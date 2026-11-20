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

  const [mfs] = await conn.query(`
    SELECT id, name, institution_code, institution_type, status, partnership_status, directory_status 
    FROM institutions 
    WHERE institution_type IN ('mfs', 'payment_gateway', 'digital_bank') 
       OR name LIKE '%bKash%' OR name LIKE '%Nagad%' OR name LIKE '%Rocket%' OR name LIKE '%Upay%'
  `);
  console.log('ALL MFS / WALLET INSTITUTIONS IN DB:');
  console.table(mfs);

  const [gateways] = await conn.query(`
    SELECT id, name, code, type, status FROM payment_gateways
  `);
  console.log('PAYMENT GATEWAYS IN DB:');
  console.table(gateways);

  await conn.end();
}

main().catch(console.error);

