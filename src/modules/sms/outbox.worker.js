import crypto from "crypto";
import { db } from "../../config/db.js";
import { smsService } from "../../services/sms.service.js";
import { encryptPayload, decryptPayload } from "./outbox.crypto.js";

const WORKER_ID = `worker-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
const LEASE_DURATION_SECONDS = 30;
const MAX_ATTEMPTS = 3;

let workerIntervalId = null;

export const smsOutboxService = {
  /**
   * Start recurring worker polling loop (e.g. for server startup)
   */
  startWorker(intervalMs = 5000) {
    if (workerIntervalId) return;
    workerIntervalId = setInterval(async () => {
      try {
        await smsOutboxService.processOutboxBatch(10);
      } catch (err) {
        console.error("[SmsOutboxWorker] Batch processing error:", err.message);
      }
    }, intervalMs);
    // Don't keep Node process alive solely for background polling
    if (workerIntervalId && workerIntervalId.unref) {
      workerIntervalId.unref();
    }
  },

  /**
   * Stop recurring worker loop
   */
  stopWorker() {
    if (workerIntervalId) {
      clearInterval(workerIntervalId);
      workerIntervalId = null;
    }
  },
  /**
   * Enqueue an SMS to be delivered durably with AES-256-GCM encryption.
   * Can be executed within an existing MySQL transaction connection.
   */
  async enqueueSms(connectionOrDb, { otpCodeId, destination, purpose, otp, expiresAt }) {
    const payload = {
      otp,
      purpose,
      destination,
      queuedAt: new Date().toISOString(),
    };

    const { encryptedPayload, iv, authTag } = encryptPayload(payload);

    const [result] = await connectionOrDb.execute(
      `INSERT INTO sms_outbox (
        otp_code_id, destination, purpose, encrypted_payload, iv, auth_tag,
        status, attempts, max_attempts, next_attempt_at, expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, NOW(), ?, NOW())`,
      [
        otpCodeId || null,
        destination,
        purpose,
        encryptedPayload,
        iv,
        authTag,
        MAX_ATTEMPTS,
        expiresAt,
      ]
    );

    return result.insertId;
  },

  /**
   * Process a batch of pending SMS outbox jobs with worker leases and backoff.
   * Returns number of jobs processed.
   */
  async processOutboxBatch(batchSize = 10) {
    // 1. Expire stale or overdue jobs first
    await db.execute(
      `UPDATE sms_outbox
       SET status = 'expired', encrypted_payload = NULL, iv = NULL, auth_tag = NULL, last_error = 'OTP expired before delivery'
       WHERE status IN ('pending', 'processing') AND expires_at <= NOW()`
    );

    // 2. Claim pending jobs with worker lease to prevent duplicate claiming across workers
    const leaseUntil = new Date(Date.now() + LEASE_DURATION_SECONDS * 1000);
    const [claimResult] = await db.execute(
      `UPDATE sms_outbox
       SET status = 'processing',
           locked_by = ?,
           locked_until = ?
       WHERE (status = 'pending' OR (status = 'processing' AND locked_until < NOW()))
         AND next_attempt_at <= NOW()
         AND expires_at > NOW()
         AND attempts < max_attempts
       ORDER BY id ASC
       LIMIT ?`,
      [WORKER_ID, leaseUntil, batchSize]
    );

    if (claimResult.affectedRows === 0) {
      return 0;
    }

    // 3. Fetch claimed jobs
    const [jobs] = await db.execute(
      `SELECT id, otp_code_id, destination, purpose, encrypted_payload, iv, auth_tag, attempts, max_attempts, expires_at
       FROM sms_outbox
       WHERE locked_by = ? AND status = 'processing'`,
      [WORKER_ID]
    );

    for (const job of jobs) {
      const currentAttempt = job.attempts + 1;

      // Check if job expired while waiting
      if (new Date(job.expires_at) <= new Date()) {
        await db.execute(
          `UPDATE sms_outbox
           SET status = 'expired', encrypted_payload = NULL, iv = NULL, auth_tag = NULL, locked_by = NULL, locked_until = NULL, last_error = 'OTP expired'
           WHERE id = ?`,
          [job.id]
        );
        continue;
      }

      // Decrypt payload
      const decrypted = decryptPayload(job.encrypted_payload, job.iv, job.auth_tag);
      if (!decrypted || !decrypted.otp) {
        await db.execute(
          `UPDATE sms_outbox
           SET status = 'failed', encrypted_payload = NULL, iv = NULL, auth_tag = NULL, locked_by = NULL, locked_until = NULL, last_error = 'Corrupt or unreadable encrypted payload'
           WHERE id = ?`,
          [job.id]
        );
        continue;
      }

      try {
        const sendResult = await smsService.sendOtpSms({
          to: job.destination,
          otp: decrypted.otp,
          purpose: job.purpose,
          expiresMinutes: 5,
        });

        // SUCCESS: Erase encrypted payload and mark delivered
        await db.execute(
          `UPDATE sms_outbox
           SET status = 'sent',
               encrypted_payload = NULL,
               iv = NULL,
               auth_tag = NULL,
               locked_by = NULL,
               locked_until = NULL,
               provider_reference = ?,
               delivered_at = NOW(),
               attempts = ?
           WHERE id = ?`,
          [sendResult?.referenceId || sendResult?.messageId || "delivered", currentAttempt, job.id]
        );
      } catch (err) {
        // Sanitize error message (never log secret or payload)
        const sanitizedError = (err?.message || "SMS delivery failure").substring(0, 250);

        if (currentAttempt >= job.max_attempts) {
          // Permanently failed: Erase encrypted payload
          await db.execute(
            `UPDATE sms_outbox
             SET status = 'failed',
                 encrypted_payload = NULL,
                 iv = NULL,
                 auth_tag = NULL,
                 locked_by = NULL,
                 locked_until = NULL,
                 attempts = ?,
                 last_error = ?
             WHERE id = ?`,
            [currentAttempt, sanitizedError, job.id]
          );
        } else {
          // Retry with exponential backoff: 2s, 6s, 18s...
          const backoffSeconds = Math.pow(3, currentAttempt);
          await db.execute(
            `UPDATE sms_outbox
             SET status = 'pending',
                 locked_by = NULL,
                 locked_until = NULL,
                 attempts = ?,
                 next_attempt_at = DATE_ADD(NOW(), INTERVAL ? SECOND),
                 last_error = ?
             WHERE id = ?`,
            [currentAttempt, backoffSeconds, sanitizedError, job.id]
          );
        }
      }
    }

    return jobs.length;
  },
};

