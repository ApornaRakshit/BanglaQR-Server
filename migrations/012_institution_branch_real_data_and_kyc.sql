-- ============================================================================
-- Migration 012: Real Branch Management, Geo Enhancements, and Merchant KYC Link
-- ============================================================================

-- 1. Enhance institutions table with head office address, geo fields, and expanded types
ALTER TABLE `institutions` 
  MODIFY COLUMN `institution_type` ENUM('bank', 'commercial_bank', 'specialized_bank', 'mfs', 'payment_gateway', 'other') NOT NULL DEFAULT 'bank';

-- Conditionally add head office fields to institutions
SET @dbname = DATABASE();

SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'institutions' AND COLUMN_NAME = 'head_office_address') > 0,
  'SELECT 1',
  'ALTER TABLE institutions ADD COLUMN head_office_address TEXT NULL AFTER website_url'
));
PREPARE stmt FROM @preparedStatement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'institutions' AND COLUMN_NAME = 'division') > 0,
  'SELECT 1',
  'ALTER TABLE institutions ADD COLUMN division VARCHAR(50) NULL AFTER head_office_address'
));
PREPARE stmt FROM @preparedStatement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'institutions' AND COLUMN_NAME = 'district') > 0,
  'SELECT 1',
  'ALTER TABLE institutions ADD COLUMN district VARCHAR(50) NULL AFTER division'
));
PREPARE stmt FROM @preparedStatement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'institutions' AND COLUMN_NAME = 'upazila') > 0,
  'SELECT 1',
  'ALTER TABLE institutions ADD COLUMN upazila VARCHAR(100) NULL AFTER district'
));
PREPARE stmt FROM @preparedStatement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'institutions' AND COLUMN_NAME = 'services_offered') > 0,
  'SELECT 1',
  'ALTER TABLE institutions ADD COLUMN services_offered TEXT NULL AFTER description'
));
PREPARE stmt FROM @preparedStatement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;


-- 2. Enhance institution_branches table
ALTER TABLE `institution_branches`
  MODIFY COLUMN `status` ENUM('active', 'inactive', 'suspended') NOT NULL DEFAULT 'active';

SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'institution_branches' AND COLUMN_NAME = 'routing_number') > 0,
  'SELECT 1',
  'ALTER TABLE institution_branches ADD COLUMN routing_number VARCHAR(50) NULL AFTER branch_code, ADD INDEX idx_branch_routing (routing_number)'
));
PREPARE stmt FROM @preparedStatement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'institution_branches' AND COLUMN_NAME = 'division_id') > 0,
  'SELECT 1',
  'ALTER TABLE institution_branches ADD COLUMN division_id BIGINT UNSIGNED NULL AFTER upazila, ADD COLUMN district_id BIGINT UNSIGNED NULL AFTER division_id, ADD COLUMN upazila_id BIGINT UNSIGNED NULL AFTER district_id'
));
PREPARE stmt FROM @preparedStatement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'institution_branches' AND COLUMN_NAME = 'is_demo') > 0,
  'SELECT 1',
  'ALTER TABLE institution_branches ADD COLUMN is_demo TINYINT(1) NOT NULL DEFAULT 0 AFTER status, ADD INDEX idx_branch_demo (is_demo)'
));
PREPARE stmt FROM @preparedStatement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'institution_branches' AND COLUMN_NAME = 'is_archived') > 0,
  'SELECT 1',
  'ALTER TABLE institution_branches ADD COLUMN is_archived TINYINT(1) NOT NULL DEFAULT 0 AFTER is_demo, ADD COLUMN archived_at DATETIME NULL AFTER is_archived, ADD COLUMN archived_by VARCHAR(100) NULL AFTER archived_at'
));
PREPARE stmt FROM @preparedStatement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;


-- 3. Enhance bd_divisions and bd_districts with Bangla name columns if missing
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'bd_divisions' AND COLUMN_NAME = 'division_name_bn') > 0,
  'SELECT 1',
  'ALTER TABLE bd_divisions ADD COLUMN division_name_bn VARCHAR(100) NULL AFTER division_name'
));
PREPARE stmt FROM @preparedStatement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'bd_districts' AND COLUMN_NAME = 'district_name_bn') > 0,
  'SELECT 1',
  'ALTER TABLE bd_districts ADD COLUMN district_name_bn VARCHAR(100) NULL AFTER district_name'
));
PREPARE stmt FROM @preparedStatement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;


-- 4. Connect merchant_kyc to institutions and branches
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'merchant_kyc' AND COLUMN_NAME = 'institution_id') > 0,
  'SELECT 1',
  'ALTER TABLE merchant_kyc ADD COLUMN institution_id BIGINT UNSIGNED NULL AFTER bank_name, ADD CONSTRAINT fk_mkyc_institution FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE SET NULL'
));
PREPARE stmt FROM @preparedStatement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'merchant_kyc' AND COLUMN_NAME = 'branch_id') > 0,
  'SELECT 1',
  'ALTER TABLE merchant_kyc ADD COLUMN branch_id BIGINT UNSIGNED NULL AFTER branch_name, ADD CONSTRAINT fk_mkyc_branch FOREIGN KEY (branch_id) REFERENCES institution_branches(id) ON DELETE SET NULL'
));
PREPARE stmt FROM @preparedStatement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'merchant_kyc' AND COLUMN_NAME = 'branch_code') > 0,
  'SELECT 1',
  'ALTER TABLE merchant_kyc ADD COLUMN branch_code VARCHAR(50) NULL AFTER branch_id, ADD COLUMN division VARCHAR(100) NULL AFTER routing_number, ADD COLUMN district VARCHAR(100) NULL AFTER division, ADD COLUMN upazila VARCHAR(100) NULL AFTER district, ADD COLUMN branch_address TEXT NULL AFTER upazila'
));
PREPARE stmt FROM @preparedStatement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Mark existing initial 6 branches as is_demo = 1 for admin visibility/archival
UPDATE `institution_branches` SET `is_demo` = 1 WHERE `id` IN (1, 2, 3, 4, 5, 6);
