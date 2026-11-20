-- Migration 030: Multi-Step Merchant Form Versioning & Per-Step Tracking
-- 1. Reuses existing merchant_profile_custom_values table (NO duplicate table)
--    Adds optional step_key for explicit multi-step categorization
-- 2. Creates merchant_form_step_versions to pin immutable published versions per step per merchant
-- 3. Fully backward compatible with Migration 029 and existing merchant records.

ALTER TABLE `merchant_profile_custom_values`
  ADD COLUMN `step_key` VARCHAR(50) NULL DEFAULT 'onboarding_company' AFTER `field_key`,
  ADD INDEX `idx_mpcv_merchant_step` (`merchant_id`, `step_key`);

CREATE TABLE IF NOT EXISTS `merchant_form_step_versions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `merchant_id` BIGINT UNSIGNED NOT NULL,
  `form_key` VARCHAR(50) NOT NULL,
  `form_version_id` INT UNSIGNED NOT NULL,
  `pinned_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_merchant_step_version` (`merchant_id`, `form_key`),
  CONSTRAINT `fk_mfsv_merchant` FOREIGN KEY (`merchant_id`) REFERENCES `merchants` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_mfsv_version` FOREIGN KEY (`form_version_id`) REFERENCES `merchant_form_versions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Initialize step_versions for existing merchants using currently pinned form_version_id
INSERT IGNORE INTO `merchant_form_step_versions` (`merchant_id`, `form_key`, `form_version_id`, `pinned_at`)
SELECT `merchant_id`, 'onboarding_company', `form_version_id`, NOW()
FROM `merchant_profiles`
WHERE `form_version_id` IS NOT NULL;
