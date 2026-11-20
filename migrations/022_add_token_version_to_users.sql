-- Migration: 022_add_token_version_to_users.sql
-- Description: Add token_version to users table for reliable, non-racy JWT access token revocation.
-- Defaults existing users to 0.

-- Forward Migration:
ALTER TABLE users
  ADD COLUMN token_version INT UNSIGNED NOT NULL DEFAULT 0 AFTER must_change_password;

-- Rollback Instructions (Strict Deployment Order):
-- IMPORTANT: Do not drop token_version from MySQL while application code still depends on it!
-- 1. First, deploy updated application code that removes token_version validation from requireAuth and createAccessToken.
-- 2. Verify all application server nodes have completed deployment.
-- 3. Only then, execute the database schema rollback:
--    ALTER TABLE users DROP COLUMN token_version;
