import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { db } from "../src/config/db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, "../.env") });

async function run() {
  console.log("Applying Migration 009: Addon Orders & Payments...");

  await db.query(`
    CREATE TABLE IF NOT EXISTS \`addon_orders\` (
      \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      \`order_number\` VARCHAR(50) NOT NULL,
      \`merchant_id\` BIGINT UNSIGNED NOT NULL,
      \`addon_id\` BIGINT UNSIGNED NULL,
      \`merchant_addon_id\` BIGINT UNSIGNED NULL,
      \`addon_name\` VARCHAR(150) NOT NULL,
      \`addon_code\` VARCHAR(50) NOT NULL,
      \`billing_cycle\` VARCHAR(50) NOT NULL DEFAULT 'monthly',
      \`pricing_type\` VARCHAR(50) NOT NULL DEFAULT 'monthly',
      \`amount\` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
      \`currency\` VARCHAR(10) NOT NULL DEFAULT 'BDT',
      \`status\` ENUM(
        'pending_payment',
        'payment_processing',
        'paid',
        'pending_admin_approval',
        'approved',
        'activation_pending',
        'active',
        'rejected',
        'cancelled',
        'suspended'
      ) NOT NULL DEFAULT 'pending_payment',
      \`notes\` TEXT NULL,
      \`admin_notes\` TEXT NULL,
      \`is_archived\` TINYINT(1) NOT NULL DEFAULT 0,
      \`archived_at\` DATETIME NULL,
      \`archived_by\` VARCHAR(100) NULL,
      \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`),
      UNIQUE KEY \`uniq_order_number\` (\`order_number\`),
      KEY \`idx_addon_orders_merchant\` (\`merchant_id\`),
      KEY \`idx_addon_orders_addon\` (\`addon_id\`),
      KEY \`idx_addon_orders_status\` (\`status\`),
      KEY \`idx_addon_orders_archived\` (\`is_archived\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
  console.log("✓ addon_orders table created or exists.");

  await db.query(`
    CREATE TABLE IF NOT EXISTS \`addon_payments\` (
      \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      \`payment_reference\` VARCHAR(100) NOT NULL,
      \`order_id\` BIGINT UNSIGNED NOT NULL,
      \`merchant_id\` BIGINT UNSIGNED NOT NULL,
      \`gateway\` VARCHAR(50) NOT NULL DEFAULT 'dgepay',
      \`payment_method\` VARCHAR(50) NULL DEFAULT 'dgepay',
      \`amount\` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
      \`currency\` VARCHAR(10) NOT NULL DEFAULT 'BDT',
      \`gateway_unique_txn_id\` VARCHAR(100) NOT NULL,
      \`gateway_order_id\` VARCHAR(100) NULL,
      \`gateway_transaction_id\` VARCHAR(100) NULL,
      \`gateway_status\` VARCHAR(100) NULL,
      \`gateway_response\` JSON NULL,
      \`checkout_url\` TEXT NULL,
      \`status\` ENUM(
        'pending',
        'processing',
        'successful',
        'cancelled',
        'failed',
        'refunded'
      ) NOT NULL DEFAULT 'pending',
      \`paid_at\` DATETIME NULL,
      \`failed_at\` DATETIME NULL,
      \`cancelled_at\` DATETIME NULL,
      \`is_archived\` TINYINT(1) NOT NULL DEFAULT 0,
      \`archived_at\` DATETIME NULL,
      \`archived_by\` VARCHAR(100) NULL,
      \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`),
      UNIQUE KEY \`uniq_payment_reference\` (\`payment_reference\`),
      UNIQUE KEY \`uniq_gateway_unique_txn_id\` (\`gateway_unique_txn_id\`),
      KEY \`idx_addon_payments_order\` (\`order_id\`),
      KEY \`idx_addon_payments_merchant\` (\`merchant_id\`),
      KEY \`idx_addon_payments_status\` (\`status\`),
      KEY \`idx_addon_payments_gateway\` (\`gateway\`),
      KEY \`idx_addon_payments_archived\` (\`is_archived\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
  console.log("✓ addon_payments table created or exists.");

  try {
    await db.query(`
      ALTER TABLE \`notifications\` 
      MODIFY COLUMN \`type\` ENUM(
        'system',
        'merchant_update',
        'kyc',
        'document',
        'gateway',
        'security',
        'contact_inquiry',
        'info',
        'payment',
        'addon'
      ) NOT NULL DEFAULT 'system';
    `);
    console.log("✓ notifications type enum expanded.");
  } catch (err) {
    console.warn("Notice: notifications type alter: " + err.message);
  }

  // Check merchant_addons for order_id / payment_id
  const [cols] = await db.query("SHOW COLUMNS FROM `merchant_addons`");
  const colNames = cols.map((c) => c.Field);
  if (!colNames.includes("order_id")) {
    await db.query("ALTER TABLE `merchant_addons` ADD COLUMN `order_id` BIGINT UNSIGNED NULL AFTER `addon_id`");
    console.log("✓ Added order_id column to merchant_addons.");
  }
  if (!colNames.includes("payment_id")) {
    await db.query("ALTER TABLE `merchant_addons` ADD COLUMN `payment_id` BIGINT UNSIGNED NULL AFTER `order_id`");
    console.log("✓ Added payment_id column to merchant_addons.");
  }

  console.log("Migration 009 executed successfully!");
  process.exit(0);
}

run().catch((err) => {
  console.error("Migration 009 error:", err);
  process.exit(1);
});

