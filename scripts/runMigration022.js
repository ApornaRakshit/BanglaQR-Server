import { db } from "../src/config/db.js";

async function runMigration() {
  console.log("Running Migration 022: Add token_version to users table...");

  try {
    const [cols] = await db.execute("SHOW COLUMNS FROM users LIKE 'token_version'");
    if (!cols.length) {
      console.log("Adding column `token_version` to `users` table...");
      await db.execute(`
        ALTER TABLE users
        ADD COLUMN token_version INT UNSIGNED NOT NULL DEFAULT 0 AFTER must_change_password
      `);
      console.log("✓ Added token_version to users table with DEFAULT 0");
    } else {
      console.log("Column token_version already exists in users table");
    }

    console.log("Migration 022 completed successfully!");
  } catch (error) {
    console.error("Migration 022 failed:", error);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

runMigration();

