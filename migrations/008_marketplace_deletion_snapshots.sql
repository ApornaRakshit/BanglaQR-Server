-- Migration 008: Snapshot columns for safe gateway & addon deletion and historical integrity

-- 1. Modify merchant_gateway_applications
ALTER TABLE merchant_gateway_applications 
  MODIFY COLUMN gateway_id BIGINT UNSIGNED NULL,
  ADD COLUMN IF NOT EXISTS gateway_name VARCHAR(150) NULL AFTER gateway_id,
  ADD COLUMN IF NOT EXISTS gateway_code VARCHAR(50) NULL AFTER gateway_name,
  ADD COLUMN IF NOT EXISTS logo_url VARCHAR(500) NULL AFTER gateway_code,
  ADD COLUMN IF NOT EXISTS service_type VARCHAR(100) NULL AFTER logo_url,
  ADD COLUMN IF NOT EXISTS service_fee DECIMAL(6,2) NULL AFTER service_type;

-- 2. Modify merchant_gateway_services
ALTER TABLE merchant_gateway_services
  MODIFY COLUMN gateway_id BIGINT UNSIGNED NULL,
  ADD COLUMN IF NOT EXISTS gateway_name VARCHAR(150) NULL AFTER gateway_id,
  ADD COLUMN IF NOT EXISTS gateway_code VARCHAR(50) NULL AFTER gateway_name,
  ADD COLUMN IF NOT EXISTS logo_url VARCHAR(500) NULL AFTER gateway_code,
  ADD COLUMN IF NOT EXISTS service_fee DECIMAL(6,2) NULL AFTER logo_url;

-- 3. Modify merchant_addons
ALTER TABLE merchant_addons
  MODIFY COLUMN addon_id BIGINT UNSIGNED NULL,
  ADD COLUMN IF NOT EXISTS addon_name VARCHAR(150) NULL AFTER addon_id,
  ADD COLUMN IF NOT EXISTS addon_code VARCHAR(50) NULL AFTER addon_name,
  ADD COLUMN IF NOT EXISTS logo_url VARCHAR(500) NULL AFTER addon_code,
  ADD COLUMN IF NOT EXISTS category VARCHAR(100) NULL AFTER logo_url,
  ADD COLUMN IF NOT EXISTS price DECIMAL(10,2) NULL AFTER category,
  ADD COLUMN IF NOT EXISTS pricing_type VARCHAR(50) NULL AFTER price;

-- 4. Backfill snapshots from existing gateways and addons
UPDATE merchant_gateway_applications mga
JOIN gateways g ON mga.gateway_id = g.id
SET 
  mga.gateway_name = COALESCE(mga.gateway_name, g.name),
  mga.gateway_code = COALESCE(mga.gateway_code, g.code),
  mga.logo_url = COALESCE(mga.logo_url, g.logo_url),
  mga.service_type = COALESCE(mga.service_type, g.service_type),
  mga.service_fee = COALESCE(mga.service_fee, g.service_fee);

UPDATE merchant_gateway_services mgs
JOIN gateways g ON mgs.gateway_id = g.id
SET 
  mgs.gateway_name = COALESCE(mgs.gateway_name, g.name),
  mgs.gateway_code = COALESCE(mgs.gateway_code, g.code),
  mgs.logo_url = COALESCE(mgs.logo_url, g.logo_url),
  mgs.service_fee = COALESCE(mgs.service_fee, g.service_fee);

UPDATE merchant_addons ma
JOIN addons a ON ma.addon_id = a.id
SET 
  ma.addon_name = COALESCE(ma.addon_name, a.name),
  ma.addon_code = COALESCE(ma.addon_code, a.code),
  ma.logo_url = COALESCE(ma.logo_url, a.logo_url),
  ma.category = COALESCE(ma.category, a.category),
  ma.price = COALESCE(ma.price, a.price),
  ma.pricing_type = COALESCE(ma.pricing_type, a.pricing_type);

