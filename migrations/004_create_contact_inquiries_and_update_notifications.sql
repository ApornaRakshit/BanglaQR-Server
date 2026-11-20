-- Migration 004: Create contact_inquiries table and update notifications type
CREATE TABLE IF NOT EXISTS contact_inquiries (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(150) NOT NULL,
  phone VARCHAR(30) NOT NULL,
  email VARCHAR(150) NOT NULL,
  service_id VARCHAR(100) NULL,
  service_name VARCHAR(150) NOT NULL,
  message TEXT NULL,
  status ENUM('new', 'in_progress', 'replied', 'closed') NOT NULL DEFAULT 'new',
  ip_address VARCHAR(45) NULL,
  user_agent TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_contact_inquiries_status (status),
  INDEX idx_contact_inquiries_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE notifications 
MODIFY COLUMN type ENUM('system','merchant_update','kyc','document','gateway','security','contact_inquiry','info') NOT NULL DEFAULT 'system';

