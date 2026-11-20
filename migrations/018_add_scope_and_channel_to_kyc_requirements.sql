-- Migration 018: Add scope and channel_type to institution_kyc_requirements
-- Allows Global, Channel-Level (Bank vs MFS), and Institution-Specific KYC requirements

SET @dbname = DATABASE();
SET @tablename = 'institution_kyc_requirements';

-- 1. Modify institution_id to allow NULL for global and channel scopes
ALTER TABLE `institution_kyc_requirements`
  MODIFY COLUMN `institution_id` BIGINT UNSIGNED NULL;

-- 2. Add scope column
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'scope') > 0,
  'SELECT 1',
  'ALTER TABLE institution_kyc_requirements ADD COLUMN scope ENUM("global", "channel", "institution") NOT NULL DEFAULT "institution" AFTER applicable_service_id'
));
PREPARE alterScope FROM @preparedStatement;
EXECUTE alterScope;
DEALLOCATE PREPARE alterScope;

-- 3. Add channel_type column
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'channel_type') > 0,
  'SELECT 1',
  'ALTER TABLE institution_kyc_requirements ADD COLUMN channel_type ENUM("bank", "mfs", "all") NOT NULL DEFAULT "all" AFTER scope'
));
PREPARE alterChannel FROM @preparedStatement;
EXECUTE alterChannel;
DEALLOCATE PREPARE alterChannel;

