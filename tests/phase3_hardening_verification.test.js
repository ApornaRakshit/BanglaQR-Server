import http from 'http';
import assert from 'assert';
import bcrypt from "bcryptjs";
import { db } from '../src/config/db.js';
import app from '../src/app.js';
import { createAccessToken, createPasswordResetChallengeToken } from '../src/modules/auth/auth.utils.js';

function request(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, headers: res.headers, body: data ? JSON.parse(data) : {} });
        } catch {
          resolve({ statusCode: res.statusCode, headers: res.headers, body: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runHardeningVerification() {
  console.log('=== STARTING MANDATORY VERIFICATION SUITE (B, C, D) ===');
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const testPhone = '01799988877';
  const testEmail = 'sec_audit_stage@banglaqr.com';
  let testUserId = null;

  try {
    // 0. Setup isolated test user
    const [ins] = await db.execute(
      `INSERT INTO users (email, phone, password_hash, status, email_verified_at, phone_verified_at)
       VALUES (?, ?, ?, 'active', NOW(), NOW())`,
      [testEmail, testPhone, await bcrypt.hash('InitPass123!', 10)]
    );
    testUserId = ins.insertId;

    // Add role
    const [roles] = await db.execute('SELECT id FROM roles WHERE name = "merchant" LIMIT 1');
    if (roles.length) {
      await db.execute('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [testUserId, roles[0].id]);
    }

    // -------------------------------------------------------------------------
    // B. RESET CHALLENGE REPLAY & CONCURRENCY VERIFICATION
    // -------------------------------------------------------------------------
    console.log('\n--- B. Reset Challenge Tests ---');
    const challengeJti = 'test-challenge-jti-' + Date.now();
    await db.execute(
      `INSERT INTO otp_codes (user_id, destination, purpose, code_hash, expires_at, verified_at, reset_challenge_jti)
       VALUES (?, ?, 'password_reset', 'test_dummy_hash', DATE_ADD(NOW(), INTERVAL 5 MINUTE), NOW(), ?)`,
      [testUserId, testPhone, challengeJti]
    );

    const userObj = { id: testUserId, phone: testPhone };
    const resetChallengeToken = createPasswordResetChallengeToken(userObj, challengeJti);

    // B1: First reset attempt with valid token -> Must SUCCEED (200)
    const resB1 = await request({
      hostname: '127.0.0.1', port, path: '/api/v1/auth/reset-password', method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { token: resetChallengeToken, newPassword: 'HardenedPass1!' });

    console.log('[B1: First Reset] Status:', resB1.statusCode, resB1.body.message);
    assert.strictEqual(resB1.statusCode, 200);

    // B2: Same token used a second time -> Must be REJECTED (400)
    const resB2 = await request({
      hostname: '127.0.0.1', port, path: '/api/v1/auth/reset-password', method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { token: resetChallengeToken, newPassword: 'HardenedPass2!' });

    console.log('[B2: Token Replay] Status:', resB2.statusCode, resB2.body.message);
    assert.strictEqual(resB2.statusCode, 400);

    // B3: Concurrent reset requests using same token
    const concJti = 'conc-challenge-jti-' + Date.now();
    await db.execute(
      `INSERT INTO otp_codes (user_id, destination, purpose, code_hash, expires_at, verified_at, reset_challenge_jti)
       VALUES (?, ?, 'password_reset', 'test_dummy_hash2', DATE_ADD(NOW(), INTERVAL 5 MINUTE), NOW(), ?)`,
      [testUserId, testPhone, concJti]
    );
    const concToken = createPasswordResetChallengeToken(userObj, concJti);

    const [concRes1, concRes2] = await Promise.all([
      request({ hostname: '127.0.0.1', port, path: '/api/v1/auth/reset-password', method: 'POST', headers: { 'Content-Type': 'application/json' } }, { token: concToken, newPassword: 'ConcurrentPass1!' }),
      request({ hostname: '127.0.0.1', port, path: '/api/v1/auth/reset-password', method: 'POST', headers: { 'Content-Type': 'application/json' } }, { token: concToken, newPassword: 'ConcurrentPass2!' })
    ]);

    const concStatuses = [concRes1.statusCode, concRes2.statusCode];
    console.log('[B3: Concurrency Test] Statuses:', concStatuses);
    assert.ok(concStatuses.includes(200), 'One concurrent reset must succeed');
    assert.ok(concStatuses.includes(400) || concStatuses.includes(429), 'Second concurrent reset must fail');
    assert.notStrictEqual(concRes1.statusCode + concRes2.statusCode, 400, 'Both concurrent resets must NOT succeed (200 + 200)');

    // -------------------------------------------------------------------------
    // C. ACCESS TOKEN REVOCATION VERIFICATION
    // -------------------------------------------------------------------------
    console.log('\n--- C. Access Token Revocation Tests ---');
    // Issue token BEFORE password reset. Clear password_changed_at first for test user.
    await db.execute('UPDATE users SET password_changed_at = NULL WHERE id = ?', [testUserId]);
    const userPreReset = { id: testUserId, email: testEmail, role: 'merchant' };
    const preResetToken = createAccessToken(userPreReset);

    // Verify token works on /api/v1/auth/me prior to reset
    const resPreMe = await request({
      hostname: '127.0.0.1', port, path: '/api/v1/auth/me', method: 'GET',
      headers: { 'Authorization': 'Bearer ' + preResetToken }
    });
    console.log('[C1: Pre-Reset Auth /me] Status:', resPreMe.statusCode);
    assert.strictEqual(resPreMe.statusCode, 200);

    // Sleep 1.2s to ensure timestamp separation
    await new Promise(r => setTimeout(r, 1200));

    // Reset password
    const cJti = 'c-challenge-jti-' + Date.now();
    await db.execute(
      `INSERT INTO otp_codes (user_id, destination, purpose, code_hash, expires_at, verified_at, reset_challenge_jti)
       VALUES (?, ?, 'password_reset', 'test_dummy_hash3', DATE_ADD(NOW(), INTERVAL 5 MINUTE), NOW(), ?)`,
      [testUserId, testPhone, cJti]
    );
    const cResetToken = createPasswordResetChallengeToken(userObj, cJti);
    const resResetC = await request({
      hostname: '127.0.0.1', port, path: '/api/v1/auth/reset-password', method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { token: cResetToken, newPassword: 'NewRevocationPass1!' });
    assert.strictEqual(resResetC.statusCode, 200);

    // Now attempt to use preResetToken on /api/v1/auth/me -> Must return 401
    const resPostMe = await request({
      hostname: '127.0.0.1', port, path: '/api/v1/auth/me', method: 'GET',
      headers: { 'Authorization': 'Bearer ' + preResetToken }
    });
    console.log('[C2: Post-Reset Auth /me using old token] Status:', resPostMe.statusCode, resPostMe.body.message);
    assert.strictEqual(resPostMe.statusCode, 401);
    assert.strictEqual(resPostMe.body.message, 'Password was changed. Please log in again with your new password.');

    // -------------------------------------------------------------------------
    // D. PER-IP RATE LIMITING VERIFICATION
    // -------------------------------------------------------------------------
    console.log('\n--- D. Per-IP Rate Limiting Tests ---');
    // Rapidly send requests to trigger rate limiter on /forgot-password
    let got429 = false;
    for (let i = 0; i < 7; i++) {
      const res = await request({
        hostname: '127.0.0.1', port, path: '/api/v1/auth/forgot-password', method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, { phone: '0171111222' + i });
      if (res.statusCode === 429) {
        got429 = true;
        console.log(`[D1: Rate Limiter Triggered at request #${i + 1}] Status: 429 Message:`, res.body.message);
        break;
      }
    }
    assert.strictEqual(got429, true, 'Per-IP rate limiter must trigger 429 on excessive requests');

    console.log('\nALL VERIFICATION CRITERIA B, C, D CONFIRMED AND PASSED (100%)');
  } finally {
    server.close();
    if (testUserId) {
      await db.execute('DELETE FROM user_roles WHERE user_id = ?', [testUserId]);
      await db.execute('DELETE FROM otp_codes WHERE user_id = ?', [testUserId]);
      await db.execute('DELETE FROM sessions WHERE user_id = ?', [testUserId]);
      await db.execute('DELETE FROM users WHERE id = ?', [testUserId]);
      console.log('Test staging clean up completed.');
    }
  }
}

runHardeningVerification().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });

