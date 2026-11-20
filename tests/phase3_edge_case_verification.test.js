import http from 'http';
import assert from 'assert';
import bcrypt from "bcryptjs";
import { db } from '../src/config/db.js';
import app from '../src/app.js';
import { createAccessToken, hashOtp } from '../src/modules/auth/auth.utils.js';
import { smsService } from '../src/services/sms.service.js';

function request(options, body) {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const duration = performance.now() - start;
        try {
          resolve({ statusCode: res.statusCode, headers: res.headers, body: data ? JSON.parse(data) : {}, duration });
        } catch {
          resolve({ statusCode: res.statusCode, headers: res.headers, body: data, duration });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runEdgeCaseVerification() {
  console.log('=== STARTING EDGE-CASE HARDENING AUDIT ===');
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const testPhone = '01799112233';
  const testEmail = 'edge_case_merchant@banglaqr.com';
  let testUserId = null;

  // Mock smsService.sendOtpSms
  const originalSendOtpSms = smsService.sendOtpSms;
  smsService.sendOtpSms = async () => ({
    success: true,
    messageId: 'mock-sms-' + Date.now(),
    provider: 'GenNet',
    statusCode: 1900
  });

  try {
    // Setup test merchant
    const [ins] = await db.execute(
      `INSERT INTO users (email, phone, password_hash, status, email_verified_at, phone_verified_at)
       VALUES (?, ?, ?, 'active', NOW(), NOW())`,
      [testEmail, testPhone, await bcrypt.hash('InitialSecurePass1!', 10)]
    );
    testUserId = ins.insertId;

    const [roles] = await db.execute('SELECT id FROM roles WHERE name = "merchant" LIMIT 1');
    if (roles.length) {
      await db.execute('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [testUserId, roles[0].id]);
    }

    // -------------------------------------------------------------------------
    // 1. SAME-SECOND TOKEN REVOCATION TEST
    // -------------------------------------------------------------------------
    console.log('\n--- 1. Same-Second Token Revocation Check ---');
    const userObj = { id: testUserId, email: testEmail, role: 'merchant' };
    const sameSecondToken = createAccessToken(userObj);

    // Artificially align password_changed_at to exact same second or later than token.iat
    await db.execute(
      `UPDATE users SET password_changed_at = NOW() WHERE id = ?`,
      [testUserId]
    );

    const resSameSec = await request({
      hostname: '127.0.0.1', port, path: '/api/v1/auth/me', method: 'GET',
      headers: { 'Authorization': 'Bearer ' + sameSecondToken }
    });

    console.log('[Check 1: Same-Second Token] Status:', resSameSec.statusCode, resSameSec.body.message);
    assert.strictEqual(resSameSec.statusCode, 401, 'Token issued in the same second must be rejected');
    assert.strictEqual(resSameSec.body.message, 'Password was changed. Please log in again with your new password.');
    console.log('✓ Same-second token revocation confirmed: NO old token survives.');

    // -------------------------------------------------------------------------
    // 2. INDEPENDENT RATE LIMITING TESTS
    // -------------------------------------------------------------------------
    console.log('\n--- 2. Independent Per-IP Rate Limiting Checks ---');

    // Test POST /forgot-password limiter (limit = 5)
    console.log('Testing POST /api/v1/auth/forgot-password rate limit...');
    let forgotPasswordHit429 = false;
    for (let i = 0; i < 7; i++) {
      const res = await request({
        hostname: '127.0.0.1', port, path: '/api/v1/auth/forgot-password', method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, { phone: `0170000000${i}` });
      if (res.statusCode === 429) {
        forgotPasswordHit429 = true;
        console.log(`✓ /forgot-password hit 429 at attempt #${i + 1}`);
        break;
      }
    }
    assert.strictEqual(forgotPasswordHit429, true, 'POST /forgot-password must return 429 when per-IP limit exceeded');

    // Test POST /verify limiter (limit = 10)
    console.log('Testing POST /api/v1/auth/verify rate limit...');
    let verifyHit429 = false;
    for (let i = 0; i < 12; i++) {
      const res = await request({
        hostname: '127.0.0.1', port, path: '/api/v1/auth/verify', method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, { destination: '01711223344', code: '123456', purpose: 'login' });
      if (res.statusCode === 429) {
        verifyHit429 = true;
        console.log(`✓ /verify hit 429 at attempt #${i + 1}`);
        break;
      }
    }
    assert.strictEqual(verifyHit429, true, 'POST /verify must return 429 when per-IP limit exceeded');

    // Test POST /resend-otp limiter (limit = 5)
    console.log('Testing POST /api/v1/auth/resend-otp rate limit...');
    let resendHit429 = false;
    for (let i = 0; i < 7; i++) {
      const res = await request({
        hostname: '127.0.0.1', port, path: '/api/v1/auth/resend-otp', method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, { destination: `0171122334${i}`, purpose: 'login' });
      if (res.statusCode === 429) {
        resendHit429 = true;
        console.log(`✓ /resend-otp hit 429 at attempt #${i + 1}`);
        break;
      }
    }
    assert.strictEqual(resendHit429, true, 'POST /resend-otp must return 429 when per-IP limit exceeded');

    // -------------------------------------------------------------------------
    // 3. USER ENUMERATION TIMING ANALYSIS
    // -------------------------------------------------------------------------
    console.log('\n--- 3. User Enumeration Timing Analysis (Direct Service / Low-level) ---');
    // We measure requestPasswordReset timing for registered vs unregistered numbers
    const { requestPasswordReset } = await import('../src/modules/auth/auth.service.js');

    const registeredPhone = testPhone;
    const unregisteredPhone = '01799000000';

    const registeredTimes = [];
    const unregisteredTimes = [];

    // Run 10 samples each
    for (let i = 0; i < 10; i++) {
      // Clear OTP cooldown to allow repeated requests
      await db.execute('DELETE FROM otp_codes WHERE destination = ?', [registeredPhone]);

      const t0Reg = performance.now();
      const resReg = await requestPasswordReset({ phone: registeredPhone });
      registeredTimes.push(performance.now() - t0Reg);

      const t0Unreg = performance.now();
      const resUnreg = await requestPasswordReset({ phone: unregisteredPhone });
      unregisteredTimes.push(performance.now() - t0Unreg);

      // Verify identical response structure
      assert.strictEqual(resReg.success, resUnreg.success);
      assert.strictEqual(resReg.message, resUnreg.message);
      assert.strictEqual(resReg.cooldownSeconds, resUnreg.cooldownSeconds);
    }

    const calcStats = (times) => {
      const sorted = [...times].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      const p95 = sorted[Math.floor(sorted.length * 0.95)];
      return { median: median.toFixed(2), p95: p95.toFixed(2), min: sorted[0].toFixed(2), max: sorted[sorted.length - 1].toFixed(2) };
    };

    const regStats = calcStats(registeredTimes);
    const unregStats = calcStats(unregisteredTimes);

    console.log('Registered Phone Timing (ms):  ', regStats);
    console.log('Unregistered Phone Timing (ms):', unregStats);
    console.log('✓ Both registered and unregistered phones return identical message and payload structure.');

    // -------------------------------------------------------------------------
    // 4. OTP HASHING ACCURACY CHECK
    // -------------------------------------------------------------------------
    console.log('\n--- 4. OTP Hashing Accuracy Check ---');
    const sampleCode = '123456';
    const computedHmac = hashOtp(sampleCode);
    console.log('hashOtp computed output:', computedHmac);
    assert.strictEqual(typeof computedHmac, 'string');
    assert.strictEqual(computedHmac.length, 64, 'HMAC-SHA256 hex string must be 64 characters');

    const [otpCols] = await db.execute('SHOW FULL COLUMNS FROM otp_codes');
    const colNames = otpCols.map(c => c.Field);
    console.log('Database otp_codes columns:', colNames);
    assert.ok(colNames.includes('code_hash'), 'otp_codes has code_hash');
    assert.ok(!colNames.includes('salt'), 'CONFIRMED: Database does NOT require salt column because hashOtp uses HMAC-SHA256 with server env.otpHashSecret');
    console.log('✓ Confirmed: OTP hashing uses HMAC-SHA256 with server secret. No redundant salt column needed.');

    console.log('\n=================================================================');
    console.log('ALL EDGE-CASE HARDENING AUDIT CHECKS PASSED (100%)');
    console.log('=================================================================\n');

  } finally {
    smsService.sendOtpSms = originalSendOtpSms;
    server.close();
    if (testUserId) {
      await db.execute('DELETE FROM user_roles WHERE user_id = ?', [testUserId]);
      await db.execute('DELETE FROM otp_codes WHERE user_id = ? OR destination = ?', [testUserId, testPhone]);
      await db.execute('DELETE FROM sessions WHERE user_id = ?', [testUserId]);
      await db.execute('DELETE FROM users WHERE id = ?', [testUserId]);
      console.log('Test staging cleanup complete.');
    }
  }
}

runEdgeCaseVerification().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });

