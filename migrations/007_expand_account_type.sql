-- Migration: Expand account_type column to support 'SND', 'Other', and custom account types
ALTER TABLE merchant_kyc MODIFY COLUMN account_type VARCHAR(100) NOT NULL DEFAULT 'Current';
