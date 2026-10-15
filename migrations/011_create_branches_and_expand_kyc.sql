
CREATE TABLE IF NOT EXISTS geo_divisions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(50) NOT NULL UNIQUE,
  name_bn VARCHAR(100) NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS geo_districts (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  division_id INT UNSIGNED NOT NULL,
  name VARCHAR(50) NOT NULL,
  name_bn VARCHAR(100) NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (division_id) REFERENCES geo_divisions(id) ON DELETE CASCADE,
  UNIQUE KEY uq_div_district (division_id, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS geo_upazilas (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  district_id INT UNSIGNED NOT NULL,
  name VARCHAR(100) NOT NULL,
  name_bn VARCHAR(150) NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (district_id) REFERENCES geo_districts(id) ON DELETE CASCADE,
  INDEX idx_district_upazila (district_id, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Create Institution Branches Table
CREATE TABLE IF NOT EXISTS institution_branches (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  institution_id BIGINT UNSIGNED NOT NULL,
  branch_name VARCHAR(150) NOT NULL,
  branch_code VARCHAR(50) NOT NULL,
  division VARCHAR(50) NOT NULL,
  district VARCHAR(50) NOT NULL,
  upazila VARCHAR(100) NOT NULL,
  post_office VARCHAR(100) NULL,
  postal_code VARCHAR(20) NULL,
  address TEXT NULL,
  phone VARCHAR(50) NULL,
  email VARCHAR(150) NULL,
  manager_name VARCHAR(150) NULL,
  notes TEXT NULL,
  status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE CASCADE,
  UNIQUE KEY uq_inst_branch_code (institution_id, branch_code),
  INDEX idx_inst_branch_status (institution_id, status),
  INDEX idx_branch_geo (division, district, upazila)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Add branch_id to merchant_gateway_applications if not exists
SET @dbname = DATABASE();
SET @tablename = 'merchant_gateway_applications';
SET @columnname = 'branch_id';
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE
      TABLE_SCHEMA = @dbname
      AND TABLE_NAME = @tablename
      AND COLUMN_NAME = @columnname
  ) > 0,
  'SELECT 1',
  'ALTER TABLE merchant_gateway_applications ADD COLUMN branch_id BIGINT UNSIGNED NULL AFTER institution_id, ADD CONSTRAINT fk_mga_branch FOREIGN KEY (branch_id) REFERENCES institution_branches(id) ON DELETE SET NULL'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 4. Expand institution_kyc_requirements table
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'institution_kyc_requirements' AND COLUMN_NAME = 'applicable_service_id') > 0,
  'SELECT 1',
  'ALTER TABLE institution_kyc_requirements ADD COLUMN applicable_service_id BIGINT UNSIGNED NULL AFTER institution_id, ADD CONSTRAINT fk_ikr_gateway FOREIGN KEY (applicable_service_id) REFERENCES gateways(id) ON DELETE SET NULL'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'institution_kyc_requirements' AND COLUMN_NAME = 'requirement_category') > 0,
  'SELECT 1',
  'ALTER TABLE institution_kyc_requirements ADD COLUMN requirement_category VARCHAR(50) NOT NULL DEFAULT "business_identity" AFTER requirement_code'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'institution_kyc_requirements' AND COLUMN_NAME = 'requirement_type') > 0,
  'SELECT 1',
  'ALTER TABLE institution_kyc_requirements ADD COLUMN requirement_type VARCHAR(50) NOT NULL DEFAULT "document_upload" AFTER requirement_category'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'institution_kyc_requirements' AND COLUMN_NAME = 'applicable_business_types') > 0,
  'SELECT 1',
  'ALTER TABLE institution_kyc_requirements ADD COLUMN applicable_business_types TEXT NULL AFTER requirement_type'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'institution_kyc_requirements' AND COLUMN_NAME = 'allowed_extensions') > 0,
  'SELECT 1',
  'ALTER TABLE institution_kyc_requirements ADD COLUMN allowed_extensions VARCHAR(100) NOT NULL DEFAULT "pdf,jpg,jpeg,png,webp" AFTER instructions'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'institution_kyc_requirements' AND COLUMN_NAME = 'max_file_size_mb') > 0,
  'SELECT 1',
  'ALTER TABLE institution_kyc_requirements ADD COLUMN max_file_size_mb INT NOT NULL DEFAULT 5 AFTER allowed_extensions'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'institution_kyc_requirements' AND COLUMN_NAME = 'max_files_count') > 0,
  'SELECT 1',
  'ALTER TABLE institution_kyc_requirements ADD COLUMN max_files_count INT NOT NULL DEFAULT 1 AFTER max_file_size_mb'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'institution_kyc_requirements' AND COLUMN_NAME = 'document_sides') > 0,
  'SELECT 1',
  'ALTER TABLE institution_kyc_requirements ADD COLUMN document_sides VARCHAR(20) NOT NULL DEFAULT "single" AFTER max_files_count'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'institution_kyc_requirements' AND COLUMN_NAME = 'requires_approval') > 0,
  'SELECT 1',
  'ALTER TABLE institution_kyc_requirements ADD COLUMN requires_approval TINYINT(1) NOT NULL DEFAULT 1 AFTER is_mandatory'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'institution_kyc_requirements' AND COLUMN_NAME = 'review_instructions') > 0,
  'SELECT 1',
  'ALTER TABLE institution_kyc_requirements ADD COLUMN review_instructions TEXT NULL AFTER requires_approval'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 5. Seed Permissions for Branch Management
INSERT IGNORE INTO permissions (name, description, created_at, updated_at) VALUES
  ('institution.branch.view', 'View banking institution branches and locations', NOW(), NOW()),
  ('institution.branch.manage', 'Create, edit, and toggle institution branches', NOW(), NOW());

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT 4, id FROM permissions WHERE name IN ('institution.branch.view', 'institution.branch.manage');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT 2, id FROM permissions WHERE name IN ('institution.branch.view', 'institution.branch.manage');

-- 6. Seed Bangladesh Geographic Master Data (8 Divisions & Main Districts/Upazilas)
INSERT IGNORE INTO geo_divisions (id, name, name_bn) VALUES
  (1, 'Dhaka', 'ঢাকা'),
  (2, 'Chattogram', 'চট্টগ্রাম'),
  (3, 'Rajshahi', 'রাজশাহী'),
  (4, 'Khulna', 'খুলনা'),
  (5, 'Barishal', 'বরিশাল'),
  (6, 'Sylhet', 'সিলেট'),
  (7, 'Rangpur', 'রংপুর'),
  (8, 'Mymensingh', 'ময়মনসিংহ');

-- Seed Major Districts for each Division
INSERT IGNORE INTO geo_districts (id, division_id, name, name_bn) VALUES
  -- Dhaka
  (1, 1, 'Dhaka', 'ঢাকা'),
  (2, 1, 'Gazipur', 'গাজীপুর'),
  (3, 1, 'Narayanganj', 'নারায়ণগঞ্জ'),
  (4, 1, 'Tangail', 'টাঙ্গাইল'),
  (5, 1, 'Faridpur', 'ফরিদপুর'),
  -- Chattogram
  (6, 2, 'Chattogram', 'চট্টগ্রাম'),
  (7, 2, 'Cox\'s Bazar', 'কক্সবাজার'),
  (8, 2, 'Cumilla', 'কুমিল্লা'),
  (9, 2, 'Noakhali', 'নোয়াখালী'),
  (10, 2, 'Brahmanbaria', 'ব্রাহ্মণবাড়িয়া'),
  -- Rajshahi
  (11, 3, 'Rajshahi', 'রাজশাহী'),
  (12, 3, 'Bogura', 'বগুড়া'),
  (13, 3, 'Pabna', 'পাবনা'),
  (14, 3, 'Sirajganj', 'সিরাজগঞ্জ'),
  -- Khulna
  (15, 4, 'Khulna', 'খুলনা'),
  (16, 4, 'Jashore', 'যশোর'),
  (17, 4, 'Kushtia', 'কুষ্টিয়া'),
  (18, 4, 'Satkhira', 'সাতক্ষীরা'),
  -- Barishal
  (19, 5, 'Barishal', 'বরিশাল'),
  (20, 5, 'Patuakhali', 'পটুয়াখালী'),
  (21, 5, 'Bhola', 'ভোলা'),
  -- Sylhet
  (22, 6, 'Sylhet', 'সিলেট'),
  (23, 6, 'Moulvibazar', 'মৌলভীবাজার'),
  (24, 6, 'Habiganj', 'হবিগঞ্জ'),
  -- Rangpur
  (25, 7, 'Rangpur', 'রংপুর'),
  (26, 7, 'Dinajpur', 'দিনাজপুর'),
  (27, 7, 'Kurigram', 'কুড়িগ্রাম'),
  -- Mymensingh
  (28, 8, 'Mymensingh', 'ময়মনসিংহ'),
  (29, 8, 'Jamalpur', 'জামালপুর'),
  (30, 8, 'Netrokona', 'নেত্রকোণা');

-- Seed Major Upazilas
INSERT IGNORE INTO geo_upazilas (id, district_id, name, name_bn) VALUES
  -- Dhaka District Upazilas / Thanas
  (1, 1, 'Gulshan', 'গুলশান'),
  (2, 1, 'Banani', 'বনানী'),
  (3, 1, 'Motijheel', 'মতিঝিল'),
  (4, 1, 'Dhanmondi', 'ধানমন্ডি'),
  (5, 1, 'Uttara', 'উত্তরা'),
  (6, 1, 'Mirpur', 'মিরপুর'),
  (7, 1, 'Tejgaon', 'তেজগাঁও'),
  (8, 1, 'Savar', 'সাভার'),
  (9, 1, 'Keraniganj', 'কেরানীগঞ্জ'),
  -- Gazipur
  (10, 2, 'Gazipur Sadar', 'গাজীপুর সদর'),
  (11, 2, 'Tongi', 'টঙ্গী'),
  (12, 2, 'Kaliakair', 'কালিয়াকৈর'),
  -- Narayanganj
  (13, 3, 'Narayanganj Sadar', 'নারায়ণগঞ্জ সদর'),
  (14, 3, 'Sonargaon', 'সোনারগাঁও'),
  -- Chattogram
  (15, 6, 'Agrabad', 'আগ্রাবাদ'),
  (16, 6, 'Kotwali', 'কোতোয়ালী'),
  (17, 6, 'Panchlaish', 'পাঁচলাইশ'),
  (18, 6, 'Hathazari', 'হাটহাজারী'),
  -- Rajshahi
  (19, 11, 'Boalia', 'বোয়ালিয়া'),
  (20, 11, 'Motihar', 'মতিহার'),
  (21, 11, 'Paba', 'পবা'),
  -- Khulna
  (22, 15, 'Khulna Sadar', 'খুলনা সদর'),
  (23, 15, 'Khalishpur', 'খালিশপুর'),
  (24, 15, 'Sonadanga', 'সোনাডাঙ্গা'),
  -- Barishal
  (25, 19, 'Barishal Sadar', 'বরিশাল সদর'),
  (26, 19, 'Babuganj', 'বাবুগঞ্জ'),
  -- Sylhet
  (27, 22, 'Sylhet Sadar', 'সিলেট সদর'),
  (28, 22, 'Beanibazar', 'বিয়ানীবাজার'),
  -- Rangpur
  (29, 25, 'Rangpur Sadar', 'রংপুর সদর'),
  (30, 25, 'Pirganj', 'পীরগঞ্জ'),
  -- Mymensingh
  (31, 28, 'Mymensingh Sadar', 'ময়মনসিংহ সদর'),
  (32, 28, 'Trishal', 'ত্রিশাল');

-- 7. Seed Initial Real Branches for Institutions
INSERT IGNORE INTO institution_branches 
  (institution_id, branch_name, branch_code, division, district, upazila, post_office, postal_code, address, phone, email, manager_name, status)
VALUES
  (1, 'Gulshan Corporate Branch', 'BRAC_001', 'Dhaka', 'Dhaka', 'Gulshan', 'Gulshan-1', '1212', 'Plot 67, Road 11, Block D, Gulshan-1, Dhaka', '+8802222288111', 'gulshan.branch@bracbank.com', 'Kazi Mahbubul Alam', 'active'),
  (1, 'Motijheel Commercial Branch', 'BRAC_002', 'Dhaka', 'Dhaka', 'Motijheel', 'Motijheel C/A', '1000', '16 Dilkusha C/A, Motijheel, Dhaka', '+8802222288222', 'motijheel.branch@bracbank.com', 'Farhana Yasmin', 'active'),
  (1, 'Agrabad Commercial Branch', 'BRAC_003', 'Chattogram', 'Chattogram', 'Agrabad', 'Agrabad C/A', '4100', 'World Trade Center, Agrabad C/A, Chattogram', '+88031718801', 'agrabad.branch@bracbank.com', 'Shafiqur Rahman', 'active'),
  (2, 'Principal Branch', 'DBL_001', 'Dhaka', 'Dhaka', 'Motijheel', 'Motijheel C/A', '1000', 'Biman Bhaban, 100 Motijheel C/A, Dhaka', '+88029577201', 'principal@dhakabank.com', 'M. A. Haque', 'active'),
  (2, 'Banani Branch', 'DBL_002', 'Dhaka', 'Dhaka', 'Banani', 'Banani Post Office', '1213', 'Road 11, Block D, Banani, Dhaka', '+88029881122', 'banani@dhakabank.com', 'Nusrat Jahan', 'active'),
  (3, 'City Center Corporate Branch', 'CITY_001', 'Dhaka', 'Dhaka', 'Motijheel', 'Motijheel C/A', '1000', 'City Bank Center, 136 Gulshan Avenue, Dhaka', '+88028813405', 'corporate@thecitybank.com', 'Tahmid Hossain', 'active');

