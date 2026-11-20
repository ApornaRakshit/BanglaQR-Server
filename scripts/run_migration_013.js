import { db } from "../src/config/db.js";

async function addColumnIfNotExists(connection, table, column, def) {
  const [rows] = await connection.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
    [table, column]
  );
  if (rows.length === 0) {
    await connection.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
    console.log(`✅ Added column ${column} to ${table}`);
  } else {
    console.log(`ℹ️ Column ${column} already exists in ${table}`);
  }
}

async function run() {
  console.log("Running migration 013 (JS schema inspector)...");
  const connection = await db.getConnection();
  try {
    const table = "institution_kyc_requirements";

    await addColumnIfNotExists(connection, table, "max_pdf_pages", "INT NOT NULL DEFAULT 5 AFTER max_file_size_mb");
    await addColumnIfNotExists(connection, table, "admin_notes", "TEXT NULL AFTER review_instructions");
    await addColumnIfNotExists(connection, table, "auto_verify_ocr", "TINYINT(1) NOT NULL DEFAULT 0 AFTER admin_notes");
    await addColumnIfNotExists(connection, table, "check_expiry", "TINYINT(1) NOT NULL DEFAULT 0 AFTER auto_verify_ocr");
    await addColumnIfNotExists(connection, table, "require_matching_name", "TINYINT(1) NOT NULL DEFAULT 0 AFTER check_expiry");
    await addColumnIfNotExists(connection, table, "expiry_field_name", "VARCHAR(100) NULL DEFAULT 'expiry_date' AFTER require_matching_name");
    await addColumnIfNotExists(connection, table, "min_validity_days", "INT NOT NULL DEFAULT 30 AFTER expiry_field_name");
    await addColumnIfNotExists(connection, table, "reference_api_url", "VARCHAR(500) NULL AFTER min_validity_days");
    await addColumnIfNotExists(connection, table, "sample_document_url", "VARCHAR(500) NULL AFTER reference_api_url");
    await addColumnIfNotExists(connection, table, "sample_document_urls", "JSON NULL AFTER sample_document_url");

    console.log("✅ Migration 013 successfully applied!");

    const [cols] = await connection.query("SHOW COLUMNS FROM institution_kyc_requirements");
    console.log("\nFinal columns in institution_kyc_requirements:");
    cols.forEach((c) => console.log(` - ${c.Field}: ${c.Type} (${c.Null === "YES" ? "NULL" : "NOT NULL"}, default: ${c.Default})`));

    process.exit(0);
  } catch (err) {
    console.error("❌ Migration error:", err);
    process.exit(1);
  } finally {
    connection.release();
  }
}

run();

