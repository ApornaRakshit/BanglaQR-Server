-- Migration 029: Phase 3 Dynamic Merchant Form Integration
-- Adds form_version_id to merchant_profiles for pinning draft onboarding form versions
-- Adds field_key to merchant_profile_custom_values for cross-version custom value preservation
-- Preserves all previous migrations (024-028), triggers, and table structures safely.

ALTER TABLE `merchant_profiles`
  ADD COLUMN `form_version_id` INT UNSIGNED NULL AFTER `channel`,
  ADD CONSTRAINT `fk_merchant_profiles_form_version`
    FOREIGN KEY (`form_version_id`) REFERENCES `merchant_form_versions` (`id`)
    ON DELETE SET NULL;

ALTER TABLE `merchant_profile_custom_values`
  ADD COLUMN `field_key` VARCHAR(50) NULL AFTER `field_id`,
  ADD INDEX `idx_mpcv_merchant_field_key` (`merchant_id`, `field_key`);
