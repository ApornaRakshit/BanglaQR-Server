import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();

async function run() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "bangla_qr",
  });

  const [cols1] = await conn.execute(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'bangla_qr' AND TABLE_NAME = 'merchant_gateway_applications' AND COLUMN_NAME = 'application_type'"
  );
  if (cols1.length === 0) {
    await conn.execute(
      "ALTER TABLE merchant_gateway_applications ADD COLUMN application_type ENUM('onboarding_kyc', 'gateway_service') NOT NULL DEFAULT 'onboarding_kyc' AFTER application_number"
    );
    console.log("Added application_type");
  }

  await conn.execute(
    "UPDATE merchant_gateway_applications SET application_type = CASE WHEN gateway_id IS NOT NULL AND institution_service_id IS NOT NULL THEN 'gateway_service' ELSE 'onboarding_kyc' END"
  );

  await conn.execute(
    "ALTER TABLE notifications MODIFY COLUMN recipient_type ENUM('admin', 'merchant', 'institution', 'all') NOT NULL DEFAULT 'admin'"
  );
  console.log("Updated notifications recipient_type");

  const [cols2] = await conn.execute(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'bangla_qr' AND TABLE_NAME = 'notifications' AND COLUMN_NAME = 'institution_id'"
  );
  if (cols2.length === 0) {
    await conn.execute(
      "ALTER TABLE notifications ADD COLUMN institution_id BIGINT UNSIGNED NULL AFTER recipient_id, ADD INDEX idx_notifications_institution (institution_id)"
    );
    console.log("Added institution_id");
  }

  console.log("Migration completed successfully!");
  await conn.end();
}

run().catch(console.error);

