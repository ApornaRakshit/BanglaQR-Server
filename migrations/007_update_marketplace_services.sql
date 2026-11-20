-- Migration 007: Update gateways and addons for Marketplace
-- Add category, is_published, accepts_applications, display_order, short_description, eligibility

-- Note: MySQL migration runner will safely inspect and apply columns.
ALTER TABLE gateways 
  ADD COLUMN IF NOT EXISTS category VARCHAR(50) DEFAULT 'gateway',
  ADD COLUMN IF NOT EXISTS is_published TINYINT(1) DEFAULT 1,
  ADD COLUMN IF NOT EXISTS accepts_applications TINYINT(1) DEFAULT 1,
  ADD COLUMN IF NOT EXISTS display_order INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS short_description VARCHAR(255) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS eligibility TEXT DEFAULT NULL;

ALTER TABLE addons 
  ADD COLUMN IF NOT EXISTS logo_url VARCHAR(500) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS is_published TINYINT(1) DEFAULT 1,
  ADD COLUMN IF NOT EXISTS accepts_applications TINYINT(1) DEFAULT 1,
  ADD COLUMN IF NOT EXISTS display_order INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS short_description VARCHAR(255) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS eligibility TEXT DEFAULT NULL;

