import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'banglaqr_db'
  });

  console.log('=== INSTITUTION 9 DETAILS ===');
  const [inst9] = await conn.query('SELECT * FROM institutions WHERE id = 9');
  console.log(inst9[0]);

  console.log('=== ALL MFS / WALLET INSTITUTIONS ===');
  const [mfs] = await conn.query(`
    SELECT id, name, institution_code, institution_type, status, partnership_status 
    FROM institutions 
    WHERE institution_type IN ('mfs', 'payment_gateway', 'digital_bank') 
       OR name LIKE '%bKash%' OR name LIKE '%Nagad%' OR name LIKE '%Rocket%' OR name LIKE '%Upay%'
  `);
  console.table(mfs);

  console.log('=== INSTITUTION MFS PROFILES ===');
  const [mfsProfiles] = await conn.query('SELECT * FROM institution_mfs_profiles');
  console.table(mfsProfiles);

  console.log('=== INSTITUTION BANK PROFILES (first 10) ===');
  const [bankProfiles] = await conn.query('SELECT * FROM institution_bank_profiles LIMIT 10');
  console.table(bankProfiles);

  await conn.end();
}

main().catch(console.error);

