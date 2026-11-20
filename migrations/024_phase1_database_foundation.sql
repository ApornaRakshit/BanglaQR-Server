-- Migration: 024_phase1_database_foundation.sql
-- Description: BanglaQR Phase 1 - Two-Segment Merchant Classification & Business Catalogues Foundation
-- Strict Rules: Exactly two merchant segments ('micro', 'big'). No 'both', 'all', or third segment.

-- 1. Persistent Merchant Segment on merchants table
-- Segment is strictly ENUM('micro', 'big') or NULL (unresolved for legacy merchants until selected).
-- Never guess or auto-assign a third segment.
ALTER TABLE merchants
  ADD COLUMN merchant_segment ENUM('micro', 'big') NULL DEFAULT NULL AFTER merchant_code,
  ADD INDEX idx_merchant_segment (merchant_segment);

-- 2. Business Legal Structures Catalogue
CREATE TABLE IF NOT EXISTS business_legal_structures (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(50) NOT NULL UNIQUE,
  name_bn VARCHAR(150) NOT NULL,
  name_en VARCHAR(150) NOT NULL,
  description TEXT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  display_order INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_legal_struct_active_order (is_active, display_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Industry Categories Master Data
CREATE TABLE IF NOT EXISTS industry_categories (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(50) NOT NULL UNIQUE,
  name_bn VARCHAR(150) NOT NULL,
  name_en VARCHAR(150) NOT NULL,
  description TEXT NULL,
  source_authority VARCHAR(100) NOT NULL DEFAULT 'BanglaQR Internal Classification',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  display_order INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_ind_cat_active_order (is_active, display_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Trade License Business Activity Catalogue
CREATE TABLE IF NOT EXISTS trade_license_activities (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(50) NOT NULL UNIQUE,
  name_bn VARCHAR(150) NOT NULL,
  name_en VARCHAR(150) NOT NULL,
  description TEXT NULL,
  source_authority VARCHAR(100) NOT NULL DEFAULT 'BanglaQR custom classification',
  source_document VARCHAR(150) NULL,
  source_version VARCHAR(50) NULL,
  official_reference_code VARCHAR(100) NULL,
  verification_status ENUM('verified_dncc', 'verified_dscc', 'verified_gov', 'external_reference', 'unverified', 'banglaqr_proposed') NOT NULL DEFAULT 'banglaqr_proposed',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  display_order INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_tla_active_order (is_active, display_order),
  INDEX idx_tla_verification (verification_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Industry and Business Activity Mapping (Many-to-Many)
CREATE TABLE IF NOT EXISTS industry_activity_mapping (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  industry_category_id INT UNSIGNED NOT NULL,
  activity_id INT UNSIGNED NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_industry_activity (industry_category_id, activity_id),
  CONSTRAINT fk_iam_industry FOREIGN KEY (industry_category_id) REFERENCES industry_categories (id) ON DELETE CASCADE,
  CONSTRAINT fk_iam_activity FOREIGN KEY (activity_id) REFERENCES trade_license_activities (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. Two-Segment Activity Eligibility Rules
-- Strict rule: merchant_segment is ENUM('micro', 'big'). Separate rows for micro and big. Never 'both'.
CREATE TABLE IF NOT EXISTS business_activity_segment_rules (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  activity_id INT UNSIGNED NOT NULL,
  merchant_segment ENUM('micro', 'big') NOT NULL,
  is_eligible TINYINT(1) NOT NULL DEFAULT 1,
  notes VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_activity_segment (activity_id, merchant_segment),
  CONSTRAINT fk_basr_activity FOREIGN KEY (activity_id) REFERENCES trade_license_activities (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. Merchant Profile Activities (Primary + Zero or more Additional)
CREATE TABLE IF NOT EXISTS merchant_profile_activities (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  merchant_id BIGINT UNSIGNED NOT NULL,
  activity_id INT UNSIGNED NOT NULL,
  activity_role ENUM('primary', 'additional') NOT NULL DEFAULT 'additional',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_merchant_activity (merchant_id, activity_id),
  CONSTRAINT fk_mpa_merchant FOREIGN KEY (merchant_id) REFERENCES merchants (id) ON DELETE CASCADE,
  CONSTRAINT fk_mpa_activity FOREIGN KEY (activity_id) REFERENCES trade_license_activities (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 8. Dynamic Form Foundation: Versions
CREATE TABLE IF NOT EXISTS merchant_form_versions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  form_key VARCHAR(50) NOT NULL DEFAULT 'merchant_onboarding',
  version_number INT UNSIGNED NOT NULL DEFAULT 1,
  status ENUM('draft', 'published', 'archived') NOT NULL DEFAULT 'draft',
  published_at DATETIME NULL,
  published_by INT UNSIGNED NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_form_version (form_key, version_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 9. Dynamic Form Foundation: Sections
CREATE TABLE IF NOT EXISTS merchant_form_sections (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  form_version_id INT UNSIGNED NOT NULL,
  section_key VARCHAR(50) NOT NULL,
  title_bn VARCHAR(150) NOT NULL,
  title_en VARCHAR(150) NOT NULL,
  description_bn TEXT NULL,
  description_en TEXT NULL,
  display_order INT UNSIGNED NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_section_key (form_version_id, section_key),
  CONSTRAINT fk_mfs_form_version FOREIGN KEY (form_version_id) REFERENCES merchant_form_versions (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 10. Dynamic Form Foundation: Fields
CREATE TABLE IF NOT EXISTS merchant_form_fields (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  form_version_id INT UNSIGNED NOT NULL,
  section_id INT UNSIGNED NOT NULL,
  field_key VARCHAR(50) NOT NULL,
  system_field_key VARCHAR(50) NULL COMMENT 'Mapping to core system fields (e.g. company_name, business_type)',
  label_bn VARCHAR(150) NOT NULL,
  label_en VARCHAR(150) NOT NULL,
  help_text_bn TEXT NULL,
  help_text_en TEXT NULL,
  placeholder_bn VARCHAR(150) NULL,
  placeholder_en VARCHAR(150) NULL,
  field_type VARCHAR(50) NOT NULL DEFAULT 'text',
  field_width VARCHAR(20) NOT NULL DEFAULT 'half' COMMENT 'full, half, third',
  display_order INT UNSIGNED NOT NULL DEFAULT 0,
  is_visible TINYINT(1) NOT NULL DEFAULT 1,
  is_required TINYINT(1) NOT NULL DEFAULT 0,
  is_system_field TINYINT(1) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  validation_config JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_field_key (form_version_id, field_key),
  CONSTRAINT fk_mff_version FOREIGN KEY (form_version_id) REFERENCES merchant_form_versions (id) ON DELETE CASCADE,
  CONSTRAINT fk_mff_section FOREIGN KEY (section_id) REFERENCES merchant_form_sections (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 11. Dynamic Form Foundation: Field Options
CREATE TABLE IF NOT EXISTS merchant_form_field_options (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  field_id INT UNSIGNED NOT NULL,
  option_value VARCHAR(100) NOT NULL,
  label_bn VARCHAR(150) NOT NULL,
  label_en VARCHAR(150) NOT NULL,
  display_order INT UNSIGNED NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_mffo_field FOREIGN KEY (field_id) REFERENCES merchant_form_fields (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 12. Dynamic Form Foundation: Field Rules (Strictly Two Segments: micro or big; Channels: bank or mfs)
CREATE TABLE IF NOT EXISTS merchant_form_field_rules (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  field_id INT UNSIGNED NOT NULL,
  merchant_segment ENUM('micro', 'big') NULL COMMENT 'Separate row for micro or big. Never both.',
  channel ENUM('bank', 'mfs') NULL COMMENT 'Separate row for bank or mfs. Never both.',
  is_visible TINYINT(1) NOT NULL DEFAULT 1,
  is_required TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_mffr_field FOREIGN KEY (field_id) REFERENCES merchant_form_fields (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 13. Dynamic Form Foundation: Profile Custom Values (For Non-Protected / Extended Fields)
CREATE TABLE IF NOT EXISTS merchant_profile_custom_values (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  merchant_id BIGINT UNSIGNED NOT NULL,
  field_id INT UNSIGNED NOT NULL,
  field_value TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_merchant_custom_field (merchant_id, field_id),
  CONSTRAINT fk_mpcv_merchant FOREIGN KEY (merchant_id) REFERENCES merchants (id) ON DELETE CASCADE,
  CONSTRAINT fk_mpcv_field FOREIGN KEY (field_id) REFERENCES merchant_form_fields (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
