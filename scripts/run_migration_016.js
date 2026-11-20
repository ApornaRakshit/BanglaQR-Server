import { db } from "../src/config/db.js";

async function run() {
  const connection = await db.getConnection();
  try {
    await connection.query(
      "ALTER TABLE institutions MODIFY COLUMN institution_type ENUM('bank','commercial_bank','specialized_bank','mfs','payment_gateway','digital_bank','other') NOT NULL DEFAULT 'bank'"
    );
    await connection.query(
      "ALTER TABLE institution_bank_profiles MODIFY COLUMN bank_category ENUM('commercial_conventional','commercial_islamic','specialized','foreign_commercial','digital_bank') NOT NULL DEFAULT 'commercial_conventional'"
    );
    console.log("✅ Enums updated with digital_bank successfully!");
  } catch (err) {
    console.error("Failed to update enums:", err);
  } finally {
    connection.release();
    await db.end();
  }
}

run();

