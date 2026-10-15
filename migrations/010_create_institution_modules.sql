ALTER TABLE `gateways`
  ADD COLUMN `institution_id` BIGINT UNSIGNED NULL AFTER `id`,
  ADD CONSTRAINT `fk_gateways_institution`
    FOREIGN KEY (`institution_id`) REFERENCES `institutions` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

-- 2. Add institution_id to merchant_gateway_applications to link merchant applications directly to financial institutions
ALTER TABLE `merchant_gateway_applications`
  ADD COLUMN `institution_id` BIGINT UNSIGNED NULL AFTER `gateway_id`,
  ADD CONSTRAINT `fk_mga_institution`
    FOREIGN KEY (`institution_id`) REFERENCES `institutions` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

-- 3. Dedicated institution_kyc_requirements table for managing configurable KYC documents and business info per institution
CREATE TABLE IF NOT EXISTS `institution_kyc_requirements` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `institution_id` BIGINT UNSIGNED NOT NULL,
  `name` VARCHAR(150) NOT NULL COMMENT 'Document or requirement name, e.g. Trade License, Bank Solvency',
  `requirement_code` VARCHAR(50) NOT NULL,
  `document_type` VARCHAR(50) NOT NULL DEFAULT 'other',
  `description` TEXT NULL,
  `instructions` TEXT NULL,
  `is_mandatory` TINYINT(1) NOT NULL DEFAULT 1,
  `status` ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
  `display_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_inst_req_code` (`institution_id`, `requirement_code`),
  INDEX `idx_inst_kyc_status` (`institution_id`, `status`),
  CONSTRAINT `fk_inst_kyc_institution`
    FOREIGN KEY (`institution_id`) REFERENCES `institutions` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Dedicated institution_settings table for platform-isolated institution preferences and operational configs
CREATE TABLE IF NOT EXISTS `institution_settings` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `institution_id` BIGINT UNSIGNED NOT NULL,
  `setting_key` VARCHAR(100) NOT NULL,
  `setting_value` JSON NOT NULL,
  `updated_by` VARCHAR(150) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_inst_setting` (`institution_id`, `setting_key`),
  CONSTRAINT `fk_inst_settings_institution`
    FOREIGN KEY (`institution_id`) REFERENCES `institutions` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Seed permissions for Super Admin and Admin roles so they have full institution management rights
INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`)
SELECT r.id, p.id
FROM `roles` r
CROSS JOIN `permissions` p
WHERE r.name IN ('super_admin', 'admin')
  AND p.name LIKE 'institution.%';

