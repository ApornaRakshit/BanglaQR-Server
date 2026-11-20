import http from 'http';
import assert from 'assert';
import bcrypt from "bcryptjs";
import jwt from 'jsonwebtoken';
import { db } from '../src/config/db.js';
import app from '../src/app.js';
import { env } from '../src/config/env.js';
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

async function runFinalChecks() {
  console.log('=== RUNNING FINAL TOKEN_VERSION SECURITY CHECKS ===');
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const testPhone = '01722334455';
  const testEmail = 'final_checks_user@banglaqr.com';
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
    // 1. LEGACY JWT COMPATIBILITY (token_version absent in payload, DB version = 0)
    // -------------------------------------------------------------------------
    console.log('\n--- 1. Legacy JWT Compatibility Test ---');
    // Sign a token without token_version
    const legacyToken = jwt.sign(
      { sub: String(testUserId), email: testEmail, role: 'merchant' },
      env.jwt.accessSecret,
      { expiresIn: '7d' }
    );
    const resLegacy = await request({
      hostname: '127.0.0.1', port, path: '/api/v1/auth/me', method: 'GET',
      headers: { 'Authorization': 'Bearer ' + legacyToken }
    });
    console.log('[Legacy Token with DB token_version = 0] Status:', resLegacy.statusCode);
    assert.strictEqual(resLegacy.statusCode, 200, 'Legacy token without token_version must be accepted when DB version is 0');
    console.log('✓ Legacy JWT compatibility confirmed.');

    // -------------------------------------------------------------------------
    // 2. OLD TOKEN AFTER PASSWORD RESET -> HTTP 401
    // -------------------------------------------------------------------------
    console.log('\n--- 2. Old Token & Multi-Device Invalidation ---');
    const tokenDeviceA = createAccessToken({ id: testUserId, email: testEmail, role: 'merchant', token_version: 0 });
    const tokenDeviceB = createAccessToken({ id: testUserId, email: testEmail, role: 'merchant', token_version: 0 });

    // Trigger password reset via service / endpoint
    const challengeJti = 'final-jti-' + Date.now();
    await db.execute(
      `INSERT INTO otp_codes (user_id, destination, purpose, code_hash, expires_at, verified_at, reset_challenge_jti)
       VALUES (?, ?, 'password_reset', 'test_dummy_hash', DATE_ADD(NOW(), INTERVAL 5 MINUTE), NOW(), ?)`,
      [testUserId, testPhone, challengeJti]
    );
    const challengeToken = createPasswordResetChallengeToken({ id: testUserId, phone: testPhone }, challengeJti);

    const resetRes = await request({
      hostname: '127.0.0.1', port, path: '/api/v1/auth/reset-password', method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { token: challengeToken, newPassword: 'BrandNewPassword123!' });
    assert.strictEqual(resetRes.statusCode, 200);

    // Old token on Device A -> 401
    const resOldA = await request({
      hostname: '127.0.0.1', port, path: '/api/v1/auth/me', method: 'GET',
      headers: { 'Authorization': 'Bearer ' + tokenDeviceA }
    });
    console.log('[Old Token Device A] Status:', resOldA.statusCode, resOldA.body.message);
    assert.strictEqual(resOldA.statusCode, 401);
    assert.strictEqual(resOldA.body.message, 'Session has been invalidated. Please log in again.');

    // Previous token on Device B -> 401
    const resOldB = await request({
      hostname: '127.0.0.1', port, path: '/api/v1/auth/me', method: 'GET',
      headers: { 'Authorization': 'Bearer ' + tokenDeviceB }
    });
    console.log('[Old Token Device B] Status:', resOldB.statusCode, resOldB.body.message);
    assert.strictEqual(resOldB.statusCode, 401);
    console.log('✓ Old tokens on all devices rejected with 401.');

    // -------------------------------------------------------------------------
    // 3. FRESH LOGIN IN THE SAME SECOND -> HTTP 200
    // -------------------------------------------------------------------------
    console.log('\n--- 3. Fresh Login in the Same Second ---');
    const freshSameSecondToken = createAccessToken({
      id: testUserId,
      email: testEmail,
      role: 'merchant',
      token_version: 1,
    });
    const resSameSec = await request({
      hostname: '127.0.0.1', port, path: '/api/v1/auth/me', method: 'GET',
      headers: { 'Authorization': 'Bearer ' + freshSameSecondToken }
    });
    console.log('[Fresh Same-Second Token] Status:', resSameSec.statusCode);
    assert.strictEqual(resSameSec.statusCode, 200);
    console.log('✓ Fresh token issued in the same second succeeds.');

    // -------------------------------------------------------------------------
    // 4. FRESH LOGIN ON ANOTHER DEVICE -> HTTP 200
    // -------------------------------------------------------------------------
    console.log('\n--- 4. Fresh Login on Another Device ---');
    const freshDeviceCToken = createAccessToken({
      id: testUserId,
      email: testEmail,
      role: 'merchant',
      token_version: 1,
    });
    const resDeviceC = await request({
      hostname: '127.0.0.1', port, path: '/api/v1/auth/me', method: 'GET',
      headers: { 'Authorization': 'Bearer ' + freshDeviceCToken }
    });
    console.log('[Fresh Token Device C] Status:', resDeviceC.statusCode);
    assert.strictEqual(resDeviceC.statusCode, 200);
    console.log('✓ Fresh token on another device succeeds.');

    // -------------------------------------------------------------------------
    // 5. TOKEN WITH MISMATCHED VERSION (e.g. Higher/Stale) -> HTTP 401
    // -------------------------------------------------------------------------
    console.log('\n--- 5. Token with Mismatched Version (tokenVersion !== user.token_version) ---');
    const mismatchedToken = createAccessToken({
      id: testUserId,
      email: testEmail,
      role: 'merchant',
      token_version: 999, // Mismatched (DB has 1)
    });
    const resMismatch = await request({
      hostname: '127.0.0.1', port, path: '/api/v1/auth/me', method: 'GET',
      headers: { 'Authorization': 'Bearer ' + mismatchedToken }
    });
    console.log('[Mismatched Version (token=999, DB=1)] Status:', resMismatch.statusCode, resMismatch.body.message);
    assert.strictEqual(resMismatch.statusCode, 401);
    assert.strictEqual(resMismatch.body.message, 'Session has been invalidated. Please log in again.');
    console.log('✓ Strict equality verification passed (Mismatched version rejected with 401).');

    console.log('\n=================================================================');
    console.log('ALL FINAL TOKEN_VERSION SECURITY CHECKS PASSED (100%)');
    console.log('=================================================================\n');

  } finally {
    server.close();
    if (testUserId) {
      await db.execute('DELETE FROM user_roles WHERE user_id = ?', [testUserId]);
      await db.execute('DELETE FROM otp_codes WHERE user_id = ?', [testUserId]);
      await db.execute('DELETE FROM sessions WHERE user_id = ?', [testUserId]);
      await db.execute('DELETE FROM users WHERE id = ?', [testUserId]);
      console.log('Test staging cleanup complete.');
    }
  }
}

runFinalChecks().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });

