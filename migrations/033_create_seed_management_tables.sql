-- Migration 033: Create seed management and batch tracking tables
-- Designed for local development test fixture lifecycle & selective rollback

CREATE TABLE IF NOT EXISTS `seed_batches` (
  `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `batch_name` VARCHAR(150) NOT NULL,
  `seeder_type` VARCHAR(80) NOT NULL DEFAULT 'merchant',
  `record_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `status` ENUM('active', 'cleaned_up', 'failed') NOT NULL DEFAULT 'active',
  `metadata` JSON NULL,
  `created_by_user_id` INT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `cleaned_up_at` TIMESTAMP NULL DEFAULT NULL,
  INDEX `idx_sb_status` (`status`),
  INDEX `idx_sb_seeder_type` (`seeder_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `seed_batch_records` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `batch_id` INT UNSIGNED NOT NULL,
  `table_name` VARCHAR(80) NOT NULL,
  `record_id` VARCHAR(100) NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_sbr_batch` (`batch_id`),
  INDEX `idx_sbr_table_record` (`table_name`, `record_id`),
  CONSTRAINT `fk_sbr_batch` FOREIGN KEY (`batch_id`) REFERENCES `seed_batches` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
