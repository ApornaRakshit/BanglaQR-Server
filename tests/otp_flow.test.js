import assert from "node:assert";
import { db } from "../src/config/db.js";
import {
  createAndSendOtp,
  verifyOtp,
  resendOtp,
} from "../src/modules/auth/auth.service.js";

async function runOtpFlowTests() {
  console.log("=== Running OTP Request, Resend, Expiry & Verification Flow Tests ===");

  const testPhone = "01799887766";
  const purpose = "phone_verification";

  // Clean any old test records for this phone number
  await db.execute("DELETE FROM otp_codes WHERE destination = ?", [testPhone]);

  try {
    // 1. Create and send OTP (simulate SMS provider)
    const sendResult = await createAndSendOtp(
      db,
      null, // anonymous/unregistered phone verification
      testPhone,
      purpose
    );

    assert.strictEqual(sendResult.success, true, "OTP creation must succeed");
    assert.strictEqual(sendResult.destination, testPhone, "Destination must match");
    console.log("✓ Step 1: createAndSendOtp created record in otp_codes table");

    // Retrieve the generated record
    const [rows] = await db.execute(
      "SELECT * FROM otp_codes WHERE destination = ? AND purpose = ? ORDER BY created_at DESC LIMIT 1",
      [testPhone, purpose]
    );
    assert.strictEqual(rows.length, 1, "Must find exactly 1 record");
    const otpRecord = rows[0];
    assert.ok(otpRecord.code_hash, "code_hash must exist and not be empty");
    assert.strictEqual(otpRecord.verified_at, null, "verified_at must initially be null");
    assert.strictEqual(otpRecord.attempts, 0, "attempts must start at 0");

    // 2. Test Cooldown: Calling createAndSendOtp immediately must throw 429
    try {
      await createAndSendOtp(db, null, testPhone, purpose);
      assert.fail("Should have thrown 429 cooldown error");
    } catch (err) {
      assert.strictEqual(err.statusCode, 429, "Cooldown must return 429");
      assert.ok(err.waitSeconds > 0, "Wait seconds must be > 0");
      console.log(`✓ Step 2: Cooldown triggered correctly (Wait ${err.waitSeconds}s)`);
    }

    // 3. Test Invalid OTP Attempt (wrong code)
    try {
      await verifyOtp({
        destination: testPhone,
        code: "000000",
        purpose,
      });
      assert.fail("Should have thrown on wrong code");
    } catch (err) {
      assert.strictEqual(err.statusCode, 400, "Wrong code should return 400");
      console.log("✓ Step 3: Wrong OTP code rejected with 400");
    }

    // Verify attempt counter incremented in DB
    const [afterAttemptRows] = await db.execute(
      "SELECT attempts FROM otp_codes WHERE id = ?",
      [otpRecord.id]
    );
    assert.strictEqual(afterAttemptRows[0].attempts, 1, "Attempts must increment to 1");
    console.log("✓ Step 4: Invalid attempt counter incremented to 1 in DB");

    // 4. Test Expired OTP check
    await db.execute(
      "UPDATE otp_codes SET expires_at = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE id = ?",
      [otpRecord.id]
    );

    try {
      await verifyOtp({
        destination: testPhone,
        code: "123456",
        purpose,
      });
      assert.fail("Should have thrown on expired OTP");
    } catch (err) {
      assert.strictEqual(err.statusCode, 400, "Expired OTP should return 400");
      console.log("✓ Step 5: Expired OTP rejected with 400");
    }

    // 5. Test Maximum Attempts Limit (lockout)
    await db.execute(
      "UPDATE otp_codes SET expires_at = DATE_ADD(NOW(), INTERVAL 5 MINUTE), attempts = 5 WHERE id = ?",
      [otpRecord.id]
    );

    try {
      await verifyOtp({
        destination: testPhone,
        code: "123456",
        purpose,
      });
      assert.fail("Should have thrown on max attempts reached");
    } catch (err) {
      assert.strictEqual(err.statusCode, 429, "Max attempts reached must return 429");
      console.log("✓ Step 6: Max attempts threshold reached (returns 429)");
    }

    console.log("\nAll OTP Flow unit tests passed successfully!");
  } finally {
    // Cleanup test record
    await db.execute("DELETE FROM otp_codes WHERE destination = ?", [testPhone]);
  }
}

runOtpFlowTests().then(() => process.exit(0)).catch(e => {
  console.error("OTP Flow test failed:", e);
  process.exit(1);
});

