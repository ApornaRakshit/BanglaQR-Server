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

async function runTokenVersionAudit() {
  console.log('=== STARTING TOKEN_VERSION REVOCATION SUITE (TESTS A, B, C, D, E) ===');
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const testPhone = '01755667788';
  const testEmail = 'token_version_test@banglaqr.com';
  let testUserId = null;

  try {
    // 0. Setup isolated test user with token_version = 0
    const [ins] = await db.execute(
      `INSERT INTO users (email, phone, password_hash, status, token_version, email_verified_at, phone_verified_at)
       VALUES (?, ?, ?, 'active', 0, NOW(), NOW())`,
      [testEmail, testPhone, await bcrypt.hash('InitPass123!', 10)]
    );
    testUserId = ins.insertId;

    const [roles] = await db.execute('SELECT id FROM roles WHERE name = "merchant" LIMIT 1');
    if (roles.length) {
      await db.execute('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [testUserId, roles[0].id]);
    }

    // -------------------------------------------------------------------------
    // TEST A: Old token after password reset -> HTTP 401
    // -------------------------------------------------------------------------
    console.log('\n--- TEST A & D: Old token after password reset & multi-device invalidation ---');
    // Issue token for Device 1 (pre-reset, token_version = 0)
    const tokenDev1 = createAccessToken({ id: testUserId, email: testEmail, role: 'merchant', token_version: 0 });
    // Issue token for Device 2 (pre-reset, token_version = 0)
    const tokenDev2 = createAccessToken({ id: testUserId, email: testEmail, role: 'merchant', token_version: 0 });

    // Verify both tokens work prior to password reset
    const preResDev1 = await request({
      hostname: '127.0.0.1', port, path: '/api/v1/auth/me', method: 'GET',
      headers: { 'Authorization': 'Bearer ' + tokenDev1 }
    });
    assert.strictEqual(preResDev1.statusCode, 200, 'Dev1 pre-reset token must be 200');

    const preResDev2 = await request({
      hostname: '127.0.0.1', port, path: '/api/v1/auth/me', method: 'GET',
      headers: { 'Authorization': 'Bearer ' + tokenDev2 }
    });
    assert.strictEqual(preResDev2.statusCode, 200, 'Dev2 pre-reset token must be 200');

    // Create password reset challenge
    const challengeJti = 'tv-jti-' + Date.now();
    await db.execute(
      `INSERT INTO otp_codes (user_id, destination, purpose, code_hash, expires_at, verified_at, reset_challenge_jti)
       VALUES (?, ?, 'password_reset', 'test_dummy_hash', DATE_ADD(NOW(), INTERVAL 5 MINUTE), NOW(), ?)`,
      [testUserId, testPhone, challengeJti]
    );
    const challengeToken = createPasswordResetChallengeToken({ id: testUserId, phone: testPhone }, challengeJti);

    // Reset Password
    const resetRes = await request({
      hostname: '127.0.0.1', port, path: '/api/v1/auth/reset-password', method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { token: challengeToken, newPassword: 'FreshResetPass123!' });
    assert.strictEqual(resetRes.statusCode, 200, 'Reset password must return 200');

    // Verify in database: token_version incremented from 0 to 1
    const [uDb] = await db.execute('SELECT token_version FROM users WHERE id = ?', [testUserId]);
    console.log('[DB Verify] New token_version:', uDb[0].token_version);
    assert.strictEqual(Number(uDb[0].token_version), 1, 'token_version must increment to 1');

    // TEST A: Check Dev1 old token -> Must be 401
    const postResDev1 = await request({
      hostname: '127.0.0.1', port, path: '/api/v1/auth/me', method: 'GET',
      headers: { 'Authorization': 'Bearer ' + tokenDev1 }
    });
    console.log('[Test A: Dev1 Old Token] Status:', postResDev1.statusCode, postResDev1.body.message);
    assert.strictEqual(postResDev1.statusCode, 401);
    assert.strictEqual(postResDev1.body.message, 'Session has been invalidated. Please log in again.');

    // TEST D: Check Dev2 old token -> Must also be 401
    const postResDev2 = await request({
      hostname: '127.0.0.1', port, path: '/api/v1/auth/me', method: 'GET',
      headers: { 'Authorization': 'Bearer ' + tokenDev2 }
    });
    console.log('[Test D: Dev2 Old Token on Another Device] Status:', postResDev2.statusCode, postResDev2.body.message);
    assert.strictEqual(postResDev2.statusCode, 401);
    assert.strictEqual(postResDev2.body.message, 'Session has been invalidated. Please log in again.');
    console.log('✓ TEST A & D PASSED: Previous tokens on all devices invalidated.');

    // -------------------------------------------------------------------------
    // TEST B: Fresh login immediately after reset in the SAME SECOND -> HTTP 200
    // -------------------------------------------------------------------------
    console.log('\n--- TEST B: Fresh login in the SAME SECOND ---');
    // Issue fresh token with updated token_version = 1
    const freshSameSecondToken = createAccessToken({
      id: testUserId,
      email: testEmail,
      role: 'merchant',
      token_version: 1,
    });

    const sameSecRes = await request({
      hostname: '127.0.0.1', port, path: '/api/v1/auth/me', method: 'GET',
      headers: { 'Authorization': 'Bearer ' + freshSameSecondToken }
    });
    console.log('[Test B: Fresh Same-Second Token] Status:', sameSecRes.statusCode);
    assert.strictEqual(sameSecRes.statusCode, 200, 'Fresh token issued in the same second must return 200 OK');
    console.log('✓ TEST B PASSED: Fresh login in the same second succeeds without race conditions.');

    // -------------------------------------------------------------------------
    // TEST C: Fresh token on another device -> HTTP 200
    // -------------------------------------------------------------------------
    console.log('\n--- TEST C: Fresh token on another device ---');
    const freshDev3Token = createAccessToken({
      id: testUserId,
      email: testEmail,
      role: 'merchant',
      token_version: 1,
    });

    const dev3Res = await request({
      hostname: '127.0.0.1', port, path: '/api/v1/auth/me', method: 'GET',
      headers: { 'Authorization': 'Bearer ' + freshDev3Token }
    });
    console.log('[Test C: Fresh Token on another device] Status:', dev3Res.statusCode);
    assert.strictEqual(dev3Res.statusCode, 200);
    console.log('✓ TEST C PASSED: Fresh token on another device succeeds.');

    // -------------------------------------------------------------------------
    // TEST E: Concurrent reset challenge replay -> only one succeeds
    // -------------------------------------------------------------------------
    console.log('\n--- TEST E: Concurrent reset challenge replay ---');
    const concJti = 'conc-tv-jti-' + Date.now();
    await db.execute(
      `INSERT INTO otp_codes (user_id, destination, purpose, code_hash, expires_at, verified_at, reset_challenge_jti)
       VALUES (?, ?, 'password_reset', 'test_dummy_hash2', DATE_ADD(NOW(), INTERVAL 5 MINUTE), NOW(), ?)`,
      [testUserId, testPhone, concJti]
    );
    const concChallengeToken = createPasswordResetChallengeToken({ id: testUserId, phone: testPhone }, concJti);

    const [concRes1, concRes2] = await Promise.all([
      request({ hostname: '127.0.0.1', port, path: '/api/v1/auth/reset-password', method: 'POST', headers: { 'Content-Type': 'application/json' } }, { token: concChallengeToken, newPassword: 'ConcurrentPass1!' }),
      request({ hostname: '127.0.0.1', port, path: '/api/v1/auth/reset-password', method: 'POST', headers: { 'Content-Type': 'application/json' } }, { token: concChallengeToken, newPassword: 'ConcurrentPass2!' })
    ]);

    const statuses = [concRes1.statusCode, concRes2.statusCode];
    console.log('[Test E: Concurrency Statuses]:', statuses);
    assert.ok(statuses.includes(200), 'One reset must succeed (200)');
    assert.ok(statuses.includes(400) || statuses.includes(429), 'Second reset must fail (400 or 429)');
    assert.notStrictEqual(concRes1.statusCode + concRes2.statusCode, 400, 'Both concurrent requests must NOT succeed');
    console.log('✓ TEST E PASSED: Only one concurrent reset succeeded.');

    console.log('\n=================================================================');
    console.log('ALL TOKEN_VERSION REVOCATION TESTS (A - E) PASSED (100%)');
    console.log('=================================================================\n');

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

runTokenVersionAudit().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });

