import { merchantRepository } from "./merchant.repository.js";
import { secureStorage } from "../../config/storage.js";
import { isDevVerificationBypass } from "../../config/env.js";
import { db } from "../../config/db.js";
import { adminInstitutionsRepository } from "../admin/institutions/admin.institutions.repository.js";
import argon2 from "argon2";
import crypto from "crypto";

const REQUIRED_DOC_TYPES = [
  "NID_FRONT",
  "NID_BACK",
  "TIN_CERTIFICATE",
  "CANCELLED_BANK_CHEQUE",
];

function normalizeDocType(type) {
  if (!type) return "";
  const upper = String(type).toUpperCase();
  if (upper === "NID_FRONT" || upper === "NID-FRONT") return "NID_FRONT";
  if (upper === "NID_BACK" || upper === "NID-BACK") return "NID_BACK";
  if (upper === "TIN_CERTIFICATE" || upper === "TIN" || upper === "TIN_CERT") return "TIN_CERTIFICATE";
  if (upper === "BIN_CERTIFICATE" || upper === "BIN" || upper === "BIN_CERT") return "BIN_CERTIFICATE";
  if (upper === "CANCELLED_BANK_CHEQUE" || upper === "BANK_CHEQUE" || upper === "CHEQUE") return "CANCELLED_BANK_CHEQUE";
  if (upper === "TRADE_LICENSE" || upper === "TRADE") return "TRADE_LICENSE";
  if (upper === "COMPANY_REGISTRATION" || upper === "RJSC_INCORPORATION") return "COMPANY_REGISTRATION";
  return upper;
}

function calculateProgress(profile, contact, commercial, kyc, documents, verification) {
  const uploadedDocTypes = (documents || []).map((d) => normalizeDocType(d.document_type || d.documentType));
  
  const hasNidFront = uploadedDocTypes.includes("NID_FRONT");
  const hasNidBack = uploadedDocTypes.includes("NID_BACK");
  const hasTin = uploadedDocTypes.includes("TIN_CERTIFICATE");
  const hasCheque = uploadedDocTypes.includes("CANCELLED_BANK_CHEQUE");

  const requiredDocsComplete = hasNidFront && hasNidBack && hasTin && hasCheque;

  const kycComplete = Boolean(
    (kyc?.legal_business_name || kyc?.legalBusinessName) &&
    (kyc?.business_entity_type || kyc?.businessEntityType) &&
    (kyc?.trade_license_number || kyc?.tradeLicenseNumber) &&
    (kyc?.tin || kyc?.tinNumber) &&
    (kyc?.authorized_person_name || kyc?.authorizedPersonName) &&
    (kyc?.nid_number || kyc?.nidNumber) &&
    (kyc?.bank_name || kyc?.bankName) &&
    (kyc?.bank_account_number || kyc?.accountNumber)
  );

  const devBypassActive = isDevVerificationBypass();

  const steps = {
    company: Boolean(profile?.company_name || profile?.companyName),
    contact: Boolean(
      (contact?.name) &&
      (contact?.email) &&
      (contact?.phone)
    ),
    commercial: Boolean(
      commercial?.transactions_per_day !== undefined || commercial?.transactionsPerDay !== undefined
    ),
    kyc: kycComplete,
    documents: requiredDocsComplete,
    verification: Boolean((verification?.emailVerified && verification?.phoneVerified) || devBypassActive),
  };

  const completedCount = Object.values(steps).filter(Boolean).length;
  const totalCount = 6;
  const percentage = Math.round((completedCount / totalCount) * 100);

  const docChecklist = {
    nidFront: hasNidFront,
    nidBack: hasNidBack,
    tinCertificate: hasTin,
    cancelledBankCheque: hasCheque,
    binCertificate: uploadedDocTypes.includes("BIN_CERTIFICATE"),
    tradeLicense: uploadedDocTypes.includes("TRADE_LICENSE"),
    companyRegistration: uploadedDocTypes.includes("COMPANY_REGISTRATION"),
    requiredCount: [hasNidFront, hasNidBack, hasTin, hasCheque].filter(Boolean).length,
    totalRequired: 4,
    isComplete: requiredDocsComplete,
  };

  return { steps, percentage, canSubmit: completedCount === totalCount, docChecklist };
}

export const merchantService = {
  async getOrCreateMerchant(userId) {
    return await merchantRepository.findOrCreateMerchantByUserId(userId);
  },

  async getMerchantMe(userId) {
    const merchant = await merchantRepository.findOrCreateMerchantByUserId(userId);
    const [profile, contact, commercial, kyc, documents, verification, fieldIssues] = await Promise.all([
      merchantRepository.getProfile(merchant.id),
      merchantRepository.getContact(merchant.id),
      merchantRepository.getCommercial(merchant.id),
      merchantRepository.getKyc(merchant.id),
      merchantRepository.getDocuments(merchant.id),
      merchantRepository.getUserVerification(userId),
      db.query(
        `SELECT kfi.*, i.name AS institution_name, ib.branch_name
         FROM kyc_field_issues kfi
         LEFT JOIN institutions i ON i.id = kfi.institution_id
         LEFT JOIN merchant_gateway_applications mga ON mga.merchant_id = kfi.merchant_id AND mga.institution_id = kfi.institution_id
         LEFT JOIN institution_branches ib ON ib.id = mga.branch_id
         WHERE kfi.merchant_id = ?
         ORDER BY kfi.created_at DESC`,
        [merchant.id]
      ).then(([rows]) => rows).catch(() => []),
    ]);

    const openIssues = (fieldIssues || []).filter((i) => i.status === "open");

    const { steps, percentage, canSubmit, docChecklist } = calculateProgress(
      profile,
      contact,
      commercial,
      kyc,
      documents,
      verification
    );

    return {
      merchant: {
        id: merchant.id,
        merchantCode: merchant.merchant_code,
        accountStatus: merchant.account_status,
        kycStatus: merchant.kyc_status,
        onboardingStep: merchant.onboarding_step,
        submittedAt: merchant.submitted_at,
        approvedAt: merchant.approved_at,
        rejectedAt: merchant.rejected_at,
        rejectionReason: merchant.rejection_reason,
        adminComments: merchant.admin_comments,
        createdAt: merchant.created_at,
      },
      profile: profile
        ? {
            companyName: profile.company_name,
            businessType: profile.business_type || "",
            industry: profile.industry || "",
            website: profile.website || "",
            address: profile.address || "",
            city: profile.city || "",
            state: profile.state || "",
            postalCode: profile.postal_code || "",
            country: profile.country || "Bangladesh",
          }
        : null,
      contact: contact
        ? {
            name: contact.name,
            phone: contact.phone,
            email: contact.email,
            designation: contact.designation || "",
          }
        : null,
      commercial: commercial
        ? {
            transactionsPerDay: commercial.transactions_per_day || 0,
            transactionsPerMonth: commercial.transactions_per_month || 0,
            volumePerDay: Number(commercial.volume_per_day) || 0,
            volumePerMonth: Number(commercial.volume_per_month) || 0,
            maximumTicketSize: Number(commercial.maximum_ticket_size) || 0,
            returnUrl: commercial.return_url || "",
            merchantDomain: commercial.merchant_domain || "",
            merchantIpAddress: commercial.merchant_ip_address || "",
          }
        : null,
      kyc: kyc
        ? {
            legalBusinessName: kyc.legal_business_name || "",
            businessEntityType: kyc.business_entity_type || "",
            tradeLicenseNumber: kyc.trade_license_number || "",
            registrationNumber: kyc.registration_number || "",
            tin: kyc.tin || "",
            bin: kyc.bin || "",
            authorizedPersonName: kyc.authorized_person_name || "",
            designation: kyc.designation || "",
            nidNumber: kyc.nid_number || "",
            nidIssueDate: kyc.nid_issue_date ? kyc.nid_issue_date.toString().split("T")[0] : "",
            nidExpiryDate: kyc.nid_expiry_date ? kyc.nid_expiry_date.toString().split("T")[0] : "",
            institutionId: kyc.institution_id || null,
            branchId: kyc.branch_id || null,
            bankName: kyc.bank_name || "",
            branchName: kyc.branch_name || "",
            branchCode: kyc.branch_code || "",
            division: kyc.division || "",
            district: kyc.district || "",
            upazila: kyc.upazila || "",
            branchAddress: kyc.branch_address || "",
            accountHolderName: kyc.bank_account_name || "",
            accountNumber: kyc.bank_account_number || "",
            routingNumber: kyc.routing_number || "",
            accountType: kyc.account_type || "Current",
          }
        : null,
      documents: documents.map((doc) => ({
        id: doc.id,
        documentType: normalizeDocType(doc.document_type),
        documentName: doc.document_name,
        customLabel: doc.custom_label || doc.document_name,
        originalFilename: doc.original_filename || doc.document_name,
        mimeType: doc.mime_type,
        fileSize: doc.file_size,
        status: doc.status,
        reviewComment: doc.review_comment || doc.review_note,
        uploadedAt: doc.uploaded_at,
      })),
      verification: verification || {
        email: "",
        phone: "",
        emailVerified: false,
        phoneVerified: false,
      },
      onboarding: {
        steps,
        percentage,
        canSubmit,
        docChecklist,
        currentStep: merchant.onboarding_step,
        accountStatus: merchant.account_status,
        kycStatus: merchant.kyc_status,
        openKycIssuesCount: openIssues.length,
      },
      kycFieldIssues: (fieldIssues || []).map((fi) => ({
        id: fi.id,
        kycId: fi.kyc_id,
        institutionId: fi.institution_id,
        institutionName: fi.institution_name,
        branchName: fi.branch_name,
        fieldKey: fi.field_key,
        issueType: fi.issue_type,
        issueReason: fi.issue_reason,
        status: fi.status,
        resolutionNote: fi.resolution_note,
        createdAt: fi.created_at,
        updatedAt: fi.updated_at,
      })),
      isApproved: merchant.account_status === "approved" || merchant.account_status === "active",
    };
  },

  async updateCompany(userId, data) {
    const merchant = await merchantRepository.findOrCreateMerchantByUserId(userId);
    await merchantRepository.upsertProfile(merchant.id, data);
    await merchantRepository.updateMerchantStep(merchant.id, 2);
    await merchantRepository.createHistory(
      merchant.id,
      "company",
      "update_company",
      merchant.account_status,
      merchant.account_status,
      { companyName: data.companyName }
    );
    return await merchantRepository.getProfile(merchant.id);
  },

  async updateContact(userId, data) {
    const merchant = await merchantRepository.findOrCreateMerchantByUserId(userId);
    await merchantRepository.upsertContact(merchant.id, data);
    await merchantRepository.updateMerchantStep(merchant.id, 3);
    await merchantRepository.createHistory(
      merchant.id,
      "contact",
      "update_contact",
      merchant.account_status,
      merchant.account_status,
      { contactName: data.name, email: data.email }
    );
    return await merchantRepository.getContact(merchant.id);
  },

  async updateCommercial(userId, data) {
    const merchant = await merchantRepository.findOrCreateMerchantByUserId(userId);
    await merchantRepository.upsertCommercial(merchant.id, data);
    await merchantRepository.updateMerchantStep(merchant.id, 4);
    await merchantRepository.createHistory(
      merchant.id,
      "commercial",
      "update_commercial",
      merchant.account_status,
      merchant.account_status
    );
    return await merchantRepository.getCommercial(merchant.id);
  },

  async getKyc(userId) {
    const merchant = await merchantRepository.findOrCreateMerchantByUserId(userId);
    const kyc = await merchantRepository.getKyc(merchant.id);
    if (!kyc) return {};
    return {
      legalBusinessName: kyc.legal_business_name || "",
      businessEntityType: kyc.business_entity_type || "",
      tradeLicenseNumber: kyc.trade_license_number || "",
      registrationNumber: kyc.registration_number || "",
      tin: kyc.tin || "",
      bin: kyc.bin || "",
      authorizedPersonName: kyc.authorized_person_name || "",
      designation: kyc.designation || "",
      nidNumber: kyc.nid_number || "",
      nidIssueDate: kyc.nid_issue_date ? kyc.nid_issue_date.toString().split("T")[0] : "",
      nidExpiryDate: kyc.nid_expiry_date ? kyc.nid_expiry_date.toString().split("T")[0] : "",
      institutionId: kyc.institution_id || null,
      branchId: kyc.branch_id || null,
      bankName: kyc.bank_name || "",
      branchName: kyc.branch_name || "",
      branchCode: kyc.branch_code || "",
      division: kyc.division || "",
      district: kyc.district || "",
      upazila: kyc.upazila || "",
      branchAddress: kyc.branch_address || "",
      accountHolderName: kyc.bank_account_name || "",
      accountNumber: kyc.bank_account_number || "",
      routingNumber: kyc.routing_number || "",
      accountType: kyc.account_type || "Current",
    };
  },

  async updateKyc(userId, data) {
    const merchant = await merchantRepository.findOrCreateMerchantByUserId(userId);

    const payload = { ...data };

    // If branchId is supplied, auto-sync verified branch data from database
    if (payload.branchId) {
      const [branches] = await db.query(
        "SELECT * FROM institution_branches WHERE id = ? AND status = 'active' AND is_archived = 0 LIMIT 1",
        [payload.branchId]
      );
      if (branches.length > 0) {
        const branch = branches[0];
        payload.branchName = branch.branch_name;
        payload.branchCode = branch.branch_code;
        payload.routingNumber = branch.routing_number || payload.routingNumber;
        payload.division = branch.division;
        payload.district = branch.district;
        payload.upazila = branch.upazila;
        payload.branchAddress = branch.address;
        payload.institutionId = branch.institution_id;
      }
    }

    if (payload.institutionId && !payload.bankName) {
      const [insts] = await db.query("SELECT name FROM institutions WHERE id = ? LIMIT 1", [payload.institutionId]);
      if (insts.length > 0) {
        payload.bankName = insts[0].name;
      }
    }

    await merchantRepository.upsertKyc(merchant.id, payload);
    await merchantRepository.updateMerchantStep(merchant.id, 5);
    await merchantRepository.createHistory(
      merchant.id,
      "kyc",
      "update_kyc",
      merchant.account_status,
      merchant.account_status
    );
    return await this.getKyc(userId);
  },

  async getDocuments(userId) {
    const merchant = await merchantRepository.findOrCreateMerchantByUserId(userId);
    const docs = await merchantRepository.getDocuments(merchant.id);
    return docs.map((doc) => ({
      id: doc.id,
      documentType: normalizeDocType(doc.document_type),
      documentName: doc.document_name,
      customLabel: doc.custom_label || doc.document_name,
      originalFilename: doc.original_filename || doc.document_name,
      mimeType: doc.mime_type,
      fileSize: doc.file_size,
      status: doc.status,
      reviewComment: doc.review_comment || doc.review_note,
      uploadedAt: doc.uploaded_at,
    }));
  },

  async uploadDocument(userId, file, { documentType, documentName, customLabel }) {
    if (!file) {
      const error = new Error("No file selected for upload");
      error.statusCode = 400;
      throw error;
    }

    const merchant = await merchantRepository.findOrCreateMerchantByUserId(userId);
    const normalizedType = normalizeDocType(documentType);
    const safeDocName = documentName || customLabel || file.originalname || normalizedType;

    const { storageKey, size, mimeType } = await secureStorage.saveFile(file, merchant.id);

    const doc = await merchantRepository.createDocument(merchant.id, {
      documentType: normalizedType,
      documentName: safeDocName,
      customLabel: customLabel || safeDocName,
      originalFilename: file.originalname,
      storedFilename: storageKey.split("/").pop(),
      storageKey,
      mimeType,
      fileSize: size,
    });

    await merchantRepository.updateMerchantStep(merchant.id, 6);
    await merchantRepository.createHistory(
      merchant.id,
      "documents",
      "upload_document",
      merchant.account_status,
      merchant.account_status,
      { documentId: doc.id, documentType: normalizedType }
    );

    return {
      ...doc,
      documentType: normalizeDocType(doc.document_type),
    };
  },

  async replaceDocument(userId, docId, file, { documentName, customLabel }) {
    if (!file) {
      const error = new Error("No replacement file uploaded");
      error.statusCode = 400;
      throw error;
    }

    const merchant = await merchantRepository.findOrCreateMerchantByUserId(userId);
    const existingDoc = await merchantRepository.getDocumentById(docId, merchant.id);

    if (!existingDoc) {
      const error = new Error("Document not found or unauthorized");
      error.statusCode = 404;
      throw error;
    }

    // Delete old file
    await secureStorage.deleteFile(existingDoc.storage_key, merchant.id);

    // Save new file
    const { storageKey, size, mimeType } = await secureStorage.saveFile(file, merchant.id);
    const safeDocName = documentName || customLabel || file.originalname || existingDoc.document_name;

    const updatedDoc = await merchantRepository.replaceDocument(docId, merchant.id, {
      documentName: safeDocName,
      customLabel: customLabel || existingDoc.custom_label || safeDocName,
      originalFilename: file.originalname,
      storedFilename: storageKey.split("/").pop(),
      storageKey,
      mimeType,
      fileSize: size,
    });

    await merchantRepository.createHistory(
      merchant.id,
      "documents",
      "replace_document",
      merchant.account_status,
      merchant.account_status,
      { documentId: docId }
    );

    return {
      ...updatedDoc,
      documentType: normalizeDocType(updatedDoc.document_type),
    };
  },

  async deleteDocument(userId, docId) {
    const merchant = await merchantRepository.findOrCreateMerchantByUserId(userId);
    const existingDoc = await merchantRepository.getDocumentById(docId, merchant.id);

    if (!existingDoc) {
      const error = new Error("Document not found or unauthorized");
      error.statusCode = 404;
      throw error;
    }

    await secureStorage.deleteFile(existingDoc.storage_key, merchant.id);
    await merchantRepository.deleteDocument(docId, merchant.id);

    await merchantRepository.createHistory(
      merchant.id,
      "documents",
      "delete_document",
      merchant.account_status,
      merchant.account_status,
      { documentId: docId, documentType: existingDoc.document_type }
    );

    return { success: true, message: "Document deleted successfully" };
  },

  async getDocumentFile(userId, docId) {
    const merchant = await merchantRepository.findOrCreateMerchantByUserId(userId);
    const doc = await merchantRepository.getDocumentById(docId, merchant.id);

    if (!doc) {
      const error = new Error("Document not found");
      error.statusCode = 404;
      throw error;
    }

    const filePath = secureStorage.getFilePath(doc.storage_key, merchant.id);
    return {
      filePath,
      mimeType: doc.mime_type,
      documentName: doc.document_name,
    };
  },

  async getOnboardingStatus(userId) {
    const merchant = await merchantRepository.findOrCreateMerchantByUserId(userId);
    const [profile, contact, commercial, kyc, documents, verification] = await Promise.all([
      merchantRepository.getProfile(merchant.id),
      merchantRepository.getContact(merchant.id),
      merchantRepository.getCommercial(merchant.id),
      merchantRepository.getKyc(merchant.id),
      merchantRepository.getDocuments(merchant.id),
      merchantRepository.getUserVerification(userId),
    ]);

    const { steps, percentage, canSubmit, docChecklist } = calculateProgress(
      profile,
      contact,
      commercial,
      kyc,
      documents,
      verification
    );

    return {
      merchantId: merchant.id,
      merchantCode: merchant.merchant_code,
      accountStatus: merchant.account_status,
      kycStatus: merchant.kyc_status,
      onboardingStep: merchant.onboarding_step,
      submittedAt: merchant.submitted_at,
      approvedAt: merchant.approved_at,
      rejectedAt: merchant.rejected_at,
      rejectionReason: merchant.rejection_reason,
      steps,
      percentage,
      canSubmit,
      docChecklist,
      verification,
    };
  },

  async submitApplication(userId) {
    const merchant = await merchantRepository.findOrCreateMerchantByUserId(userId);

    if (merchant.account_status === "submitted" || merchant.account_status === "under_review") {
      const error = new Error("Your application has already been submitted and is currently under review");
      error.statusCode = 400;
      throw error;
    }

    if (merchant.account_status === "approved" || merchant.account_status === "active") {
      const error = new Error("Your merchant account is already approved and active");
      error.statusCode = 400;
      throw error;
    }

    const [profile, contact, commercial, kyc, documents, verification] = await Promise.all([
      merchantRepository.getProfile(merchant.id),
      merchantRepository.getContact(merchant.id),
      merchantRepository.getCommercial(merchant.id),
      merchantRepository.getKyc(merchant.id),
      merchantRepository.getDocuments(merchant.id),
      merchantRepository.getUserVerification(userId),
    ]);

    const missing = [];
    if (!profile || !profile.company_name) {
      missing.push("Company Information (Company Name)");
    }
    if (!contact || !contact.name || !contact.email || !contact.phone) {
      missing.push("Contact Information (Name, Email, Phone)");
    }
    if (!kyc || !kyc.legal_business_name || !kyc.trade_license_number || !kyc.nid_number) {
      missing.push("KYC Information (Legal Name, Trade License, NID, Bank details)");
    }

    const uploadedDocTypes = (documents || []).map((d) => normalizeDocType(d.document_type));
    if (!uploadedDocTypes.includes("NID_FRONT")) missing.push("NID Front document");
    if (!uploadedDocTypes.includes("NID_BACK")) missing.push("NID Back document");
    if (!uploadedDocTypes.includes("TIN_CERTIFICATE")) missing.push("TIN Certificate document");
    if (!uploadedDocTypes.includes("CANCELLED_BANK_CHEQUE")) missing.push("Cancelled Bank Cheque document");

    const devBypassActive = true; // Email and phone verification are optional per current requirement

    if (missing.length > 0) {
      const error = new Error(
        `Cannot submit application. Missing requirements: ${missing.join(", ")}`
      );
      error.statusCode = 422;
      error.details = missing;
      throw error;
    }

    const prevAccountStatus = merchant.account_status;

    await merchantRepository.updateMerchantStatus(merchant.id, "submitted", "pending", true);

    await merchantRepository.createHistory(
      merchant.id,
      "review",
      "submit_application",
      prevAccountStatus,
      "submitted",
      {
        submittedAt: new Date().toISOString(),
        devVerificationBypass: devBypassActive,
      }
    );

    // Insert persistent Admin notification & Bank Partner notification
    try {
      const company = profile?.company_name || merchant.merchant_code;
      await merchantRepository.createAdminNotification(
        `New Merchant Application: ${company}`,
        `Merchant ${company} (${merchant.merchant_code}) has submitted their onboarding & KYC documentation for verification.`,
        "kyc",
        `/admin/kyc`
      );

      // If merchant selected an Institution Bank in KYC (or existing applications), notify the Bank
      const bankInstId = kyc?.institution_id || null;
      if (bankInstId) {
        // Ensure an entry exists in merchant_gateway_applications for this institution
        const [existingApps] = await db.query(
          `SELECT id FROM merchant_gateway_applications WHERE merchant_id = ? AND institution_id = ? LIMIT 1`,
          [merchant.id, Number(bankInstId)]
        );

        if (existingApps.length === 0) {
          await db.query(
            `INSERT INTO merchant_gateway_applications
             (application_number, merchant_id, institution_id, branch_id, status, gateway_name, applied_at)
             VALUES (?, ?, ?, ?, 'applied', ?, NOW())`,
            [
              `APP-${Date.now().toString().slice(-6)}`,
              merchant.id,
              Number(bankInstId),
              kyc?.branch_id || null,
              kyc?.bank_name || "Partner Bank",
            ]
          );
        } else {
          await db.query(
            `UPDATE merchant_gateway_applications
             SET status = 'applied', branch_id = COALESCE(?, branch_id), updated_at = NOW()
             WHERE id = ?`,
            [kyc?.branch_id || null, existingApps[0].id]
          );
        }

        // Write to institution activity log so Bank Admin sees it in recent activities & notifications
        await db.query(
          `INSERT INTO institution_activity_logs
           (institution_id, user_id, user_email, action, resource_type, resource_id, status_transition, details)
           VALUES (?, ?, ?, 'merchant.application.submitted', 'merchant_application', ?, 'draft -> applied', ?)`,
          [
            Number(bankInstId),
            userId,
            contact?.email || null,
            String(merchant.id),
            JSON.stringify({
              companyName: company,
              merchantCode: merchant.merchant_code,
              branchName: kyc?.branch_name || null,
              bankName: kyc?.bank_name || null,
            }),
          ]
        );
      }
    } catch (notifErr) {
      console.warn("Non-blocking notification error on submission:", notifErr);
    }

    return {
      success: true,
      message: "Merchant onboarding application submitted successfully. An administrator and your designated bank will review your submission.",
      accountStatus: "submitted",
      kycStatus: "pending",
      submittedAt: new Date().toISOString(),
      onboardingStep: 7,
    };
  },

  /**
   * Resubmit field correction after merchant fixes flagged issues
   */
  async submitCorrection(userId, { issueId, fieldKey, note }) {
    const merchant = await merchantRepository.findOrCreateMerchantByUserId(userId);
    const [kyc] = await Promise.all([merchantRepository.getKyc(merchant.id)]);
    const [profile] = await Promise.all([merchantRepository.getProfile(merchant.id)]);

    // Check if issueId is provided, or resolve all open issues matching fieldKey
    let targetIssues = [];
    if (issueId) {
      const [rows] = await db.query(
        `SELECT * FROM kyc_field_issues WHERE id = ? AND merchant_id = ?`,
        [Number(issueId), merchant.id]
      );
      targetIssues = rows;
    } else if (fieldKey) {
      const [rows] = await db.query(
        `SELECT * FROM kyc_field_issues WHERE merchant_id = ? AND field_key = ? AND status = 'open'`,
        [merchant.id, fieldKey]
      );
      targetIssues = rows;
    } else {
      const [rows] = await db.query(
        `SELECT * FROM kyc_field_issues WHERE merchant_id = ? AND status = 'open'`,
        [merchant.id]
      );
      targetIssues = rows;
    }

    if (targetIssues.length === 0) {
      return { success: true, message: "No open issues found to resolve." };
    }

    for (const issue of targetIssues) {
      await db.query(
        `UPDATE kyc_field_issues
         SET status = 'resolved', resolution_note = ?, updated_at = NOW()
         WHERE id = ?`,
        [note || "Corrected and re-submitted by merchant", issue.id]
      );

      // Notify the specific institution if issue has an institution_id
      if (issue.institution_id) {
        await db.query(
          `INSERT INTO institution_activity_logs
           (institution_id, user_id, user_email, action, resource_type, resource_id, status_transition, details)
           VALUES (?, ?, ?, 'merchant.correction.resubmitted', 'kyc_field_issue', ?, 'open -> resolved', ?)`,
          [
            Number(issue.institution_id),
            userId,
            null,
            String(issue.id),
            JSON.stringify({
              merchantCode: merchant.merchant_code,
              companyName: profile?.company_name || merchant.merchant_code,
              fieldKey: issue.field_key,
              note: note || "Correction resubmitted",
            }),
          ]
        );
      }
    }

    // Check if any other issues remain open
    const [remainingOpen] = await db.query(
      `SELECT COUNT(*) AS cnt FROM kyc_field_issues WHERE merchant_id = ? AND status = 'open'`,
      [merchant.id]
    );

    const hasRemaining = Number(remainingOpen[0]?.cnt || 0) > 0;
    const newStatus = hasRemaining ? "additional_information_required" : "under_review";

    await merchantRepository.updateMerchantStatus(merchant.id, newStatus, newStatus);
    await db.query(
      `UPDATE merchant_gateway_applications
       SET status = ?
       WHERE merchant_id = ? AND status = 'additional_information_required'`,
      [newStatus, merchant.id]
    );

    // Notify Platform Admin
    try {
      const company = profile?.company_name || merchant.merchant_code;
      await merchantRepository.createAdminNotification(
        `Merchant Re-submitted Correction: ${company}`,
        `Merchant ${company} (${merchant.merchant_code}) has updated and re-submitted their correction for review.`,
        "kyc",
        `/admin/kyc`
      );
    } catch (_) {}

    return {
      success: true,
      message: "Correction re-submitted successfully. Bank and Admin compliance teams have been notified.",
      accountStatus: newStatus,
      kycStatus: newStatus,
      remainingOpenIssues: Number(remainingOpen[0]?.cnt || 0),
    };
  },

  // ==========================================
  // PART 3: GATEWAYS CATALOGUE & APPLY
  // ==========================================
  async getGateways(userId, filters = {}) {
    const merchant = await merchantRepository.findOrCreateMerchantByUserId(userId);
    const [gateways] = await db.execute("SELECT * FROM gateways WHERE status = 'active' ORDER BY name ASC");
    const [applications] = await db.execute("SELECT gateway_id, status FROM merchant_gateway_applications WHERE merchant_id = ?", [merchant.id]);
    const [services] = await db.execute("SELECT gateway_id, status FROM merchant_gateway_services WHERE merchant_id = ?", [merchant.id]);

    const appMap = new Map();
    applications.forEach((a) => appMap.set(a.gateway_id, a.status));

    const serviceMap = new Map();
    services.forEach((s) => serviceMap.set(s.gateway_id, s.status));

    return gateways.map((g) => {
      const appStatus = appMap.get(g.id) || null;
      const svcStatus = serviceMap.get(g.id) || null;
      return {
        id: g.id,
        name: g.name,
        code: g.code,
        logoUrl: g.logo_url,
        description: g.description,
        supportedMethods: typeof g.supported_methods === "string" ? JSON.parse(g.supported_methods) : (g.supported_methods || []),
        serviceType: g.service_type || "Payment Gateway",
        qrSupported: Boolean(g.qr_supported),
        cardSupported: Boolean(g.card_supported),
        mobileSupported: Boolean(g.mobile_supported),
        apiSupported: Boolean(g.api_supported),
        requiredDocuments: typeof g.required_documents === "string" ? JSON.parse(g.required_documents) : (g.required_documents || []),
        serviceFee: Number(g.service_fee || 1.5),
        setupFee: Number(g.setup_fee || 0),
        status: g.status,
        merchantApplicationStatus: appStatus,
        merchantServiceStatus: svcStatus,
        hasApplied: Boolean(appStatus),
        isActivated: svcStatus === "active",
        // Snake case aliases
        gateway_name: g.name,
        gateway_code: g.code,
        gateway_logo: g.logo_url,
        service_type: g.service_type || "Payment Gateway",
        service_fee: Number(g.service_fee || 1.5),
        setup_fee: Number(g.setup_fee || 0),
      };
    });
  },

  async getGatewayById(userId, gatewayId) {
    const merchant = await merchantRepository.findOrCreateMerchantByUserId(userId);
    const [rows] = await db.execute("SELECT * FROM gateways WHERE id = ? LIMIT 1", [gatewayId]);
    if (!rows.length) {
      const err = new Error("Gateway service not found");
      err.statusCode = 404;
      throw err;
    }
    const g = rows[0];

    const [applications] = await db.execute(
      "SELECT * FROM merchant_gateway_applications WHERE merchant_id = ? AND gateway_id = ? ORDER BY applied_at DESC LIMIT 1",
      [merchant.id, gatewayId]
    );

    const [services] = await db.execute(
      "SELECT * FROM merchant_gateway_services WHERE merchant_id = ? AND gateway_id = ? LIMIT 1",
      [merchant.id, gatewayId]
    );

    return {
      id: g.id,
      name: g.name,
      code: g.code,
      logoUrl: g.logo_url,
      description: g.description,
      supportedMethods: typeof g.supported_methods === "string" ? JSON.parse(g.supported_methods) : (g.supported_methods || []),
      serviceType: g.service_type || "Payment Gateway",
      qrSupported: Boolean(g.qr_supported),
      cardSupported: Boolean(g.card_supported),
      mobileSupported: Boolean(g.mobile_supported),
      apiSupported: Boolean(g.api_supported),
      requiredDocuments: typeof g.required_documents === "string" ? JSON.parse(g.required_documents) : (g.required_documents || []),
      serviceFee: Number(g.service_fee || 1.5),
      setupFee: Number(g.setup_fee || 0),
      status: g.status,
      application: applications.length ? applications[0] : null,
      service: services.length ? services[0] : null,
      // Snake case aliases
      gateway_name: g.name,
      gateway_code: g.code,
      gateway_logo: g.logo_url,
      service_type: g.service_type || "Payment Gateway",
      service_fee: Number(g.service_fee || 1.5),
    };
  },

  async applyGateway(userId, gatewayId, payload = {}) {
    const merchant = await merchantRepository.findOrCreateMerchantByUserId(userId);
    const [gRows] = await db.execute("SELECT * FROM gateways WHERE id = ? AND status = 'active' LIMIT 1", [gatewayId]);
    if (!gRows.length) {
      const err = new Error("Selected gateway service is currently inactive or unavailable for application.");
      err.statusCode = 400;
      throw err;
    }
    const gateway = gRows[0];

    // Check for existing applications
    const [existing] = await db.execute(
      "SELECT id, status FROM merchant_gateway_applications WHERE merchant_id = ? AND gateway_id = ? LIMIT 1",
      [merchant.id, gatewayId]
    );

    if (existing.length > 0) {
      const currentStatus = existing[0].status;
      if (currentStatus === "approved") {
        const err = new Error("You already have an approved application for this gateway service.");
        err.statusCode = 400;
        throw err;
      }
      if (currentStatus === "applied" || currentStatus === "under_review") {
        const err = new Error("You already have a pending application currently under review for this gateway.");
        err.statusCode = 400;
        throw err;
      }
    }

    const [res] = await db.execute(
      `INSERT INTO merchant_gateway_applications (merchant_id, gateway_id, gateway_name, gateway_code, logo_url, service_type, service_fee, status, applied_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'applied', NOW(), NOW(), NOW())`,
      [merchant.id, gatewayId, gateway.name, gateway.code, gateway.logo_url || null, gateway.service_type || "Payment Gateway", gateway.service_fee || 1.5]
    );

    const applicationId = res.insertId;

    // Record History
    await merchantRepository.createHistory(
      merchant.id,
      "gateway_application",
      "apply_gateway",
      null,
      "applied",
      { gatewayId, gatewayName: gateway.name, applicationId }
    );

    // Create Admin Notification
    const [prof] = await db.execute("SELECT company_name FROM merchant_profiles WHERE merchant_id = ? LIMIT 1", [merchant.id]);
    const company = prof[0]?.company_name || merchant.merchant_code;

    try {
      await merchantRepository.createAdminNotification(
        `New Gateway Application: ${gateway.name}`,
        `Merchant ${company} (${merchant.merchant_code}) has applied for ${gateway.name} payment gateway service.`,
        "gateway",
        "/admin/gateways/applications"
      );
    } catch {}

    return {
      success: true,
      message: `Your application for ${gateway.name} has been submitted successfully for compliance review.`,
      applicationId,
      gatewayName: gateway.name,
      status: "applied",
      appliedAt: new Date().toISOString(),
    };
  },

  // ==========================================
  // PART 4: APPLICATIONS
  // ==========================================
  async getApplications(userId, filters = {}) {
    const merchant = await merchantRepository.findOrCreateMerchantByUserId(userId);
    const conditions = ["mga.merchant_id = ?"];
    const params = [merchant.id];

    if (filters.status && filters.status !== "all") {
      conditions.push("mga.status = ?");
      params.push(filters.status);
    }

    const whereClause = `WHERE ${conditions.join(" AND ")}`;

    const [rows] = await db.execute(
      `
        SELECT mga.*, 
               COALESCE(g.name, mga.gateway_name, 'Deleted Gateway') AS gateway_name, 
               COALESCE(g.code, mga.gateway_code, 'DELETED') AS gateway_code, 
               COALESCE(g.logo_url, mga.logo_url) AS logo_url, 
               COALESCE(g.service_type, mga.service_type, 'Payment Gateway') AS service_type, 
               COALESCE(g.service_fee, mga.service_fee, 0) AS service_fee,
               g.supported_methods, g.required_documents
        FROM merchant_gateway_applications mga
        LEFT JOIN gateways g ON mga.gateway_id = g.id
        ${whereClause}
        ORDER BY mga.applied_at DESC
      `,
      params
    );

    return rows.map((r) => ({
      id: r.id,
      applicationReference: `BQR-APP-${String(r.id).padStart(6, "0")}`,
      gatewayId: r.gateway_id,
      gatewayName: r.gateway_name,
      gatewayCode: r.gateway_code,
      logoUrl: r.logo_url,
      serviceType: r.service_type,
      serviceFee: Number(r.service_fee),
      supportedMethods: typeof r.supported_methods === "string" ? JSON.parse(r.supported_methods) : (r.supported_methods || []),
      requiredDocuments: typeof r.required_documents === "string" ? JSON.parse(r.required_documents) : (r.required_documents || []),
      status: r.status,
      reviewNote: r.review_note,
      appliedAt: r.applied_at,
      reviewedAt: r.reviewed_at,
      updatedAt: r.updated_at,
      // Snake case aliases
      gateway_name: r.gateway_name,
      gateway_code: r.gateway_code,
      gateway_logo: r.logo_url,
      service_type: r.service_type,
      service_fee: Number(r.service_fee),
      applied_at: r.applied_at,
      reviewed_at: r.reviewed_at,
      review_note: r.review_note,
    }));
  },

  async getApplicationById(userId, applicationId) {
    const merchant = await merchantRepository.findOrCreateMerchantByUserId(userId);
    const [rows] = await db.execute(
      `
        SELECT mga.*, 
               COALESCE(g.name, mga.gateway_name, 'Deleted Gateway') AS gateway_name, 
               COALESCE(g.code, mga.gateway_code, 'DELETED') AS gateway_code, 
               COALESCE(g.logo_url, mga.logo_url) AS logo_url, 
               COALESCE(g.service_type, mga.service_type, 'Payment Gateway') AS service_type, 
               COALESCE(g.service_fee, mga.service_fee, 0) AS service_fee,
               g.supported_methods, g.required_documents, g.description
        FROM merchant_gateway_applications mga
        LEFT JOIN gateways g ON mga.gateway_id = g.id
        WHERE mga.id = ? AND mga.merchant_id = ?
        LIMIT 1
      `,
      [applicationId, merchant.id]
    );

    if (!rows.length) {
      const err = new Error("Gateway application not found or unauthorized");
      err.statusCode = 404;
      throw err;
    }

    const r = rows[0];
    return {
      id: r.id,
      applicationReference: `BQR-APP-${String(r.id).padStart(6, "0")}`,
      gatewayId: r.gateway_id,
      gatewayName: r.gateway_name,
      gatewayCode: r.gateway_code,
      logoUrl: r.logo_url,
      description: r.description,
      serviceType: r.service_type,
      serviceFee: Number(r.service_fee),
      supportedMethods: typeof r.supported_methods === "string" ? JSON.parse(r.supported_methods) : (r.supported_methods || []),
      requiredDocuments: typeof r.required_documents === "string" ? JSON.parse(r.required_documents) : (r.required_documents || []),
      status: r.status,
      reviewNote: r.review_note,
      appliedAt: r.applied_at,
      reviewedAt: r.reviewed_at,
      updatedAt: r.updated_at,
      // Snake case aliases
      gateway_name: r.gateway_name,
      gateway_code: r.gateway_code,
      gateway_logo: r.logo_url,
      service_type: r.service_type,
      service_fee: Number(r.service_fee),
      applied_at: r.applied_at,
      reviewed_at: r.reviewed_at,
      review_note: r.review_note,
    };
  },

  // ==========================================
  // PART 5: MY SERVICES
  // ==========================================
  async getMyServices(userId, filters = {}) {
    const merchant = await merchantRepository.findOrCreateMerchantByUserId(userId);
    const conditions = ["mgs.merchant_id = ?"];
    const params = [merchant.id];

    if (filters.status && filters.status !== "all") {
      conditions.push("mgs.status = ?");
      params.push(filters.status);
    }

    const whereClause = `WHERE ${conditions.join(" AND ")}`;

    const [rows] = await db.execute(
      `
        SELECT mgs.*, 
               COALESCE(g.name, mgs.gateway_name, 'Deleted Gateway') AS gateway_name, 
               COALESCE(g.code, mgs.gateway_code, 'DELETED') AS gateway_code, 
               COALESCE(g.logo_url, mgs.logo_url) AS logo_url, 
               COALESCE(g.service_fee, mgs.service_fee, 0) AS service_fee,
               g.supported_methods, 
               COALESCE(g.qr_supported, 1) AS qr_supported, 
               COALESCE(g.card_supported, 0) AS card_supported, 
               COALESCE(g.mobile_supported, 1) AS mobile_supported, 
               COALESCE(g.api_supported, 1) AS api_supported
        FROM merchant_gateway_services mgs
        LEFT JOIN gateways g ON mgs.gateway_id = g.id
        ${whereClause}
        ORDER BY mgs.created_at DESC
      `,
      params
    );

    return rows.map((r) => {
      const rawConfig = typeof r.configuration === "string" ? JSON.parse(r.configuration) : (r.configuration || {});
      // Mask secret keys for security
      const maskedConfig = { ...rawConfig };
      if (maskedConfig.secretKey) {
        maskedConfig.secretKey = "••••••••" + String(maskedConfig.secretKey).slice(-4);
      }
      if (maskedConfig.apiKey) {
        maskedConfig.apiKey = "••••••••" + String(maskedConfig.apiKey).slice(-4);
      }

      return {
        id: r.id,
        gatewayId: r.gateway_id,
        gatewayName: r.gateway_name,
        gatewayCode: r.gateway_code,
        logoUrl: r.logo_url,
        serviceType: r.service_type,
        serviceFee: Number(r.service_fee),
        supportedMethods: typeof r.supported_methods === "string" ? JSON.parse(r.supported_methods) : (r.supported_methods || []),
        qrSupported: Boolean(r.qr_supported),
        cardSupported: Boolean(r.card_supported),
        mobileSupported: Boolean(r.mobile_supported),
        apiSupported: Boolean(r.api_supported),
        status: r.status,
        configuration: maskedConfig,
        hasConfigured: Boolean(rawConfig.merchantId || rawConfig.storeId || rawConfig.apiKey),
        activatedAt: r.activated_at,
        createdAt: r.created_at,
        // Snake case aliases
        gateway_name: r.gateway_name,
        gateway_code: r.gateway_code,
        gateway_logo: r.logo_url,
        service_type: r.service_type,
        service_fee: Number(r.service_fee),
        activated_at: r.activated_at,
        created_at: r.created_at,
      };
    });
  },

  async getMyServiceById(userId, serviceId) {
    const merchant = await merchantRepository.findOrCreateMerchantByUserId(userId);
    const [rows] = await db.execute(
      `
        SELECT mgs.*, 
               COALESCE(g.name, mgs.gateway_name, 'Deleted Gateway') AS gateway_name, 
               COALESCE(g.code, mgs.gateway_code, 'DELETED') AS gateway_code, 
               COALESCE(g.logo_url, mgs.logo_url) AS logo_url, 
               COALESCE(g.service_fee, mgs.service_fee, 0) AS service_fee,
               g.supported_methods, 
               COALESCE(g.qr_supported, 1) AS qr_supported, 
               COALESCE(g.card_supported, 0) AS card_supported, 
               COALESCE(g.mobile_supported, 1) AS mobile_supported, 
               COALESCE(g.api_supported, 1) AS api_supported, 
               g.description
        FROM merchant_gateway_services mgs
        LEFT JOIN gateways g ON mgs.gateway_id = g.id
        WHERE mgs.id = ? AND mgs.merchant_id = ?
        LIMIT 1
      `,
      [serviceId, merchant.id]
    );

    if (!rows.length) {
      const err = new Error("Merchant gateway service not found or unauthorized");
      err.statusCode = 404;
      throw err;
    }

    const r = rows[0];
    const rawConfig = typeof r.configuration === "string" ? JSON.parse(r.configuration) : (r.configuration || {});

    return {
      id: r.id,
      gatewayId: r.gateway_id,
      gatewayName: r.gateway_name,
      gatewayCode: r.gateway_code,
      logoUrl: r.logo_url,
      description: r.description,
      serviceType: r.service_type,
      serviceFee: Number(r.service_fee),
      supportedMethods: typeof r.supported_methods === "string" ? JSON.parse(r.supported_methods) : (r.supported_methods || []),
      qrSupported: Boolean(r.qr_supported),
      cardSupported: Boolean(r.card_supported),
      mobileSupported: Boolean(r.mobile_supported),
      apiSupported: Boolean(r.api_supported),
      status: r.status,
      configuration: rawConfig,
      activatedAt: r.activated_at,
      createdAt: r.created_at,
      // Snake case aliases
      gateway_name: r.gateway_name,
      gateway_code: r.gateway_code,
      gateway_logo: r.logo_url,
      service_type: r.service_type,
      service_fee: Number(r.service_fee),
      activated_at: r.activated_at,
      created_at: r.created_at,
    };
  },

  async updateServiceConfiguration(userId, serviceId, configPayload) {
    const merchant = await merchantRepository.findOrCreateMerchantByUserId(userId);
    const [rows] = await db.execute(
      "SELECT * FROM merchant_gateway_services WHERE id = ? AND merchant_id = ? LIMIT 1",
      [serviceId, merchant.id]
    );

    if (!rows.length) {
      const err = new Error("Gateway service not found or unauthorized");
      err.statusCode = 404;
      throw err;
    }

    const service = rows[0];
    const existingConfig = typeof service.configuration === "string" ? JSON.parse(service.configuration) : (service.configuration || {});

    const updatedConfig = {
      ...existingConfig,
      merchantId: configPayload.merchantId ?? existingConfig.merchantId ?? "",
      storeId: configPayload.storeId ?? existingConfig.storeId ?? "",
      apiKey: configPayload.apiKey && !configPayload.apiKey.startsWith("••") ? configPayload.apiKey : existingConfig.apiKey ?? "",
      secretKey: configPayload.secretKey && !configPayload.secretKey.startsWith("••") ? configPayload.secretKey : existingConfig.secretKey ?? "",
      webhookUrl: configPayload.webhookUrl ?? existingConfig.webhookUrl ?? "",
      callbackUrl: configPayload.callbackUrl ?? existingConfig.callbackUrl ?? "",
      returnUrl: configPayload.returnUrl ?? existingConfig.returnUrl ?? "",
      sandboxMode: configPayload.sandboxMode !== undefined ? Boolean(configPayload.sandboxMode) : (existingConfig.sandboxMode ?? true),
      updatedAt: new Date().toISOString(),
    };

    await db.execute(
      "UPDATE merchant_gateway_services SET configuration = ?, updated_at = NOW() WHERE id = ?",
      [JSON.stringify(updatedConfig), serviceId]
    );

    await merchantRepository.createHistory(
      merchant.id,
      "service_configuration",
      "update_configuration",
      service.status,
      service.status,
      { serviceId, gatewayId: service.gateway_id }
    );

    return {
      success: true,
      message: "Gateway credentials and configuration saved securely.",
      serviceId,
    };
  },

  // ==========================================
  // PART 6: ADD-ONS
  // ==========================================
  async getAddons(userId, filters = {}) {
    const merchant = await merchantRepository.findOrCreateMerchantByUserId(userId);
    const [addons] = await db.execute("SELECT * FROM addons WHERE status = 'available' OR status = 'active' ORDER BY category ASC, name ASC");
    const [merchantAddons] = await db.query(
      `SELECT ma.*, 
              o.id AS order_id, o.order_number, o.status AS order_status, o.amount AS order_amount,
              p.id AS payment_id, p.payment_reference, p.status AS payment_status, p.checkout_url
       FROM merchant_addons ma
       LEFT JOIN addon_orders o ON (o.id = ma.order_id OR (o.merchant_id = ma.merchant_id AND o.addon_id = ma.addon_id AND o.status IN ('pending_payment', 'paid', 'active')))
       LEFT JOIN addon_payments p ON (p.id = ma.payment_id OR (p.order_id = o.id AND p.status IN ('pending', 'processing', 'successful')))
       WHERE ma.merchant_id = ?
       ORDER BY ma.id DESC`,
      [merchant.id]
    );

    const mAddonMap = new Map();
    merchantAddons.forEach((ma) => {
      if (!mAddonMap.has(ma.addon_id)) {
        mAddonMap.set(ma.addon_id, ma);
      } else {
        const existing = mAddonMap.get(ma.addon_id);
        if (existing.status !== "activated" && (ma.status === "activated" || ma.order_status === "pending_payment")) {
          mAddonMap.set(ma.addon_id, ma);
        }
      }
    });

    return addons.map((a) => {
      const ma = mAddonMap.get(a.id);
      const isActivated = Boolean(
        ma?.status === "activated" ||
        ma?.status === "approved" ||
        ma?.order_status === "active" ||
        ma?.order_status === "paid"
      );
      const hasUnpaidOrder = Boolean(ma && ma.order_status === "pending_payment" && !isActivated);
      const isUnderReview = Boolean(
        ma && (ma.status === "under_review" || ma.order_status === "awaiting_approval") && !isActivated
      );

      const applicationStatus = ma ? ma.status : "available";
      const orderStatus = ma?.order_status || (isActivated ? "paid" : null);
      const paymentStatus = ma?.payment_status || (isActivated ? "successful" : null);
      const subscriptionStatus = isActivated
        ? "active"
        : hasUnpaidOrder
        ? "awaiting_payment"
        : isUnderReview
        ? "pending_approval"
        : "inactive";

      return {
        id: a.id,
        name: a.name,
        code: a.code,
        description: a.description,
        category: a.category,
        pricingType: a.pricing_type,
        price: Number(a.price),
        billingCycle: a.billing_cycle,
        requirements: a.requirements,
        status: a.status,
        merchantStatus: ma ? ma.status : "available",
        hasApplied: Boolean(ma),
        isActivated,
        hasUnpaidOrder,
        isUnderReview,
        orderId: ma?.order_id || null,
        orderNumber: ma?.order_number || null,
        orderStatus,
        paymentId: ma?.payment_id || null,
        paymentReference: ma?.payment_reference || null,
        paymentStatus,
        checkoutUrl: ma?.checkout_url || null,
        applicationStatus,
        subscriptionStatus,
        // Snake case aliases
        pricing_type: a.pricing_type,
        billing_cycle: a.billing_cycle,
        merchant_status: ma ? ma.status : "available",
        has_applied: Boolean(ma),
        is_activated: isActivated,
        has_unpaid_order: hasUnpaidOrder,
        is_under_review: isUnderReview,
        order_id: ma?.order_id || null,
        order_number: ma?.order_number || null,
        order_status: orderStatus,
        payment_id: ma?.payment_id || null,
        payment_reference: ma?.payment_reference || null,
        payment_status: paymentStatus,
        checkout_url: ma?.checkout_url || null,
        application_status: applicationStatus,
        subscription_status: subscriptionStatus,
      };
    });
  },

  async applyAddon(userId, addonId, payload = {}) {
    const merchant = await merchantRepository.findOrCreateMerchantByUserId(userId);
    const [aRows] = await db.execute("SELECT * FROM addons WHERE id = ? AND status = 'available' LIMIT 1", [addonId]);
    if (!aRows.length) {
      const err = new Error("Selected add-on service is currently unavailable.");
      err.statusCode = 400;
      throw err;
    }
    const addon = aRows[0];

    // Check if already applied
    const [existing] = await db.execute(
      "SELECT id, status FROM merchant_addons WHERE merchant_id = ? AND addon_id = ? LIMIT 1",
      [merchant.id, addonId]
    );

    if (existing.length > 0) {
      const currentStatus = existing[0].status;
      if (currentStatus === "activated" || currentStatus === "approved") {
        const err = new Error("This add-on is already active on your merchant account.");
        err.statusCode = 400;
        throw err;
      }
      if (currentStatus === "applied" || currentStatus === "under_review") {
        const err = new Error("You already have an active application under review for this add-on.");
        err.statusCode = 400;
        throw err;
      }
    }

    const [res] = await db.execute(
      `INSERT INTO merchant_addons (merchant_id, addon_id, addon_name, addon_code, logo_url, category, price, pricing_type, status, applied_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'applied', NOW(), NOW(), NOW())`,
      [merchant.id, addonId, addon.name, addon.code, addon.logo_url || null, addon.category || "Operations", addon.price || 0, addon.pricing_type || "monthly"]
    );

    // History & Notification
    await merchantRepository.createHistory(
      merchant.id,
      "addon_application",
      "apply_addon",
      null,
      "applied",
      { addonId, addonName: addon.name }
    );

    const [prof] = await db.execute("SELECT company_name FROM merchant_profiles WHERE merchant_id = ? LIMIT 1", [merchant.id]);
    const company = prof[0]?.company_name || merchant.merchant_code;

    try {
      await merchantRepository.createAdminNotification(
        `New Add-on Application: ${addon.name}`,
        `Merchant ${company} (${merchant.merchant_code}) has applied for the ${addon.name} add-on service.`,
        "gateway",
        "/admin/addons"
      );
    } catch {}

    return {
      success: true,
      message: `Your application for add-on '${addon.name}' has been submitted successfully.`,
      addonId,
      status: "applied",
    };
  },

  // ==========================================
  // PART 7: API & INTEGRATION
  // ==========================================
  async getIntegrationDetails(userId) {
    const merchant = await merchantRepository.findOrCreateMerchantByUserId(userId);
    const [profile] = await db.execute("SELECT company_name FROM merchant_profiles WHERE merchant_id = ? LIMIT 1", [merchant.id]);
    const [activeServices] = await db.execute(
      `SELECT mgs.*, 
              COALESCE(g.name, mgs.gateway_name, 'Unknown Gateway') AS gateway_name, 
              COALESCE(g.code, mgs.gateway_code, 'UNKNOWN') AS gateway_code
       FROM merchant_gateway_services mgs
       LEFT JOIN gateways g ON mgs.gateway_id = g.id
       WHERE mgs.merchant_id = ? AND mgs.status = 'active'`,
      [merchant.id]
    );

    const deterministicSandboxKey = `bqr_test_key_${Buffer.from(String(merchant.merchant_code)).toString("hex").slice(0, 16)}`;
    const deterministicSandboxSecret = `bqr_test_sec_${Buffer.from(String(userId + merchant.id)).toString("hex").slice(0, 24)}`;

    return {
      merchantId: merchant.id,
      merchantCode: merchant.merchant_code,
      companyName: profile[0]?.company_name || merchant.merchant_code,
      environment: "sandbox",
      credentials: {
        sandbox: {
          apiKey: deterministicSandboxKey,
          apiSecret: deterministicSandboxSecret,
          merchantId: merchant.merchant_code,
          apiBaseUrl: "https://sandbox.banglaqr.com/api/v1",
          qrGenerateEndpoint: "/payments/banglaqr/generate",
          statusCheckEndpoint: "/payments/banglaqr/status",
          refundEndpoint: "/payments/banglaqr/refund",
        },
        live: {
          apiKey: merchant.account_status === "approved" || merchant.account_status === "active" ? `bqr_live_${Buffer.from(String(merchant.merchant_code + "live")).toString("hex").slice(0, 16)}` : null,
          apiSecret: merchant.account_status === "approved" || merchant.account_status === "active" ? `bqr_live_sec_${Buffer.from(String(merchant.merchant_code + "live")).toString("hex").slice(0, 24)}` : null,
          apiBaseUrl: "https://api.banglaqr.com/api/v1",
          isLiveEligible: merchant.account_status === "approved" || merchant.account_status === "active",
        },
      },
      webhooks: {
        registeredEndpoint: "https://yourdomain.com/webhooks/banglaqr",
        signatureHeader: "X-BanglaQR-Signature",
        ipWhitelist: ["103.145.118.0/24", "103.145.119.0/24"],
      },
      activeGateways: activeServices.map((s) => ({
        id: s.id,
        gatewayName: s.gateway_name,
        gatewayCode: s.gateway_code,
        serviceType: s.service_type,
        activatedAt: s.activated_at,
      })),
      documentationGuides: [
        {
          title: "BanglaQR Static & Dynamic QR Spec",
          type: "PDF / Online Guide",
          link: "/docs/banglaqr-spec",
        },
        {
          title: "Node.js SDK & Checkout Integration",
          type: "NPM Package",
          link: "https://github.com/banglaqr/nodejs-sdk",
        },
        {
          title: "PHP & Laravel Interoperable Integration",
          type: "Composer Package",
          link: "https://github.com/banglaqr/php-sdk",
        },
      ],
    };
  },

  // ==========================================
  // NOTIFICATIONS
  // ==========================================
  async getNotifications(userId) {
    const [rows] = await db.execute(
      `SELECT id, title, message, type, link, is_read, created_at
       FROM notifications
       WHERE (recipient_type = 'merchant' AND recipient_id = ?) OR recipient_type = 'all'
       ORDER BY created_at DESC LIMIT 50`,
      [userId]
    );

    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      message: r.message,
      type: r.type,
      link: r.link || "/merchant/dashboard",
      isRead: Boolean(r.is_read),
      createdAt: r.created_at,
    }));
  },

  async getUnreadNotificationCount(userId) {
    const [rows] = await db.execute(
      `SELECT COUNT(*) AS unread_count
       FROM notifications
       WHERE ((recipient_type = 'merchant' AND recipient_id = ?) OR recipient_type = 'all')
         AND is_read = 0`,
      [userId]
    );
    return { unreadCount: Number(rows[0]?.unread_count || 0) };
  },

  async markNotificationRead(userId, notifId) {
    await db.execute(
      `UPDATE notifications SET is_read = 1
       WHERE id = ? AND ((recipient_type = 'merchant' AND recipient_id = ?) OR recipient_type = 'all')`,
      [notifId, userId]
    );
    return { success: true };
  },

  async markAllNotificationsRead(userId) {
    await db.execute(
      `UPDATE notifications SET is_read = 1
       WHERE ((recipient_type = 'merchant' AND recipient_id = ?) OR recipient_type = 'all') AND is_read = 0`,
      [userId]
    );
    return { success: true };
  },

  // ==========================================
  // SUPPORT TICKETS
  // ==========================================
  async getSupportTickets(userId, filters = {}) {
    const merchant = await merchantRepository.findOrCreateMerchantByUserId(userId);
    const conditions = ["merchant_id = ?"];
    const params = [merchant.id];

    if (filters.status && filters.status !== "all") {
      conditions.push("status = ?");
      params.push(filters.status);
    }

    const [rows] = await db.execute(
      `SELECT * FROM support_tickets WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC`,
      params
    );

    return rows.map((r) => ({
      id: r.id,
      ticketNumber: r.ticket_number,
      ticket_number: r.ticket_number,
      subject: r.subject,
      priority: r.priority,
      status: r.status,
      category: r.category,
      createdAt: r.created_at,
      created_at: r.created_at,
      updatedAt: r.updated_at,
      updated_at: r.updated_at,
    }));
  },

  async getSupportTicketById(userId, ticketId) {
    const merchant = await merchantRepository.findOrCreateMerchantByUserId(userId);
    const [rows] = await db.execute(
      "SELECT * FROM support_tickets WHERE id = ? AND merchant_id = ? LIMIT 1",
      [ticketId, merchant.id]
    );
    if (!rows.length) {
      const err = new Error("Support ticket not found");
      err.statusCode = 404;
      throw err;
    }

    const ticket = rows[0];
    const [messages] = await db.execute(
      `SELECT id, ticket_id, sender_id, sender_type, message, attachments, created_at
       FROM support_ticket_messages WHERE ticket_id = ? ORDER BY created_at ASC`,
      [ticketId]
    );

    const mappedMessages = messages.map((m) => ({
      id: m.id,
      senderType: m.sender_type,
      sender_type: m.sender_type,
      message: m.message,
      attachments: typeof m.attachments === "string" ? JSON.parse(m.attachments) : m.attachments,
      createdAt: m.created_at,
      created_at: m.created_at,
    }));

    return {
      ...ticket,
      ticketNumber: ticket.ticket_number,
      ticket_number: ticket.ticket_number,
      createdAt: ticket.created_at,
      created_at: ticket.created_at,
      updatedAt: ticket.updated_at,
      updated_at: ticket.updated_at,
      messages: mappedMessages,
      replies: mappedMessages,
    };
  },

  async createSupportTicket(userId, data) {
    const merchant = await merchantRepository.findOrCreateMerchantByUserId(userId);
    const ticketNumber = `TKT-${Date.now().toString().slice(-6)}`;

    const [res] = await db.execute(
      `INSERT INTO support_tickets (ticket_number, merchant_id, user_id, subject, priority, status, category, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'open', ?, NOW(), NOW())`,
      [
        ticketNumber,
        merchant.id,
        userId,
        data.subject,
        data.priority || "medium",
        data.category || "General Inquiry",
      ]
    );

    const ticketId = res.insertId;

    if (data.message) {
      await db.execute(
        `INSERT INTO support_ticket_messages (ticket_id, sender_id, sender_type, message, created_at)
         VALUES (?, ?, 'merchant', ?, NOW())`,
        [ticketId, userId, data.message]
      );
    }

    return {
      success: true,
      message: "Support ticket submitted successfully. Support team will respond shortly.",
      data: {
        id: ticketId,
        ticketId,
        ticketNumber,
      },
    };
  },

  async replySupportTicket(userId, ticketId, data) {
    const merchant = await merchantRepository.findOrCreateMerchantByUserId(userId);
    const [rows] = await db.execute(
      "SELECT id FROM support_tickets WHERE id = ? AND merchant_id = ? LIMIT 1",
      [ticketId, merchant.id]
    );
    if (!rows.length) {
      const err = new Error("Support ticket not found");
      err.statusCode = 404;
      throw err;
    }

    await db.execute(
      `INSERT INTO support_ticket_messages (ticket_id, sender_id, sender_type, message, created_at)
       VALUES (?, ?, 'merchant', ?, NOW())`,
      [ticketId, userId, data.message]
    );

    await db.execute(
      `UPDATE support_tickets SET status = 'open', updated_at = NOW() WHERE id = ?`,
      [ticketId]
    );

    return { success: true, message: "Reply added to ticket" };
  },

  // ==========================================
  // SETTINGS
  // ==========================================
  async getSettings(userId) {
    const merchant = await merchantRepository.findOrCreateMerchantByUserId(userId);
    const [user] = await db.execute("SELECT id, email, phone, status, two_factor_enabled FROM users WHERE id = ? LIMIT 1", [userId]);
    const [profile] = await db.execute("SELECT * FROM merchant_profiles WHERE merchant_id = ? LIMIT 1", [merchant.id]);

    return {
      user: user[0] || {},
      merchant: {
        id: merchant.id,
        merchantCode: merchant.merchant_code,
        accountStatus: merchant.account_status,
        kycStatus: merchant.kyc_status,
      },
      profile: profile[0] || {},
    };
  },

  async changePassword(userId, { currentPassword, newPassword }) {
    if (!newPassword || newPassword.length < 8) {
      const err = new Error("New password must be at least 8 characters");
      err.statusCode = 400;
      throw err;
    }

    const [rows] = await db.execute("SELECT password_hash FROM users WHERE id = ? LIMIT 1", [userId]);
    if (!rows.length) {
      const err = new Error("User not found");
      err.statusCode = 404;
      throw err;
    }

    if (currentPassword) {
      const valid = await argon2.verify(rows[0].password_hash, currentPassword);
      if (!valid) {
        const err = new Error("Current password is incorrect");
        err.statusCode = 400;
        throw err;
      }
    }

    const hash = await argon2.hash(newPassword);
    await db.execute("UPDATE users SET password_hash = ?, updated_at = NOW() WHERE id = ?", [hash, userId]);

    return { success: true, message: "Password updated successfully" };
  },

  // ==========================================
  // BANKING INSTITUTIONS & BRANCHES FOR KYC
  // ==========================================
  async getActiveInstitutions() {
    return adminInstitutionsRepository.getActiveInstitutions();
  },

  async getActiveBranchesForInstitution(institutionId) {
    return adminInstitutionsRepository.getActiveBranchesForInstitution(institutionId);
  },

  async getGeoDivisions() {
    return adminInstitutionsRepository.getGeoDivisions();
  },

  async getGeoDistricts(divisionId) {
    return adminInstitutionsRepository.getGeoDistricts(divisionId);
  },

  async getGeoUpazilas(districtId) {
    return adminInstitutionsRepository.getGeoUpazilas(districtId);
  },

  async getInstitutionKycRequirements(institutionId, serviceId) {
    return merchantRepository.getInstitutionKycRequirements(institutionId, serviceId);
  },
};
