import { db } from "../src/config/db.js";

async function addColumnIfNotExists(table, column, def) {
  const [rows] = await db.execute(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
    [table, column]
  );
  if (rows.length === 0) {
    await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
    console.log(`Added ${column} to ${table}`);
  } else {
    console.log(`Column ${column} already exists in ${table}`);
  }
}

async function run() {
  try {
    await addColumnIfNotExists("merchant_kyc", "business_entity_type", "VARCHAR(100) NULL");
    await addColumnIfNotExists("merchant_kyc", "designation", "VARCHAR(100) NULL");
    await addColumnIfNotExists("merchant_kyc", "nid_issue_date", "DATE NULL");
    await addColumnIfNotExists("merchant_kyc", "nid_expiry_date", "DATE NULL");
    await addColumnIfNotExists("merchant_kyc", "branch_name", "VARCHAR(255) NULL");
    await addColumnIfNotExists("merchant_kyc", "account_type", "ENUM('Current', 'Savings', 'Business') NOT NULL DEFAULT 'Current'");

    await addColumnIfNotExists("merchant_documents", "custom_label", "VARCHAR(255) NULL");
    await addColumnIfNotExists("merchant_documents", "original_filename", "VARCHAR(255) NULL");
    await addColumnIfNotExists("merchant_documents", "stored_filename", "VARCHAR(255) NULL");
    await addColumnIfNotExists("merchant_documents", "review_note", "TEXT NULL");

    console.log("✅ Columns successfully verified and created");
    const [kycCols] = await db.execute("DESCRIBE merchant_kyc;");
    console.log("Final merchant_kyc columns:", kycCols.map((c) => c.Field));
    const [docCols] = await db.execute("DESCRIBE merchant_documents;");
    console.log("Final merchant_documents columns:", docCols.map((c) => c.Field));
    process.exit(0);
  } catch (err) {
    console.error("Migration error:", err);
    process.exit(1);
  }
}

run();

