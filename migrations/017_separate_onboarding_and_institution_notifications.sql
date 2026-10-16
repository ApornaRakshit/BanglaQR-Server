-- Migration 017: Distinguish Onboarding KYC vs Service Application and Enable Institution Notifications
-- Safe additive migration preserving existing data and relationships

ALTER TABLE merchant_gateway_applications 
ADD COLUMN IF NOT EXISTS application_type ENUM('onboarding_kyc', 'gateway_service') NOT NULL DEFAULT 'onboarding_kyc' 
AFTER application_number;

UPDATE merchant_gateway_applications 
SET application_type = CASE 
  WHEN gateway_id IS NOT NULL AND institution_service_id IS NOT NULL THEN 'gateway_service' 
  ELSE 'onboarding_kyc' 
END;

ALTER TABLE notifications 
MODIFY COLUMN recipient_type ENUM('admin', 'merchant', 'institution', 'all') NOT NULL DEFAULT 'admin';

ALTER TABLE notifications 
ADD COLUMN IF NOT EXISTS institution_id BIGINT UNSIGNED NULL AFTER recipient_id;

