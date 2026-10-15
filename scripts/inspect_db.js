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

  console.log('=== INSTITUTION USERS ===');
  const [iu] = await conn.query(`
    SELECT iu.id, iu.institution_id, i.name as inst_name, iu.user_id, u.email as user_email, iu.staff_name, r.name as role_name
    FROM institution_users iu
    LEFT JOIN institutions i ON i.id = iu.institution_id
    LEFT JOIN users u ON u.id = iu.user_id
    LEFT JOIN roles r ON r.id = iu.role_id
  `);
  console.table(iu);

  console.log('=== USERS WITH BRAC / BANK / ADMIN ===');
  const [users] = await conn.query(`
    SELECT id, email, phone, status FROM users WHERE email LIKE '%brac%' OR email LIKE '%bank%' OR email LIKE '%admin%'
  `);
  console.table(users);

  console.log('=== BRAC INSTITUTIONS ===');
  const [bracInsts] = await conn.query(`
    SELECT id, name, institution_code, institution_type, status, partnership_status FROM institutions WHERE name LIKE '%BRAC%'
  `);
  console.table(bracInsts);

  console.log('=== PRIME BANK INSTITUTIONS ===');
  const [primeInsts] = await conn.query(`
    SELECT id, name, institution_code, institution_type, status, partnership_status FROM institutions WHERE name LIKE '%Prime%'
  `);
  console.table(primeInsts);

  console.log('=== MFS INSTITUTIONS / PROFILES ===');
  const [mfsInsts] = await conn.query(`
    SELECT id, name, institution_code, institution_type, status, partnership_status FROM institutions WHERE institution_type = 'mfs' OR name LIKE '%bKash%' OR name LIKE '%Nagad%' OR name LIKE '%Rocket%' OR name LIKE '%Upay%'
  `);
  console.table(mfsInsts);

  console.log('=== ALL INSTITUTION TYPES ===');
  const [types] = await conn.query(`
    SELECT institution_type, COUNT(*) as cnt FROM institutions GROUP BY institution_type
  `);
  console.table(types);

  await conn.end();
}

main().catch(console.error);

