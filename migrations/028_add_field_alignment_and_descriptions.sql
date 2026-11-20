-- Migration 028: Add Field Alignment and Description Support to Dynamic Form Builder
-- Preserves all existing Phase 1 migrations (024-027), tables, triggers, and foreign keys.

ALTER TABLE `merchant_form_fields`
  ADD COLUMN `alignment` ENUM('left', 'center', 'right') NOT NULL DEFAULT 'left' AFTER `field_width`,
  ADD COLUMN `description_bn` TEXT NULL AFTER `placeholder_en`,
  ADD COLUMN `description_en` TEXT NULL AFTER `description_bn`;
