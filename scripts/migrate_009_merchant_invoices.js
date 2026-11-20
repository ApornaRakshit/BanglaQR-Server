import { db } from "../src/config/db.js";

async function migrate() {
  console.log("=== STARTING INVOICE MODULE MIGRATION (009) ===");

  // 1. Create invoice_customers table
  await db.query(`
    CREATE TABLE IF NOT EXISTS invoice_customers (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      merchant_id BIGINT UNSIGNED NOT NULL,
      name VARCHAR(255) NOT NULL,
      business_name VARCHAR(255) NULL,
      email VARCHAR(255) NULL,
      phone VARCHAR(50) NULL,
      billing_address TEXT NULL,
      tax_identification VARCHAR(100) NULL,
      notes TEXT NULL,
      status ENUM('active', 'archived') DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_inv_cust_merchant (merchant_id),
      INDEX idx_inv_cust_email (email),
      INDEX idx_inv_cust_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
  console.log("✓ invoice_customers table ready");

  // 2. Additive columns for invoices table
  const [cols] = await db.query("DESCRIBE invoices");
  const existingCols = new Set(cols.map((c) => c.Field));

  const columnsToAdd = [
    { name: "customer_id", type: "BIGINT UNSIGNED NULL AFTER merchant_id" },
    { name: "customer_phone", type: "VARCHAR(50) NULL AFTER customer_email" },
    { name: "customer_address", type: "TEXT NULL AFTER customer_phone" },
    { name: "customer_business_name", type: "VARCHAR(255) NULL AFTER customer_address" },
    { name: "subtotal", type: "DECIMAL(12,2) DEFAULT 0.00 AFTER amount" },
    { name: "discount_amount", type: "DECIMAL(12,2) DEFAULT 0.00 AFTER subtotal" },
    { name: "tax_amount", type: "DECIMAL(12,2) DEFAULT 0.00 AFTER discount_amount" },
    { name: "amount_paid", type: "DECIMAL(12,2) DEFAULT 0.00 AFTER tax_amount" },
    { name: "balance_due", type: "DECIMAL(12,2) DEFAULT 0.00 AFTER amount_paid" },
    { name: "po_number", type: "VARCHAR(100) NULL AFTER due_date" },
    { name: "reference_number", type: "VARCHAR(100) NULL AFTER po_number" },
    { name: "notes", type: "TEXT NULL AFTER items" },
    { name: "payment_instructions", type: "TEXT NULL AFTER notes" },
    { name: "terms_conditions", type: "TEXT NULL AFTER payment_instructions" },
    { name: "footer_message", type: "TEXT NULL AFTER terms_conditions" },
    { name: "sent_at", type: "DATETIME NULL AFTER status" },
    { name: "last_reminder_at", type: "DATETIME NULL AFTER sent_at" },
    { name: "paid_at", type: "DATETIME NULL AFTER last_reminder_at" },
    { name: "cancelled_at", type: "DATETIME NULL AFTER paid_at" },
  ];

  for (const col of columnsToAdd) {
    if (!existingCols.has(col.name)) {
      console.log(`  Adding column ${col.name} to invoices table...`);
      await db.query(`ALTER TABLE invoices ADD COLUMN ${col.name} ${col.type}`);
    }
  }
  console.log("✓ invoices table columns updated");

  // 3. Create invoice_payments table
  await db.query(`
    CREATE TABLE IF NOT EXISTS invoice_payments (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      merchant_id BIGINT UNSIGNED NOT NULL,
      invoice_id BIGINT UNSIGNED NOT NULL,
      amount DECIMAL(12,2) NOT NULL,
      payment_date DATE NOT NULL,
      payment_method VARCHAR(100) NOT NULL,
      reference_id VARCHAR(150) NULL,
      notes TEXT NULL,
      is_gateway_verified TINYINT(1) DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_inv_pay_merchant (merchant_id),
      INDEX idx_inv_pay_invoice (invoice_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
  console.log("✓ invoice_payments table ready");

  // 4. Create invoice_history table
  await db.query(`
    CREATE TABLE IF NOT EXISTS invoice_history (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      merchant_id BIGINT UNSIGNED NOT NULL,
      invoice_id BIGINT UNSIGNED NOT NULL,
      action VARCHAR(100) NOT NULL,
      description TEXT NULL,
      metadata JSON NULL,
      created_by BIGINT UNSIGNED NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_inv_hist_merchant (merchant_id),
      INDEX idx_inv_hist_invoice (invoice_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
  console.log("✓ invoice_history table ready");

  console.log("=== INVOICE MODULE MIGRATION COMPLETED SUCCESSFULLY ===");
  process.exit(0);
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});

