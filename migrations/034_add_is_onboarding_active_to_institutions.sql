-- Migration 034: Add is_onboarding_active to institutions
-- Allows separate control of institution status and merchant onboarding acceptance

ALTER TABLE `institutions`
  ADD COLUMN `is_onboarding_active` TINYINT(1) NOT NULL DEFAULT 0 AFTER `status`;
