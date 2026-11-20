-- Migration: 025_add_catalogue_associations_and_form_versioning.sql
-- Description: Adds nullable foreign key relationships for legal structures & industry categories,
-- and links submitted applications to exact dynamic form versions.

-- 1. Add nullable catalogue reference columns to merchant_profiles
ALTER TABLE merchant_profiles
  ADD COLUMN legal_structure_id INT UNSIGNED NULL AFTER business_type,
  ADD COLUMN industry_category_id INT UNSIGNED NULL AFTER industry,
  ADD CONSTRAINT fk_mp_legal_structure FOREIGN KEY (legal_structure_id) REFERENCES business_legal_structures(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_mp_industry_category FOREIGN KEY (industry_category_id) REFERENCES industry_categories(id) ON DELETE SET NULL,
  ADD INDEX idx_mp_legal_structure (legal_structure_id),
  ADD INDEX idx_mp_industry_category (industry_category_id);

-- 2. Add nullable catalogue reference column to merchant_kyc (for consistency with legal structure)
ALTER TABLE merchant_kyc
  ADD COLUMN legal_structure_id INT UNSIGNED NULL AFTER business_entity_type,
  ADD CONSTRAINT fk_mkyc_legal_structure FOREIGN KEY (legal_structure_id) REFERENCES business_legal_structures(id) ON DELETE SET NULL,
  ADD INDEX idx_mkyc_legal_structure (legal_structure_id);

-- 3. Add form_version_id to merchant_gateway_applications (to retain exact form version used at submission)
ALTER TABLE merchant_gateway_applications
  ADD COLUMN form_version_id INT UNSIGNED NULL AFTER submission_version,
  ADD CONSTRAINT fk_mga_form_version FOREIGN KEY (form_version_id) REFERENCES merchant_form_versions(id) ON DELETE RESTRICT,
  ADD INDEX idx_mga_form_version (form_version_id);

-- 4. Add form_version_id to kyc_submission_versions (historical snapshot versioning)
ALTER TABLE kyc_submission_versions
  ADD COLUMN form_version_id INT UNSIGNED NULL AFTER version_no,
  ADD CONSTRAINT fk_ksv_form_version FOREIGN KEY (form_version_id) REFERENCES merchant_form_versions(id) ON DELETE RESTRICT,
  ADD INDEX idx_ksv_form_version (form_version_id);

-- 5. Safe, non-destructive backfill for canonical legacy values (leaving 'Other' and unmapped as NULL)
-- Backfill Private Limited
UPDATE merchant_profiles SET legal_structure_id = 4 WHERE LOWER(TRIM(business_type)) = 'private limited';
UPDATE merchant_kyc SET legal_structure_id = 4 WHERE LOWER(TRIM(business_entity_type)) = 'private limited';

-- Backfill Sole Proprietorship
UPDATE merchant_profiles SET legal_structure_id = 1 WHERE LOWER(TRIM(business_type)) = 'sole proprietorship';
UPDATE merchant_kyc SET legal_structure_id = 1 WHERE LOWER(TRIM(business_entity_type)) = 'sole proprietorship';

-- Backfill Software & Technology Industry
UPDATE merchant_profiles SET industry_category_id = 12 WHERE LOWER(TRIM(industry)) = 'software & technology';
