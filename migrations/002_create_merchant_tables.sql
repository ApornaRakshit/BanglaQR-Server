-- Migration 002: Create Merchant and Onboarding Tables

CREATE TABLE IF NOT EXISTS merchants (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL UNIQUE,
    merchant_code VARCHAR(50) NULL UNIQUE,
    account_status ENUM(
        'draft',
        'submitted',
        'under_review',
        'additional_information_required',
        'approved',
        'rejected',
        'suspended',
        'active'
    ) NOT NULL DEFAULT 'draft',
    kyc_status ENUM(
        'pending',
        'under_review',
        'additional_information_required',
        'approved',
        'rejected'
    ) NOT NULL DEFAULT 'pending',
    onboarding_step INT NOT NULL DEFAULT 1,
    submitted_at DATETIME NULL,
    approved_at DATETIME NULL,
    rejected_at DATETIME NULL,
    rejection_reason TEXT NULL,
    admin_comments TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_merchants_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS merchant_profiles (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    merchant_id BIGINT UNSIGNED NOT NULL UNIQUE,
    company_name VARCHAR(255) NOT NULL,
    business_type VARCHAR(100) NULL,
    industry VARCHAR(100) NULL,
    website VARCHAR(255) NULL,
    address TEXT NULL,
    city VARCHAR(100) NULL,
    state VARCHAR(100) NULL,
    postal_code VARCHAR(30) NULL,
    country VARCHAR(100) NOT NULL DEFAULT 'Bangladesh',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_merchant_profiles_merchant
        FOREIGN KEY (merchant_id)
        REFERENCES merchants(id)
        ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS merchant_contacts (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    merchant_id BIGINT UNSIGNED NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(30) NOT NULL,
    email VARCHAR(255) NOT NULL,
    designation VARCHAR(100) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_merchant_contacts_merchant
        FOREIGN KEY (merchant_id)
        REFERENCES merchants(id)
        ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS merchant_commercial_details (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    merchant_id BIGINT UNSIGNED NOT NULL UNIQUE,
    transactions_per_day INT UNSIGNED NULL DEFAULT 0,
    transactions_per_month INT UNSIGNED NULL DEFAULT 0,
    volume_per_day DECIMAL(15,2) UNSIGNED NULL DEFAULT 0.00,
    volume_per_month DECIMAL(15,2) UNSIGNED NULL DEFAULT 0.00,
    maximum_ticket_size DECIMAL(15,2) UNSIGNED NULL DEFAULT 0.00,
    return_url VARCHAR(500) NULL,
    merchant_domain VARCHAR(255) NULL,
    merchant_ip_address VARCHAR(45) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_merchant_commercial_merchant
        FOREIGN KEY (merchant_id)
        REFERENCES merchants(id)
        ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS merchant_kyc (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    merchant_id BIGINT UNSIGNED NOT NULL UNIQUE,
    legal_business_name VARCHAR(255) NULL,
    registration_number VARCHAR(100) NULL,
    tin VARCHAR(100) NULL,
    bin VARCHAR(100) NULL,
    trade_license_number VARCHAR(100) NULL,
    nid_number VARCHAR(100) NULL,
    authorized_person_name VARCHAR(255) NULL,
    bank_name VARCHAR(255) NULL,
    bank_account_name VARCHAR(255) NULL,
    bank_account_number VARCHAR(100) NULL,
    routing_number VARCHAR(50) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_merchant_kyc_merchant
        FOREIGN KEY (merchant_id)
        REFERENCES merchants(id)
        ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS merchant_documents (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    merchant_id BIGINT UNSIGNED NOT NULL,
    document_type VARCHAR(100) NOT NULL,
    document_name VARCHAR(255) NOT NULL,
    storage_key VARCHAR(500) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    file_size BIGINT UNSIGNED NOT NULL,
    status ENUM(
        'Pending',
        'Uploaded',
        'Under Review',
        'Approved',
        'Rejected',
        'Additional Document Required'
    ) NOT NULL DEFAULT 'Uploaded',
    review_comment TEXT NULL,
    uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_merchant_documents_merchant
        FOREIGN KEY (merchant_id)
        REFERENCES merchants(id)
        ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS merchant_onboarding_history (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    merchant_id BIGINT UNSIGNED NOT NULL,
    step VARCHAR(100) NOT NULL,
    action VARCHAR(100) NOT NULL,
    previous_status VARCHAR(100) NULL,
    new_status VARCHAR(100) NULL,
    metadata JSON NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_merchant_onboarding_history_merchant
        FOREIGN KEY (merchant_id)
        REFERENCES merchants(id)
        ON DELETE CASCADE
);

