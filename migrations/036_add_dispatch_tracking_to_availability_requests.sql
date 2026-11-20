-- Migration 036: Add dispatch channel tracking columns to institution_availability_requests
ALTER TABLE institution_availability_requests
  ADD COLUMN confirmation_email_status ENUM('pending', 'sent', 'failed') NOT NULL DEFAULT 'pending',
  ADD COLUMN inapp_notified_at DATETIME NULL DEFAULT NULL,
  ADD COLUMN availability_email_status ENUM('not_applicable', 'pending', 'sent', 'failed') NOT NULL DEFAULT 'not_applicable',
  ADD COLUMN availability_email_at DATETIME NULL DEFAULT NULL,
  ADD COLUMN last_error TEXT NULL DEFAULT NULL;
