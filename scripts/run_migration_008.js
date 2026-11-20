import mysql from 'mysql2/promise';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

async function addColumnIfNotExists(conn, table, column, definition) {
  const [cols] = await conn.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  if (cols.length === 0) {
    console.log(`Adding ${column} to ${table}...`);
    await conn.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  } else {
    console.log(`Column ${column} already exists in ${table}.`);
  }
}

async function runMigration() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,
  });

  try {
    console.log('Running migration 008...');

    // 1. Modify merchant_gateway_applications
    await conn.query(`ALTER TABLE merchant_gateway_applications MODIFY COLUMN gateway_id BIGINT UNSIGNED NULL`);
    await addColumnIfNotExists(conn, 'merchant_gateway_applications', 'gateway_name', 'VARCHAR(150) NULL');
    await addColumnIfNotExists(conn, 'merchant_gateway_applications', 'gateway_code', 'VARCHAR(50) NULL');
    await addColumnIfNotExists(conn, 'merchant_gateway_applications', 'logo_url', 'VARCHAR(500) NULL');
    await addColumnIfNotExists(conn, 'merchant_gateway_applications', 'service_type', 'VARCHAR(100) NULL');
    await addColumnIfNotExists(conn, 'merchant_gateway_applications', 'service_fee', 'DECIMAL(6,2) NULL');

    // 2. Modify merchant_gateway_services
    await conn.query(`ALTER TABLE merchant_gateway_services MODIFY COLUMN gateway_id BIGINT UNSIGNED NULL`);
    await addColumnIfNotExists(conn, 'merchant_gateway_services', 'gateway_name', 'VARCHAR(150) NULL');
    await addColumnIfNotExists(conn, 'merchant_gateway_services', 'gateway_code', 'VARCHAR(50) NULL');
    await addColumnIfNotExists(conn, 'merchant_gateway_services', 'logo_url', 'VARCHAR(500) NULL');
    await addColumnIfNotExists(conn, 'merchant_gateway_services', 'service_fee', 'DECIMAL(6,2) NULL');

    // 3. Modify merchant_addons
    await conn.query(`ALTER TABLE merchant_addons MODIFY COLUMN addon_id BIGINT UNSIGNED NULL`);
    await addColumnIfNotExists(conn, 'merchant_addons', 'addon_name', 'VARCHAR(150) NULL');
    await addColumnIfNotExists(conn, 'merchant_addons', 'addon_code', 'VARCHAR(50) NULL');
    await addColumnIfNotExists(conn, 'merchant_addons', 'logo_url', 'VARCHAR(500) NULL');
    await addColumnIfNotExists(conn, 'merchant_addons', 'category', 'VARCHAR(100) NULL');
    await addColumnIfNotExists(conn, 'merchant_addons', 'price', 'DECIMAL(10,2) NULL');
    await addColumnIfNotExists(conn, 'merchant_addons', 'pricing_type', 'VARCHAR(50) NULL');

    // 4. Backfill
    console.log('Backfilling snapshots...');
    await conn.query(`
      UPDATE merchant_gateway_applications mga
      JOIN gateways g ON mga.gateway_id = g.id
      SET 
        mga.gateway_name = COALESCE(mga.gateway_name, g.name),
        mga.gateway_code = COALESCE(mga.gateway_code, g.code),
        mga.logo_url = COALESCE(mga.logo_url, g.logo_url),
        mga.service_type = COALESCE(mga.service_type, g.service_type),
        mga.service_fee = COALESCE(mga.service_fee, g.service_fee)
    `);

    await conn.query(`
      UPDATE merchant_gateway_services mgs
      JOIN gateways g ON mgs.gateway_id = g.id
      SET 
        mgs.gateway_name = COALESCE(mgs.gateway_name, g.name),
        mgs.gateway_code = COALESCE(mgs.gateway_code, g.code),
        mgs.logo_url = COALESCE(mgs.logo_url, g.logo_url),
        mgs.service_fee = COALESCE(mgs.service_fee, g.service_fee)
    `);

    await conn.query(`
      UPDATE merchant_addons ma
      JOIN addons a ON ma.addon_id = a.id
      SET 
        ma.addon_name = COALESCE(ma.addon_name, a.name),
        ma.addon_code = COALESCE(ma.addon_code, a.code),
        ma.logo_url = COALESCE(ma.logo_url, a.logo_url),
        ma.category = COALESCE(ma.category, a.category),
        ma.price = COALESCE(ma.price, a.price),
        ma.pricing_type = COALESCE(ma.pricing_type, a.pricing_type)
    `);

    console.log('Migration 008 completed successfully!');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    await conn.end();
  }
}

runMigration();

