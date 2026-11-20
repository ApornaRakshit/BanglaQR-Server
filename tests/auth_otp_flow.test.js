import assert from "node:assert";
import { db } from "../src/config/db.js";
import {
  registerUser,
  loginUser,
  completeLoginWithOtp,
} from "../src/modules/auth/auth.service.js";

async function testAuthOtpFlow() {
  console.log("=== Testing Mandatory Phone SMS OTP for Signup and Login ===");

  const testEmail = `test_merchant_${Date.now()}@banglaqr.test`;
  const testPhone = "01812345678";
  const testPassword = "Password123@#";

  // Cleanup before test
  await db.execute("DELETE FROM users WHERE email = ? OR phone = ?", [testEmail, testPhone]);
  await db.execute("DELETE FROM otp_codes WHERE destination = ?", [testPhone]);

  try {
    // 1. SIGNUP TEST: Direct signup must NOT give access token; must send OTP and require verification
    console.log("1. Executing Registration...");
    const regResult = await registerUser({
      fullName: "Test Merchant",
      name: "Test Merchant",
      email: testEmail,
      phone: testPhone,
      password: testPassword,
    });

    assert.strictEqual(regResult.accessToken, null, "Registration must NOT return accessToken directly!");
    assert.strictEqual(regResult.status, "pending", "User must be in pending status before OTP verification");
    console.log("✓ Registration completed with pending status and NO direct login token");

    // Check that OTP code was generated in database for phone
    const [regOtps] = await db.execute(
      "SELECT * FROM otp_codes WHERE destination = ? AND purpose = 'phone_verification' ORDER BY created_at DESC LIMIT 1",
      [testPhone]
    );
    assert.strictEqual(regOtps.length, 1, "Phone verification OTP must be dispatched on registration");
    console.log("✓ Phone verification OTP generated in DB for registration");

    // Manually activate/verify user's registration for login testing
    await db.execute(
      "UPDATE users SET status = 'active', phone_verified_at = NOW(), email_verified_at = NOW() WHERE id = ?",
      [regResult.userId]
    );

    // 2. LOGIN TEST: Password check must NOT log user in directly; must initiate OTP challenge
    console.log("\n2. Executing Login with credentials...");
    const loginResult = await loginUser({
      email: testEmail,
      password: testPassword,
    });

    assert.strictEqual(loginResult.requiresOtp, true, "Login must return requiresOtp: true!");
    assert.ok(loginResult.challengeToken, "Login must provide challengeToken for 2FA completion");
    assert.strictEqual(loginResult.accessToken, undefined, "Login must NOT return accessToken before OTP check!");
    console.log("✓ Login intercepted with requiresOtp: true and challengeToken issued");

    // Check that a login OTP was created in database
    const [loginOtps] = await db.execute(
      "SELECT * FROM otp_codes WHERE destination = ? AND purpose = 'login' ORDER BY created_at DESC LIMIT 1",
      [testPhone]
    );
    assert.strictEqual(loginOtps.length, 1, "Login OTP must be dispatched to user's phone");
    console.log("✓ Login SMS OTP generated in DB for login");

    console.log("\nAll Signup & Login OTP mandatory verification tests passed successfully!");
  } finally {
    // Cleanup
    await db.execute("DELETE FROM users WHERE email = ? OR phone = ?", [testEmail, testPhone]);
    await db.execute("DELETE FROM otp_codes WHERE destination = ?", [testPhone]);
  }
}

testAuthOtpFlow().then(() => process.exit(0)).catch(e => {
  console.error("Test failed:", e);
  process.exit(1);
});

