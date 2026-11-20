-- Migration 013: Expand institution_kyc_requirements table for full-page requirement management
-- Adds support for:
-- 1. max_pdf_pages
-- 2. admin_notes (internal review notes strictly hidden from merchants)
-- 3. auto_verify_ocr, check_expiry, require_matching_name
-- 4. expiry_field_name, min_validity_days, reference_api_url
-- 5. sample_document_url, sample_document_urls (JSON array for multi-sample)

SET @dbname = DATABASE();
SET @tablename = 'institution_kyc_requirements';

-- 1. max_pdf_pages
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'max_pdf_pages') > 0,
  'SELECT 1',
  'ALTER TABLE institution_kyc_requirements ADD COLUMN max_pdf_pages INT NOT NULL DEFAULT 5 AFTER max_file_size_mb'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 2. admin_notes
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'admin_notes') > 0,
  'SELECT 1',
  'ALTER TABLE institution_kyc_requirements ADD COLUMN admin_notes TEXT NULL AFTER review_instructions'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 3. auto_verify_ocr
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'auto_verify_ocr') > 0,
  'SELECT 1',
  'ALTER TABLE institution_kyc_requirements ADD COLUMN auto_verify_ocr TINYINT(1) NOT NULL DEFAULT 0 AFTER admin_notes'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 4. check_expiry
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'check_expiry') > 0,
  'SELECT 1',
  'ALTER TABLE institution_kyc_requirements ADD COLUMN check_expiry TINYINT(1) NOT NULL DEFAULT 0 AFTER auto_verify_ocr'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 5. require_matching_name
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'require_matching_name') > 0,
  'SELECT 1',
  'ALTER TABLE institution_kyc_requirements ADD COLUMN require_matching_name TINYINT(1) NOT NULL DEFAULT 0 AFTER check_expiry'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 6. expiry_field_name
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'expiry_field_name') > 0,
  'SELECT 1',
  'ALTER TABLE institution_kyc_requirements ADD COLUMN expiry_field_name VARCHAR(100) NULL DEFAULT "expiry_date" AFTER require_matching_name'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 7. min_validity_days
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'min_validity_days') > 0,
  'SELECT 1',
  'ALTER TABLE institution_kyc_requirements ADD COLUMN min_validity_days INT NOT NULL DEFAULT 30 AFTER expiry_field_name'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 8. reference_api_url
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'reference_api_url') > 0,
  'SELECT 1',
  'ALTER TABLE institution_kyc_requirements ADD COLUMN reference_api_url VARCHAR(500) NULL AFTER min_validity_days'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 9. sample_document_url
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'sample_document_url') > 0,
  'SELECT 1',
  'ALTER TABLE institution_kyc_requirements ADD COLUMN sample_document_url VARCHAR(500) NULL AFTER reference_api_url'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 10. sample_document_urls
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'sample_document_urls') > 0,
  'SELECT 1',
  'ALTER TABLE institution_kyc_requirements ADD COLUMN sample_document_urls JSON NULL AFTER sample_document_url'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

