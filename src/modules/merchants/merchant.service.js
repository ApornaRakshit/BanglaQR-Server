import { merchantRepository } from "./merchant.repository.js";
import { secureStorage } from "../../config/storage.js";

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
    verification: Boolean(verification?.emailVerified && verification?.phoneVerified),
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
            bankName: kyc.bank_name || "",
            branchName: kyc.branch_name || "",
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
      },
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
      bankName: kyc.bank_name || "",
      branchName: kyc.branch_name || "",
      accountHolderName: kyc.bank_account_name || "",
      accountNumber: kyc.bank_account_number || "",
      routingNumber: kyc.routing_number || "",
      accountType: kyc.account_type || "Current",
    };
  },

  async updateKyc(userId, data) {
    const merchant = await merchantRepository.findOrCreateMerchantByUserId(userId);
    await merchantRepository.upsertKyc(merchant.id, data);
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

    if (!verification?.emailVerified) {
      missing.push("Email address verification");
    }
    if (!verification?.phoneVerified) {
      missing.push("Phone number verification");
    }

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
      { submittedAt: new Date().toISOString() }
    );

    return {
      success: true,
      message: "Merchant onboarding application submitted successfully. An administrator will review your submission.",
      accountStatus: "submitted",
      kycStatus: "pending",
      submittedAt: new Date().toISOString(),
      onboardingStep: 7,
    };
  },
};
