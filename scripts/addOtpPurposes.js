import { db } from "../src/config/db.js";

async function run() {
  const [cols] = await db.query("SHOW COLUMNS FROM otp_codes LIKE 'purpose'");
  console.log("Current purpose column:", cols[0]);

  // Alter enum to include 'phone_change' and 'email_change'
  await db.query(`
    ALTER TABLE otp_codes 
    MODIFY COLUMN purpose ENUM(
      'email_verification',
      'phone_verification',
      'login',
      'password_reset',
      'two_factor',
      'phone_change',
      'email_change'
    ) NOT NULL
  `);

  console.log("Updated otp_codes.purpose ENUM to include phone_change and email_change.");
  process.exit(0);
}

run().catch((err) => {
  console.error("Migration error:", err);
  process.exit(1);
});
