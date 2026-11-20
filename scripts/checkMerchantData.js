import { db } from "../src/config/db.js";

async function run() {
  try {
    const [rows] = await db.query(`
      SELECT u.id AS user_id, u.email, m.id AS merchant_id, p.company_name, p.business_type, p.industry, p.address, p.city, p.state, p.postal_code, p.website
      FROM users u
      LEFT JOIN merchants m ON m.user_id = u.id
      LEFT JOIN merchant_profiles p ON p.merchant_id = m.id
      WHERE u.email = 'aporna.rakshit@gmail.com'
    `);
    console.log("Merchant User Data in DB:", rows);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

run();

