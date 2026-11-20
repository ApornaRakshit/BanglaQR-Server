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

  const [cols] = await conn.query('DESCRIBE institution_mfs_profiles');
  console.log('institution_mfs_profiles columns:');
  console.table(cols);

  const [cols2] = await conn.query('DESCRIBE institution_bank_profiles');
  console.log('institution_bank_profiles columns:');
  console.table(cols2);

  await conn.end();
}

main().catch(console.error);

