import { db } from "../../config/db.js";

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);

function pickDraftValue(data, aliases, existingValue, fallback = null) {
  const clearFields = new Set(Array.isArray(data?.clearFields) ? data.clearFields : []);
  if (aliases.some((key) => clearFields.has(key))) return null;
  for (const key of aliases) {
    if (!hasOwn(data, key)) continue;
    const value = data[key];
    // Empty/NULL in a partial form is treated as "not entered yet", not a delete.
    if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) {
      return existingValue ?? fallback;
    }
    return value;
  }
  return existingValue ?? fallback;
}

function parseJsonValue(value) {
  if (!value) return null;
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return null; }
  }
  return value;
}

function mergeNonEmpty(existingValue, incomingValue) {
  if (incomingValue === undefined || incomingValue === null) return existingValue;
  if (typeof incomingValue === "string" && incomingValue.trim() === "") return existingValue;
  if (Array.isArray(incomingValue)) {
    if (incomingValue.length === 0) return existingValue;
    const oldArray = Array.isArray(existingValue) ? existingValue : [];
    return incomingValue.map((value, index) => mergeNonEmpty(oldArray[index], value));
  }
  if (incomingValue && typeof incomingValue === "object") {
    const oldObject = existingValue && typeof existingValue === "object" && !Array.isArray(existingValue) ? existingValue : {};
    const result = { ...oldObject };
    for (const [key, value] of Object.entries(incomingValue)) {
      result[key] = mergeNonEmpty(oldObject[key], value);
    }
    return result;
  }
  return incomingValue;
}


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

  async updateLastVisitedStep(merchantId, path, connectionOrDb = db) {
    if (!path || typeof path !== "string") return;
    const cleanPath = path.trim().slice(0, 100);
    await connectionOrDb.execute(
      `UPDATE merchants SET last_visited_step = ? WHERE id = ?`,
      [cleanPath, merchantId]
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
    const value = (camel, snake, column, fallback = null) =>
      pickDraftValue(data, [camel, snake].filter(Boolean), existing?.[column], fallback);
    const institutionId = pickDraftValue(data, ["institutionId", "institution_id"], existing?.institution_id, null);
    const branchId = pickDraftValue(data, ["branchId", "branch_id"], existing?.branch_id, null);
    const hasExistingAccount = hasOwn(data, "hasExistingAccount")
      ? (data.hasExistingAccount ? 1 : 0)
      : hasOwn(data, "has_existing_account")
        ? (data.has_existing_account ? 1 : 0)
        : (existing?.has_existing_account ?? 1);
    const applyNewAccount = hasOwn(data, "applyNewAccount")
      ? (data.applyNewAccount ? 1 : 0)
      : hasOwn(data, "apply_new_account")
        ? (data.apply_new_account ? 1 : 0)
        : (existing?.apply_new_account ?? 0);
    const accountOpeningStatus = value("accountOpeningStatus", "account_opening_status", "account_opening_status");
    const formVersionId = pickDraftValue(data, ["formVersionId", "form_version_id"], existing?.form_version_id, null);
    const legalStructureId = pickDraftValue(data, ["legalStructureId", "legal_structure_id"], existing?.legal_structure_id, null);
    const industryCategoryId = pickDraftValue(data, ["industryCategoryId", "industry_category_id"], existing?.industry_category_id, null);
    const values = [
      value("companyName", "company_name", "company_name", ""),
      value("businessType", "business_type", "business_type"),
      legalStructureId,
      value("industry", "industry", "industry"),
      industryCategoryId,
      value("website", "website", "website"),
      value("address", "address", "address"),
      value("city", "city", "city"),
      value("state", "state", "state"),
      value("postalCode", "postal_code", "postal_code"),
      value("country", "country", "country", "Bangladesh"),
      institutionId,
      value("channel", "channel", "channel"),
      formVersionId,
      value("bankName", "bank_name", "bank_name"),
      branchId,
      value("branchName", "branch_name", "branch_name"),
      value("routingNumber", "routing_number", "routing_number"),
      hasExistingAccount,
      applyNewAccount,
      accountOpeningStatus,
    ];

    if (existing) {
      await connectionOrDb.execute(
        `UPDATE merchant_profiles
         SET company_name = ?, business_type = ?, legal_structure_id = ?, industry = ?, industry_category_id = ?, website = ?,
             address = ?, city = ?, state = ?, postal_code = ?, country = ?,
             institution_id = ?, channel = ?, form_version_id = COALESCE(?, form_version_id),
             bank_name = ?, branch_id = ?, branch_name = ?, routing_number = ?,
             has_existing_account = ?, apply_new_account = ?, account_opening_status = ?
         WHERE merchant_id = ?`,
        [...values, merchantId]
      );
    } else {
      await connectionOrDb.execute(
        `INSERT INTO merchant_profiles
         (merchant_id, company_name, business_type, legal_structure_id, industry, industry_category_id, website, address, city, state,
          postal_code, country, institution_id, channel, form_version_id, bank_name, branch_id, branch_name,
          routing_number, has_existing_account, apply_new_account, account_opening_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [merchantId, ...values]
      );
    }
  },

  // --- Contact ---
  async getContact(merchantId, connectionOrDb = db) {
    const [rows] = await connectionOrDb.execute(
      `SELECT *, CAST(dob AS CHAR) as dob_str FROM merchant_contacts WHERE merchant_id = ? LIMIT 1`,
      [merchantId]
    );
    if (!rows[0]) return null;
    const contact = rows[0];
    if (contact.dob_str) {
      contact.dob = contact.dob_str;
    }
    return contact;
  },

  async upsertContact(merchantId, data, connectionOrDb = db) {
    const existing = await this.getContact(merchantId, connectionOrDb);
    const name = data.name !== undefined ? (data.name || "") : (existing?.name || "");
    const nameBn = data.nameBn !== undefined ? (data.nameBn || data.name_bn || null) : (existing?.name_bn || null);
    const phone = data.phone !== undefined ? (data.phone || "") : (existing?.phone || "");
    const emergencyContact = data.emergencyContact !== undefined ? (data.emergencyContact || data.emergency_contact || null) : (existing?.emergency_contact || null);
    const email = data.email !== undefined ? (data.email || "") : (existing?.email || "");
    const secondaryEmail = data.secondaryEmail !== undefined ? (data.secondaryEmail || data.secondary_email || null) : (existing?.secondary_email || null);
    const designation = data.designation !== undefined ? (data.designation || null) : (existing?.designation || null);
    const nidNo = data.nidNo !== undefined ? (data.nidNo || data.nid_no || null) : (existing?.nid_no || null);
    const division = data.division !== undefined ? (data.division || null) : (existing?.division || null);
    const country = data.country !== undefined ? (data.country || "Bangladesh") : (existing?.country || "Bangladesh");
    const cleanDob = data.dob && String(data.dob).trim() !== "" ? String(data.dob).trim().split("T")[0] : null;
    const dob = data.dob !== undefined ? cleanDob : (existing?.dob || null);
    const fatherName = data.fatherName !== undefined ? (data.fatherName || data.father_name || null) : (existing?.father_name || null);
    const motherName = data.motherName !== undefined ? (data.motherName || data.mother_name || null) : (existing?.mother_name || null);
    const cleanGender = data.gender && String(data.gender).trim() !== "" ? String(data.gender).trim() : null;
    const gender = data.gender !== undefined ? cleanGender : (existing?.gender || null);
    const permanentAddress = data.permanentAddress !== undefined ? (data.permanentAddress || data.permanent_address || null) : (existing?.permanent_address || null);
    const presentAddress = data.presentAddress !== undefined ? (data.presentAddress || data.present_address || null) : (existing?.present_address || null);
    const isSameAddress = data.isSameAddress !== undefined ? (data.isSameAddress ? 1 : 0) : (existing?.is_same_address ? 1 : 0);
    const cleanMarital = (data.maritalStatus || data.marital_status) && String(data.maritalStatus || data.marital_status).trim() !== "" ? String(data.maritalStatus || data.marital_status).trim() : null;
    const maritalStatus = (data.maritalStatus !== undefined || data.marital_status !== undefined) ? cleanMarital : (existing?.marital_status || null);
    const spouseName = data.spouseName !== undefined ? (data.spouseName || data.spouse_name || null) : (existing?.spouse_name || null);
    const passportNo = data.passportNo !== undefined ? (data.passportNo || data.passport_no || null) : (existing?.passport_no || null);
    const otherId = data.otherId !== undefined ? (data.otherId || data.other_id || null) : (existing?.other_id || null);
    const nomineeName = data.nomineeName !== undefined ? (data.nomineeName || data.nominee_name || null) : (existing?.nominee_name || null);
    const nomineeRelation = data.nomineeRelation !== undefined ? (data.nomineeRelation || data.nominee_relation || null) : (existing?.nominee_relation || null);
    const nomineeMobile = data.nomineeMobile !== undefined ? (data.nomineeMobile || data.nominee_mobile || null) : (existing?.nominee_mobile || null);
    const nomineeNid = data.nomineeNid !== undefined ? (data.nomineeNid || data.nominee_nid || null) : (existing?.nominee_nid || null);

    if (existing) {
      await connectionOrDb.execute(
        `UPDATE merchant_contacts
         SET name = ?, name_bn = ?, phone = ?, emergency_contact = ?, email = ?, secondary_email = ?, designation = ?,
             nid_no = ?, division = ?, country = ?, dob = ?, father_name = ?,
             mother_name = ?, gender = ?, permanent_address = ?, present_address = ?,
             is_same_address = ?, marital_status = ?, spouse_name = ?, passport_no = ?,
             other_id = ?, nominee_name = ?, nominee_relation = ?, nominee_mobile = ?,
             nominee_nid = ?
         WHERE merchant_id = ?`,
        [
          name, nameBn, phone, emergencyContact, email, secondaryEmail, designation,
          nidNo, division, country, dob, fatherName,
          motherName, gender, permanentAddress, presentAddress,
          isSameAddress, maritalStatus, spouseName, passportNo,
          otherId, nomineeName, nomineeRelation, nomineeMobile,
          nomineeNid, merchantId
        ]
      );
    } else {
      await connectionOrDb.execute(
        `INSERT INTO merchant_contacts (
           merchant_id, name, name_bn, phone, emergency_contact, email, secondary_email, designation,
           nid_no, division, country, dob, father_name,
           mother_name, gender, permanent_address, present_address,
           is_same_address, marital_status, spouse_name, passport_no,
           other_id, nominee_name, nominee_relation, nominee_mobile,
           nominee_nid
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          merchantId, name, nameBn, phone, emergencyContact, email, secondaryEmail, designation,
          nidNo, division, country, dob, fatherName,
          motherName, gender, permanentAddress, presentAddress,
          isSameAddress, maritalStatus, spouseName, passportNo,
          otherId, nomineeName, nomineeRelation, nomineeMobile,
          nomineeNid
        ]
      );
    }
  },

  // --- Commercial ---
  async getCommercial(merchantId, connectionOrDb = db) {
    const [rows] = await connectionOrDb.execute(
      `SELECT * FROM merchant_commercial_details WHERE merchant_id = ? LIMIT 1`,
      [merchantId]
    );
    return rows[0] || null;
  },

  async upsertCommercial(merchantId, data, connectionOrDb = db) {
    const existing = await this.getCommercial(merchantId, connectionOrDb);
    const numberValue = (camel, snake, column) => {
      const raw = pickDraftValue(data, [camel, snake], existing?.[column], 0);
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? parsed : (existing?.[column] ?? 0);
    };
    const textValue = (camel, snake, column) =>
      pickDraftValue(data, [camel, snake], existing?.[column], null);
    const values = [
      numberValue("transactionsPerDay", "transactions_per_day", "transactions_per_day"),
      numberValue("transactionsPerMonth", "transactions_per_month", "transactions_per_month"),
      numberValue("volumePerDay", "volume_per_day", "volume_per_day"),
      numberValue("volumePerMonth", "volume_per_month", "volume_per_month"),
      numberValue("maximumTicketSize", "maximum_ticket_size", "maximum_ticket_size"),
      textValue("returnUrl", "return_url", "return_url"),
      textValue("merchantDomain", "merchant_domain", "merchant_domain"),
      textValue("merchantIpAddress", "merchant_ip_address", "merchant_ip_address"),
    ];

    if (existing) {
      await connectionOrDb.execute(
        `UPDATE merchant_commercial_details
         SET transactions_per_day = ?, transactions_per_month = ?, volume_per_day = ?,
             volume_per_month = ?, maximum_ticket_size = ?, return_url = ?,
             merchant_domain = ?, merchant_ip_address = ?
         WHERE merchant_id = ?`,
        [...values, merchantId]
      );
    } else {
      await connectionOrDb.execute(
        `INSERT INTO merchant_commercial_details
         (merchant_id, transactions_per_day, transactions_per_month, volume_per_day, volume_per_month,
          maximum_ticket_size, return_url, merchant_domain, merchant_ip_address)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [merchantId, ...values]
      );
    }
  },

  // --- KYC ---
  async getKyc(merchantId, connectionOrDb = db) {
    const [rows] = await connectionOrDb.execute(
      `SELECT * FROM merchant_kyc WHERE merchant_id = ? LIMIT 1`,
      [merchantId]
    );
    return rows[0] || null;
  },

  async upsertKyc(merchantId, data, connectionOrDb = db) {
    const existing = await this.getKyc(merchantId, connectionOrDb);
    const value = (camel, snake, column, fallback = null) =>
      pickDraftValue(data, [camel, snake].filter(Boolean), existing?.[column], fallback);
    const oldForm = parseJsonValue(existing?.kyc_form_data);
    const incomingForm = data.kycFormData && typeof data.kycFormData === "object" ? data.kycFormData : null;
    const clearForm = Array.isArray(data.clearFields) && data.clearFields.includes("kycFormData");
    const mergedForm = clearForm ? null : (incomingForm ? mergeNonEmpty(oldForm || {}, incomingForm) : oldForm);
    const kycFormData = mergedForm ? JSON.stringify(mergedForm) : null;

    const legalStructureId = pickDraftValue(data, ["legalStructureId", "legal_structure_id"], existing?.legal_structure_id, null);

    const values = [
      value("legalBusinessName", "legal_business_name", "legal_business_name"),
      value("businessEntityType", "business_entity_type", "business_entity_type"),
      legalStructureId,
      value("tradeLicenseNumber", "trade_license_number", "trade_license_number"),
      value("registrationNumber", "registration_number", "registration_number"),
      value("tin", "tin_number", "tin"),
      value("bin", "bin_number", "bin"),
      value("authorizedPersonName", "authorized_person_name", "authorized_person_name"),
      value("designation", "designation", "designation"),
      value("nidNumber", "nid_number", "nid_number"),
      value("nidIssueDate", "nid_issue_date", "nid_issue_date"),
      value("nidExpiryDate", "nid_expiry_date", "nid_expiry_date"),
      value("institutionId", "institution_id", "institution_id"),
      value("branchId", "branch_id", "branch_id"),
      value("bankName", "bank_name", "bank_name"),
      value("branchName", "branch_name", "branch_name"),
      value("branchCode", "branch_code", "branch_code"),
      value("division", "division", "division"),
      value("district", "district", "district"),
      value("upazila", "upazila", "upazila"),
      value("branchAddress", "branch_address", "branch_address"),
      value("accountHolderName", "bank_account_name", "bank_account_name"),
      value("accountNumber", "bank_account_number", "bank_account_number"),
      value("routingNumber", "routing_number", "routing_number"),
      value("accountType", "account_type", "account_type", "Current"),
      kycFormData,
    ];

    if (existing) {
      await connectionOrDb.execute(
        `UPDATE merchant_kyc
         SET legal_business_name = ?, business_entity_type = ?, legal_structure_id = ?, trade_license_number = ?,
             registration_number = ?, tin = ?, bin = ?, authorized_person_name = ?,
             designation = ?, nid_number = ?, nid_issue_date = ?, nid_expiry_date = ?,
             institution_id = ?, branch_id = ?, bank_name = ?, branch_name = ?,
             branch_code = ?, division = ?, district = ?, upazila = ?, branch_address = ?,
             bank_account_name = ?, bank_account_number = ?, routing_number = ?, account_type = ?,
             kyc_form_data = ?
         WHERE merchant_id = ?`,
        [...values, merchantId]
      );
    } else {
      await connectionOrDb.execute(
        `INSERT INTO merchant_kyc
         (merchant_id, legal_business_name, business_entity_type, legal_structure_id, trade_license_number,
          registration_number, tin, bin, authorized_person_name, designation, nid_number,
          nid_issue_date, nid_expiry_date, institution_id, branch_id, bank_name, branch_name,
          branch_code, division, district, upazila, branch_address, bank_account_name,
          bank_account_number, routing_number, account_type, kyc_form_data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [merchantId, ...values]
      );
    }
  },

  // --- Documents ---
  async getDocuments(merchantId, connectionOrDb = db) {
    const [rows] = await connectionOrDb.execute(
      `SELECT id, document_type, document_name, custom_label, original_filename, stored_filename,
              storage_key, previous_storage_key, previous_filename, mime_type, file_size, status, review_comment, review_note,
              uploaded_at, reviewed_at, created_at, updated_at
       FROM merchant_documents
       WHERE merchant_id = ?
       ORDER BY created_at ASC`,
      [merchantId]
    );
    return rows;
  },

  async getDocumentById(docId, merchantId, connectionOrDb = db) {
    const [rows] = await connectionOrDb.execute(
      `SELECT * FROM merchant_documents WHERE id = ? AND merchant_id = ? LIMIT 1`,
      [docId, merchantId]
    );
    return rows[0] || null;
  },

  async getDocumentByType(merchantId, documentType, connectionOrDb = db) {
    const [rows] = await connectionOrDb.execute(
      `SELECT * FROM merchant_documents WHERE merchant_id = ? AND document_type = ? LIMIT 1`,
      [merchantId, documentType]
    );
    return rows[0] || null;
  },

  async createDocument(merchantId, { documentType, documentName, customLabel, originalFilename, storedFilename, storageKey, mimeType, fileSize }, connectionOrDb = db) {
    // If a document of this type already exists, replace it to maintain clean 1:1 records for core types
    const singleDocTypes = [
      "NID_FRONT",
      "NID_BACK",
      "MERCHANT_SIGNATURE",
      "MERCHANT_NID_SIGNATURE",
      "PASSPORT_PHOTO",
      "UTILITY_BILL",
      "NOMINEE_PHOTO",
      "NOMINEE_PASSPORT_PHOTO",
      "NOMINEE_NID",
      "NOMINEE_UTILITY_BILL",
      "NOMINEE_SIGNATURE",
      "NOMINEE_NID_SIGNATURE",
      "TIN_CERTIFICATE",
      "BIN_CERTIFICATE",
      "BANK_STATEMENT",
      "CANCELLED_BANK_CHEQUE",
      "TRADE_LICENSE",
      "BUSINESS_OUTLET_PHOTO"
    ];
    const existing = await this.getDocumentByType(merchantId, documentType, connectionOrDb);
    if (existing && singleDocTypes.includes(documentType)) {
      return await this.replaceDocument(existing.id, merchantId, {
        documentName,
        customLabel,
        originalFilename,
        storedFilename,
        storageKey,
        mimeType,
        fileSize,
      }, connectionOrDb);
    }

    const [result] = await connectionOrDb.execute(
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

    const [rows] = await connectionOrDb.execute(
      `SELECT id, document_type, document_name, custom_label, original_filename, storage_key, mime_type, file_size, status, review_comment, uploaded_at, created_at
       FROM merchant_documents WHERE id = ? LIMIT 1`,
      [result.insertId]
    );
    return rows[0];
  },

  async replaceDocument(docId, merchantId, { documentName, customLabel, originalFilename, storedFilename, storageKey, mimeType, fileSize }, connectionOrDb = db) {
    // Preserve old file info as previous_storage_key and previous_filename
    const [currentRows] = await connectionOrDb.execute(
      `SELECT storage_key, original_filename FROM merchant_documents WHERE id = ? AND merchant_id = ? LIMIT 1`,
      [docId, merchantId]
    );
    const prevKey = currentRows[0]?.storage_key || null;
    const prevFile = currentRows[0]?.original_filename || null;

    await connectionOrDb.execute(
      `UPDATE merchant_documents
       SET document_name = ?, custom_label = ?, original_filename = ?, stored_filename = ?,
           storage_key = ?, previous_storage_key = COALESCE(?, previous_storage_key),
           previous_filename = COALESCE(?, previous_filename),
           mime_type = ?, file_size = ?, status = 'Uploaded', uploaded_at = NOW()
       WHERE id = ? AND merchant_id = ?`,
      [
        documentName,
        customLabel || documentName,
        originalFilename || documentName,
        storedFilename || null,
        storageKey,
        prevKey,
        prevFile,
        mimeType,
        fileSize,
        docId,
        merchantId,
      ]
    );

    const [rows] = await connectionOrDb.execute(
      `SELECT id, document_type, document_name, custom_label, original_filename, previous_filename, storage_key, previous_storage_key, mime_type, file_size, status, review_comment, uploaded_at, created_at
       FROM merchant_documents WHERE id = ? AND merchant_id = ? LIMIT 1`,
      [docId, merchantId]
    );
    return rows[0];
  },

  async deleteDocument(docId, merchantId, connectionOrDb = db) {
    await connectionOrDb.execute(
      `DELETE FROM merchant_documents WHERE id = ? AND merchant_id = ?`,
      [docId, merchantId]
    );
  },

  // --- Onboarding History & Audit ---
  async createHistory(merchantId, step, action, previousStatus, newStatus, metadata = null, connectionOrDb = db) {
    await connectionOrDb.execute(
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

  // --- User status & contact verification ---
  async getUserVerification(userId, connectionOrDb = db) {
    const [userRows] = await connectionOrDb.execute(
      `SELECT id, email, phone, email_verified_at, phone_verified_at, status FROM users WHERE id = ? LIMIT 1`,
      [userId]
    );
    if (!userRows.length) return null;
    const u = userRows[0];

    // Check merchant contact-specific verification
    const [contactRows] = await connectionOrDb.execute(
      `SELECT mc.email_verified_at, mc.phone_verified_at 
       FROM merchants m 
       JOIN merchant_contacts mc ON mc.merchant_id = m.id 
       WHERE m.user_id = ? LIMIT 1`,
      [userId]
    );

    const contact = contactRows[0];
    const isContactPhoneVerified = Boolean(contact && contact.phone_verified_at);
    const isContactEmailVerified = Boolean(contact && contact.email_verified_at);

    return {
      email: u.email,
      phone: u.phone,
      emailVerified: isContactEmailVerified || Boolean(u.email_verified_at),
      phoneVerified: isContactPhoneVerified,
      status: u.status,
    };
  },

  // --- Notification ---
  async createAdminNotification(title, message, type = "system", link = "/admin/kyc", connectionOrDb = db) {
    await connectionOrDb.execute(
      `INSERT INTO notifications (recipient_type, recipient_id, title, message, type, link, is_read, created_at)
       VALUES ('admin', NULL, ?, ?, ?, ?, 0, NOW())`,
      [title, message, type, link]
    );
  },

  // --- Banking Institution KYC Requirements (strictly stripped of admin_notes) ---
  async getInstitutionKycRequirements(institutionId, serviceId = null, businessType = null) {
    if (!institutionId || isNaN(Number(institutionId))) {
      return [];
    }

    // 1. Fetch institution record to determine type and active status
    const [instRows] = await db.query(
      "SELECT id, name, institution_code, institution_type, status FROM institutions WHERE id = ? LIMIT 1",
      [Number(institutionId)]
    );

    if (instRows.length === 0) {
      const err = new Error("Institution not found.");
      err.statusCode = 404;
      throw err;
    }

    const institution = instRows[0];
    if (institution.status !== "active") {
      const err = new Error(`Institution '${institution.name}' is currently inactive or not permitted for onboarding.`);
      err.statusCode = 400;
      throw err;
    }

    const conditions = ["ikr.institution_id = ?", "ikr.status = 'active'"];
    const params = [Number(institutionId)];

    if (serviceId && !isNaN(Number(serviceId)) && Number(serviceId) > 0) {
      conditions.push("(ikr.applicable_service_id = ? OR ikr.applicable_service_id IS NULL)");
      params.push(Number(serviceId));
    }

    // STRICT PRIVACY: Note that admin_notes and review_instructions are NOT selected!
    const [customRows] = await db.query(
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

    // 2. Fetch Global, Channel-Level, and Institution-Specific Requirements directly from DB
    const isMFS = institution.institution_type === "mfs";
    const channelName = isMFS ? "mfs" : "bank";
    const [dbRequirements] = await db.query(
      `
      SELECT
        ikr.id,
        ikr.institution_id,
        ikr.applicable_service_id,
        ikr.scope,
        ikr.channel_type,
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
      WHERE ikr.status = 'active'
        AND (
          ikr.scope = 'global'
          OR (ikr.scope = 'channel' AND (ikr.channel_type = ? OR ikr.channel_type = 'all'))
          OR (ikr.scope = 'institution' AND ikr.institution_id = ?)
        )
      ORDER BY ikr.display_order ASC, ikr.id ASC
      `,
      [channelName, Number(institutionId)]
    );

    // 3. Deterministic Precedence Merge: Global -> Channel -> Institution Custom (Institution overrides by requirement_code)
    const globals = [];
    const channels = [];
    const institutionCustom = [];

    for (const r of dbRequirements) {
      if (r.scope === "global") globals.push(r);
      else if (r.scope === "channel") channels.push(r);
      else institutionCustom.push(r);
    }

    const customCodeMap = new Map();
    for (const r of institutionCustom) {
      customCodeMap.set(r.requirement_code.toUpperCase(), r);
    }

    const channelCodeMap = new Map();
    for (const r of channels) {
      channelCodeMap.set(r.requirement_code.toUpperCase(), r);
    }

    const mergedList = [];
    const processedCodes = new Set();

    // 1st Layer: Global rules (can be overridden by institution custom)
    for (const g of globals) {
      const code = g.requirement_code.toUpperCase();
      if (customCodeMap.has(code)) {
        mergedList.push(customCodeMap.get(code));
      } else {
        mergedList.push(g);
      }
      processedCodes.add(code);
    }

    // 2nd Layer: Channel rules (can be overridden by institution custom)
    for (const c of channels) {
      const code = c.requirement_code.toUpperCase();
      if (!processedCodes.has(code)) {
        if (customCodeMap.has(code)) {
          mergedList.push(customCodeMap.get(code));
        } else {
          mergedList.push(c);
        }
        processedCodes.add(code);
      }
    }

    // 3rd Layer: Institution-specific additional requirements
    for (const instR of institutionCustom) {
      const code = instR.requirement_code.toUpperCase();
      if (!processedCodes.has(code)) {
        mergedList.push(instR);
        processedCodes.add(code);
      }
    }

    // 4. Filter by businessType if provided (e.g. 'micro_merchant' vs 'big_merchant')
    let filteredList = mergedList;
    if (businessType) {
      const normalizedBt = businessType.toLowerCase();
      const isMicro = normalizedBt.includes("micro") || normalizedBt.includes("sole") || normalizedBt.includes("pra") || normalizedBt.includes("proprietor");

      filteredList = mergedList.map((item) => {
        const appBt = String(item.applicable_business_types || "").toLowerCase();
        const code = String(item.requirement_code || "").toUpperCase();
        let mandatory = Boolean(item.is_mandatory);

        if (isMicro && (code === "TIN_CERTIFICATE" || code === "BIN_CERTIFICATE" || code === "CANCELLED_BANK_CHEQUE")) {
          mandatory = false;
        } else if (isMicro && appBt === "big_merchant") {
          mandatory = false;
        } else if (!isMicro && appBt === "micro_merchant") {
          mandatory = false;
        }

        return {
          ...item,
          is_mandatory: mandatory ? 1 : 0,
        };
      });
    }

    // Sort by display order
    filteredList.sort((a, b) => (Number(a.display_order) || 0) - (Number(b.display_order) || 0));

    return filteredList;
  },
};
