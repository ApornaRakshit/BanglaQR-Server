import { db } from "../src/config/db.js";
import argon2 from "argon2";
import {
  resendOtp,
  verifyOtp,
  loginUser,
  getVerificationStatus,
} from "../src/modules/auth/auth.service.js";
import { hashOtp } from "../src/modules/auth/auth.utils.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

async function runRealUserTest() {
  const originalBypass = process.env.AUTH_VERIFICATION_MODE;
  process.env.AUTH_VERIFICATION_MODE = "";
  console.log("==================================================");
  console.log("TESTING OTP VERIFICATION FLOW WITH REAL USER");
  console.log("==================================================");

  const testEmail = "dev.apornarakshit@gmail.com";
  const testPhone = "01521561710";
  const testPassword = "Password@123456";

  // Step 1: Ensure user exists and is reset to unverified state for clean testing
  const passwordHash = await argon2.hash(testPassword);
  const [existing] = await db.execute(`SELECT id FROM users WHERE email = ?`, [testEmail]);

  let userId;
  if (existing.length > 0) {
    userId = existing[0].id;
    await db.execute(
      `
        UPDATE users
        SET password_hash = ?,
            phone = ?,
            email_verified_at = NULL,
            phone_verified_at = NULL,
            status = 'pending'
        WHERE id = ?
      `,
      [passwordHash, testPhone, userId]
    );
  } else {
    const [ins] = await db.execute(
      `
        INSERT INTO users (email, phone, password_hash, status, email_verified_at, phone_verified_at)
        VALUES (?, ?, ?, 'pending', NULL, NULL)
      `,
      [testEmail, testPhone, passwordHash]
    );
    userId = ins.insertId;
  }

  // Clear any existing OTPs for clean test
  await db.execute(`DELETE FROM otp_codes WHERE user_id = ? OR destination IN (?, ?)`, [
    userId,
    testEmail,
    testPhone,
  ]);

  console.log(`\n[Step 1] Real user setup completed for: ${testEmail} (ID: ${userId})`);
  const [u1] = await db.execute(`SELECT email, phone, email_verified_at, phone_verified_at, status FROM users WHERE id = ?`, [userId]);
  assert(u1[0].email_verified_at === null, "email_verified_at is initially NULL");
  assert(u1[0].phone_verified_at === null, "phone_verified_at is initially NULL");
  assert(u1[0].status === "pending", "Initial account status is 'pending'");

  // Step 2: Attempt login before verification (Must fail with 403)
  console.log("\n[Step 2] Attempting login on unverified account");
  let loginBlocked = false;
  try {
    await loginUser({ email: testEmail, password: testPassword });
  } catch (err) {
    loginBlocked = true;
    assert(err.statusCode === 403, "Login returned HTTP 403 Forbidden");
    assert(err.emailVerified === false, "Error reports emailVerified: false");
    assert(err.phoneVerified === false, "Error reports phoneVerified: false");
    console.log("  ✓ Correct 403 block payload:", {
      statusCode: err.statusCode,
      emailVerified: err.emailVerified,
      phoneVerified: err.phoneVerified,
      email: err.email,
      phone: err.phone,
    });
  }
  assert(loginBlocked, "Unverified user is blocked from logging in");

  // Step 3: Request Email OTP
  console.log("\n[Step 3] Requesting Email OTP");
  const emailResend = await resendOtp({
    destination: testEmail,
    purpose: "email_verification",
    email: testEmail,
  });
  assert(emailResend.success === true, "Email OTP generated and dispatched");

  // Retrieve raw OTP from DB for verification test
  const [emailOtps] = await db.execute(
    `SELECT id, code_hash, verified_at, expires_at FROM otp_codes WHERE destination = ? AND purpose = 'email_verification' AND verified_at IS NULL ORDER BY id DESC LIMIT 1`,
    [testEmail]
  );
  assert(emailOtps.length === 1, "Found active Email OTP record in MySQL");

  // Step 4: Verify Email OTP with invalid code first
  console.log("\n[Step 4] Testing invalid Email OTP rejection");
  let wrongRejected = false;
  try {
    await verifyOtp({
      destination: testEmail,
      code: "000000",
      purpose: "email_verification",
      email: testEmail,
    });
  } catch (err) {
    wrongRejected = true;
    assert(err.statusCode === 400, "Wrong OTP returned HTTP 400");
  }
  assert(wrongRejected, "Invalid OTP correctly rejected");

  // To test valid verification without hardcoding mock codes, let's create a known 6-digit test code
  const testEmailCode = "135790";
  const testEmailCodeHash = hashOtp(testEmailCode);
  await db.execute(`UPDATE otp_codes SET code_hash = ? WHERE id = ?`, [testEmailCodeHash, emailOtps[0].id]);

  // Step 5: Verify Email OTP with valid code
  console.log("\n[Step 5] Verifying valid Email OTP");
  const emailVerifyRes = await verifyOtp({
    destination: testEmail,
    code: testEmailCode,
    purpose: "email_verification",
    email: testEmail,
  });
  assert(emailVerifyRes.verified === true, "Email OTP verification returned verified: true");
  assert(emailVerifyRes.emailVerified === true, "emailVerified flag is true");
  assert(emailVerifyRes.phoneVerified === false, "phoneVerified flag remains false");
  assert(emailVerifyRes.allVerified === false, "allVerified is false because phone is still pending");

  // Confirm DB update
  const [u2] = await db.execute(`SELECT email_verified_at, phone_verified_at, status FROM users WHERE id = ?`, [userId]);
  assert(u2[0].email_verified_at !== null, "users.email_verified_at is now populated in MySQL");
  assert(u2[0].phone_verified_at === null, "users.phone_verified_at is still NULL in MySQL");
  assert(u2[0].status === "pending", "Account status is still 'pending'");

  // Step 6: Verify Replay Attack Prevention (consumed OTP cannot be reused)
  console.log("\n[Step 6] Testing Email OTP reuse prevention");
  let emailReplayBlocked = false;
  try {
    await verifyOtp({
      destination: testEmail,
      code: testEmailCode,
      purpose: "email_verification",
      email: testEmail,
    });
  } catch (err) {
    emailReplayBlocked = true;
    assert(err.statusCode === 400, "Replayed OTP returned HTTP 400");
  }
  assert(emailReplayBlocked, "Consumed Email OTP cannot be reused");

  // Step 7: Attempt login with only Email verified (Must still fail with 403)
  console.log("\n[Step 7] Attempting login with only Email verified");
  let partialLoginBlocked = false;
  try {
    await loginUser({ email: testEmail, password: testPassword });
  } catch (err) {
    partialLoginBlocked = true;
    assert(err.statusCode === 403, "Partial verification login returned HTTP 403");
    assert(err.emailVerified === true, "Error reports emailVerified: true");
    assert(err.phoneVerified === false, "Error reports phoneVerified: false");
  }
  assert(partialLoginBlocked, "User with only email verified cannot log in");

  // Step 8: Request SMS OTP
  console.log("\n[Step 8] Requesting SMS OTP for phone: " + testPhone);
  const smsResend = await resendOtp({
    destination: testPhone,
    purpose: "phone_verification",
    email: testEmail,
  });
  assert(smsResend.success === true, "SMS OTP generated and dispatched");

  const [phoneOtps] = await db.execute(
    `SELECT id, code_hash, verified_at, expires_at FROM otp_codes WHERE destination = ? AND purpose = 'phone_verification' AND verified_at IS NULL ORDER BY id DESC LIMIT 1`,
    [testPhone]
  );
  assert(phoneOtps.length === 1, "Found active SMS OTP record in MySQL");

  const testPhoneCode = "246801";
  const testPhoneCodeHash = hashOtp(testPhoneCode);
  await db.execute(`UPDATE otp_codes SET code_hash = ? WHERE id = ?`, [testPhoneCodeHash, phoneOtps[0].id]);

  // Step 9: Verify SMS OTP with international format variant (+8801521561710) to test normalization
  console.log("\n[Step 9] Verifying SMS OTP with +880 format input");
  const phoneVerifyRes = await verifyOtp({
    destination: `+88${testPhone}`,
    code: testPhoneCode,
    purpose: "phone_verification",
    email: testEmail,
  });
  assert(phoneVerifyRes.verified === true, "SMS OTP verification returned verified: true");
  assert(phoneVerifyRes.phoneVerified === true, "phoneVerified flag is now true");
  assert(phoneVerifyRes.emailVerified === true, "emailVerified flag is true");
  assert(phoneVerifyRes.allVerified === true, "allVerified is now true!");
  assert(phoneVerifyRes.userStatus === "active", "Account status is now 'active'!");

  // Confirm DB update
  const [u3] = await db.execute(`SELECT email_verified_at, phone_verified_at, status FROM users WHERE id = ?`, [userId]);
  assert(u3[0].email_verified_at !== null, "users.email_verified_at is confirmed in MySQL");
  assert(u3[0].phone_verified_at !== null, "users.phone_verified_at is confirmed in MySQL");
  assert(u3[0].status === "active", "users.status is updated to 'active' in MySQL");

  // Step 10: Successful Login
  console.log("\n[Step 10] Logging in with fully verified credentials");
  const loginResult = await loginUser({ email: testEmail, password: testPassword });
  assert(Boolean(loginResult.accessToken), "Access token returned successfully");
  assert(loginResult.user.email === testEmail, "Logged in user email matches");
  assert(loginResult.user.id === userId, "Logged in user ID matches");

  // Step 11: Verification Status Query Check
  console.log("\n[Step 11] Checking getVerificationStatus endpoint helper");
  const statusCheck = await getVerificationStatus({ destination: testEmail });
  assert(statusCheck.found === true, "User found in status query");
  assert(statusCheck.emailVerified === true, "Status reports emailVerified: true");
  assert(statusCheck.phoneVerified === true, "Status reports phoneVerified: true");
  assert(statusCheck.allVerified === true, "Status reports allVerified: true");
  assert(statusCheck.status === "active", "Status reports active");

  console.log("\n==================================================");
  console.log("🎉 ALL REAL USER OTP VERIFICATION TESTS PASSED!");
  console.log("==================================================\n");
  process.env.AUTH_VERIFICATION_MODE = originalBypass;
  process.exit(0);
}

runRealUserTest().catch((err) => {
  console.error("Test Error:", err);
  process.exit(1);
});
