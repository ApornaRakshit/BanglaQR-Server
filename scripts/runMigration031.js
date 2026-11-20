import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { db } from "../src/config/db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
  console.log("Starting Migration 031 execution...");

  // 1. Check & Add scope to roles
  const [roleCols] = await db.query("DESCRIBE `roles`");
  if (!roleCols.some((c) => c.Field === "scope")) {
    await db.query(
      "ALTER TABLE `roles` ADD COLUMN `scope` ENUM('platform', 'institution', 'merchant') NOT NULL DEFAULT 'platform' AFTER `description`"
    );
    console.log("✓ Added 'scope' column to `roles` table");
  }

  // 2. Check & Add module to permissions
  const [permCols] = await db.query("DESCRIBE `permissions`");
  if (!permCols.some((c) => c.Field === "module")) {
    await db.query(
      "ALTER TABLE `permissions` ADD COLUMN `module` VARCHAR(50) NOT NULL DEFAULT 'system' AFTER `description`"
    );
    console.log("✓ Added 'module' column to `permissions` table");
  }

  // 3. Update existing roles scopes
  await db.query(
    "UPDATE `roles` SET `scope` = 'platform' WHERE `name` IN ('super_admin', 'admin', 'reviewer', 'support_agent')"
  );
  await db.query("UPDATE `roles` SET `scope` = 'merchant' WHERE `name` = 'merchant'");
  await db.query(
    "UPDATE `roles` SET `scope` = 'institution' WHERE `name` IN ('bank_admin', 'bank_reviewer', 'bank_operations')"
  );

  // 4. Insert new Platform Admin roles
  const platformRoles = [
    ["operations_admin", "Operations administration, onboarding, and service lifecycle", "platform"],
    ["finance_admin", "Financial settlement, invoice and gateway payments oversight", "platform"],
    ["kyc_officer", "Dedicated KYC & document verification officer", "platform"],
    ["content_manager", "CMS, website marketing content, FAQs and inquiries", "platform"],
    ["support_admin", "Customer support, dispute tickets and communication", "platform"],
    ["auditor_viewer", "Read-only platform auditor and security viewer", "platform"],
  ];
  for (const [rName, rDesc, rScope] of platformRoles) {
    await db.query(
      "INSERT IGNORE INTO `roles` (`name`, `description`, `scope`, `created_at`) VALUES (?, ?, ?, NOW())",
      [rName, rDesc, rScope]
    );
  }

  // 5. Insert standard Institution Roles
  const institutionRoles = [
    ["institution_admin", "Institution Administrator with full branch & staff management", "institution"],
    ["institution_reviewer", "Reviews merchant onboarding applications & KYC verification", "institution"],
    ["institution_operations", "Monitors settlements, QR issuance, and daily transactions", "institution"],
    ["institution_compliance", "Compliance monitoring, AML auditing and regulatory filings", "institution"],
    ["institution_viewer", "Read-only auditor for branch and transaction reports", "institution"],
  ];
  for (const [rName, rDesc, rScope] of institutionRoles) {
    await db.query(
      "INSERT IGNORE INTO `roles` (`name`, `description`, `scope`, `created_at`) VALUES (?, ?, ?, NOW())",
      [rName, rDesc, rScope]
    );
  }

  // 6. Update permission modules
  await db.query("UPDATE `permissions` SET `module` = 'merchant' WHERE `name` LIKE 'merchant.%'");
  await db.query("UPDATE `permissions` SET `module` = 'kyc' WHERE `name` LIKE 'kyc.%'");
  await db.query("UPDATE `permissions` SET `module` = 'document' WHERE `name` LIKE 'document.%'");
  await db.query(
    "UPDATE `permissions` SET `module` = 'gateway' WHERE `name` LIKE 'gateway.%' OR `name` LIKE 'application.%'"
  );
  await db.query(
    "UPDATE `permissions` SET `module` = 'payments' WHERE `name` LIKE 'addon.%' OR `name` LIKE 'invoice.%'"
  );
  await db.query(
    "UPDATE `permissions` SET `module` = 'cms' WHERE `name` LIKE 'cms.%' OR `name` LIKE 'contact_inquiry.%'"
  );
  await db.query("UPDATE `permissions` SET `module` = 'support' WHERE `name` LIKE 'ticket.%'");
  await db.query("UPDATE `permissions` SET `module` = 'audit' WHERE `name` LIKE 'audit.%'");
  await db.query("UPDATE `permissions` SET `module` = 'institution' WHERE `name` LIKE 'institution.%'");

  // 7. Insert new Permissions
  const newPermissions = [
    ["admin_users.view", "View platform admin users and activity", "user_management"],
    ["admin_users.create", "Invite and create platform admin users", "user_management"],
    ["admin_users.edit", "Edit platform admin user profile and status", "user_management"],
    ["admin_users.delete", "Suspend or delete platform admin user access", "user_management"],
    ["roles.view", "View roles and permission matrices", "user_management"],
    ["roles.manage", "Create and edit roles and assign permissions", "user_management"],
    ["institution_staff.view", "View all bank and MFS institution staff", "institution_staff"],
    ["institution_staff.create", "Create and invite bank and MFS institution staff", "institution_staff"],
    ["institution_staff.edit", "Edit bank and MFS institution staff details and roles", "institution_staff"],
    ["institution_staff.delete", "Suspend or delete bank and MFS staff membership", "institution_staff"],
  ];
  for (const [pName, pDesc, pMod] of newPermissions) {
    await db.query(
      "INSERT IGNORE INTO `permissions` (`name`, `description`, `module`, `created_at`, `updated_at`) VALUES (?, ?, ?, NOW(), NOW())",
      [pName, pDesc, pMod]
    );
  }

  // 8. Create platform_admin_users table
  await db.query(`
    CREATE TABLE IF NOT EXISTS \`platform_admin_users\` (
      \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      \`user_id\` BIGINT UNSIGNED NOT NULL,
      \`full_name\` VARCHAR(150) NOT NULL,
      \`role_id\` BIGINT UNSIGNED NOT NULL,
      \`status\` ENUM('active', 'suspended', 'disabled') NOT NULL DEFAULT 'active',
      \`created_by_user_id\` BIGINT UNSIGNED NULL,
      \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`),
      UNIQUE KEY \`uq_platform_admin_user\` (\`user_id\`),
      KEY \`fk_pau_role\` (\`role_id\`),
      KEY \`fk_pau_created_by\` (\`created_by_user_id\`),
      KEY \`idx_pau_status\` (\`status\`),
      CONSTRAINT \`fk_pau_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT \`fk_pau_role\` FOREIGN KEY (\`role_id\`) REFERENCES \`roles\` (\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE,
      CONSTRAINT \`fk_pau_created_by\` FOREIGN KEY (\`created_by_user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
  console.log("✓ Created `platform_admin_users` table");

  // 9. Create platform_admin_invitations table
  await db.query(`
    CREATE TABLE IF NOT EXISTS \`platform_admin_invitations\` (
      \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      \`email\` VARCHAR(255) NOT NULL,
      \`full_name\` VARCHAR(150) NOT NULL,
      \`phone\` VARCHAR(30) NULL,
      \`role_id\` BIGINT UNSIGNED NOT NULL,
      \`token_hash\` VARCHAR(64) NOT NULL,
      \`status\` ENUM('pending', 'accepted', 'revoked', 'expired') NOT NULL DEFAULT 'pending',
      \`expires_at\` DATETIME NOT NULL,
      \`invited_by_user_id\` BIGINT UNSIGNED NULL,
      \`accepted_at\` DATETIME NULL,
      \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`),
      INDEX \`idx_pai_token\` (\`token_hash\`),
      INDEX \`idx_pai_email\` (\`email\`),
      INDEX \`idx_pai_status\` (\`status\`),
      CONSTRAINT \`fk_pai_role\` FOREIGN KEY (\`role_id\`) REFERENCES \`roles\` (\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE,
      CONSTRAINT \`fk_pai_invited_by\` FOREIGN KEY (\`invited_by_user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
  console.log("✓ Created `platform_admin_invitations` table");

  // 10. Migrate existing platform admins
  await db.query(`
    INSERT IGNORE INTO \`platform_admin_users\` (\`user_id\`, \`full_name\`, \`role_id\`, \`status\`, \`created_at\`, \`updated_at\`)
    SELECT 
      u.id,
      COALESCE(u.email, 'Admin User') AS full_name,
      ur.role_id,
      IF(u.status = 'suspended', 'suspended', 'active'),
      NOW(),
      NOW()
    FROM \`users\` u
    JOIN \`user_roles\` ur ON ur.user_id = u.id
    JOIN \`roles\` r ON r.id = ur.role_id
    WHERE r.name IN ('super_admin', 'admin', 'reviewer', 'support_agent')
    ON DUPLICATE KEY UPDATE \`role_id\` = VALUES(\`role_id\`);
  `);

  await db.query("UPDATE `platform_admin_users` SET `full_name` = 'Super Admin' WHERE `user_id` = 4");
  await db.query("UPDATE `platform_admin_users` SET `full_name` = 'System Admin' WHERE `user_id` = 451");
  await db.query("UPDATE `platform_admin_users` SET `full_name` = 'KYC Reviewer' WHERE `user_id` = 6");
  await db.query("UPDATE `platform_admin_users` SET `full_name` = 'Customer Support' WHERE `user_id` = 7");

  // 11. Grant all permissions to super_admin (id=1) and admin (id=2)
  await db.query(`
    INSERT IGNORE INTO \`role_permissions\` (\`role_id\`, \`permission_id\`)
    SELECT 1, p.id FROM \`permissions\` p;
  `);
  await db.query(`
    INSERT IGNORE INTO \`role_permissions\` (\`role_id\`, \`permission_id\`)
    SELECT 2, p.id FROM \`permissions\` p;
  `);

  console.log("✓ Successfully applied Migration 031!");
  const [admins] = await db.query(
    "SELECT pau.id, pau.full_name, u.email, r.name AS role_name, pau.status FROM platform_admin_users pau JOIN users u ON u.id = pau.user_id JOIN roles r ON r.id = pau.role_id"
  );
  console.log("Platform admin members in DB:", admins);
  process.exit(0);
}

run().catch((err) => {
  console.error("Migration 031 failed:", err);
  process.exit(1);
});
