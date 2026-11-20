import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

try {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306
  });

  const [mgaCols] = await conn.query('DESCRIBE merchant_gateway_applications');
  console.log('--- merchant_gateway_applications ---');
  console.log(mgaCols.map(c => c.Field + ' (' + c.Type + ', Null:' + c.Null + ')').join('\n'));

  const [mgsCols] = await conn.query('DESCRIBE merchant_gateway_services');
  console.log('\n--- merchant_gateway_services ---');
  console.log(mgsCols.map(c => c.Field + ' (' + c.Type + ', Null:' + c.Null + ')').join('\n'));

  const [maCols] = await conn.query('DESCRIBE merchant_addons');
  console.log('\n--- merchant_addons ---');
  console.log(maCols.map(c => c.Field + ' (' + c.Type + ', Null:' + c.Null + ')').join('\n'));

  const [gCols] = await conn.query('DESCRIBE gateways');
  console.log('\n--- gateways ---');
  console.log(gCols.map(c => c.Field + ' (' + c.Type + ', Null:' + c.Null + ')').join('\n'));

  const [aCols] = await conn.query('DESCRIBE addons');
  console.log('\n--- addons ---');
  console.log(aCols.map(c => c.Field + ' (' + c.Type + ', Null:' + c.Null + ')').join('\n'));

  const [fks] = await conn.query(`
    SELECT TABLE_NAME, COLUMN_NAME, CONSTRAINT_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
    FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL
      AND TABLE_NAME IN ('merchant_gateway_applications', 'merchant_gateway_services', 'merchant_addons')
  `);
  console.log('\n--- Foreign Keys ---');
  console.log(fks);

  await conn.end();
} catch (err) {
  console.error('Error:', err);
}

