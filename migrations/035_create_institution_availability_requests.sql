-- Migration: 035_create_institution_availability_requests.sql
-- BanglaQR: Merchant Institution Availability Requests (Notify Me)

CREATE TABLE IF NOT EXISTS institution_availability_requests (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  merchant_id BIGINT UNSIGNED NOT NULL,
  institution_id BIGINT UNSIGNED NOT NULL,
  request_status ENUM('pending', 'notified', 'cancelled') NOT NULL DEFAULT 'pending',
  requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notified_at DATETIME NULL DEFAULT NULL,
  active_pending_key VARCHAR(100) NULL DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_iar_merchant FOREIGN KEY (merchant_id) REFERENCES merchants (id) ON DELETE CASCADE,
  CONSTRAINT fk_iar_institution FOREIGN KEY (institution_id) REFERENCES institutions (id) ON DELETE CASCADE,
  UNIQUE KEY uq_active_pending (active_pending_key),
  INDEX idx_iar_institution_status (institution_id, request_status),
  INDEX idx_iar_merchant_status (merchant_id, request_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP TRIGGER IF EXISTS trg_iar_before_insert;
CREATE TRIGGER trg_iar_before_insert BEFORE INSERT ON institution_availability_requests
FOR EACH ROW
BEGIN
  IF NEW.request_status = 'pending' THEN
    SET NEW.active_pending_key = CONCAT(NEW.merchant_id, '_', NEW.institution_id);
  ELSE
    SET NEW.active_pending_key = NULL;
  END IF;
END;

DROP TRIGGER IF EXISTS trg_iar_before_update;
CREATE TRIGGER trg_iar_before_update BEFORE UPDATE ON institution_availability_requests
FOR EACH ROW
BEGIN
  IF NEW.request_status = 'pending' THEN
    SET NEW.active_pending_key = CONCAT(NEW.merchant_id, '_', NEW.institution_id);
  ELSE
    SET NEW.active_pending_key = NULL;
  END IF;
END;
