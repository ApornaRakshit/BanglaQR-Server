import { db } from "../src/config/db.js";

async function run() {
  const [cols] = await db.query("SHOW COLUMNS FROM institution_users LIKE 'image_url'");
  if (!cols.length) {
    await db.query("ALTER TABLE institution_users ADD COLUMN image_url VARCHAR(500) NULL AFTER staff_name");
    console.log("Added image_url column to institution_users table.");
  } else {
    console.log("image_url column already exists.");
  }

  // Also check platform_admin_users for avatar_url
  const [pauCols] = await db.query("SHOW COLUMNS FROM platform_admin_users LIKE 'avatar_url'");
  if (!pauCols.length) {
    await db.query("ALTER TABLE platform_admin_users ADD COLUMN avatar_url VARCHAR(500) NULL AFTER full_name");
    console.log("Added avatar_url column to platform_admin_users table.");
  } else {
    console.log("avatar_url column already exists.");
  }

  process.exit(0);
}

run().catch((err) => {
  console.error("Migration error:", err);
  process.exit(1);
});
