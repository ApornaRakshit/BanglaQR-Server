-- Migration 003: Update merchant_kyc and merchant_documents tables to support all KYC & Document fields

-- Update merchant_kyc with additional fields if not present
-- ALTER TABLE merchant_kyc
  -- ADD COLUMN IF NOT EXISTS business_entity_type VARCHAR(100) NULL AFTER legal_business_name,
  -- ADD COLUMN IF NOT EXISTS designation VARCHAR(100) NULL AFTER authorized_person_name,
  -- ADD COLUMN IF NOT EXISTS nid_issue_date DATE NULL AFTER nid_number,
  -- ADD COLUMN IF NOT EXISTS nid_expiry_date DATE NULL AFTER nid_issue_date,
  -- ADD COLUMN IF NOT EXISTS branch_name VARCHAR(255) NULL AFTER bank_name,
  -- ADD COLUMN IF NOT EXISTS account_type ENUM('Current', 'Savings', 'Business') NOT NULL DEFAULT 'Current' AFTER routing_number;

-- Update merchant_documents with additional metadata fields if not present
-- ALTER TABLE merchant_documents
  -- ADD COLUMN IF NOT EXISTS custom_label VARCHAR(255) NULL AFTER document_name,
  -- ADD COLUMN IF NOT EXISTS original_filename VARCHAR(255) NULL AFTER custom_label,
  -- ADD COLUMN IF NOT EXISTS stored_filename VARCHAR(255) NULL AFTER original_filename,
  -- ADD COLUMN IF NOT EXISTS review_note TEXT NULL AFTER review_comment;

