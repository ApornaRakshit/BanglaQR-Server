import { db } from "../../config/db.js";

export const merchantRepository = {
  /**
   * Find or create merchant record for a given user ID
   */
  async findOrCreateMerchantByUserId(userId, connectionOrDb = db) {
    const [rows] = await connectionOrDb.execute(
      `SELECT * FROM merchants WHERE user_id = ? LIMIT 1`,
      [userId]
    );

    if (rows.length > 0) {
      return rows[0];
    }

    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const merchantCode = `BQR-M-${Date.now().toString().slice(-6)}${randomSuffix}`;

    const [result] = await connectionOrDb.execute(
      `INSERT INTO merchants (user_id, merchant_code, account_status, kyc_status, onboarding_step)
       VALUES (?, ?, 'draft', 'pending', 1)`,
      [userId, merchantCode]
    );

    const [newRows] = await connectionOrDb.execute(
      `SELECT * FROM merchants WHERE id = ? LIMIT 1`,
      [result.insertId]
    );

    return newRows[0];
  },

  async findMerchantByUserId(userId, connectionOrDb = db) {
    const [rows] = await connectionOrDb.execute(
      `SELECT * FROM merchants WHERE user_id = ? LIMIT 1`,
      [userId]
    );
    return rows[0] || null;
  },

  async findMerchantById(merchantId, connectionOrDb = db) {
    const [rows] = await connectionOrDb.execute(
      `SELECT * FROM merchants WHERE id = ? LIMIT 1`,
      [merchantId]
    );
    return rows[0] || null;
  },

  async updateMerchantStep(merchantId, step, connectionOrDb = db) {
    await connectionOrDb.execute(
      `UPDATE merchants SET onboarding_step = GREATEST(onboarding_step, ?) WHERE id = ?`,
      [step, merchantId]
    );
  },

  async updateMerchantStatus(merchantId, accountStatus, kycStatus, submitted = false, connectionOrDb = db) {
    if (submitted) {
      await connectionOrDb.execute(
        `UPDATE merchants
         SET account_status = ?, kyc_status = ?, submitted_at = NOW(), onboarding_step = 7
         WHERE id = ?`,
        [accountStatus, kycStatus, merchantId]
      );
    } else {
      await connectionOrDb.execute(
        `UPDATE merchants SET account_status = ?, kyc_status = ? WHERE id = ?`,
        [accountStatus, kycStatus, merchantId]
      );
    }
  },

  // --- Profile ---
  async getProfile(merchantId, connectionOrDb = db) {
    const [rows] = await connectionOrDb.execute(
      `SELECT * FROM merchant_profiles WHERE merchant_id = ? LIMIT 1`,
      [merchantId]
    );
    return rows[0] || null;
  },

  async upsertProfile(merchantId, data, connectionOrDb = db) {
    const existing = await this.getProfile(merchantId, connectionOrDb);
    if (existing) {
      await connectionOrDb.execute(
        `UPDATE merchant_profiles
         SET company_name = ?, business_type = ?, industry = ?, website = ?,
             address = ?, city = ?, state = ?, postal_code = ?, country = ?
         WHERE merchant_id = ?`,
        [
          data.companyName || data.company_name || "My Business",
          data.businessType || data.business_type || null,
          data.industry || null,
          data.website || null,
          data.address || null,
          data.city || null,
          data.state || null,
          data.postalCode || data.postal_code || null,
          data.country || "Bangladesh",
          merchantId,
        ]
      );
    } else {
      await connectionOrDb.execute(
        `INSERT INTO merchant_profiles (merchant_id, company_name, business_type, industry, website, address, city, state, postal_code, country)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          merchantId,
          data.companyName || data.company_name || "My Business",
          data.businessType || data.business_type || null,
          data.industry || null,
          data.website || null,
          data.address || null,
          data.city || null,
          data.state || null,
          data.postalCode || data.postal_code || null,
          data.country || "Bangladesh",
        ]
      );
    }
  },

  // --- Contact ---
  async getContact(merchantId, connectionOrDb = db) {
    const [rows] = await connectionOrDb.execute(
      `SELECT * FROM merchant_contacts WHERE merchant_id = ? LIMIT 1`,
      [merchantId]
    );
    return rows[0] || null;
  },

  async upsertContact(merchantId, data, connectionOrDb = db) {
    const existing = await this.getContact(merchantId, connectionOrDb);
    if (existing) {
      await connectionOrDb.execute(
        `UPDATE merchant_contacts
         SET name = ?, phone = ?, email = ?, designation = ?
         WHERE merchant_id = ?`,
        [data.name, data.phone, data.email, data.designation || null, merchantId]
      );
    } else {
      await connectionOrDb.execute(
        `INSERT INTO merchant_contacts (merchant_id, name, phone, email, designation)
         VALUES (?, ?, ?, ?, ?)`,
        [merchantId, data.name, data.phone, data.email, data.designation || null]
      );
    }
  },

  // --- Commercial ---
  async getCommercial(merchantId) {
    const [rows] = await db.execute(
      `SELECT * FROM merchant_commercial_details WHERE merchant_id = ? LIMIT 1`,
      [merchantId]
    );
    return rows[0] || null;
  },

  async upsertCommercial(merchantId, data) {
    const existing = await this.getCommercial(merchantId);
    if (existing) {
      await db.execute(
        `UPDATE merchant_commercial_details
         SET transactions_per_day = ?, transactions_per_month = ?, volume_per_day = ?,
             volume_per_month = ?, maximum_ticket_size = ?, return_url = ?,
             merchant_domain = ?, merchant_ip_address = ?
         WHERE merchant_id = ?`,
        [
          data.transactionsPerDay || 0,
          data.transactionsPerMonth || 0,
          data.volumePerDay || 0,
          data.volumePerMonth || 0,
          data.maximumTicketSize || 0,
          data.returnUrl || null,
          data.merchantDomain || null,
          data.merchantIpAddress || null,
          merchantId,
        ]
      );
    } else {
      await db.execute(
        `INSERT INTO merchant_commercial_details
         (merchant_id, transactions_per_day, transactions_per_month, volume_per_day, volume_per_month, maximum_ticket_size, return_url, merchant_domain, merchant_ip_address)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          merchantId,
          data.transactionsPerDay || 0,
          data.transactionsPerMonth || 0,
          data.volumePerDay || 0,
          data.volumePerMonth || 0,
          data.maximumTicketSize || 0,
          data.returnUrl || null,
          data.merchantDomain || null,
          data.merchantIpAddress || null,
        ]
      );
    }
  },

  // --- KYC ---
  async getKyc(merchantId) {
    const [rows] = await db.execute(
      `SELECT * FROM merchant_kyc WHERE merchant_id = ? LIMIT 1`,
      [merchantId]
    );
    return rows[0] || null;
  },

  async upsertKyc(merchantId, data) {
    const existing = await this.getKyc(merchantId);
    const legalName = data.legalBusinessName || data.legal_business_name || null;
    const entityType = data.businessEntityType || data.business_entity_type || null;
    const tradeLicense = data.tradeLicenseNumber || data.trade_license_number || null;
    const regNumber = data.registrationNumber || data.registration_number || null;
    const tinVal = data.tin || data.tin_number || null;
    const binVal = data.bin || data.bin_number || null;
    const authName = data.authorizedPersonName || data.authorized_person_name || null;
    const designation = data.designation || null;
    const nidVal = data.nidNumber || data.nid_number || null;
    const nidIssue = data.nidIssueDate || data.nid_issue_date || null;
    const nidExpiry = data.nidExpiryDate || data.nid_expiry_date || null;
    const instId = data.institutionId || data.institution_id || null;
    const branchId = data.branchId || data.branch_id || null;
    const bankName = data.bankName || data.bank_name || null;
    const branchName = data.branchName || data.branch_name || null;
    const branchCode = data.branchCode || data.branch_code || null;
    const division = data.division || null;
    const district = data.district || null;
    const upazila = data.upazila || null;
    const branchAddress = data.branchAddress || data.branch_address || null;
    const accHolder = data.accountHolderName || data.bank_account_name || null;
    const accNumber = data.accountNumber || data.bank_account_number || null;
    const routingVal = data.routingNumber || data.routing_number || null;
    const accType = data.accountType || data.account_type || "Current";

    if (existing) {
      await db.execute(
        `UPDATE merchant_kyc
         SET legal_business_name = ?, business_entity_type = ?, trade_license_number = ?,
             registration_number = ?, tin = ?, bin = ?, authorized_person_name = ?,
             designation = ?, nid_number = ?, nid_issue_date = ?, nid_expiry_date = ?,
             institution_id = ?, branch_id = ?, bank_name = ?, branch_name = ?,
             branch_code = ?, division = ?, district = ?, upazila = ?, branch_address = ?,
             bank_account_name = ?, bank_account_number = ?, routing_number = ?, account_type = ?
         WHERE merchant_id = ?`,
        [
          legalName,
          entityType,
          tradeLicense,
          regNumber,
          tinVal,
          binVal,
          authName,
          designation,
          nidVal,
          nidIssue,
          nidExpiry,
          instId,
          branchId,
          bankName,
          branchName,
          branchCode,
          division,
          district,
          upazila,
          branchAddress,
          accHolder,
          accNumber,
          routingVal,
          accType,
          merchantId,
        ]
      );
    } else {
      await db.execute(
        `INSERT INTO merchant_kyc
         (merchant_id, legal_business_name, business_entity_type, trade_license_number,
          registration_number, tin, bin, authorized_person_name, designation, nid_number,
          nid_issue_date, nid_expiry_date, institution_id, branch_id, bank_name, branch_name,
          branch_code, division, district, upazila, branch_address, bank_account_name,
          bank_account_number, routing_number, account_type)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          merchantId,
          legalName,
          entityType,
          tradeLicense,
          regNumber,
          tinVal,
          binVal,
          authName,
          designation,
          nidVal,
          nidIssue,
          nidExpiry,
          instId,
          branchId,
          bankName,
          branchName,
          branchCode,
          division,
          district,
          upazila,
          branchAddress,
          accHolder,
          accNumber,
          routingVal,
          accType,
        ]
      );
    }
  },

  // --- Documents ---
  async getDocuments(merchantId) {
    const [rows] = await db.execute(
      `SELECT id, document_type, document_name, custom_label, original_filename, stored_filename,
              storage_key, mime_type, file_size, status, review_comment, review_note,
              uploaded_at, reviewed_at, created_at, updated_at
       FROM merchant_documents
       WHERE merchant_id = ?
       ORDER BY created_at ASC`,
      [merchantId]
    );
    return rows;
  },

  async getDocumentById(docId, merchantId) {
    const [rows] = await db.execute(
      `SELECT * FROM merchant_documents WHERE id = ? AND merchant_id = ? LIMIT 1`,
      [docId, merchantId]
    );
    return rows[0] || null;
  },

  async getDocumentByType(merchantId, documentType) {
    const [rows] = await db.execute(
      `SELECT * FROM merchant_documents WHERE merchant_id = ? AND document_type = ? LIMIT 1`,
      [merchantId, documentType]
    );
    return rows[0] || null;
  },

  async createDocument(merchantId, { documentType, documentName, customLabel, originalFilename, storedFilename, storageKey, mimeType, fileSize }) {
    // If a document of this type already exists, replace it to maintain clean 1:1 records for core types
    const existing = await this.getDocumentByType(merchantId, documentType);
    if (existing && ["NID_FRONT", "NID_BACK", "TIN_CERTIFICATE", "BIN_CERTIFICATE", "CANCELLED_BANK_CHEQUE"].includes(documentType)) {
      return await this.replaceDocument(existing.id, merchantId, {
        documentName,
        customLabel,
        originalFilename,
        storedFilename,
        storageKey,
        mimeType,
        fileSize,
      });
    }

    const [result] = await db.execute(
      `INSERT INTO merchant_documents
       (merchant_id, document_type, document_name, custom_label, original_filename, stored_filename, storage_key, mime_type, file_size, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Uploaded')`,
      [
        merchantId,
        documentType,
        documentName,
        customLabel || documentName,
        originalFilename || documentName,
        storedFilename || null,
        storageKey,
        mimeType,
        fileSize,
      ]
    );

    const [rows] = await db.execute(
      `SELECT id, document_type, document_name, custom_label, original_filename, storage_key, mime_type, file_size, status, review_comment, uploaded_at, created_at
       FROM merchant_documents WHERE id = ? LIMIT 1`,
      [result.insertId]
    );
    return rows[0];
  },

  async replaceDocument(docId, merchantId, { documentName, customLabel, originalFilename, storedFilename, storageKey, mimeType, fileSize }) {
    await db.execute(
      `UPDATE merchant_documents
       SET document_name = ?, custom_label = ?, original_filename = ?, stored_filename = ?,
           storage_key = ?, mime_type = ?, file_size = ?, status = 'Uploaded', uploaded_at = NOW()
       WHERE id = ? AND merchant_id = ?`,
      [
        documentName,
        customLabel || documentName,
        originalFilename || documentName,
        storedFilename || null,
        storageKey,
        mimeType,
        fileSize,
        docId,
        merchantId,
      ]
    );

    const [rows] = await db.execute(
      `SELECT id, document_type, document_name, custom_label, original_filename, storage_key, mime_type, file_size, status, review_comment, uploaded_at, created_at
       FROM merchant_documents WHERE id = ? LIMIT 1`,
      [docId]
    );
    return rows[0];
  },

  async deleteDocument(docId, merchantId) {
    await db.execute(
      `DELETE FROM merchant_documents WHERE id = ? AND merchant_id = ?`,
      [docId, merchantId]
    );
  },

  // --- Onboarding History & Audit ---
  async createHistory(merchantId, step, action, previousStatus, newStatus, metadata = null) {
    await db.execute(
      `INSERT INTO merchant_onboarding_history (merchant_id, step, action, previous_status, new_status, metadata)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        merchantId,
        step,
        action,
        previousStatus || null,
        newStatus || null,
        metadata ? JSON.stringify(metadata) : null,
      ]
    );
  },

  // --- User status ---
  async getUserVerification(userId) {
    const [rows] = await db.execute(
      `SELECT id, email, phone, email_verified_at, phone_verified_at, status FROM users WHERE id = ? LIMIT 1`,
      [userId]
    );
    if (!rows.length) return null;
    const u = rows[0];
    return {
      email: u.email,
      phone: u.phone,
      emailVerified: Boolean(u.email_verified_at),
      phoneVerified: Boolean(u.phone_verified_at),
      status: u.status,
    };
  },

  // --- Notification ---
  async createAdminNotification(title, message, type = "system", link = "/admin/kyc") {
    await db.execute(
      `INSERT INTO notifications (recipient_type, recipient_id, title, message, type, link, is_read, created_at)
       VALUES ('admin', NULL, ?, ?, ?, ?, 0, NOW())`,
      [title, message, type, link]
    );
  },

  // --- Banking Institution KYC Requirements (strictly stripped of admin_notes) ---
  async getInstitutionKycRequirements(institutionId, serviceId = null) {
    const conditions = ["ikr.institution_id = ?", "ikr.status = 'active'"];
    const params = [Number(institutionId)];

    if (serviceId && !isNaN(Number(serviceId)) && Number(serviceId) > 0) {
      conditions.push("(ikr.applicable_service_id = ? OR ikr.applicable_service_id IS NULL)");
      params.push(Number(serviceId));
    }

    // STRICT PRIVACY: Note that admin_notes and review_instructions are NOT selected!
    const [rows] = await db.query(
      `
      SELECT
        ikr.id,
        ikr.institution_id,
        ikr.applicable_service_id,
        ikr.name,
        ikr.requirement_code,
        ikr.requirement_category,
        ikr.requirement_type,
        ikr.applicable_business_types,
        ikr.document_type,
        ikr.description,
        ikr.instructions,
        ikr.allowed_extensions,
        ikr.max_file_size_mb,
        ikr.max_pdf_pages,
        ikr.document_sides,
        ikr.is_mandatory,
        ikr.sample_document_url,
        ikr.sample_document_urls,
        ikr.display_order,
        g.name AS service_name
      FROM institution_kyc_requirements ikr
      LEFT JOIN gateways g ON g.id = ikr.applicable_service_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY ikr.display_order ASC, ikr.id ASC
      `,
      params
    );

    return rows;
  },
};
