import { db } from "../src/config/db.js";

async function runMigration() {
  console.log("--------------------------------------------------");
  console.log("RUNNING MIGRATION 007: CONTACT INQUIRIES & NOTIFICATIONS");
  console.log("--------------------------------------------------");

  try {
    // 1. Create contact_inquiries table
    await db.query(`
      CREATE TABLE IF NOT EXISTS contact_inquiries (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        full_name VARCHAR(150) NOT NULL,
        phone VARCHAR(30) NOT NULL,
        email VARCHAR(150) NOT NULL,
        service_id VARCHAR(100) NULL,
        service_name VARCHAR(150) NOT NULL,
        message TEXT NULL,
        status ENUM('new', 'in_progress', 'replied', 'closed') NOT NULL DEFAULT 'new',
        ip_address VARCHAR(45) NULL,
        user_agent TEXT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_contact_inquiries_status (status),
        INDEX idx_contact_inquiries_created_at (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log("✓ Created table 'contact_inquiries' successfully");

    // 2. Modify notifications table type enum to include contact_inquiry
    await db.query(`
      ALTER TABLE notifications 
      MODIFY COLUMN type ENUM('system','merchant_update','kyc','document','gateway','security','contact_inquiry','info') NOT NULL DEFAULT 'system';
    `);
    console.log("✓ Updated 'notifications.type' ENUM column successfully");

    // 3. Ensure permissions for contact inquiries exist
    const perms = [
      { name: "contact_inquiry.view", description: "View public contact inquiries" },
      { name: "contact_inquiry.manage", description: "Manage and reply to contact inquiries" },
    ];

    for (const p of perms) {
      const [existing] = await db.query("SELECT id FROM permissions WHERE name = ?", [p.name]);
      if (existing.length === 0) {
        const [res] = await db.query("INSERT INTO permissions (name, description) VALUES (?, ?)", [p.name, p.description]);
        const permId = res.insertId;

        // Assign to super_admin (role id 1) and admin (role id 2)
        const [roles] = await db.query("SELECT id FROM roles WHERE name IN ('super_admin', 'admin')");
        for (const r of roles) {
          await db.query("INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)", [r.id, permId]);
        }
        console.log(`✓ Added permission '${p.name}' and assigned to admin roles`);
      }
    }

    console.log("🎉 Migration 007 completed successfully!");
    process.exit(0);
  } catch (err) {
    console.error("❌ Migration failed:", err);
    process.exit(1);
  }
}

runMigration();

