import { db } from "../src/config/db.js";

async function columnExists(connection, table, column) {
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows.length > 0;
}

async function tableExists(connection, table) {
  const [rows] = await connection.query(
    `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  return rows.length > 0;
}

async function addColumn(connection, table, column, definition) {
  const exists = await columnExists(connection, table, column);
  if (!exists) {
    await connection.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    console.log(`✅ [${table}] Added column ${column}`);
  } else {
    console.log(`ℹ️ [${table}] Column ${column} already exists`);
  }
}

export async function runMigration014() {
  console.log("=== Starting Migration 014: Institution Portal, Directory & KYC Correction ===");
  const connection = await db.getConnection();

  try {
    // -------------------------------------------------------------
    // 1. Extend institutions
    // -------------------------------------------------------------
    await addColumn(connection, "institutions", "name_bn", "VARCHAR(150) NULL AFTER name");
    await addColumn(connection, "institutions", "legal_name", "VARCHAR(255) NULL AFTER name_bn");
    await addColumn(
      connection,
      "institutions",
      "directory_status",
      "ENUM('unlisted', 'listed', 'verified', 'archived') NOT NULL DEFAULT 'listed' AFTER status"
    );
    await addColumn(
      connection,
      "institutions",
      "partnership_status",
      "ENUM('none', 'in_discussion', 'mou_signed', 'active_partner', 'partner_suspended') NOT NULL DEFAULT 'none' AFTER directory_status"
    );
    await addColumn(
      connection,
      "institutions",
      "regulatory_status",
      "ENUM('scheduled_bank', 'non_scheduled_bank', 'licensed_mfs', 'payment_system_operator', 'under_review', 'exempt') NOT NULL DEFAULT 'scheduled_bank' AFTER partnership_status"
    );
    await addColumn(connection, "institutions", "source_name", "VARCHAR(150) NULL AFTER regulatory_status");
    await addColumn(connection, "institutions", "source_url", "VARCHAR(500) NULL AFTER source_name");
    await addColumn(connection, "institutions", "source_checked_at", "DATETIME NULL AFTER source_url");
    await addColumn(connection, "institutions", "source_verified_by", "VARCHAR(100) NULL AFTER source_checked_at");

    // -------------------------------------------------------------
    // 2. Create institution_bank_profiles
    // -------------------------------------------------------------
    if (!(await tableExists(connection, "institution_bank_profiles"))) {
      await connection.query(`
        CREATE TABLE institution_bank_profiles (
          institution_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
          bank_category ENUM('commercial_conventional', 'commercial_islamic', 'specialized', 'foreign_commercial') NOT NULL DEFAULT 'commercial_conventional',
          ownership_type ENUM('state_owned', 'private', 'foreign', 'joint_venture') NOT NULL DEFAULT 'private',
          official_bank_code VARCHAR(50) NULL,
          swift_code VARCHAR(20) NULL,
          regulatory_reference VARCHAR(100) NULL,
          official_contact_person VARCHAR(150) NULL,
          contact_designation VARCHAR(100) NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          CONSTRAINT fk_ibp_institution FOREIGN KEY (institution_id) REFERENCES institutions (id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);
      console.log("✅ Created table institution_bank_profiles");
    } else {
      console.log("ℹ️ Table institution_bank_profiles already exists");
    }

    // -------------------------------------------------------------
    // 3. Create institution_mfs_profiles
    // -------------------------------------------------------------
    if (!(await tableExists(connection, "institution_mfs_profiles"))) {
      await connection.query(`
        CREATE TABLE institution_mfs_profiles (
          institution_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
          brand_name VARCHAR(150) NOT NULL,
          legal_operator_name VARCHAR(255) NOT NULL,
          provider_code VARCHAR(50) NOT NULL,
          parent_bank_id BIGINT UNSIGNED NULL,
          authorization_reference VARCHAR(100) NULL,
          merchant_application_supported TINYINT(1) NOT NULL DEFAULT 0,
          official_contact VARCHAR(150) NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          CONSTRAINT fk_imp_institution FOREIGN KEY (institution_id) REFERENCES institutions (id) ON DELETE CASCADE,
          CONSTRAINT fk_imp_parent_bank FOREIGN KEY (parent_bank_id) REFERENCES institutions (id) ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);
      console.log("✅ Created table institution_mfs_profiles");
    } else {
      console.log("ℹ️ Table institution_mfs_profiles already exists");
    }

    // -------------------------------------------------------------
    // 4. Extend institution_branches
    // -------------------------------------------------------------
    await addColumn(
      connection,
      "institution_branches",
      "unit_type",
      "ENUM('branch', 'sub_branch', 'booth', 'collection_booth') NOT NULL DEFAULT 'branch' AFTER branch_code"
    );
    await addColumn(
      connection,
      "institution_branches",
      "parent_branch_id",
      "BIGINT UNSIGNED NULL AFTER unit_type"
    );
    await addColumn(connection, "institution_branches", "source_url", "VARCHAR(500) NULL AFTER notes");
    await addColumn(connection, "institution_branches", "source_verified_at", "DATETIME NULL AFTER source_url");
    await addColumn(connection, "institution_branches", "source_verified_by", "VARCHAR(100) NULL AFTER source_verified_at");
    await addColumn(connection, "institution_branches", "import_batch_id", "VARCHAR(100) NULL AFTER source_verified_by");

    // -------------------------------------------------------------
    // 5. Create institution_service_points (MFS outlets & service centers)
    // -------------------------------------------------------------
    if (!(await tableExists(connection, "institution_service_points"))) {
      await connection.query(`
        CREATE TABLE institution_service_points (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
          provider_id BIGINT UNSIGNED NOT NULL,
          outlet_type ENUM('agent_point', 'customer_care', 'service_point', 'kiosk') NOT NULL DEFAULT 'agent_point',
          outlet_name VARCHAR(150) NOT NULL,
          outlet_code VARCHAR(50) NULL,
          address TEXT NULL,
          division_id BIGINT UNSIGNED NULL,
          district_id BIGINT UNSIGNED NULL,
          upazila_id BIGINT UNSIGNED NULL,
          contact VARCHAR(100) NULL,
          status ENUM('active', 'inactive', 'suspended') NOT NULL DEFAULT 'active',
          source_url VARCHAR(500) NULL,
          source_verified_at DATETIME NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          CONSTRAINT fk_isp_provider FOREIGN KEY (provider_id) REFERENCES institutions (id) ON DELETE CASCADE,
          CONSTRAINT fk_isp_division FOREIGN KEY (division_id) REFERENCES bd_divisions (id) ON DELETE SET NULL,
          CONSTRAINT fk_isp_district FOREIGN KEY (district_id) REFERENCES bd_districts (id) ON DELETE SET NULL,
          CONSTRAINT fk_isp_upazila FOREIGN KEY (upazila_id) REFERENCES bd_upazilas (id) ON DELETE SET NULL,
          UNIQUE KEY uq_provider_outlet_code (provider_id, outlet_code),
          KEY idx_isp_status (status),
          KEY idx_isp_geo (district_id, upazila_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);
      console.log("✅ Created table institution_service_points");
    } else {
      console.log("ℹ️ Table institution_service_points already exists");
    }

    // -------------------------------------------------------------
    // 6. Create institution_user_branch_assignments
    // -------------------------------------------------------------
    if (!(await tableExists(connection, "institution_user_branch_assignments"))) {
      await connection.query(`
        CREATE TABLE institution_user_branch_assignments (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
          membership_id BIGINT UNSIGNED NOT NULL,
          branch_id BIGINT UNSIGNED NOT NULL,
          assigned_by BIGINT UNSIGNED NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT fk_iuba_membership FOREIGN KEY (membership_id) REFERENCES institution_users (id) ON DELETE CASCADE,
          CONSTRAINT fk_iuba_branch FOREIGN KEY (branch_id) REFERENCES institution_branches (id) ON DELETE CASCADE,
          UNIQUE KEY uq_membership_branch (membership_id, branch_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);
      console.log("✅ Created table institution_user_branch_assignments");
    } else {
      console.log("ℹ️ Table institution_user_branch_assignments already exists");
    }

    // -------------------------------------------------------------
    // 7. Create institution_applications & institution_application_services
    // -------------------------------------------------------------
    if (!(await tableExists(connection, "institution_applications"))) {
      await connection.query(`
        CREATE TABLE institution_applications (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
          application_number VARCHAR(64) NOT NULL UNIQUE,
          institution_id BIGINT UNSIGNED NOT NULL,
          application_type ENUM('partner_onboarding', 'service_enablement', 'profile_update') NOT NULL DEFAULT 'partner_onboarding',
          submitted_by_user_id BIGINT UNSIGNED NULL,
          status ENUM('draft', 'submitted', 'under_review', 'additional_info_required', 'approved', 'rejected', 'cancelled') NOT NULL DEFAULT 'draft',
          submitted_data_snapshot JSON NULL,
          reviewer_id BIGINT UNSIGNED NULL,
          review_comment TEXT NULL,
          rejection_reason TEXT NULL,
          submitted_at DATETIME NULL,
          reviewed_at DATETIME NULL,
          approved_at DATETIME NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          CONSTRAINT fk_ia_institution FOREIGN KEY (institution_id) REFERENCES institutions (id) ON DELETE CASCADE,
          KEY idx_ia_status (status),
          KEY idx_ia_inst (institution_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);
      console.log("✅ Created table institution_applications");
    } else {
      console.log("ℹ️ Table institution_applications already exists");
    }

    if (!(await tableExists(connection, "institution_application_services"))) {
      await connection.query(`
        CREATE TABLE institution_application_services (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
          application_id BIGINT UNSIGNED NOT NULL,
          service_code VARCHAR(50) NOT NULL,
          service_name VARCHAR(150) NOT NULL,
          service_type VARCHAR(50) NOT NULL DEFAULT 'payment_gateway',
          requested_integration_mode ENUM('api', 'hosted_checkout', 'qr_offline', 'manual', 'hybrid') NOT NULL DEFAULT 'api',
          status ENUM('requested', 'approved', 'rejected', 'pending_contract') NOT NULL DEFAULT 'requested',
          notes TEXT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT fk_ias_app FOREIGN KEY (application_id) REFERENCES institution_applications (id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);
      console.log("✅ Created table institution_application_services");
    } else {
      console.log("ℹ️ Table institution_application_services already exists");
    }

    // -------------------------------------------------------------
    // 8. Create institution_documents
    // -------------------------------------------------------------
    if (!(await tableExists(connection, "institution_documents"))) {
      await connection.query(`
        CREATE TABLE institution_documents (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
          institution_id BIGINT UNSIGNED NOT NULL,
          application_id BIGINT UNSIGNED NULL,
          document_type VARCHAR(100) NOT NULL,
          original_file_name VARCHAR(255) NOT NULL,
          storage_key VARCHAR(500) NOT NULL,
          mime_type VARCHAR(100) NOT NULL,
          size_bytes BIGINT UNSIGNED NOT NULL,
          checksum_sha256 VARCHAR(64) NULL,
          version_no INT NOT NULL DEFAULT 1,
          status ENUM('pending', 'approved', 'rejected', 'expired') NOT NULL DEFAULT 'pending',
          uploaded_by_user_id BIGINT UNSIGNED NULL,
          reviewed_by_user_id BIGINT UNSIGNED NULL,
          review_comment TEXT NULL,
          uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          reviewed_at DATETIME NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          CONSTRAINT fk_idoc_institution FOREIGN KEY (institution_id) REFERENCES institutions (id) ON DELETE CASCADE,
          CONSTRAINT fk_idoc_application FOREIGN KEY (application_id) REFERENCES institution_applications (id) ON DELETE SET NULL,
          KEY idx_idoc_status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);
      console.log("✅ Created table institution_documents");
    } else {
      console.log("ℹ️ Table institution_documents already exists");
    }

    // -------------------------------------------------------------
    // 9. Create institution_services
    // -------------------------------------------------------------
    if (!(await tableExists(connection, "institution_services"))) {
      await connection.query(`
        CREATE TABLE institution_services (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
          institution_id BIGINT UNSIGNED NOT NULL,
          service_code VARCHAR(50) NOT NULL,
          service_name VARCHAR(150) NOT NULL,
          service_type VARCHAR(50) NOT NULL DEFAULT 'payment_gateway',
          legacy_gateway_id BIGINT UNSIGNED NULL,
          integration_mode ENUM('api', 'hosted_checkout', 'qr_offline', 'manual', 'hybrid') NOT NULL DEFAULT 'api',
          availability_status ENUM('available', 'testing_only', 'unavailable', 'deprecated') NOT NULL DEFAULT 'available',
          application_required TINYINT(1) NOT NULL DEFAULT 1,
          service_requirements JSON NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          CONSTRAINT fk_is_institution FOREIGN KEY (institution_id) REFERENCES institutions (id) ON DELETE CASCADE,
          CONSTRAINT fk_is_legacy_gw FOREIGN KEY (legacy_gateway_id) REFERENCES gateways (id) ON DELETE SET NULL,
          UNIQUE KEY uq_inst_service_code (institution_id, service_code),
          KEY idx_is_status (availability_status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);
      console.log("✅ Created table institution_services");
    } else {
      console.log("ℹ️ Table institution_services already exists");
    }

    // -------------------------------------------------------------
    // 10. Create institution_service_connections
    // -------------------------------------------------------------
    if (!(await tableExists(connection, "institution_service_connections"))) {
      await connection.query(`
        CREATE TABLE institution_service_connections (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
          institution_service_id BIGINT UNSIGNED NOT NULL,
          connection_mode ENUM('direct_api', 'aggregator', 'sftp_batch', 'manual_portal') NOT NULL DEFAULT 'direct_api',
          status ENUM('not_connected', 'setup_pending', 'testing', 'connected', 'error', 'suspended') NOT NULL DEFAULT 'not_connected',
          environment ENUM('sandbox', 'staging', 'production') NOT NULL DEFAULT 'sandbox',
          credential_secret_ref VARCHAR(255) NULL,
          last_tested_at DATETIME NULL,
          last_verified_at DATETIME NULL,
          verified_by_user_id BIGINT UNSIGNED NULL,
          connection_notes TEXT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          CONSTRAINT fk_isc_service FOREIGN KEY (institution_service_id) REFERENCES institution_services (id) ON DELETE CASCADE,
          KEY idx_isc_status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);
      console.log("✅ Created table institution_service_connections");
    } else {
      console.log("ℹ️ Table institution_service_connections already exists");
    }

    // -------------------------------------------------------------
    // 11. Extend merchant_gateway_applications
    // -------------------------------------------------------------
    await addColumn(
      connection,
      "merchant_gateway_applications",
      "application_number",
      "VARCHAR(64) NULL AFTER id"
    );
    await addColumn(
      connection,
      "merchant_gateway_applications",
      "institution_service_id",
      "BIGINT UNSIGNED NULL AFTER branch_id"
    );
    await addColumn(
      connection,
      "merchant_gateway_applications",
      "assigned_reviewer_id",
      "BIGINT UNSIGNED NULL AFTER status"
    );
    await addColumn(
      connection,
      "merchant_gateway_applications",
      "submitted_data_snapshot",
      "JSON NULL AFTER assigned_reviewer_id"
    );
    await addColumn(
      connection,
      "merchant_gateway_applications",
      "review_comment",
      "TEXT NULL AFTER review_note"
    );
    await addColumn(
      connection,
      "merchant_gateway_applications",
      "rejection_reason",
      "TEXT NULL AFTER review_comment"
    );
    await addColumn(
      connection,
      "merchant_gateway_applications",
      "submission_version",
      "INT NOT NULL DEFAULT 1 AFTER rejection_reason"
    );
    await addColumn(
      connection,
      "merchant_gateway_applications",
      "approved_at",
      "DATETIME NULL AFTER reviewed_at"
    );

    // Populate missing application_numbers for existing records
    await connection.query(`
      UPDATE merchant_gateway_applications
      SET application_number = CONCAT('MGA-', DATE_FORMAT(created_at, '%Y%m%d'), '-', LPAD(id, 4, '0'))
      WHERE application_number IS NULL OR application_number = '';
    `);

    // -------------------------------------------------------------
    // 12. Create institution_data_imports & institution_data_import_rows
    // -------------------------------------------------------------
    if (!(await tableExists(connection, "institution_data_imports"))) {
      await connection.query(`
        CREATE TABLE institution_data_imports (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
          entity_type ENUM('bank_branches', 'mfs_service_points', 'institutions') NOT NULL,
          source_name VARCHAR(150) NOT NULL,
          source_url VARCHAR(500) NULL,
          original_file_name VARCHAR(255) NOT NULL,
          storage_key VARCHAR(500) NOT NULL,
          checksum_sha256 VARCHAR(64) NULL,
          status ENUM('uploaded', 'validating', 'validated_with_errors', 'ready_for_review', 'approved_for_publish', 'publishing', 'published', 'rejected', 'failed') NOT NULL DEFAULT 'uploaded',
          total_rows INT NOT NULL DEFAULT 0,
          valid_rows INT NOT NULL DEFAULT 0,
          invalid_rows INT NOT NULL DEFAULT 0,
          created_rows INT NOT NULL DEFAULT 0,
          updated_rows INT NOT NULL DEFAULT 0,
          duplicate_rows INT NOT NULL DEFAULT 0,
          started_by_user_id BIGINT UNSIGNED NULL,
          started_at DATETIME NULL,
          completed_at DATETIME NULL,
          error_summary JSON NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          KEY idx_idi_status (status),
          KEY idx_idi_entity (entity_type)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);
      console.log("✅ Created table institution_data_imports");
    } else {
      console.log("ℹ️ Table institution_data_imports already exists");
    }

    if (!(await tableExists(connection, "institution_data_import_rows"))) {
      await connection.query(`
        CREATE TABLE institution_data_import_rows (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
          import_id BIGINT UNSIGNED NOT NULL,
          \`row_number\` INT NOT NULL,
          raw_data JSON NOT NULL,
          parsed_data JSON NULL,
          validation_status ENUM('valid', 'invalid', 'warning', 'duplicate') NOT NULL DEFAULT 'valid',
          validation_errors JSON NULL,
          action_taken ENUM('none', 'inserted', 'updated', 'skipped') NOT NULL DEFAULT 'none',
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT fk_idir_import FOREIGN KEY (import_id) REFERENCES institution_data_imports (id) ON DELETE CASCADE,
          KEY idx_idir_status (validation_status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);
      console.log("✅ Created table institution_data_import_rows");
    } else {
      console.log("ℹ️ Table institution_data_import_rows already exists");
    }

    // -------------------------------------------------------------
    // 13. Create institution_activity_logs (operational history)
    // -------------------------------------------------------------
    if (!(await tableExists(connection, "institution_activity_logs"))) {
      await connection.query(`
        CREATE TABLE institution_activity_logs (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
          institution_id BIGINT UNSIGNED NOT NULL,
          user_id BIGINT UNSIGNED NULL,
          user_email VARCHAR(150) NULL,
          action VARCHAR(100) NOT NULL,
          resource_type VARCHAR(100) NOT NULL,
          resource_id VARCHAR(100) NULL,
          status_transition VARCHAR(100) NULL,
          details JSON NULL,
          ip_address VARCHAR(45) NULL,
          user_agent TEXT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT fk_ial_inst FOREIGN KEY (institution_id) REFERENCES institutions (id) ON DELETE CASCADE,
          KEY idx_ial_action (action),
          KEY idx_ial_inst (institution_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);
      console.log("✅ Created table institution_activity_logs");
    } else {
      console.log("ℹ️ Table institution_activity_logs already exists");
    }

    // -------------------------------------------------------------
    // 14. KYC Correction Support Tables
    // -------------------------------------------------------------
    if (!(await tableExists(connection, "merchant_kyc_assignments"))) {
      await connection.query(`
        CREATE TABLE merchant_kyc_assignments (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
          kyc_id BIGINT UNSIGNED NOT NULL,
          institution_id BIGINT UNSIGNED NOT NULL,
          assigned_to_user_id BIGINT UNSIGNED NOT NULL,
          assigned_by_user_id BIGINT UNSIGNED NULL,
          status ENUM('assigned', 'in_review', 'completed', 'reassigned') NOT NULL DEFAULT 'assigned',
          assigned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          completed_at DATETIME NULL,
          CONSTRAINT fk_mka_kyc FOREIGN KEY (kyc_id) REFERENCES merchant_kyc (id) ON DELETE CASCADE,
          CONSTRAINT fk_mka_inst FOREIGN KEY (institution_id) REFERENCES institutions (id) ON DELETE CASCADE,
          KEY idx_mka_status (status),
          KEY idx_mka_assignee (assigned_to_user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);
      console.log("✅ Created table merchant_kyc_assignments");
    } else {
      console.log("ℹ️ Table merchant_kyc_assignments already exists");
    }

    if (!(await tableExists(connection, "kyc_field_issues"))) {
      await connection.query(`
        CREATE TABLE kyc_field_issues (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
          merchant_id BIGINT UNSIGNED NOT NULL,
          kyc_id BIGINT UNSIGNED NOT NULL,
          institution_id BIGINT UNSIGNED NULL,
          field_key VARCHAR(100) NOT NULL,
          issue_type ENUM('incorrect_value', 'illegible_scan', 'expired_document', 'mismatch', 'missing_supporting_info', 'other') NOT NULL DEFAULT 'incorrect_value',
          issue_reason TEXT NOT NULL,
          reviewer_id BIGINT UNSIGNED NOT NULL,
          status ENUM('open', 'resolved', 'waived') NOT NULL DEFAULT 'open',
          resolution_note TEXT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          CONSTRAINT fk_kfi_kyc FOREIGN KEY (kyc_id) REFERENCES merchant_kyc (id) ON DELETE CASCADE,
          CONSTRAINT fk_kfi_inst FOREIGN KEY (institution_id) REFERENCES institutions (id) ON DELETE SET NULL,
          KEY idx_kfi_status (status),
          KEY idx_kfi_merchant (merchant_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);
      console.log("✅ Created table kyc_field_issues");
    } else {
      console.log("ℹ️ Table kyc_field_issues already exists");
    }

    if (!(await tableExists(connection, "kyc_submission_versions"))) {
      await connection.query(`
        CREATE TABLE kyc_submission_versions (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
          merchant_id BIGINT UNSIGNED NOT NULL,
          kyc_id BIGINT UNSIGNED NOT NULL,
          version_no INT NOT NULL DEFAULT 1,
          snapshot_data JSON NOT NULL,
          submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          submitted_by_user_id BIGINT UNSIGNED NULL,
          change_summary TEXT NULL,
          KEY idx_ksv_merchant (merchant_id),
          KEY idx_ksv_version (kyc_id, version_no)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);
      console.log("✅ Created table kyc_submission_versions");
    } else {
      console.log("ℹ️ Table kyc_submission_versions already exists");
    }

    if (!(await tableExists(connection, "merchant_document_versions"))) {
      await connection.query(`
        CREATE TABLE merchant_document_versions (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
          document_id BIGINT UNSIGNED NOT NULL,
          version_no INT NOT NULL DEFAULT 1,
          storage_key VARCHAR(500) NOT NULL,
          original_filename VARCHAR(255) NOT NULL,
          mime_type VARCHAR(100) NOT NULL,
          file_size BIGINT UNSIGNED NOT NULL,
          checksum_sha256 VARCHAR(64) NULL,
          uploaded_by_user_id BIGINT UNSIGNED NULL,
          uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          review_status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
          review_note TEXT NULL,
          CONSTRAINT fk_mdv_doc FOREIGN KEY (document_id) REFERENCES merchant_documents (id) ON DELETE CASCADE,
          KEY idx_mdv_status (review_status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);
      console.log("✅ Created table merchant_document_versions");
    } else {
      console.log("ℹ️ Table merchant_document_versions already exists");
    }

    // -------------------------------------------------------------
    // Seed default bank/MFS profiles for existing institutions
    // -------------------------------------------------------------
    const [existingInsts] = await connection.query(`SELECT id, institution_type, name, institution_code FROM institutions`);
    for (const inst of existingInsts) {
      if (inst.institution_type === "bank") {
        await connection.query(`
          INSERT IGNORE INTO institution_bank_profiles 
          (institution_id, bank_category, ownership_type, official_bank_code, swift_code, regulatory_reference)
          VALUES (?, 'commercial_conventional', 'private', ?, NULL, 'Bangladesh Bank Scheduled Bank Order');
        `, [inst.id, inst.institution_code]);
      } else if (inst.institution_type === "mfs") {
        await connection.query(`
          INSERT IGNORE INTO institution_mfs_profiles
          (institution_id, brand_name, legal_operator_name, provider_code, merchant_application_supported)
          VALUES (?, ?, ?, ?, 1);
        `, [inst.id, inst.name, `${inst.name} Limited`, inst.institution_code]);
      }
    }
    console.log("✅ Seeded initial bank and MFS profiles for existing institutions");

    console.log("=== Migration 014 COMPLETED SUCCESSFULLY! ===");
  } catch (error) {
    console.error("❌ Migration 014 failed:", error);
    throw error;
  } finally {
    connection.release();
  }
}

if (process.argv[1]?.endsWith("run_migration_014_institution_portal_and_directory.js")) {
  runMigration014().then(() => process.exit(0)).catch(() => process.exit(1));
}
