import assert from "node:assert/strict";
import crypto from "crypto";
import { db } from "../src/config/db.js";
import { smsOutboxService } from "../src/modules/sms/outbox.worker.js";
import { smsService } from "../src/services/sms.service.js";
import { requestPasswordReset } from "../src/modules/auth/auth.service.js";
import { encryptPayload, decryptPayload } from "../src/modules/sms/outbox.crypto.js";

async function runDurableOutboxSuite() {
  console.log("=== STARTING PHASE 3 DURABLE SMS OUTBOX & THROTTLING TEST SUITE ===");

  // Staging database safety guard
  const [dbNameRows] = await db.execute("SELECT DATABASE() AS currentDb");
  const currentDb = dbNameRows[0]?.currentDb;
  assert.ok(
    currentDb && !currentDb.toLowerCase().includes("prod"),
    `[SAFETY HALT] Must not run tests against production database: "${currentDb}"`
  );
  console.log(`[Safety Guard PASS] Database verified: "${currentDb}"`);

  // Ensure clean test user
  const TEST_PHONE = "01788990011";
  const UNREG_PHONE = "01788990099";

  await db.execute("DELETE FROM sms_outbox WHERE destination IN (?, ?)", [TEST_PHONE, UNREG_PHONE]);
  await db.execute("DELETE FROM otp_codes WHERE destination IN (?, ?)", [TEST_PHONE, UNREG_PHONE]);
  await db.execute("DELETE FROM users WHERE phone = ?", [TEST_PHONE]);

  // Insert mock test user
  const [userResult] = await db.execute(
    `INSERT INTO users (phone, email, password_hash, status, token_version, created_at, updated_at)
     VALUES (?, 'outbox_test@banglaqr.local', 'mock_hash', 'active', 0, NOW(), NOW())`,
    [TEST_PHONE]
  );
  const testUserId = userResult.insertId;

  try {
    // -------------------------------------------------------------
    // TEST 1: Request Password Reset Atomically Queues Outbox Message
    // -------------------------------------------------------------
    console.log("\n[TEST 1] Testing Atomic Password Reset & Outbox Enqueue...");
    const reqRes = await requestPasswordReset({ phone: TEST_PHONE });
    assert.equal(reqRes.success, true);
    assert.equal(
      reqRes.message,
      "যদি এই মোবাইল নম্বরে নিবন্ধিত অ্যাকাউন্ট থাকে, তবে ভেরিফিকেশন কোড পাঠানো হয়েছে।"
    );

    // Verify row inserted in sms_outbox
    const [outboxRows] = await db.execute(
      `SELECT * FROM sms_outbox WHERE destination = ? ORDER BY id DESC LIMIT 1`,
      [TEST_PHONE]
    );
    assert.equal(outboxRows.length, 1, "sms_outbox entry must be created");
    const outboxJob = outboxRows[0];
    assert.equal(outboxJob.purpose, "password_reset");
    assert.ok(outboxJob.iv, "IV must be generated");
    assert.ok(outboxJob.auth_tag, "auth_tag must be present");
    console.log("✓ Test 1 Passed: Outbox job queued with encrypted payload metadata.");

    // -------------------------------------------------------------
    // TEST 2: Encryption Security (No Plaintext OTP in Database)
    // -------------------------------------------------------------
    console.log("\n[TEST 2] Verifying AES-256-GCM Encryption & No Plaintext Leak...");
    const [rawRows] = await db.execute(
      `SELECT encrypted_payload FROM sms_outbox WHERE id = ?`,
      [outboxJob.id]
    );
    // If it hasn't been sent yet, encrypted_payload is a hex string
    if (rawRows[0].encrypted_payload) {
      assert.ok(
        !rawRows[0].encrypted_payload.includes("password_reset"),
        "Raw payload in DB must be ciphertext, not plaintext JSON"
      );
      // Decrypt and verify structure
      const decrypted = decryptPayload(
        rawRows[0].encrypted_payload,
        outboxJob.iv,
        outboxJob.auth_tag
      );
      assert.ok(decrypted.otp, "Decrypted payload must contain OTP");
      assert.equal(decrypted.destination, TEST_PHONE);
    }
    console.log("✓ Test 2 Passed: Payload encrypted with AES-256-GCM.");

    // -------------------------------------------------------------
    // TEST 3: Uniform Destination-Level Throttling (Registered & Unregistered)
    // -------------------------------------------------------------
    console.log("\n[TEST 3] Verifying Uniform Per-Phone Throttling (Registered & Unregistered)...");
    // Immediate repeat request for registered phone should trigger 429
    let regThrottled = false;
    try {
      await requestPasswordReset({ phone: TEST_PHONE });
    } catch (err) {
      if (err.statusCode === 429) regThrottled = true;
    }
    assert.equal(regThrottled, true, "Registered phone must be throttled within cooldown window (429)");

    // First request for unregistered phone should succeed
    const unregRes1 = await requestPasswordReset({ phone: UNREG_PHONE });
    assert.equal(unregRes1.success, true);
    assert.equal(unregRes1.message, reqRes.message, "Contract must be identical");

    // Immediate repeat request for unregistered phone should ALSO trigger 429
    let unregThrottled = false;
    try {
      await requestPasswordReset({ phone: UNREG_PHONE });
    } catch (err) {
      if (err.statusCode === 429) unregThrottled = true;
    }
    assert.equal(
      unregThrottled,
      true,
      "Unregistered phone must ALSO be throttled within cooldown window (429)"
    );
    console.log("✓ Test 3 Passed: Both registered and unregistered phones uniformly throttled.");

    // -------------------------------------------------------------
    // TEST 4: Worker Processing, Leases, and Payload Erasure on Delivery
    // -------------------------------------------------------------
    console.log("\n[TEST 4] Testing Worker Lease, Delivery, and Post-Delivery Payload Erasure...");
    // Clear cooldown to enqueue fresh job
    await db.execute("DELETE FROM otp_codes WHERE destination = ?", [TEST_PHONE]);
    await db.execute("DELETE FROM sms_outbox WHERE destination = ?", [TEST_PHONE]);

    const freshOtp = "482910";
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    const jobId = await smsOutboxService.enqueueSms(db, {
      otpCodeId: null,
      destination: TEST_PHONE,
      purpose: "password_reset",
      otp: freshOtp,
      expiresAt,
    });

    // Mock smsService to record delivery
    let mockDispatched = false;
    const originalSend = smsService.sendOtpSms;
    smsService.sendOtpSms = async ({ to, otp }) => {
      mockDispatched = true;
      assert.equal(to, TEST_PHONE);
      assert.equal(otp, freshOtp);
      return { success: true, messageId: "GENNET-MOCK-REF-12345" };
    };

    const processedCount = await smsOutboxService.processOutboxBatch(5);
    smsService.sendOtpSms = originalSend;

    assert.ok(processedCount >= 1, "At least 1 job must have been processed");
    assert.equal(mockDispatched, true, "SMS service sendOtpSms must have been called");

    const [deliveredRows] = await db.execute(
      `SELECT status, attempts, encrypted_payload, iv, auth_tag, provider_reference, delivered_at
       FROM sms_outbox WHERE id = ?`,
      [jobId]
    );
    assert.equal(deliveredRows[0].status, "sent");
    assert.equal(deliveredRows[0].attempts, 1);
    assert.equal(deliveredRows[0].encrypted_payload, null, "Payload MUST be nullified upon delivery");
    assert.equal(deliveredRows[0].iv, null, "IV MUST be nullified upon delivery");
    assert.equal(deliveredRows[0].auth_tag, null, "Auth tag MUST be nullified upon delivery");
    assert.equal(deliveredRows[0].provider_reference, "GENNET-MOCK-REF-12345");
    assert.ok(deliveredRows[0].delivered_at, "delivered_at timestamp must be recorded");
    console.log("✓ Test 4 Passed: Delivered successfully and payload erased from DB.");

    // -------------------------------------------------------------
    // TEST 5: Worker Retries with Exponential Backoff
    // -------------------------------------------------------------
    console.log("\n[TEST 5] Testing Temporary Failure & Exponential Backoff Retry...");
    const failJobId = await smsOutboxService.enqueueSms(db, {
      otpCodeId: null,
      destination: TEST_PHONE,
      purpose: "password_reset",
      otp: "998877",
      expiresAt,
    });

    // Mock smsService to fail
    const originalSend2 = smsService.sendOtpSms;
    smsService.sendOtpSms = async () => {
      throw new Error("Temporary GenNet connection timeout");
    };

    await smsOutboxService.processOutboxBatch(5);
    smsService.sendOtpSms = originalSend2;

    const [failedRows] = await db.execute(
      `SELECT status, attempts, next_attempt_at, last_error, encrypted_payload
       FROM sms_outbox WHERE id = ?`,
      [failJobId]
    );
    assert.equal(failedRows[0].status, "pending", "Failed job must be scheduled for retry as pending");
    assert.equal(failedRows[0].attempts, 1);
    assert.ok(
      new Date(failedRows[0].next_attempt_at) > new Date(),
      "next_attempt_at must be in the future (backoff)"
    );
    assert.ok(
      failedRows[0].last_error.includes("Temporary GenNet connection timeout"),
      "Sanitized error must be captured"
    );
    assert.ok(failedRows[0].encrypted_payload !== null, "Encrypted payload preserved for retry");
    console.log("✓ Test 5 Passed: Temporary failure scheduled retry with backoff.");

    // -------------------------------------------------------------
    // TEST 6: Expired OTP Pruning
    // -------------------------------------------------------------
    console.log("\n[TEST 6] Testing Stale/Expired OTP Pruning...");
    const expiredJobId = await smsOutboxService.enqueueSms(db, {
      otpCodeId: null,
      destination: TEST_PHONE,
      purpose: "password_reset",
      otp: "112233",
      expiresAt: new Date(Date.now() - 10000), // Already expired 10s ago
    });

    let expiredSendCalled = false;
    const originalSend3 = smsService.sendOtpSms;
    smsService.sendOtpSms = async () => {
      expiredSendCalled = true;
    };

    await smsOutboxService.processOutboxBatch(5);
    smsService.sendOtpSms = originalSend3;

    assert.equal(expiredSendCalled, false, "Expired OTP must NEVER be sent to the carrier");
    const [expiredRows] = await db.execute(
      `SELECT status, encrypted_payload, last_error FROM sms_outbox WHERE id = ?`,
      [expiredJobId]
    );
    assert.equal(expiredRows[0].status, "expired");
    assert.equal(expiredRows[0].encrypted_payload, null, "Expired payload must be erased immediately");
    console.log("✓ Test 6 Passed: Expired OTP aborted and payload purged.");

    console.log("\n=================================================================");
    console.log("ALL PHASE 3 DURABLE OUTBOX & TIMING HARDENING TESTS PASSED (6/6)");
    console.log("=================================================================");
  } finally {
    // Cleanup test records
    await db.execute("DELETE FROM sms_outbox WHERE destination IN (?, ?)", [TEST_PHONE, UNREG_PHONE]);
    await db.execute("DELETE FROM otp_codes WHERE destination IN (?, ?)", [TEST_PHONE, UNREG_PHONE]);
    await db.execute("DELETE FROM users WHERE id = ?", [testUserId]);
    console.log("[Cleanup] Staging database test records safely cleaned up.");
  }
}

runDurableOutboxSuite()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Test Suite Failed:", err);
    process.exit(1);
  });
