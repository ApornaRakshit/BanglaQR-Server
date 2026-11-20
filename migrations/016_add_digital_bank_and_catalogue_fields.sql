-- Migration 016: Add digital bank enum, postal_code, and admin_notes to institutions & bank profiles

ALTER TABLE institutions
  MODIFY COLUMN institution_type ENUM('bank','commercial_bank','specialized_bank','mfs','payment_gateway','digital_bank','other') NOT NULL DEFAULT 'bank';

-- Add postal_code and admin_notes if they do not exist
SET @col_exists = 0;
SELECT COUNT(*) INTO @col_exists FROM information_schema.columns 
WHERE table_schema = DATABASE() AND table_name = 'institutions' AND column_name = 'postal_code';
SET @sql = IF(@col_exists = 0, 'ALTER TABLE institutions ADD COLUMN postal_code VARCHAR(20) NULL AFTER upazila', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = 0;
SELECT COUNT(*) INTO @col_exists FROM information_schema.columns 
WHERE table_schema = DATABASE() AND table_name = 'institutions' AND column_name = 'admin_notes';
SET @sql = IF(@col_exists = 0, 'ALTER TABLE institutions ADD COLUMN admin_notes TEXT NULL AFTER source_verified_by', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Update institution_bank_profiles for digital_bank category and banking_model
ALTER TABLE institution_bank_profiles
  MODIFY COLUMN bank_category ENUM('commercial_conventional','commercial_islamic','specialized','foreign_commercial','digital_bank') NOT NULL DEFAULT 'commercial_conventional';

SET @col_exists = 0;
SELECT COUNT(*) INTO @col_exists FROM information_schema.columns 
WHERE table_schema = DATABASE() AND table_name = 'institution_bank_profiles' AND column_name = 'banking_model';
SET @sql = IF(@col_exists = 0, 'ALTER TABLE institution_bank_profiles ADD COLUMN banking_model VARCHAR(50) NULL AFTER bank_category', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

