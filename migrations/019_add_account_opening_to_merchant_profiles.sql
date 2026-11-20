-- Migration 019: Add Account Opening and Setup Fields to Merchant Profiles
ALTER TABLE `merchant_profiles`
  ADD COLUMN IF NOT EXISTS `has_existing_account` TINYINT(1) DEFAULT 1 AFTER `routing_number`,
  ADD COLUMN IF NOT EXISTS `apply_new_account` TINYINT(1) DEFAULT 0 AFTER `has_existing_account`,
  ADD COLUMN IF NOT EXISTS `account_opening_status` VARCHAR(50) DEFAULT NULL AFTER `apply_new_account`;

