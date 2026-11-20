-- Migration 031: Complete User & Role Management System
-- Purpose:
--   1. Add 'scope' to roles ('platform', 'institution', 'merchant') and insert standard platform & institution roles
--   2. Add 'module' to permissions and insert standard permissions for user, role and institution staff management
--   3. Create 'platform_admin_users' for robust platform admin team management
--   4. Create 'platform_admin_invitations' for secure token-based invitation of platform admins
--   5. Link initial role permissions and migrate existing admin users into platform_admin_users

-- 1. Update roles table with scope column
ALTER TABLE `roles`
ADD COLUMN IF NOT EXISTS `scope` ENUM('platform', 'institution', 'merchant') NOT NULL DEFAULT 'platform' AFTER `description`;

-- Update existing roles with correct scopes
UPDATE `roles` SET `scope` = 'platform' WHERE `name` IN ('super_admin', 'admin', 'reviewer', 'support_agent');
UPDATE `roles` SET `scope` = 'merchant' WHERE `name` = 'merchant';
UPDATE `roles` SET `scope` = 'institution' WHERE `name` IN ('bank_admin', 'bank_reviewer', 'bank_operations');

-- Insert new Platform Admin roles if not existing
INSERT IGNORE INTO `roles` (`name`, `description`, `scope`, `created_at`) VALUES
('operations_admin', 'Operations administration, onboarding, and service lifecycle', 'platform', NOW()),
('finance_admin', 'Financial settlement, invoice and gateway payments oversight', 'platform', NOW()),
('kyc_officer', 'Dedicated KYC & document verification officer', 'platform', NOW()),
('content_manager', 'CMS, website marketing content, FAQs and inquiries', 'platform', NOW()),
('support_admin', 'Customer support, dispute tickets and communication', 'platform', NOW()),
('auditor_viewer', 'Read-only platform auditor and security viewer', 'platform', NOW());

-- Insert standard Institution Roles if not existing
INSERT IGNORE INTO `roles` (`name`, `description`, `scope`, `created_at`) VALUES
('institution_admin', 'Institution Administrator with full branch & staff management', 'institution', NOW()),
('institution_reviewer', 'Reviews merchant onboarding applications & KYC verification', 'institution', NOW()),
('institution_operations', 'Monitors settlements, QR issuance, and daily transactions', 'institution', NOW()),
('institution_compliance', 'Compliance monitoring, AML auditing and regulatory filings', 'institution', NOW()),
('institution_viewer', 'Read-only auditor for branch and transaction reports', 'institution', NOW());

-- 2. Update permissions table with module column
ALTER TABLE `permissions`
ADD COLUMN IF NOT EXISTS `module` VARCHAR(50) NOT NULL DEFAULT 'system' AFTER `description`;

-- Update existing permissions module mapping
UPDATE `permissions` SET `module` = 'merchant' WHERE `name` LIKE 'merchant.%';
UPDATE `permissions` SET `module` = 'kyc' WHERE `name` LIKE 'kyc.%';
UPDATE `permissions` SET `module` = 'document' WHERE `name` LIKE 'document.%';
UPDATE `permissions` SET `module` = 'gateway' WHERE `name` LIKE 'gateway.%' OR `name` LIKE 'application.%';
UPDATE `permissions` SET `module` = 'payments' WHERE `name` LIKE 'addon.%' OR `name` LIKE 'invoice.%';
UPDATE `permissions` SET `module` = 'cms' WHERE `name` LIKE 'cms.%' OR `name` LIKE 'contact_inquiry.%';
UPDATE `permissions` SET `module` = 'support' WHERE `name` LIKE 'ticket.%';
UPDATE `permissions` SET `module` = 'audit' WHERE `name` LIKE 'audit.%';
UPDATE `permissions` SET `module` = 'institution' WHERE `name` LIKE 'institution.%';

-- Insert standard Platform User & Role Management Permissions
INSERT IGNORE INTO `permissions` (`name`, `description`, `module`, `created_at`, `updated_at`) VALUES
('admin_users.view', 'View platform admin users and activity', 'user_management', NOW(), NOW()),
('admin_users.create', 'Invite and create platform admin users', 'user_management', NOW(), NOW()),
('admin_users.edit', 'Edit platform admin user profile and status', 'user_management', NOW(), NOW()),
('admin_users.delete', 'Suspend or delete platform admin user access', 'user_management', NOW(), NOW()),
('roles.view', 'View roles and permission matrices', 'user_management', NOW(), NOW()),
('roles.manage', 'Create and edit roles and assign permissions', 'user_management', NOW(), NOW()),
('institution_staff.view', 'View all bank and MFS institution staff', 'institution_staff', NOW(), NOW()),
('institution_staff.create', 'Create and invite bank and MFS institution staff', 'institution_staff', NOW(), NOW()),
('institution_staff.edit', 'Edit bank and MFS institution staff details and roles', 'institution_staff', NOW(), NOW()),
('institution_staff.delete', 'Suspend or delete bank and MFS staff membership', 'institution_staff', NOW(), NOW());

-- 3. Create platform_admin_users table (Membership table for Platform Admins)
CREATE TABLE IF NOT EXISTS `platform_admin_users` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `full_name` VARCHAR(150) NOT NULL,
  `role_id` BIGINT UNSIGNED NOT NULL,
  `status` ENUM('active', 'suspended', 'disabled') NOT NULL DEFAULT 'active',
  `created_by_user_id` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_platform_admin_user` (`user_id`),
  KEY `fk_pau_role` (`role_id`),
  KEY `fk_pau_created_by` (`created_by_user_id`),
  KEY `idx_pau_status` (`status`),
  CONSTRAINT `fk_pau_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_pau_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_pau_created_by` FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Create platform_admin_invitations table (Secure invitation flow for Platform Admins)
CREATE TABLE IF NOT EXISTS `platform_admin_invitations` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `email` VARCHAR(255) NOT NULL,
  `full_name` VARCHAR(150) NOT NULL,
  `phone` VARCHAR(30) NULL,
  `role_id` BIGINT UNSIGNED NOT NULL,
  `token_hash` VARCHAR(64) NOT NULL,
  `status` ENUM('pending', 'accepted', 'revoked', 'expired') NOT NULL DEFAULT 'pending',
  `expires_at` DATETIME NOT NULL,
  `invited_by_user_id` BIGINT UNSIGNED NULL,
  `accepted_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_pai_token` (`token_hash`),
  INDEX `idx_pai_email` (`email`),
  INDEX `idx_pai_status` (`status`),
  CONSTRAINT `fk_pai_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_pai_invited_by` FOREIGN KEY (`invited_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Migrate existing platform admins into platform_admin_users
INSERT IGNORE INTO `platform_admin_users` (`user_id`, `full_name`, `role_id`, `status`, `created_at`, `updated_at`)
SELECT
  u.id,
  COALESCE(u.email, 'Admin User') AS full_name,
  ur.role_id,
  IF(u.status = 'suspended', 'suspended', 'active'),
  NOW(),
  NOW()
FROM `users` u
JOIN `user_roles` ur ON ur.user_id = u.id
JOIN `roles` r ON r.id = ur.role_id
WHERE r.name IN ('super_admin', 'admin', 'reviewer', 'support_agent')
ON DUPLICATE KEY UPDATE `role_id` = VALUES(`role_id`);

-- Update specific names if known
UPDATE `platform_admin_users` SET `full_name` = 'Super Admin' WHERE `user_id` = 4;
UPDATE `platform_admin_users` SET `full_name` = 'System Admin' WHERE `user_id` = 451;
UPDATE `platform_admin_users` SET `full_name` = 'KYC Reviewer' WHERE `user_id` = 6;
UPDATE `platform_admin_users` SET `full_name` = 'Customer Support' WHERE `user_id` = 7;

-- 6. Assign all permissions to super_admin and admin roles
INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`)
SELECT 1, p.id FROM `permissions` p;

INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`)
SELECT 2, p.id FROM `permissions` p;
