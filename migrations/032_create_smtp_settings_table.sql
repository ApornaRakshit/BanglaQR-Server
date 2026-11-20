-- Migration: 032_create_smtp_settings_table.sql
-- Table to persist dynamic SMTP configuration managed by Admins from the Admin Panel

CREATE TABLE IF NOT EXISTS smtp_settings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  smtp_host VARCHAR(255) NOT NULL,
  smtp_port INT NOT NULL DEFAULT 587,
  smtp_security ENUM('SSL', 'TLS', 'STARTTLS', 'NONE') NOT NULL DEFAULT 'STARTTLS',
  smtp_username VARCHAR(255) NOT NULL,
  smtp_password_encrypted TEXT NOT NULL,
  smtp_password_iv VARCHAR(64) NOT NULL,
  smtp_password_tag VARCHAR(64) NOT NULL,
  sender_name VARCHAR(150) NOT NULL DEFAULT 'BanglaQR',
  sender_email VARCHAR(255) NOT NULL,
  reply_to_email VARCHAR(255) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  updated_by VARCHAR(150) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
