import { db } from "../src/config/db.js";

async function runMigration() {
  console.log("Running Migration 021: Add password_changed_at and reset_challenge_jti...");

  try {
    const [userCols] = await db.execute(
      "SHOW COLUMNS FROM users LIKE 'password_changed_at'"
    );
    if (!userCols.length) {
      console.log("Adding column `password_changed_at` to `users` table...");
      await db.execute(`
        ALTER TABLE users
        ADD COLUMN password_changed_at TIMESTAMP NULL DEFAULT NULL AFTER must_change_password
      `);
      console.log("✓ Added password_changed_at to users");
    } else {
      console.log("Column password_changed_at already exists in users");
    }

    const [otpCols] = await db.execute(
      "SHOW COLUMNS FROM otp_codes LIKE 'reset_challenge_jti'"
    );
    if (!otpCols.length) {
      console.log("Adding column `reset_challenge_jti` to `otp_codes` table...");
      await db.execute(`
        ALTER TABLE otp_codes
        ADD COLUMN reset_challenge_jti VARCHAR(64) NULL DEFAULT NULL AFTER verified_at,
        ADD INDEX idx_otp_codes_reset_challenge_jti (reset_challenge_jti)
      `);
      console.log("✓ Added reset_challenge_jti to otp_codes");
    } else {
      console.log("Column reset_challenge_jti already exists in otp_codes");
    }

    console.log("Migration 021 completed successfully!");
  } catch (error) {
    console.error("Migration 021 failed:", error);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

runMigration();

