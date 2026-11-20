import { db } from "../src/config/db.js";

async function run() {
  const [cols] = await db.query("SHOW COLUMNS FROM roles LIKE 'status'");
  if (!cols.length) {
    await db.query("ALTER TABLE roles ADD COLUMN status ENUM('active', 'disabled') NOT NULL DEFAULT 'active' AFTER scope");
    console.log("Successfully added status column to roles table.");
  } else {
    console.log("status column already exists on roles table.");
  }

  const [isSystemCols] = await db.query("SHOW COLUMNS FROM roles LIKE 'is_system'");
  if (!isSystemCols.length) {
    await db.query("ALTER TABLE roles ADD COLUMN is_system TINYINT(1) NOT NULL DEFAULT 0 AFTER status");
    console.log("Successfully added is_system column to roles table.");
    // Mark super_admin, admin, merchant, bank_admin as system roles
    await db.query("UPDATE roles SET is_system = 1 WHERE name IN ('super_admin', 'admin', 'merchant', 'bank_admin', 'institution_admin')");
  } else {
    console.log("is_system column already exists.");
  }

  process.exit(0);
}

run().catch((err) => {
  console.error("Migration error:", err);
  process.exit(1);
});
