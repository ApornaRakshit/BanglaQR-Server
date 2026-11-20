import mysql from "mysql2/promise";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

async function run() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "admin123",
    database: process.env.DB_NAME || "banglaqr_db",
  });

  try {
    const sqlPath = path.resolve("migrations/015_create_institution_invitations.sql");
    const sql = fs.readFileSync(sqlPath, "utf8");

    await pool.query(sql);
    console.log("Migration 015 applied successfully!");

    const [desc] = await pool.query("DESCRIBE institution_invitations");
    console.log("institution_invitations table columns:");
    desc.forEach((c) => console.log(` - ${c.Field}: ${c.Type}`));
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

run();

