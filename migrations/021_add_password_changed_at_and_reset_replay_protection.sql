-- Migration: 021_add_password_changed_at_and_reset_replay_protection.sql
-- Description: Add password_changed_at to users table for JWT access token revocation after password reset,
-- and add reset_challenge_jti to otp_codes to enforce single-use on reset challenge tokens.

-- Forward Migration:
ALTER TABLE users
  ADD COLUMN password_changed_at TIMESTAMP NULL DEFAULT NULL AFTER must_change_password;

ALTER TABLE otp_codes
  ADD COLUMN reset_challenge_jti VARCHAR(64) NULL DEFAULT NULL AFTER verified_at,
  ADD INDEX idx_otp_codes_reset_challenge_jti (reset_challenge_jti);

-- Rollback Instructions:
-- ALTER TABLE otp_codes DROP INDEX idx_otp_codes_reset_challenge_jti, DROP COLUMN reset_challenge_jti;
-- ALTER TABLE users DROP COLUMN password_changed_at;
