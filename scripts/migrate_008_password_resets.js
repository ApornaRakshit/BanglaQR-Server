import { db } from "../src/config/db.js";
import fs from "fs/promises";
import path from "path";

async function runMigration() {
  console.log("Applying Migration: 005_create_password_resets.sql ...");
  try {
    const sqlPath = path.join(process.cwd(), "migrations", "005_create_password_resets.sql");
    const sql = await fs.readFile(sqlPath, "utf-8");
    await db.query(sql);
    console.log("✓ Migration 005 applied successfully. Table 'password_resets' is ready.");
  } catch (err) {
    console.error("Migration failed:", err);
  } finally {
    await db.end();
  }
}

runMigration();

