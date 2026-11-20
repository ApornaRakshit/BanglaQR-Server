import { db } from "../src/config/db.js";

async function runMigration() {
  console.log("Running Migration 023: Create sms_outbox table...");

  try {
    const [tables] = await db.execute("SHOW TABLES LIKE 'sms_outbox'");
    if (!tables.length) {
      console.log("Creating `sms_outbox` table...");
      await db.execute(`
        CREATE TABLE IF NOT EXISTS sms_outbox (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          otp_code_id BIGINT UNSIGNED NULL,
          destination VARCHAR(255) NOT NULL,
          purpose VARCHAR(50) NOT NULL,
          encrypted_payload TEXT NULL COMMENT 'AES-256-GCM encrypted payload containing message text and OTP',
          iv VARCHAR(64) NULL,
          auth_tag VARCHAR(64) NULL,
          status ENUM('pending', 'processing', 'sent', 'failed', 'expired') NOT NULL DEFAULT 'pending',
          attempts INT UNSIGNED NOT NULL DEFAULT 0,
          max_attempts INT UNSIGNED NOT NULL DEFAULT 3,
          next_attempt_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          locked_until DATETIME NULL DEFAULT NULL,
          locked_by VARCHAR(100) NULL DEFAULT NULL,
          provider VARCHAR(50) NOT NULL DEFAULT 'gennet',
          provider_reference VARCHAR(100) NULL DEFAULT NULL,
          last_error VARCHAR(255) NULL DEFAULT NULL,
          expires_at DATETIME NOT NULL,
          delivered_at DATETIME NULL DEFAULT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_status_next_attempt (status, next_attempt_at, locked_until),
          INDEX idx_destination_purpose (destination, purpose),
          INDEX idx_expires_at (expires_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);
      console.log("✓ Created `sms_outbox` table successfully");
    } else {
      console.log("Table `sms_outbox` already exists");
    }

    console.log("Migration 023 completed successfully!");
  } catch (error) {
    console.error("Migration 023 failed:", error);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

runMigration();

