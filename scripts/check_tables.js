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

  const [cols] = await conn.query('DESCRIBE gateways');
  console.log(cols.map(c => c.Field));

  const [rows] = await conn.query('SELECT * FROM gateways');
  console.log(rows.map(r => ({ id: r.id, institution_id: r.institution_id, name: r.name, code: r.code })));

  await conn.end();
}

main().catch(console.error);

