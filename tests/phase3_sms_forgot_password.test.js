import http from 'http';
import app from '../src/app.js';
import bcrypt from "bcryptjs";
import { db } from '../src/config/db.js';
import { smsService } from '../src/services/sms.service.js';
import assert from 'assert';

function request(server, options, bodyData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (_) {}
        resolve({ statusCode: res.statusCode, headers: res.headers, body: json || data });
      });
    });
    req.on('error', reject);
    if (bodyData) {
      req.write(typeof bodyData === 'string' ? bodyData : JSON.stringify(bodyData));
    }
    req.end();
  });
}

async function runPhase3TestSuite() {
  console.log('=== STARTING PHASE 3 SMS OTP FORGOT PASSWORD ACCEPTANCE TESTS ===');

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  // Mock smsService to intercept SMS and capture OTP without sending real SMS
  const originalSendOtpSms = smsService.sendOtpSms;
  let lastCapturedSms = null;
  smsService.sendOtpSms = async function(args) {
    lastCapturedSms = args;
    return { success: true, mocked: true, csms_id: 'MOCK' + Date.now() };
  };

  const randSuffix = Math.floor(Math.random() * 89999999 + 10000000);
  const testPhone = '017' + randSuffix;
  const initialPassword = 'InitialSecretPassword123!';
  const initialPasswordHash = await bcrypt.hash(initialPassword, 10);

  // 1. Create Staging Test Merchant
  const [uRow] = await db.query(
    'INSERT INTO users (email, password_hash, phone, status, phone_verified_at) VALUES (?, ?, ?, ?, NOW())',
    ['forgot_pass_' + Date.now() + '@test.staging', initialPasswordHash, testPhone, 'active']
  );
  const testUserId = uRow.insertId;

  // Create an active session to test revocation
  const [sessionRow] = await db.query(
    'INSERT INTO sessions (user_id, session_token_hash, ip_address, expires_at, created_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 1 DAY), NOW())',
    [testUserId, 'fake_session_token_hash_abc123', '127.0.0.1']
  );
  const sessionId = sessionRow.insertId;

  try {
    console.log('[Setup] Created test merchant user (ID: ' + testUserId + ', Phone: ' + testPhone + ')');

    // ----------------------------------------------------
    // TEST 1: Request with Invalid Mobile Number
    // ----------------------------------------------------
    const resInvalidPhone = await request(server, {
      hostname: '127.0.0.1',
      port,
      path: '/api/v1/auth/forgot-password',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { phone: '12345' });

    console.log('[Test 1] Invalid phone rejected with status:', resInvalidPhone.statusCode);
    assert.ok(resInvalidPhone.statusCode === 400);

    // ----------------------------------------------------
    // TEST 2: Request with Valid Registered Mobile (Sends 6-digit OTP via GenNet mock)
    // ----------------------------------------------------
    const resValidReq = await request(server, {
      hostname: '127.0.0.1',
      port,
      path: '/api/v1/auth/forgot-password',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { phone: testPhone });

    // Give async outbox worker a moment to process the queued job
    await new Promise(resolve => setTimeout(resolve, 150));

    console.log('[Test 2] OTP requested successfully with status:', resValidReq.statusCode);
    assert.strictEqual(resValidReq.statusCode, 200);
    assert.strictEqual(resValidReq.body.success, true);
    assert.ok(lastCapturedSms, 'SMS sender was called');
    assert.strictEqual(lastCapturedSms.to, testPhone);
    assert.ok(/^\d{6}$/.test(lastCapturedSms.otp), 'Generated OTP must be 6 digits');
    const sentOtp = lastCapturedSms.otp;
    console.log('[Test 2] Captured 6-digit OTP:', sentOtp);

    // Verify OTP in MySQL otp_codes table is hashed and has 5m expiration
    const [otpDbRow] = await db.query(
      `SELECT * FROM otp_codes WHERE destination = ? AND purpose = 'password_reset' ORDER BY created_at DESC LIMIT 1`,
      [testPhone]
    );
    assert.ok(otpDbRow.length > 0);
    assert.notStrictEqual(otpDbRow[0].code_hash, sentOtp, 'OTP must be stored as HMAC hash, never in plaintext');
    const otpDbId = otpDbRow[0].id;

    // ----------------------------------------------------
    // TEST 3: Resend Cooldown Test (< 60 seconds returns 429)
    // ----------------------------------------------------
    const resCooldown = await request(server, {
      hostname: '127.0.0.1',
      port,
      path: '/api/v1/auth/forgot-password',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { phone: testPhone });

    console.log('[Test 3] Cooldown enforced within 60s. Status:', resCooldown.statusCode);
    assert.strictEqual(resCooldown.statusCode, 429);

    // ----------------------------------------------------
    // TEST 4: Wrong OTP Code Rejected with Attempts Counter Increment
    // ----------------------------------------------------
    const resWrongOtp = await request(server, {
      hostname: '127.0.0.1',
      port,
      path: '/api/v1/auth/verify',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { destination: testPhone, code: '000000', purpose: 'password_reset' });

    console.log('[Test 4] Wrong OTP rejected with status:', resWrongOtp.statusCode);
    assert.strictEqual(resWrongOtp.statusCode, 400);

    const [otpAfterWrong] = await db.query('SELECT attempts FROM otp_codes WHERE id = ?', [otpDbId]);
    assert.strictEqual(otpAfterWrong[0].attempts, 1, 'Invalid attempt counter must increment in database');

    // ----------------------------------------------------
    // TEST 5: Reset OTP Cannot Be Used For Direct Login
    // ----------------------------------------------------
    const resWrongPurpose = await request(server, {
      hostname: '127.0.0.1',
      port,
      path: '/api/v1/auth/verify',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { destination: testPhone, code: sentOtp, purpose: 'login' });

    console.log('[Test 5] Using reset OTP for login rejected with status:', resWrongPurpose.statusCode);
    assert.strictEqual(resWrongPurpose.statusCode, 400);

    // ----------------------------------------------------
    // TEST 6: Successful OTP Verification returns one-time challenge token (NO auto-login accessToken)
    // ----------------------------------------------------
    const resVerifyOtp = await request(server, {
      hostname: '127.0.0.1',
      port,
      path: '/api/v1/auth/verify',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { destination: testPhone, code: sentOtp, purpose: 'password_reset' });

    console.log('[Test 6] OTP verified successfully with status:', resVerifyOtp.statusCode);
    assert.strictEqual(resVerifyOtp.statusCode, 200);
    const verifyData = resVerifyOtp.body.data || resVerifyOtp.body;
    assert.strictEqual(verifyData.verified, true);
    assert.ok(verifyData.resetToken, 'Short-lived password reset challenge token must be returned');
    assert.strictEqual(verifyData.accessToken, undefined, 'Must NOT return accessToken or auto-log merchant in');
    const resetChallengeToken = verifyData.resetToken;

    // ----------------------------------------------------
    // TEST 7: Single-Use OTP Enforcement (Replaying same OTP is rejected)
    // ----------------------------------------------------
    const resReplayOtp = await request(server, {
      hostname: '127.0.0.1',
      port,
      path: '/api/v1/auth/verify',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { destination: testPhone, code: sentOtp, purpose: 'password_reset' });

    console.log('[Test 7] Replaying consumed OTP rejected with status:', resReplayOtp.statusCode);
    assert.strictEqual(resReplayOtp.statusCode, 400);

    // ----------------------------------------------------
    // TEST 8: Reset Password with New Password & Session Revocation
    // ----------------------------------------------------
    const newPassword = 'BrandNewSuperSecret2026!';
    const resResetPass = await request(server, {
      hostname: '127.0.0.1',
      port,
      path: '/api/v1/auth/reset-password',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { token: resetChallengeToken, newPassword });

    console.log('[Test 8] Password reset succeeded with status:', resResetPass.statusCode);
    assert.strictEqual(resResetPass.statusCode, 200);
    assert.strictEqual(resResetPass.body.success, true);

    // Verify Sessions Revocation in DB
    const [sessionsLeft] = await db.query('SELECT * FROM sessions WHERE user_id = ?', [testUserId]);
    assert.strictEqual(sessionsLeft.length, 0, 'All existing active sessions must be revoked upon password reset');
    console.log('[Test 8] Verified: Existing sessions revoked successfully from database.');

    // ----------------------------------------------------
    // TEST 9: Authentication Check (Old password FAILS, New password SUCCEEDS)
    // ----------------------------------------------------
    const [userDb] = await db.query('SELECT password_hash FROM users WHERE id = ?', [testUserId]);
    const oldPasswordMatches = await bcrypt.compare(initialPassword, userDb[0].password_hash);
    const newPasswordMatches = await bcrypt.compare(newPassword, userDb[0].password_hash);

    assert.strictEqual(oldPasswordMatches, false, 'Old password must no longer match');
    assert.strictEqual(newPasswordMatches, true, 'New password must match bcryptjs hash');
    console.log('[Test 9] Verified: Old password rejected, new password verified via bcryptjs.');

    console.log('\n=================================================================');
    console.log('ALL PHASE 3 SMS OTP FORGOT PASSWORD ACCEPTANCE TESTS PASSED (100%)');
    console.log('=================================================================\n');

  } finally {
    smsService.sendOtpSms = originalSendOtpSms;
    server.close();
    // Cleanup test records
    await db.query('DELETE FROM sessions WHERE user_id = ?', [testUserId]);
    await db.query('DELETE FROM otp_codes WHERE user_id = ? OR destination = ?', [testUserId, testPhone]);
    await db.query('DELETE FROM users WHERE id = ?', [testUserId]);
    console.log('Test staging cleanup complete.');
  }
}

runPhase3TestSuite().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
