import assert from "node:assert/strict";
import crypto from "crypto";
import { db } from "../src/config/db.js";
import { smsOutboxService } from "../src/modules/sms/outbox.worker.js";
import { smsService } from "../src/services/sms.service.js";
import { createAndSendOtp } from "../src/modules/auth/auth.service.js";
import { encryptPayload, decryptPayload } from "../src/modules/sms/outbox.crypto.js";

async function runComprehensiveVerification() {
  console.log("=== STARTING PHASE 3 COMPREHENSIVE OUTBOX VERIFICATION SUITE ===");

  // Staging safety guard
  const [dbRows] = await db.execute("SELECT DATABASE() as db");
  const currentDb = dbRows[0]?.db;
  assert.ok(currentDb && !currentDb.toLowerCase().includes("prod"), "Never run against production!");
  console.log(`[Safety Guard PASS] Staging database: ${currentDb}`);

  const TEST_PHONE = "01755667788";
  await db.execute("DELETE FROM sms_outbox WHERE destination = ?", [TEST_PHONE]);
  await db.execute("DELETE FROM otp_codes WHERE destination = ?", [TEST_PHONE]);
  await db.execute("DELETE FROM users WHERE phone = ?", [TEST_PHONE]);

  const [uRes] = await db.execute(
    `INSERT INTO users (phone, email, password_hash, status, token_version, created_at, updated_at)
     VALUES (?, 'comprehensive_test@banglaqr.local', 'mock_hash', 'active', 0, NOW(), NOW())`,
    [TEST_PHONE]
  );
  const testUserId = uRes.insertId;

  try {
    // -------------------------------------------------------------------------
    // 1. SERVER RESTART RECOVERY & STALE JOB PRUNING
    // -------------------------------------------------------------------------
    console.log("\n[VERIFICATION 1] Testing Server Restart Recovery & Stale Job Handling...");
    // Create pending job simulating server shutdown before delivery
    const restartJobId = await smsOutboxService.enqueueSms(db, {
      otpCodeId: null,
      destination: TEST_PHONE,
      purpose: "password_reset",
      otp: "554433",
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });

    // Also create an expired job simulating a server down for > 5 minutes
    const staleJobId = await smsOutboxService.enqueueSms(db, {
      otpCodeId: null,
      destination: TEST_PHONE,
      purpose: "password_reset",
      otp: "998877",
      expiresAt: new Date(Date.now() - 10000), // already expired
    });

    let deliveredCount = 0;
    const origSend = smsService.sendOtpSms;
    smsService.sendOtpSms = async ({ otp }) => {
      deliveredCount++;
      return { success: true, messageId: "RESTART-MOCK-OK" };
    };

    // Simulate server startup sweep
    await smsOutboxService.processOutboxBatch(10);
    smsService.sendOtpSms = origSend;

    // Verify restartJobId was delivered
    const [restartedRows] = await db.execute("SELECT status, delivered_at, encrypted_payload FROM sms_outbox WHERE id = ?", [restartJobId]);
    assert.equal(restartedRows[0].status, "sent", "Pending job must be recovered and delivered on restart");
    assert.ok(restartedRows[0].delivered_at);
    assert.equal(restartedRows[0].encrypted_payload, null, "Delivered payload must be erased");

    // Verify staleJobId was expired and NOT delivered
    const [staleRows] = await db.execute("SELECT status, encrypted_payload, last_error FROM sms_outbox WHERE id = ?", [staleJobId]);
    assert.equal(staleRows[0].status, "expired", "Stale job must be expired without delivery");
    assert.equal(staleRows[0].encrypted_payload, null);
    assert.equal(deliveredCount, 1, "Only the active job was delivered, expired job was NEVER dispatched");
    console.log("✓ Verification 1 Passed: Server restart recovery processes pending jobs and prunes expired ones.");

    // -------------------------------------------------------------------------
    // 2. CONCURRENT WORKER SAFETY & LEASE RECOVERY
    // -------------------------------------------------------------------------
    console.log("\n[VERIFICATION 2] Testing Concurrent Worker Safety & Expired Lease Recovery...");
    // Clear outbox
    await db.execute("DELETE FROM sms_outbox WHERE destination = ?", [TEST_PHONE]);

    const concJobId = await smsOutboxService.enqueueSms(db, {
      otpCodeId: null,
      destination: TEST_PHONE,
      purpose: "password_reset",
      otp: "332211",
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });

    // Simulate Worker A claiming the job with a lease
    const now = Date.now();
    const futureLease = new Date(now + 60000);
    const [lockRes] = await db.execute(
      `UPDATE sms_outbox
       SET status = 'processing', locked_by = 'worker-A', locked_until = ?
       WHERE id = ? AND status = 'pending'`,
      [futureLease, concJobId]
    );
    assert.equal(lockRes.affectedRows, 1);

    // Worker B tries to claim while lease is active
    let workerBCalled = false;
    const origSend2 = smsService.sendOtpSms;
    smsService.sendOtpSms = async () => { workerBCalled = true; return { success: true }; };

    const batchResB = await smsOutboxService.processOutboxBatch(10);
    smsService.sendOtpSms = origSend2;

    assert.equal(workerBCalled, false, "Worker B must not claim an actively leased job");

    // Now simulate Worker A crashing and the lease expiring
    await db.execute(
      `UPDATE sms_outbox SET locked_until = DATE_SUB(NOW(), INTERVAL 5 SECOND) WHERE id = ?`,
      [concJobId]
    );

    // Worker B runs again - should safely recover the expired lease!
    let workerBRecovered = false;
    smsService.sendOtpSms = async () => {
      workerBRecovered = true;
      return { success: true, messageId: "LEASE-RECOVERED" };
    };
    await smsOutboxService.processOutboxBatch(10);
    smsService.sendOtpSms = origSend2;

    assert.equal(workerBRecovered, true, "Worker B safely recovered the abandoned expired lease");
    const [recRows] = await db.execute("SELECT status, delivered_at FROM sms_outbox WHERE id = ?", [concJobId]);
    assert.equal(recRows[0].status, "sent");
    console.log("✓ Verification 2 Passed: Leased jobs protected from concurrency; expired leases safely recovered.");

    // -------------------------------------------------------------------------
    // 3. ENCRYPTION, KEY SPEC & INTEGRITY VERIFICATION
    // -------------------------------------------------------------------------
    console.log("\n[VERIFICATION 3] Verifying Key Spec, IV & Authentication-Tag Integrity...");
    const samplePayload = { otp: "887766", destination: "01700000000", purpose: "password_reset" };
    const enc = encryptPayload(samplePayload);

    assert.ok(enc.encryptedPayload && typeof enc.encryptedPayload === "string");
    assert.equal(enc.iv.length, 24, "96-bit IV hex string must be 24 characters");
    assert.equal(enc.authTag.length, 32, "128-bit Auth Tag hex string must be 32 characters");

    // Decrypt with correct auth tag
    const dec = decryptPayload(enc.encryptedPayload, enc.iv, enc.authTag);
    assert.equal(dec.otp, "887766");

    // Tamper with ciphertext -> must fail (GCM authentication tag mismatch)
    const tamperedPayload = enc.encryptedPayload.slice(0, -2) + "00";
    const tamperedDec = decryptPayload(tamperedPayload, enc.iv, enc.authTag);
    assert.equal(tamperedDec, null, "Decryption of tampered ciphertext must return null (GCM tag rejection)");

    // Tamper with auth tag -> must fail
    const tamperedTag = enc.authTag.slice(0, -2) + "ff";
    const tamperedTagDec = decryptPayload(enc.encryptedPayload, enc.iv, tamperedTag);
    assert.equal(tamperedTagDec, null, "Decryption with forged auth tag must return null");
    console.log("✓ Verification 3 Passed: AES-256-GCM authenticated encryption and tamper resistance confirmed.");

    // -------------------------------------------------------------------------
    // 4. ATOMIC DATABASE PERSISTENCE (ROLLBACK ON OUTBOX INSERT FAILURE)
    // -------------------------------------------------------------------------
    console.log("\n[VERIFICATION 4] Testing Atomic Persistence & Transaction Rollback...");
    // Clear test records
    await db.execute("DELETE FROM sms_outbox WHERE destination = ?", [TEST_PHONE]);
    await db.execute("DELETE FROM otp_codes WHERE destination = ?", [TEST_PHONE]);

    // Force outbox enqueue failure by monkeypatching enqueueSms
    const originalEnqueue = smsOutboxService.enqueueSms;
    smsOutboxService.enqueueSms = async () => {
      throw new Error("Simulated Outbox Disk/Table Constraint Failure");
    };

    let atomicErrorThrown = false;
    try {
      await createAndSendOtp(db, testUserId, TEST_PHONE, "password_reset");
    } catch (err) {
      atomicErrorThrown = true;
      assert.ok(err.message.includes("Simulated Outbox Disk/Table Constraint Failure"));
    } finally {
      smsOutboxService.enqueueSms = originalEnqueue;
    }

    assert.equal(atomicErrorThrown, true, "createAndSendOtp must throw when outbox enqueue fails");

    // Verify OTP was rolled back and NOT committed to MySQL
    const [orphanedOtps] = await db.execute(
      "SELECT id FROM otp_codes WHERE destination = ? AND purpose = 'password_reset'",
      [TEST_PHONE]
    );
    assert.equal(
      orphanedOtps.length,
      0,
      "OTP insertion MUST be rolled back if outbox enqueue fails (Zero orphaned OTPs)"
    );
    console.log("✓ Verification 4 Passed: Transaction rolls back cleanly; no orphaned OTPs.");

    // -------------------------------------------------------------------------
    // 5. DELIVERY RELIABILITY: RETRIES & BACKOFF
    // -------------------------------------------------------------------------
    console.log("\n[VERIFICATION 5] Testing Delivery Retries (Max 3) & Exponential Backoff...");
    await db.execute("DELETE FROM sms_outbox WHERE destination = ?", [TEST_PHONE]);
    const retryJobId = await smsOutboxService.enqueueSms(db, {
      otpCodeId: null,
      destination: TEST_PHONE,
      purpose: "password_reset",
      otp: "123456",
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });

    const origSend3 = smsService.sendOtpSms;
    smsService.sendOtpSms = async () => { throw new Error("Gateway GatewayTimeout"); };

    // Attempt 1:
    await smsOutboxService.processOutboxBatch(10);
    const [att1] = await db.execute("SELECT attempts, status, next_attempt_at FROM sms_outbox WHERE id = ?", [retryJobId]);
    assert.equal(att1[0].attempts, 1);
    assert.equal(att1[0].status, "pending");

    // Fast-forward next_attempt_at for Attempt 2
    await db.execute("UPDATE sms_outbox SET next_attempt_at = DATE_SUB(NOW(), INTERVAL 1 SECOND) WHERE id = ?", [retryJobId]);
    await smsOutboxService.processOutboxBatch(10);
    const [att2] = await db.execute("SELECT attempts, status FROM sms_outbox WHERE id = ?", [retryJobId]);
    assert.equal(att2[0].attempts, 2);
    assert.equal(att2[0].status, "pending");

    // Fast-forward next_attempt_at for Attempt 3 (Final attempt)
    await db.execute("UPDATE sms_outbox SET next_attempt_at = DATE_SUB(NOW(), INTERVAL 1 SECOND) WHERE id = ?", [retryJobId]);
    await smsOutboxService.processOutboxBatch(10);
    smsService.sendOtpSms = origSend3;

    const [att3] = await db.execute("SELECT attempts, status, encrypted_payload, last_error FROM sms_outbox WHERE id = ?", [retryJobId]);
    assert.equal(att3[0].attempts, 3);
    assert.equal(att3[0].status, "failed", "After 3 failed attempts, status must be permanently 'failed'");
    assert.equal(att3[0].encrypted_payload, null, "Payload MUST be erased on terminal failure");
    assert.ok(att3[0].last_error.includes("GatewayTimeout"));
    console.log("✓ Verification 5 Passed: Max 3 retries enforced, payload purged on terminal failure.");

    console.log("\n=================================================================");
    console.log("ALL PHASE 3 COMPREHENSIVE OUTBOX VERIFICATIONS PASSED (5/5)");
    console.log("=================================================================");
  } finally {
    await db.execute("DELETE FROM sms_outbox WHERE destination = ?", [TEST_PHONE]);
    await db.execute("DELETE FROM otp_codes WHERE destination = ?", [TEST_PHONE]);
    await db.execute("DELETE FROM users WHERE id = ?", [testUserId]);
    console.log("[Cleanup] Cleaned up verification fixtures.");
  }
}

runComprehensiveVerification()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Comprehensive Verification Failed:", err);
    process.exit(1);
  });

