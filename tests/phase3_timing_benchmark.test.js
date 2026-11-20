import http from 'http';
import assert from 'assert';
import bcrypt from "bcryptjs";
import { db } from '../src/config/db.js';
import { env } from '../src/config/env.js';
import { smsService } from '../src/services/sms.service.js';

// Linear interpolation percentile calculation (Standard method, NIST / Excel PERCENTILE.INC)
function calculatePercentile(sortedArray, percentile) {
  if (!sortedArray || sortedArray.length === 0) return 0;
  if (sortedArray.length === 1) return sortedArray[0];
  const p = percentile / 100;
  const index = p * (sortedArray.length - 1);
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);
  const weight = index - lowerIndex;
  return sortedArray[lowerIndex] + weight * (sortedArray[upperIndex] - sortedArray[lowerIndex]);
}

function calculateStandardDeviation(values, mean) {
  if (values.length <= 1) return 0;
  const variance = values.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function httpRequest(options, body) {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const duration = performance.now() - start;
        try {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: data ? JSON.parse(data) : {},
            duration
          });
        } catch {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: data,
            duration
          });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runStrictTimingBenchmark() {
  console.log('=== STARTING 100-CYCLE INTERLEAVED HTTP USER-ENUMERATION BENCHMARK ===');

  // Strict staging/test database safety guard
  const currentDbName = env.db.name;
  console.log(`[Safety Guard] Checking database name: "${currentDbName}"`);
  if (!currentDbName || currentDbName.toLowerCase().includes('prod') || currentDbName.toLowerCase().includes('live')) {
    throw new Error(`CRITICAL: Benchmark aborted! Database "${currentDbName}" may be a production database.`);
  }

  // Set BENCHMARK_MODE for this process only
  process.env.BENCHMARK_MODE = "true";

  // Mock GenNet SMS Service to guarantee NO real SMS is dispatched
  let smsSentCount = 0;
  const originalSendOtpSms = smsService.sendOtpSms;
  smsService.sendOtpSms = async (payload) => {
    smsSentCount++;
    return {
      success: true,
      messageId: `mock-benchmark-${Date.now()}-${smsSentCount}`,
      provider: 'GenNet-Mocked',
      statusCode: 1900,
    };
  };

  // Launch local test HTTP server to measure end-to-end endpoint performance
  const { default: app } = await import('../src/app.js');
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const testPhone = '01733449988';
  const testEmail = 'benchmark_user_100@banglaqr.com';
  const unregisteredPhone = '01799008877';
  let testUserId = null;

  try {
    // 1. Create dedicated benchmark user
    const [ins] = await db.execute(
      `INSERT INTO users (email, phone, password_hash, status, token_version, email_verified_at, phone_verified_at)
       VALUES (?, ?, ?, 'active', 0, NOW(), NOW())`,
      [testEmail, testPhone, await bcrypt.hash('InitPass123!', 10)]
    );
    testUserId = ins.insertId;

    const registeredTimes = [];
    const unregisteredTimes = [];
    const SAMPLES = 100;

    console.log(`Running ${SAMPLES} interleaved requests across HTTP port ${port} (Total = ${SAMPLES * 2} HTTP requests)...`);

    for (let i = 0; i < SAMPLES; i++) {
      // Clear OTP cooldown strictly for these dedicated benchmark phones
      await db.execute('DELETE FROM otp_codes WHERE user_id = ? OR destination IN (?, ?)', [
        testUserId,
        testPhone,
        unregisteredPhone,
      ]);

      // Alternate order to avoid bias
      const order = i % 2 === 0 ? ['reg', 'unreg'] : ['unreg', 'reg'];

      for (const type of order) {
        if (type === 'reg') {
          const res = await httpRequest({
            hostname: '127.0.0.1',
            port,
            path: '/api/v1/auth/forgot-password',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
          }, { phone: testPhone });

          registeredTimes.push(res.duration);

          // Assert successful generic response
          assert.strictEqual(res.statusCode, 200, `Registered response status must be 200 (Got ${res.statusCode})`);
          assert.strictEqual(res.body.success, true);
          assert.strictEqual(res.body.data.destination, testPhone);
          assert.strictEqual(res.body.data.cooldownSeconds, 60);
          assert.strictEqual(res.body.message, 'যদি এই মোবাইল নম্বরে নিবন্ধিত অ্যাকাউন্ট থাকে, তবে ভেরিফিকেশন কোড পাঠানো হয়েছে।');
        } else {
          const res = await httpRequest({
            hostname: '127.0.0.1',
            port,
            path: '/api/v1/auth/forgot-password',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
          }, { phone: unregisteredPhone });

          unregisteredTimes.push(res.duration);

          // Assert successful generic response
          assert.strictEqual(res.statusCode, 200, `Unregistered response status must be 200 (Got ${res.statusCode})`);
          assert.strictEqual(res.body.success, true);
          assert.strictEqual(res.body.data.destination, unregisteredPhone);
          assert.strictEqual(res.body.data.cooldownSeconds, 60);
          assert.strictEqual(res.body.message, 'যদি এই মোবাইল নম্বরে নিবন্ধিত অ্যাকাউন্ট থাকে, তবে ভেরিফিকেশন কোড পাঠানো হয়েছে।');
        }
      }
    }

    const processStats = (timings) => {
      const sorted = [...timings].sort((a, b) => a - b);
      const min = sorted[0];
      const max = sorted[sorted.length - 1];
      const avg = sorted.reduce((sum, v) => sum + v, 0) / sorted.length;
      const median = calculatePercentile(sorted, 50);
      const p95 = calculatePercentile(sorted, 95);
      const p99 = calculatePercentile(sorted, 99);
      const stdDev = calculateStandardDeviation(sorted, avg);
      return { min, max, avg, median, p95, p99, stdDev, sorted };
    };

    const regStats = processStats(registeredTimes);
    const unregStats = processStats(unregisteredTimes);

    console.log('\n=================================================================');
    console.log('         100-CYCLE HTTP USER-ENUMERATION BENCHMARK RESULTS       ');
    console.log('=================================================================');
    console.log(`Total HTTP Requests Executed: ${SAMPLES * 2}`);
    console.log(`Mock SMS Dispatches Triggered: ${smsSentCount}`);
    console.log(`HTTP Response Consistency: 100% IDENTICAL CONTRACT`);

    console.log('\nRegistered Mobile Endpoint Performance (N=100):');
    console.log(`- Minimum:           ${regStats.min.toFixed(2)} ms`);
    console.log(`- Median (P50):      ${regStats.median.toFixed(2)} ms`);
    console.log(`- Average:           ${regStats.avg.toFixed(2)} ms`);
    console.log(`- P95:               ${regStats.p95.toFixed(2)} ms`);
    console.log(`- P99:               ${regStats.p99.toFixed(2)} ms`);
    console.log(`- Maximum:           ${regStats.max.toFixed(2)} ms`);
    console.log(`- Standard Deviation: ${regStats.stdDev.toFixed(2)} ms`);

    console.log('\nUnregistered Mobile Endpoint Performance (N=100):');
    console.log(`- Minimum:           ${unregStats.min.toFixed(2)} ms`);
    console.log(`- Median (P50):      ${unregStats.median.toFixed(2)} ms`);
    console.log(`- Average:           ${unregStats.avg.toFixed(2)} ms`);
    console.log(`- P95:               ${unregStats.p95.toFixed(2)} ms`);
    console.log(`- P99:               ${unregStats.p99.toFixed(2)} ms`);
    console.log(`- Maximum:           ${unregStats.max.toFixed(2)} ms`);
    console.log(`- Standard Deviation: ${unregStats.stdDev.toFixed(2)} ms`);

    // Timing distributions
    const buckets = [
      { label: '< 15 ms', test: v => v < 15 },
      { label: '15 ms - 25 ms', test: v => v >= 15 && v < 25 },
      { label: '25 ms - 40 ms', test: v => v >= 25 && v < 40 },
      { label: '>= 40 ms', test: v => v >= 40 },
    ];

    console.log('\nTiming Distribution Breakdown:');
    console.log('Range            | Registered (Count) | Unregistered (Count)');
    console.log('-----------------|--------------------|---------------------');
    for (const b of buckets) {
      const regCount = registeredTimes.filter(b.test).length;
      const unregCount = unregisteredTimes.filter(b.test).length;
      console.log(`${b.label.padEnd(17)}| ${String(regCount).padEnd(19)}| ${String(unregCount).padEnd(20)}`);
    }

  } finally {
    delete process.env.BENCHMARK_MODE;
    smsService.sendOtpSms = originalSendOtpSms;
    server.close();
    if (testUserId) {
      // Clean up strictly for dedicated benchmark user
      await db.execute('DELETE FROM otp_codes WHERE user_id = ? OR destination = ?', [testUserId, testPhone]);
      await db.execute('DELETE FROM users WHERE id = ?', [testUserId]);
      console.log('\n[Safety Guard] Cleaned up dedicated benchmark user records only.');
    }
  }
}

runStrictTimingBenchmark().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
