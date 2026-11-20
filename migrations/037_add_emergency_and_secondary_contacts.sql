-- Migration 037: Add emergency_contact and secondary_email to merchant_contacts
ALTER TABLE merchant_contacts
  ADD COLUMN IF NOT EXISTS emergency_contact VARCHAR(30) NULL AFTER phone,
  ADD COLUMN IF NOT EXISTS secondary_email VARCHAR(255) NULL AFTER email;
