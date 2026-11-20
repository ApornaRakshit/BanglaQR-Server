import { db } from "../src/config/db.js";
import {
  registerUser,
  verifyOtp,
  resendOtp,
  loginUser,
  getVerificationStatus,
} from "../src/modules/auth/auth.service.js";
import { generateOtp, hashOtp } from "../src/modules/auth/auth.utils.js";
import { normalizeBdPhone } from "../src/services/sms.service.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

async function runOtpTests() {
  console.log("==================================================");
  console.log("RUNNING BANGLAQR REAL-TIME OTP E2E TEST SUITE");
  console.log("==================================================");

  const testEmail = `test.merchant.${Date.now()}@banglaqr.com`;
  const testPhone = "01799123456";
  const testPassword = "Password@123456";
  let createdUserId = null;

  try {
    // 1. Phone Normalization Tests
    console.log("\n[Test 1] Bangladeshi Phone Normalization & Operators");
    const p1 = normalizeBdPhone("01712345678");
    assert(p1.local === "01712345678" && p1.international === "8801712345678", "Normalized 017 local format");

    const p2 = normalizeBdPhone("+8801812345678");
    assert(p2.local === "01812345678" && p2.international === "8801812345678", "Normalized +88018 format");

    const p3 = normalizeBdPhone("8801912345678");
    assert(p3.local === "01912345678", "Normalized 88019 format");

    const pInvalid = normalizeBdPhone("01234567890"); // Invalid operator prefix (012 is not valid in BD)
    assert(pInvalid === null, "Rejected invalid operator prefix 012");

    // 2. Cryptographic 6-Digit OTP Generator
    console.log("\n[Test 2] Secure 6-digit OTP Generation & HMAC Hashing");
    const sampleOtp = generateOtp();
    assert(/^\d{6}$/.test(sampleOtp), `Generated OTP is exactly 6 digits: ${sampleOtp}`);
    const hash1 = hashOtp(sampleOtp);
    const hash2 = hashOtp(sampleOtp);
    assert(hash1 === hash2, "HMAC hash is deterministic");
    assert(hash1.length === 64, "SHA-256 HMAC produces 64-hex char hash");

    // 3. User Registration with Dual-Channel OTP Dispatch
    console.log("\n[Test 3] Merchant Registration & Initial OTP Generation");
    const regRes = await registerUser({
      fullName: "তানভীর আহমেদ",
      email: testEmail,
      phone: testPhone,
      password: testPassword,
    });

    createdUserId = regRes.userId;
    assert(createdUserId > 0, `User registered with ID #${createdUserId}`);
    assert(regRes.status === "pending", "Initial user status is 'pending'");

    // Inspect database records for user and OTP codes
    const [userRows] = await db.execute("SELECT * FROM users WHERE id = ?", [createdUserId]);
    assert(userRows.length === 1, "User record found in MySQL");
    assert(userRows[0].email_verified_at === null, "Email is unverified initially");
    assert(userRows[0].phone_verified_at === null, "Phone is unverified initially");

    const [otps] = await db.execute(
      "SELECT * FROM otp_codes WHERE user_id = ? ORDER BY created_at DESC",
      [createdUserId]
    );
    assert(otps.length === 2, "Generated exactly 2 OTPs (1 for Email, 1 for SMS)");

    const emailOtpRow = otps.find((o) => o.purpose === "email_verification");
    const phoneOtpRow = otps.find((o) => o.purpose === "phone_verification");
    assert(Boolean(emailOtpRow), "Email verification OTP record exists");
    assert(Boolean(phoneOtpRow), "Phone verification OTP record exists");
    assert(emailOtpRow.destination === testEmail.toLowerCase(), "Email OTP destination matches");
    assert(phoneOtpRow.destination === testPhone, "Phone OTP destination matches");
    assert(emailOtpRow.verified_at === null, "Email OTP is initially unverified");
    assert(phoneOtpRow.verified_at === null, "Phone OTP is initially unverified");

    // Expiration check: default 5 minutes
    const expiresDiff = new Date(emailOtpRow.expires_at).getTime() - new Date(emailOtpRow.created_at).getTime();
    assert(Math.abs(expiresDiff - 5 * 60 * 1000) < 5000, "OTP expiry is set to 5 minutes");

    // 4. Verification Guard on Login Before Verification
    console.log("\n[Test 4] Login Guard Against Unverified Accounts");
    let loginBlocked = false;
    try {
      await loginUser({ email: testEmail, password: testPassword });
    } catch (err) {
      loginBlocked = true;
      assert(err.statusCode === 403, "Login rejected with HTTP 403 for unverified user");
    }
    assert(loginBlocked, "Unverified user was blocked from logging in");

    // 5. Rate Limiting & 60s Resend Cooldown
    console.log("\n[Test 5] Resend Cooldown Verification (60s limit)");
    let cooldownBlocked = false;
    try {
      await resendOtp({ destination: testEmail, purpose: "email_verification" });
    } catch (err) {
      cooldownBlocked = true;
      assert(err.statusCode === 429, "Resend rejected with HTTP 429 during cooldown");
      assert(err.waitSeconds > 0 && err.waitSeconds <= 60, "Returned remaining cooldown seconds");
    }
    assert(cooldownBlocked, "Resend cooldown successfully enforced");

    // 6. OTP Verification Security: Wrong Code & Attempts Limit
    console.log("\n[Test 6] Wrong OTP Attempts and Thresholds");
    let wrongCodeError = null;
    try {
      await verifyOtp({
        destination: testEmail,
        code: "000000",
        purpose: "email_verification",
      });
    } catch (err) {
      wrongCodeError = err;
      assert(err.statusCode === 400, "Wrong code rejected with HTTP 400");
    }
    assert(Boolean(wrongCodeError), "Wrong OTP was rejected");

    // Check attempts count in database
    const [emailOtpAfterWrong] = await db.execute(
      "SELECT attempts FROM otp_codes WHERE id = ?",
      [emailOtpRow.id]
    );
    assert(emailOtpAfterWrong[0].attempts === 1, "Attempts count incremented to 1 in database");

    // 7. Expired Code Handling
    console.log("\n[Test 7] Expired OTP Code Handling");
    // Manually expire the phone OTP in database for testing
    await db.execute(
      "UPDATE otp_codes SET expires_at = DATE_SUB(NOW(), INTERVAL 10 MINUTE) WHERE id = ?",
      [phoneOtpRow.id]
    );

    let expiredError = null;
    try {
      await verifyOtp({
        destination: testPhone,
        code: "123456",
        purpose: "phone_verification",
      });
    } catch (err) {
      expiredError = err;
      assert(err.statusCode === 400, "Expired code rejected with HTTP 400");
      assert(err.message.includes("মেয়াদ শেষ") || err.message.includes("expired"), "Expired error message returned");
    }
    assert(Boolean(expiredError), "Expired OTP was rejected");

    // 8. Successful Email OTP Verification
    console.log("\n[Test 8] Verify Email OTP with Valid Code");
    // For test simulation, let's create a known test code for email
    const knownEmailCode = "582914";
    await db.execute(
      "UPDATE otp_codes SET code_hash = ?, attempts = 0, expires_at = DATE_ADD(NOW(), INTERVAL 5 MINUTE) WHERE id = ?",
      [hashOtp(knownEmailCode), emailOtpRow.id]
    );

    const emailVerifyRes = await verifyOtp({
      destination: testEmail,
      code: knownEmailCode,
      purpose: "email_verification",
    });

    assert(emailVerifyRes.verified === true, "Email verified successfully");
    assert(emailVerifyRes.emailVerified === true, "emailVerified flag is true");
    assert(emailVerifyRes.phoneVerified === false, "phoneVerified flag is still false");
    assert(emailVerifyRes.allVerified === false, "allVerified is false until phone is also verified");

    // Verify OTP consumption in database
    const [emailOtpConsumed] = await db.execute(
      "SELECT verified_at FROM otp_codes WHERE id = ?",
      [emailOtpRow.id]
    );
    assert(emailOtpConsumed[0].verified_at !== null, "OTP record marked consumed in MySQL");

    // 9. Replay / Reuse Attack Prevention
    console.log("\n[Test 9] Replay Attack Prevention (Reused OTP)");
    let replayBlocked = false;
    try {
      await verifyOtp({
        destination: testEmail,
        code: knownEmailCode,
        purpose: "email_verification",
      });
    } catch (err) {
      replayBlocked = true;
      assert(err.statusCode === 400, "Reused code rejected with HTTP 400");
    }
    assert(replayBlocked, "Consumed OTP cannot be reused");

    // 10. Successful Phone OTP Verification
    console.log("\n[Test 10] Verify Phone OTP & Account Activation");
    const knownPhoneCode = "839201";
    // Reset phone OTP with known code and valid expiry
    await db.execute(
      "UPDATE otp_codes SET code_hash = ?, attempts = 0, expires_at = DATE_ADD(NOW(), INTERVAL 5 MINUTE) WHERE id = ?",
      [hashOtp(knownPhoneCode), phoneOtpRow.id]
    );

    const phoneVerifyRes = await verifyOtp({
      destination: testPhone,
      code: knownPhoneCode,
      purpose: "phone_verification",
    });

    assert(phoneVerifyRes.verified === true, "Phone verified successfully");
    assert(phoneVerifyRes.phoneVerified === true, "phoneVerified flag is true");
    assert(phoneVerifyRes.emailVerified === true, "emailVerified flag is true");
    assert(phoneVerifyRes.allVerified === true, "allVerified flag is now true");
    assert(phoneVerifyRes.userStatus === "active", "User account status updated to 'active'");

    // 11. Verification Status API Helper
    console.log("\n[Test 11] Verification Status Query");
    const statusRes = await getVerificationStatus({ destination: testEmail });
    assert(statusRes.found === true, "User found in status query");
    assert(statusRes.emailVerified === true, "Email verified reported true");
    assert(statusRes.phoneVerified === true, "Phone verified reported true");
    assert(statusRes.allVerified === true, "All verified reported true");
    assert(statusRes.status === "active", "Status is active");

    // 12. Login After Full Verification
    console.log("\n[Test 12] Successful Merchant Login");
    const loginRes = await loginUser({ email: testEmail, password: testPassword });
    assert(Boolean(loginRes.accessToken), "Access token generated for verified user");
    assert(loginRes.user.email === testEmail.toLowerCase(), "Logged in user email matches");
    assert(loginRes.user.role === "merchant", "User role is merchant");

    // Cleanup test records
    console.log("\n[Test 13] Cleaning Up Test Records from Database");
    await db.execute("DELETE FROM otp_codes WHERE user_id = ?", [createdUserId]);
    await db.execute("DELETE FROM user_roles WHERE user_id = ?", [createdUserId]);
    await db.execute("DELETE FROM merchant_contacts WHERE email = ?", [testEmail.toLowerCase()]);
    await db.execute("DELETE FROM merchants WHERE user_id = ?", [createdUserId]);
    await db.execute("DELETE FROM users WHERE id = ?", [createdUserId]);
    assert(true, "Cleaned up test merchant user and OTPs");

    console.log("\n==================================================");
    console.log("🎉 ALL OTP REAL-TIME VERIFICATION TESTS PASSED!");
    console.log("==================================================");
  } catch (err) {
    console.error("\n❌ Test Failed:", err);
    if (createdUserId) {
      try {
        await db.execute("DELETE FROM otp_codes WHERE user_id = ?", [createdUserId]);
        await db.execute("DELETE FROM user_roles WHERE user_id = ?", [createdUserId]);
        await db.execute("DELETE FROM merchant_contacts WHERE email = ?", [testEmail.toLowerCase()]);
        await db.execute("DELETE FROM merchants WHERE user_id = ?", [createdUserId]);
        await db.execute("DELETE FROM users WHERE id = ?", [createdUserId]);
      } catch {}
    }
    throw err;
  } finally {
    await db.end();
  }
}

runOtpTests();

