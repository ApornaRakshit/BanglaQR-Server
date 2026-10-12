-- -------------------------------------------------------------
-- Migration 009: Add-on Orders and DGePay Payments Architecture
-- -------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `addon_orders` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `order_number` VARCHAR(50) NOT NULL,
  `merchant_id` BIGINT UNSIGNED NOT NULL,
  `addon_id` BIGINT UNSIGNED NULL,
  `merchant_addon_id` BIGINT UNSIGNED NULL,
  `addon_name` VARCHAR(150) NOT NULL,
  `addon_code` VARCHAR(50) NOT NULL,
  `billing_cycle` VARCHAR(50) NOT NULL DEFAULT 'monthly',
  `pricing_type` VARCHAR(50) NOT NULL DEFAULT 'monthly',
  `amount` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `currency` VARCHAR(10) NOT NULL DEFAULT 'BDT',
  `status` ENUM(
    'pending_payment',
    'payment_processing',
    'paid',
    'pending_admin_approval',
    'approved',
    'activation_pending',
    'active',
    'rejected',
    'cancelled',
    'suspended'
  ) NOT NULL DEFAULT 'pending_payment',
  `notes` TEXT NULL,
  `admin_notes` TEXT NULL,
  `is_archived` TINYINT(1) NOT NULL DEFAULT 0,
  `archived_at` DATETIME NULL,
  `archived_by` VARCHAR(100) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_order_number` (`order_number`),
  KEY `idx_addon_orders_merchant` (`merchant_id`),
  KEY `idx_addon_orders_addon` (`addon_id`),
  KEY `idx_addon_orders_status` (`status`),
  KEY `idx_addon_orders_archived` (`is_archived`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `addon_payments` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `payment_reference` VARCHAR(100) NOT NULL,
  `order_id` BIGINT UNSIGNED NOT NULL,
  `merchant_id` BIGINT UNSIGNED NOT NULL,
  `gateway` VARCHAR(50) NOT NULL DEFAULT 'dgepay',
  `payment_method` VARCHAR(50) NULL DEFAULT 'dgepay',
  `amount` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `currency` VARCHAR(10) NOT NULL DEFAULT 'BDT',
  `gateway_unique_txn_id` VARCHAR(100) NOT NULL,
  `gateway_order_id` VARCHAR(100) NULL,
  `gateway_transaction_id` VARCHAR(100) NULL,
  `gateway_status` VARCHAR(100) NULL,
  `gateway_response` JSON NULL,
  `checkout_url` TEXT NULL,
  `status` ENUM(
    'pending',
    'processing',
    'successful',
    'cancelled',
    'failed',
    'refunded'
  ) NOT NULL DEFAULT 'pending',
  `paid_at` DATETIME NULL,
  `failed_at` DATETIME NULL,
  `cancelled_at` DATETIME NULL,
  `is_archived` TINYINT(1) NOT NULL DEFAULT 0,
  `archived_at` DATETIME NULL,
  `archived_by` VARCHAR(100) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_payment_reference` (`payment_reference`),
  UNIQUE KEY `uniq_gateway_unique_txn_id` (`gateway_unique_txn_id`),
  KEY `idx_addon_payments_order` (`order_id`),
  KEY `idx_addon_payments_merchant` (`merchant_id`),
  KEY `idx_addon_payments_status` (`status`),
  KEY `idx_addon_payments_gateway` (`gateway`),
  KEY `idx_addon_payments_archived` (`is_archived`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Safely extend notifications type
ALTER TABLE `notifications` 
  MODIFY COLUMN `type` ENUM(
    'system',
    'merchant_update',
    'kyc',
    'document',
    'gateway',
    'security',
    'contact_inquiry',
    'info',
    'payment',
    'addon'
  ) NOT NULL DEFAULT 'system';

