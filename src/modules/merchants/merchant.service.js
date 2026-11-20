import { merchantRepository } from "./merchant.repository.js";
import { secureStorage } from "../../config/storage.js";
import { validateFileSignature } from "../../utils/fileValidator.js";
import { isDevVerificationBypass } from "../../config/env.js";
import { db } from "../../config/db.js";
import { adminInstitutionsRepository } from "../admin/institutions/admin.institutions.repository.js";
import { generateMerchantApplicationPdf } from "../../utils/merchantApplicationPdfService.js";
import { adminMerchantsRepository } from "../admin/merchants/admin.merchants.repository.js";
import { emailService } from "../../services/email.service.js";
import { hashPassword, verifyPassword } from "../../utils/password.js";
import crypto from "crypto";


// Only draft/rejected applications may be edited freely. Once submitted, merchant data
// is locked until an explicit correction request is recorded by Compliance/Institution.
const FINAL_LOCKED_STATUSES = new Set(["approved", "active", "suspended"]);
const REVIEW_LOCKED_STATUSES = new Set(["submitted", "under_review"]);

async function requireEditableMerchant(userId, connectionOrDb = db) {
  let merchant = await merchantRepository.findOrCreateMerchantByUserId(userId, connectionOrDb);
  const [lockedRows] = await connectionOrDb.execute(
    `SELECT * FROM merchants WHERE id = ? AND user_id = ? LIMIT 1 FOR UPDATE`,
    [merchant.id, userId]
  );
  merchant = lockedRows[0];

  if (!merchant) {
    const error = new Error("Merchant account was not found for this authenticated user.");
    error.statusCode = 404;
    throw error;
  }

  const accountStatus = String(merchant.account_status || "draft").toLowerCase();
  const kycStatus = String(merchant.kyc_status || "pending").toLowerCase();

  if (FINAL_LOCKED_STATUSES.has(accountStatus)) {
    const error = new Error("This merchant application is finalized. Editing is disabled.");
    error.statusCode = 409;
    error.code = "MERCHANT_APPLICATION_LOCKED";
    throw error;
  }

  let correctionRequested =
    accountStatus === "additional_information_required" ||
    kycStatus === "additional_information_required";

  // The database may record a correction request on the institution application or
  // KYC issue row while the main merchant status remains submitted/under_review.
  if (!correctionRequested && (REVIEW_LOCKED_STATUSES.has(accountStatus) || accountStatus === "rejected")) {
    const [issueRows] = await connectionOrDb.execute(
      `SELECT id FROM kyc_field_issues
       WHERE merchant_id = ? AND status = 'open' LIMIT 1`,
      [merchant.id]
    );
    const [applicationRows] = await connectionOrDb.execute(
      `SELECT id FROM merchant_gateway_applications
       WHERE merchant_id = ? AND application_type = 'onboarding_kyc'
         AND status = 'additional_information_required' LIMIT 1`,
      [merchant.id]
    );
    correctionRequested = issueRows.length > 0 || applicationRows.length > 0;
  }

  const editable =
    accountStatus === "draft" ||
    accountStatus === "rejected" ||
    accountStatus === "additional_information_required" ||
    (REVIEW_LOCKED_STATUSES.has(accountStatus) && correctionRequested);

  if (!editable) {
    const error = new Error(
      "Your application has already been submitted and is locked during review. You can edit it only after the Bank/Admin requests additional information."
    );
    error.statusCode = 409;
    error.code = "MERCHANT_APPLICATION_LOCKED";
    throw error;
  }

  return merchant;
}

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
  if (upper === "MERCHANT_SIGNATURE" || upper === "SIGNATURE") return "MERCHANT_SIGNATURE";
  if (upper === "MERCHANT_NID_SIGNATURE") return "MERCHANT_NID_SIGNATURE";
  if (upper === "UTILITY_BILL" || upper === "ELECTRICITY_BILL" || upper === "GAS_BILL") return "UTILITY_BILL";
  if (upper === "INCOME_SOURCE_DOC" || upper === "INCOME_SOURCE" || upper === "SOURCE_OF_FUNDS") return "INCOME_SOURCE_DOC";
  if (upper === "TIN_CERTIFICATE" || upper === "TIN" || upper === "TIN_CERT") return "TIN_CERTIFICATE";
  if (upper === "BIN_CERTIFICATE" || upper === "BIN" || upper === "BIN_CERT") return "BIN_CERTIFICATE";
  if (upper === "BANK_STATEMENT" || upper === "CANCELLED_BANK_CHEQUE" || upper === "BANK_CHEQUE" || upper === "CHEQUE") return "BANK_STATEMENT";
  if (upper === "PASSPORT_PHOTO" || upper === "PASSPORT" || upper === "MERCHANT_PHOTO") return "PASSPORT_PHOTO";

  if (upper === "NOMINEE_PHOTO" || upper === "NOMINEE_PASSPORT_PHOTO" || upper === "NOMINEE_PASSPORT") return "NOMINEE_PHOTO";
  if (upper === "NOMINEE_NID" || upper === "NOMINEE-NID") return "NOMINEE_NID";
  if (upper === "NOMINEE_UTILITY_BILL") return "NOMINEE_UTILITY_BILL";
  if (upper === "NOMINEE_SIGNATURE") return "NOMINEE_SIGNATURE";
  if (upper === "NOMINEE_NID_SIGNATURE") return "NOMINEE_NID_SIGNATURE";

  if (upper === "TRADE_LICENSE" || upper === "TRADE") return "TRADE_LICENSE";
  if (upper === "COMPANY_REGISTRATION" || upper === "RJSC_INCORPORATION") return "COMPANY_REGISTRATION";
  if (upper === "BUSINESS_OUTLET_PHOTO" || upper === "OUTLET_PHOTO" || upper === "SHOP_PHOTO") return "BUSINESS_OUTLET_PHOTO";
  return upper;
}

function calculateProgress(profile, contact, commercial, kyc, documents, verification, effectiveDynamicReqs = null, merchant = null) {
  // Only non-rejected documents count towards onboarding completion and mandatory requirements
  const validDocs = (documents || []).filter(
    (d) => String(d.status || "").toLowerCase() !== "rejected"
  );
  const uploadedDocTypes = validDocs.map((d) => normalizeDocType(d.document_type || d.documentType));

  const bType = String(profile?.business_type || profile?.businessType || kyc?.business_entity_type || kyc?.businessEntityType || "").toLowerCase();
  const segment = String(merchant?.merchant_segment || merchant?.merchantSegment || "").toLowerCase();
  const isMicro = segment === "micro" || bType.includes("micro") || bType.includes("sole") || bType.includes("pra") || bType.includes("proprietor");

  const hasNidFront = uploadedDocTypes.includes("NID_FRONT");
  const hasNidBack = uploadedDocTypes.includes("NID_BACK");
  const hasMerchantSignature = uploadedDocTypes.includes("MERCHANT_SIGNATURE");
  const hasMerchantNidSignature = uploadedDocTypes.includes("MERCHANT_NID_SIGNATURE");
  const hasUtilityBill = uploadedDocTypes.includes("UTILITY_BILL");
  const hasIncomeSourceDoc = uploadedDocTypes.includes("INCOME_SOURCE_DOC");
  const hasTin = uploadedDocTypes.includes("TIN_CERTIFICATE");
  const hasBin = uploadedDocTypes.includes("BIN_CERTIFICATE");
  const hasBankStatement = uploadedDocTypes.includes("BANK_STATEMENT");
  const hasMerchantPhoto = uploadedDocTypes.includes("PASSPORT_PHOTO");

  const hasNomineePhoto = uploadedDocTypes.includes("NOMINEE_PHOTO") || uploadedDocTypes.includes("NOMINEE_PASSPORT_PHOTO");
  const hasNomineeNid = uploadedDocTypes.includes("NOMINEE_NID");
  const hasNomineeUtilityBill = uploadedDocTypes.includes("NOMINEE_UTILITY_BILL");
  const hasNomineeSignature = uploadedDocTypes.includes("NOMINEE_SIGNATURE");
  const hasNomineeNidSignature = uploadedDocTypes.includes("NOMINEE_NID_SIGNATURE");

  // Determine which channel is authoritative
  const isMfsChannel = String(profile?.channel || "").toLowerCase() === "mfs";
  const isBigMerchant = !isMicro;

  let mandatoryItems = [];

  if (Array.isArray(effectiveDynamicReqs) && effectiveDynamicReqs.length > 0) {
    // Dynamic rule evaluation
    for (const req of effectiveDynamicReqs) {
      if (req.is_mandatory) {
        const rawCode = String(req.requirement_code || "").toUpperCase();
        const code = normalizeDocType(req.requirement_code);
        // TIN is optional for both Micro and Big merchants; BIN and Cancelled Cheque optional for micro
        if (rawCode === "TIN_CERTIFICATE" || code === "TIN_CERTIFICATE" || (isMicro && (rawCode === "BIN_CERTIFICATE" || rawCode === "CANCELLED_BANK_CHEQUE" || code === "BIN_CERTIFICATE" || code === "BANK_STATEMENT"))) {
          continue;
        }
        let ok = false;
        if (rawCode === "CANCELLED_BANK_CHEQUE" || code === "BANK_STATEMENT") {
          ok = uploadedDocTypes.includes("CANCELLED_BANK_CHEQUE") || uploadedDocTypes.includes("BANK_STATEMENT");
        } else if (code === "NOMINEE_PHOTO") {
          ok = hasNomineePhoto;
        } else if (code === "MFS_WALLET_STATEMENT") {
          ok = uploadedDocTypes.includes("MFS_WALLET_STATEMENT") || uploadedDocTypes.includes("BANK_STATEMENT");
        } else {
          ok = uploadedDocTypes.includes(code);
        }
        mandatoryItems.push(ok);
      }
    }
  } else {
    // Baseline mandatory rules
    mandatoryItems = [
      hasNidFront,
      hasNidBack,
      hasMerchantPhoto,
      hasMerchantSignature,
      hasUtilityBill,
      hasNomineePhoto,
      hasNomineeNid,
      hasNomineeSignature,
    ];

    if (isBigMerchant) {
      mandatoryItems.push(hasBin);
    }
    if (isBigMerchant && !isMfsChannel) {
      mandatoryItems.push(hasBankStatement);
    }
  }

  const requiredDocsComplete = mandatoryItems.every(Boolean);

  // Account existence condition
  const hasExistingAccount = profile?.has_existing_account !== undefined ? Boolean(profile.has_existing_account) : (profile?.hasExistingAccount !== undefined ? Boolean(profile.hasExistingAccount) : true);

  const kycComplete = Boolean(
    (kyc?.legal_business_name || kyc?.legalBusinessName) &&
    (kyc?.nid_number || kyc?.nidNumber || contact?.nid_no || contact?.nidNo) &&
    (isMicro || (kyc?.trade_license_number || kyc?.tradeLicenseNumber)) &&
    (isMicro || (kyc?.tin || kyc?.tinNumber)) &&
    (kyc?.bank_name || kyc?.bankName || profile?.bank_name || profile?.bankName) &&
    (!hasExistingAccount || (kyc?.bank_account_number || kyc?.accountNumber))
  );

  const devBypassActive = isDevVerificationBypass();

  const cName = String(profile?.company_name || profile?.companyName || "").trim();
  const isDefaultCompanyName = !cName || cName.toLowerCase() === "my business";
  const hasValidCompanyDetails =
    !isDefaultCompanyName &&
    Boolean(profile?.bank_name || profile?.bankName) &&
    Boolean(profile?.address || profile?.business_type || profile?.businessType);

  const steps = {
    company: Boolean(hasValidCompanyDetails),
    contact: Boolean(
      contact?.name &&
      contact?.email &&
      contact?.phone &&
      (contact?.nid_no || contact?.nidNo || (contact?.dob && contact?.division))
    ),
    kyc: kycComplete,
    documents: requiredDocsComplete,
    verification: Boolean(verification?.phoneVerified),
  };

  const completedCount = Object.values(steps).filter(Boolean).length;
  const totalCount = 5;
  const percentage = Math.round((completedCount / totalCount) * 100);

  const docChecklist = {
    nidFront: hasNidFront,
    nidBack: hasNidBack,
    merchantSignature: hasMerchantSignature,
    merchantNidSignature: hasMerchantNidSignature,
    utilityBill: hasUtilityBill,
    incomeSourceDoc: hasIncomeSourceDoc,
    tinCertificate: hasTin,
    binCertificate: hasBin,
    bankStatement: hasBankStatement,
    merchantPhoto: hasMerchantPhoto,
    nomineePhoto: hasNomineePhoto,
    nomineeNid: hasNomineeNid,
    nomineeUtilityBill: hasNomineeUtilityBill,
    nomineeSignature: hasNomineeSignature,
    nomineeNidSignature: hasNomineeNidSignature,
    requiredCount: mandatoryItems.filter(Boolean).length,
    totalRequired: mandatoryItems.length,
    isComplete: requiredDocsComplete,
  };

  return { steps, percentage, canSubmit: completedCount === totalCount, docChecklist };
}

async function saveCustomFieldsForStep(conn, merchantId, formKey, data, coreKeys) {
  const customEntries = Object.entries(data).filter(([k]) => !coreKeys.has(k) && !k.startsWith("_"));
  if (customEntries.length === 0) return;

  const [[mRow]] = await conn.query(
    `SELECT account_status FROM merchants WHERE id = ? LIMIT 1`,
    [merchantId]
  );
  const isSubmitted = mRow?.account_status && mRow.account_status !== "draft";

  let versionId = null;
  if (isSubmitted) {
    const [pinnedRows] = await conn.query(
      `SELECT form_version_id FROM merchant_form_step_versions WHERE merchant_id = ? AND form_key = ? LIMIT 1`,
      [merchantId, formKey]
    );
    versionId = pinnedRows[0]?.form_version_id;
  }

  if (!versionId) {
    const [pub] = await conn.query(
      `SELECT id FROM merchant_form_versions WHERE form_key = ? AND status = 'published' ORDER BY version_number DESC LIMIT 1`,
      [formKey]
    );
    versionId = pub[0]?.id;
  }

  if (!versionId) return;

  // Keep step version synced
  await conn.query(
    `INSERT INTO merchant_form_step_versions (merchant_id, form_key, form_version_id, pinned_at)
     VALUES (?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE form_version_id = VALUES(form_version_id), updated_at = NOW()`,
    [merchantId, formKey, versionId]
  );

  const [fields] = await conn.query(
    `SELECT id, field_key FROM merchant_form_fields WHERE form_version_id = ?`,
    [versionId]
  );
  const fieldKeyToId = new Map(fields.map(f => [f.field_key, f.id]));

  for (const [key, val] of customEntries) {
    const stringVal = val === null || val === undefined ? null : typeof val === "object" ? JSON.stringify(val) : String(val);
    let fieldId = fieldKeyToId.get(key);
    if (!fieldId && key.startsWith("field_")) {
      const parsedId = Number(key.replace("field_", ""));
      if (fields.some(f => f.id === parsedId)) fieldId = parsedId;
    }
    if (fieldId) {
      const [existRows] = await conn.query(
        `SELECT id FROM merchant_profile_custom_values WHERE merchant_id = ? AND field_id = ? LIMIT 1`,
        [merchantId, fieldId]
      );
      if (existRows.length > 0) {
        await conn.query(
          `UPDATE merchant_profile_custom_values SET field_value = ?, field_key = ?, step_key = ?, updated_at = NOW() WHERE id = ?`,
          [stringVal, key, formKey, existRows[0].id]
        );
      } else {
        await conn.query(
          `INSERT INTO merchant_profile_custom_values (merchant_id, field_id, field_key, field_value, step_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NOW(), NOW())`,
          [merchantId, fieldId, key, stringVal, formKey]
        );
      }
    }
  }
}

export const merchantService = {
  async getOrCreateMerchant(userId) {
    return await merchantRepository.findOrCreateMerchantByUserId(userId);
  },

  async getMerchantMe(userId) {
    const merchant = await merchantRepository.findOrCreateMerchantByUserId(userId);
    const [profile, contact, commercial, kyc, documents, verification, fieldIssues, correctionApplications, customValues] = await Promise.all([
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
      db.query(
        `SELECT id FROM merchant_gateway_applications
         WHERE merchant_id = ? AND application_type = 'onboarding_kyc'
           AND status = 'additional_information_required' LIMIT 1`,
        [merchant.id]
      ).then(([rows]) => rows).catch(() => []),
      db.query(
        `SELECT field_key, field_value FROM merchant_profile_custom_values WHERE merchant_id = ?`,
        [merchant.id]
      ).then(([rows]) => rows).catch(() => []),
    ]);

    const targetInstId = kyc?.institution_id || profile?.institution_id || 0;
    let selectedInstitution = null;
    if (targetInstId) {
      const [instRows] = await db.query(
        `SELECT id, name, logo_url, institution_type FROM institutions WHERE id = ? LIMIT 1`,
        [targetInstId]
      );
      selectedInstitution = instRows[0] || null;
    }

    const customValMap = {};
    for (const cv of customValues || []) {
      if (cv.field_key) customValMap[cv.field_key] = cv.field_value;
    }

    const openIssues = (fieldIssues || []).filter((i) => String(i.status || "").toLowerCase() === "open");
    const correctionRequested =
      String(merchant.account_status || "").toLowerCase() === "additional_information_required" ||
      String(merchant.kyc_status || "").toLowerCase() === "additional_information_required" ||
      openIssues.length > 0 ||
      (correctionApplications || []).length > 0;

    const instId = kyc?.institution_id || profile?.institution_id || null;
    let effectiveDynamicReqs = null;
    if (instId) {
      try {
        const bType = String(profile?.business_type || kyc?.business_entity_type || "").toLowerCase();
        const segment = String(merchant?.merchant_segment || "").toLowerCase();
        const isMicro = segment === "micro" || bType.includes("micro") || bType.includes("sole") || bType.includes("pra") || bType.includes("proprietor");
        effectiveDynamicReqs = await merchantRepository.getInstitutionKycRequirements(instId, null, isMicro ? "micro_merchant" : bType);
      } catch (_) {}
    }

    const progress = calculateProgress(
      profile,
      contact,
      commercial,
      kyc,
      documents,
      verification,
      effectiveDynamicReqs,
      merchant
    );
    const accountStatus = String(merchant.account_status || "").toLowerCase();
    const isSubmittedStatus =
      ["submitted", "under_review", "approved", "active", "suspended"].includes(accountStatus) &&
      !correctionRequested;
    const { steps, docChecklist } = progress;
    const percentage = isSubmittedStatus ? 100 : progress.percentage;
    const canSubmit = ["submitted", "under_review", "approved", "active", "suspended"].includes(accountStatus)
      ? false
      : progress.canSubmit;

    return {
      user: {
        id: userId,
        email: verification?.email || "",
        phone: verification?.phone || "",
      },
      merchant: {
        id: merchant.id,
        merchantCode: merchant.merchant_code,
        merchantSegment: merchant.merchant_segment || null,
        accountStatus: merchant.account_status,
        kycStatus: merchant.kyc_status,
        onboardingStep: merchant.onboarding_step,
        lastVisitedStep: merchant.last_visited_step || null,
        submittedAt: merchant.submitted_at,
        approvedAt: merchant.approved_at,
        rejectedAt: merchant.rejected_at,
        rejectionReason: merchant.rejection_reason,
        adminComments: merchant.admin_comments,
        qrCodeUrl: merchant.qr_code_url || null,
        adminCommentsData: (() => {
          if (!merchant.admin_comments) return null;
          try {
            return JSON.parse(merchant.admin_comments);
          } catch {
            return { comment: merchant.admin_comments };
          }
        })(),
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
            institutionId: profile.institution_id || null,
            channel: profile.channel || "",
            bankName: profile.bank_name || "",
            branchId: profile.branch_id || null,
            branchName: profile.branch_name || "",
            routingNumber: profile.routing_number || "",
            hasExistingAccount: profile.has_existing_account !== undefined ? Boolean(profile.has_existing_account) : true,
            applyNewAccount: profile.apply_new_account !== undefined ? Boolean(profile.apply_new_account) : false,
            accountOpeningStatus: profile.account_opening_status || null,
          }
        : null,
      contact: contact
        ? {
            name: contact.name,
            nameBn: contact.name_bn || "",
            name_bn: contact.name_bn || "",
            phone: contact.phone,
            email: contact.email,
            designation: contact.designation || "",
            nidNo: contact.nid_no || "",
            nid_no: contact.nid_no || "",
            division: contact.division || "",
            country: contact.country || "Bangladesh",
            dob: contact.dob ? String(contact.dob).split("T")[0] : "",
            fatherName: contact.father_name || "",
            father_name: contact.father_name || "",
            motherName: contact.mother_name || "",
            mother_name: contact.mother_name || "",
            gender: contact.gender || "",
            permanentAddress: contact.permanent_address || "",
            permanent_address: contact.permanent_address || "",
            presentAddress: contact.present_address || "",
            present_address: contact.present_address || "",
            isSameAddress: Boolean(contact.is_same_address),
            is_same_address: Boolean(contact.is_same_address),
            maritalStatus: contact.marital_status || "",
            marital_status: contact.marital_status || "",
            spouseName: contact.spouse_name || "",
            spouse_name: contact.spouse_name || "",
            passportNo: contact.passport_no || "",
            passport_no: contact.passport_no || "",
            otherId: contact.other_id || "",
            other_id: contact.other_id || "",
            nomineeName: contact.nominee_name || "",
            nominee_name: contact.nominee_name || "",
            nomineeRelation: contact.nominee_relation || "",
            nominee_relation: contact.nominee_relation || "",
            nomineeMobile: contact.nominee_mobile || "",
            nominee_mobile: contact.nominee_mobile || "",
            nomineeNid: contact.nominee_nid || "",
            nominee_nid: contact.nominee_nid || "",
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
            kycFormData: typeof kyc.kyc_form_data === "string" ? JSON.parse(kyc.kyc_form_data) : kyc.kyc_form_data || null,
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
        lastVisitedStep: merchant.last_visited_step || null,
        accountStatus: merchant.account_status,
        kycStatus: merchant.kyc_status,
        isSubmitted: isSubmittedStatus,
        openKycIssuesCount: openIssues.length,
        correctionRequested,
      },
      kycFieldIssues: (fieldIssues || []).map((fi) => ({
        id: fi.id,
        kycId: fi.kyc_id,
        institutionId: fi.institution_id,
        institutionName: fi.institution_name,
        branchName: fi.branch_name,
        fieldKey: fi.field_key || "",
        field_key: fi.field_key || "",
        issueType: fi.issue_type || "",
        issue_type: fi.issue_type || "",
        issueReason: fi.issue_reason || "",
        issue_reason: fi.issue_reason || "",
        status: fi.status,
        resolutionNote: fi.resolution_note,
        createdAt: fi.created_at,
        updatedAt: fi.updated_at,
      })),
      isApproved: merchant.account_status === "approved" || merchant.account_status === "active",
      customValues: customValMap,
      institution: selectedInstitution,
    };
  },

  async updateCompany(userId, data) {
    const conn = await db.getConnection();
    await conn.beginTransaction();

    try {
      const merchant = await requireEditableMerchant(userId, conn);
      const payload = { ...data };

      // Persist Merchant Segment if provided (Strictly 'micro' or 'big')
      if (payload.merchantSegment !== undefined) {
        if (payload.merchantSegment === "micro" || payload.merchantSegment === "big") {
          await conn.query("UPDATE merchants SET merchant_segment = ? WHERE id = ?", [
            payload.merchantSegment,
            merchant.id,
          ]);
        }
      }

      // 1. Channel Protection: Payment channel is established via Onboarding Setup and cannot be tampered with via arbitrary company update
      const [existingProfile] = await conn.query(
        "SELECT institution_id, channel, legal_structure_id, industry_category_id FROM merchant_profiles WHERE merchant_id = ? LIMIT 1",
        [merchant.id]
      );
      if (existingProfile.length > 0 && existingProfile[0].channel) {
        // Enforce existing authenticated channel, preventing override via form payload
        payload.channel = existingProfile[0].channel;
      }

      // Safe Institution Validation: Only check availability when selecting/changing an institution
      if (payload.institutionId !== undefined && payload.institutionId !== null) {
        const currentInstId = existingProfile[0]?.institution_id ? Number(existingProfile[0].institution_id) : null;
        const targetInstId = Number(payload.institutionId);

        // If newly selected or changed, enforce strict availability check (status=active and is_onboarding_active=1)
        if (!currentInstId || currentInstId !== targetInstId) {
          const [insts] = await conn.query(
            "SELECT id, name, status, is_onboarding_active FROM institutions WHERE id = ? LIMIT 1",
            [targetInstId]
          );
          if (insts.length === 0) {
            const err = new Error("Selected institution was not found.");
            err.statusCode = 404;
            throw err;
          }
          if (insts[0].status !== "active" || !insts[0].is_onboarding_active) {
            const err = new Error(
              `Institution '${insts[0].name}' is not currently available for onboarding. You can request notification when it becomes available.`
            );
            err.statusCode = 400;
            throw err;
          }
          payload.bankName = insts[0].name;
        } else {
          // Unchanged institution selection - fetch canonical bank name if empty
          if (!payload.bankName) {
            const [insts] = await conn.query("SELECT name FROM institutions WHERE id = ? LIMIT 1", [targetInstId]);
            if (insts.length > 0) payload.bankName = insts[0].name;
          }
        }
      }

      // 2. Catalogue Reference Resolution: Legal Structure & Industry Category
      // If businessType or legalStructureId is passed, validate and map to business_legal_structures
      if (payload.legalStructureId) {
        const [lsRows] = await conn.query(
          "SELECT id, name_en FROM business_legal_structures WHERE id = ? LIMIT 1",
          [payload.legalStructureId]
        );
        if (lsRows.length > 0) {
          payload.legalStructureId = lsRows[0].id;
          if (!payload.businessType) payload.businessType = lsRows[0].name_en;
        }
      } else if (payload.businessType) {
        const [lsRows] = await conn.query(
          "SELECT id, name_en FROM business_legal_structures WHERE LOWER(name_en) = LOWER(?) OR LOWER(name_bn) = LOWER(?) LIMIT 1",
          [payload.businessType, payload.businessType]
        );
        if (lsRows.length > 0) {
          payload.legalStructureId = lsRows[0].id;
        }
      }

      // If industry or industryCategoryId is passed, validate and map to industry_categories
      if (payload.industryCategoryId) {
        const [indRows] = await conn.query(
          "SELECT id, name_en FROM industry_categories WHERE id = ? LIMIT 1",
          [payload.industryCategoryId]
        );
        if (indRows.length > 0) {
          payload.industryCategoryId = indRows[0].id;
          if (!payload.industry) payload.industry = indRows[0].name_en;
        }
      } else if (payload.industry) {
        const [indRows] = await conn.query(
          "SELECT id, name_en FROM industry_categories WHERE LOWER(name_en) = LOWER(?) OR LOWER(name_bn) = LOWER(?) LIMIT 1",
          [payload.industry, payload.industry]
        );
        if (indRows.length > 0) {
          payload.industryCategoryId = indRows[0].id;
        }
      }

      if (!payload.industry && (payload.businessNature || payload.business_nature)) {
        payload.industry = payload.businessNature || payload.business_nature;
      }

      // Core fields that belong directly on merchant_profiles or core entities
      const CORE_PROFILE_KEYS = new Set([
        "merchantSegment", "merchant_segment",
        "companyName", "company_name",
        "companyNameBn", "company_name_bn",
        "businessType", "business_type",
        "businessNature", "business_nature",
        "legalStructureId", "legal_structure_id",
        "industry", "industry_category_id", "industryCategoryId",
        "website", "address", "city", "state",
        "postalCode", "postal_code", "country", "channel",
        "institutionId", "institution_id", "bankName", "bank_name",
        "branchId", "branch_id", "branchName", "branch_name",
        "routingNumber", "routing_number",
        "hasExistingAccount", "has_existing_account",
        "applyNewAccount", "apply_new_account",
        "accountOpeningStatus", "account_opening_status",
        "tradeLicense", "trade_license",
        "businessTin", "business_tin",
        "binVatNumber", "bin_vat_number",
        "businessRegPhone", "business_reg_phone",
        "contactMobile", "contact_mobile",
        "businessEmail", "business_email",
        "businessStartYear", "business_start_year",
        "clearFields"
      ]);

      // If merchant has a pinned form version (or active published version), save custom fields
      let formVersionId = merchant.form_version_id;
      if (!formVersionId) {
        const [[pubVer]] = await conn.query(
          `SELECT id FROM merchant_form_versions WHERE form_key IN ('onboarding_company', 'merchant_onboarding') AND status = 'published' ORDER BY version_number DESC LIMIT 1`
        );
        if (pubVer) {
          formVersionId = pubVer.id;
          payload.formVersionId = formVersionId;
        }
      }

      await merchantRepository.upsertProfile(merchant.id, payload, conn);

      // Save form fields for this step into merchant_profile_custom_values so dynamic form validation can always verify them
      if (formVersionId) {
        const [fields] = await conn.query(
          `SELECT id, field_key FROM merchant_form_fields WHERE form_version_id = ?`,
          [formVersionId]
        );
function toCamelCaseKey(str) {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

function toSnakeCaseKey(str) {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

        for (const f of fields) {
          const val =
            data[f.field_key] ??
            data[toCamelCaseKey(f.field_key)] ??
            data[toSnakeCaseKey(f.field_key)] ??
            payload[f.field_key] ??
            payload[toCamelCaseKey(f.field_key)] ??
            payload[toSnakeCaseKey(f.field_key)];
          if (val !== undefined && val !== null) {
            const stringVal = typeof val === "object" ? JSON.stringify(val) : String(val);
            const [existRows] = await conn.query(
              `SELECT id FROM merchant_profile_custom_values WHERE merchant_id = ? AND field_id = ? LIMIT 1`,
              [merchant.id, f.id]
            );
            if (existRows.length > 0) {
              await conn.query(
                `UPDATE merchant_profile_custom_values
                 SET field_value = ?, field_key = ?, step_key = 'onboarding_company', updated_at = NOW()
                 WHERE id = ?`,
                [stringVal, f.field_key, existRows[0].id]
              );
            } else {
              await conn.query(
                `INSERT INTO merchant_profile_custom_values
                 (merchant_id, field_id, field_key, field_value, step_key, created_at, updated_at)
                 VALUES (?, ?, ?, ?, 'onboarding_company', NOW(), NOW())`,
                [merchant.id, f.id, f.field_key, stringVal]
              );
            }
          }
        }
      }

      // Keep merchant_kyc synchronized with the selected institution, business entity type, and legal_structure_id
      const [existingKyc] = await conn.query(
        "SELECT id, business_entity_type, legal_structure_id FROM merchant_kyc WHERE merchant_id = ? LIMIT 1",
        [merchant.id]
      );

      if (existingKyc.length > 0) {
        await conn.query(
          `UPDATE merchant_kyc
           SET institution_id = COALESCE(?, institution_id),
               bank_name = COALESCE(NULLIF(?, ''), bank_name),
               branch_id = COALESCE(?, branch_id),
               branch_name = COALESCE(NULLIF(?, ''), branch_name),
               routing_number = COALESCE(NULLIF(?, ''), routing_number),
               business_entity_type = COALESCE(NULLIF(?, ''), business_entity_type),
               legal_structure_id = COALESCE(?, legal_structure_id),
               updated_at = NOW()
           WHERE merchant_id = ?`,
          [
            payload.institutionId || null,
            payload.bankName || null,
            payload.branchId || null,
            payload.branchName || null,
            payload.routingNumber || null,
            payload.businessType || null,
            payload.legalStructureId || null,
            merchant.id,
          ]
        );
      } else if (payload.institutionId || payload.bankName || payload.businessType || payload.legalStructureId) {
        await conn.query(
          `INSERT INTO merchant_kyc (
             merchant_id, institution_id, bank_name, branch_id, branch_name, routing_number, business_entity_type, legal_structure_id, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
          [
            merchant.id,
            payload.institutionId || null,
            payload.bankName || null,
            payload.branchId || null,
            payload.branchName || null,
            payload.routingNumber || null,
            payload.businessType || null,
            payload.legalStructureId || null,
          ]
        );
      }

      // Synchronize tradeLicense, businessTin, binVatNumber into merchant_kyc
      const tinVal = payload.businessTin || payload.business_tin || payload.tin;
      const tradeLicenseVal = payload.tradeLicense || payload.trade_license || payload.tradeLicenseNumber || payload.trade_license_number;
      const binVal = payload.binVatNumber || payload.bin_vat_number || payload.bin;
      if (tinVal || tradeLicenseVal || binVal) {
        await conn.query(
          `UPDATE merchant_kyc
           SET tin = COALESCE(NULLIF(?, ''), tin),
               trade_license_number = COALESCE(NULLIF(?, ''), trade_license_number),
               bin = COALESCE(NULLIF(?, ''), bin),
               updated_at = NOW()
           WHERE merchant_id = ?`,
          [tinVal || null, tradeLicenseVal || null, binVal || null, merchant.id]
        );
      }

      // Auto-assign Primary Business Activity if not already present or if businessNature is provided
      const [existingPrimaryAct] = await conn.query(
        `SELECT id FROM merchant_profile_activities WHERE merchant_id = ? AND activity_role = 'primary' LIMIT 1`,
        [merchant.id]
      );
      if (existingPrimaryAct.length === 0) {
        const seg = merchant.merchant_segment || "micro";
        const [eligibleActs] = await conn.query(
          `SELECT tla.id FROM trade_license_activities tla
           INNER JOIN business_activity_segment_rules basr ON basr.activity_id = tla.id
             AND basr.merchant_segment = ? AND basr.is_eligible = 1
           WHERE tla.is_active = 1
           ORDER BY tla.display_order ASC LIMIT 1`,
          [seg]
        );
        if (eligibleActs.length > 0) {
          await conn.query(
            `INSERT INTO merchant_profile_activities (merchant_id, activity_id, activity_role, created_at, updated_at)
             VALUES (?, ?, 'primary', NOW(), NOW())`,
            [merchant.id, eligibleActs[0].id]
          );
        }
      }

      await merchantRepository.updateMerchantStep(merchant.id, 2, conn);
      await merchantRepository.createHistory(
        merchant.id,
        "company",
        "update_company",
        merchant.account_status,
        merchant.account_status,
        { companyName: data.companyName },
        conn
      );

      await conn.commit();
      return await merchantRepository.getProfile(merchant.id);
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  async updateContact(userId, data) {
    const conn = await db.getConnection();
    await conn.beginTransaction();

    try {
      const merchant = await requireEditableMerchant(userId, conn);

      // Validate NID uniqueness across active/submitted/registered merchants (excluding current merchant)
      if (data.nidNo && data.nidNo.trim()) {
        const cleanNid = data.nidNo.trim();
        const [existingWithNid] = await conn.query(
          `SELECT m.id, m.merchant_code
           FROM merchants m
           INNER JOIN merchant_contacts mc ON mc.merchant_id = m.id
           WHERE mc.nid_no = ? AND m.id != ? LIMIT 1`,
          [cleanNid, merchant.id]
        );
        if (existingWithNid.length > 0) {
          const err = new Error(`জাতীয় পরিচয়পত্র নম্বর (${cleanNid}) ইতিমধ্যে অন্য একটি মার্চেন্ট অ্যাকাউন্টে ব্যবহৃত হয়েছে। প্রতি মার্চেন্টের জন্য এনআইডি নম্বর ইউনিক হতে হবে।`);
          err.statusCode = 400;
          throw err;
        }
      }

      // Validate Merchant NID vs Nominee NID
      const merchantNidClean = data.nidNo ? String(data.nidNo).replace(/\s/g, "") : "";
      const nomineeNidClean = (data.nomineeNid || data.nominee_nid) ? String(data.nomineeNid || data.nominee_nid).replace(/\s/g, "") : "";
      if (merchantNidClean && nomineeNidClean && merchantNidClean === nomineeNidClean) {
        const err = new Error("মার্চেন্ট এবং নমিনীর এনআইডি নম্বর একই হতে পারে না। প্রত্যেকের জন্য আলাদা এনআইডি নম্বর আবশ্যক।");
        err.statusCode = 400;
        throw err;
      }

      // Validate Merchant Name vs Nominee Name
      const merchantNameClean = data.name ? String(data.name).trim().toLowerCase() : "";
      const nomineeNameClean = (data.nomineeName || data.nominee_name) ? String(data.nomineeName || data.nominee_name).trim().toLowerCase() : "";
      if (merchantNameClean && nomineeNameClean && merchantNameClean === nomineeNameClean) {
        const err = new Error("মার্চেন্টের নাম এবং নমিনীর নাম একই হতে পারে না।");
        err.statusCode = 400;
        throw err;
      }

      await merchantRepository.upsertContact(merchant.id, data, conn);
      await merchantRepository.updateMerchantStep(merchant.id, 3, conn);
      await merchantRepository.createHistory(
        merchant.id,
        "contact",
        "update_contact",
        merchant.account_status,
        merchant.account_status,
        { contactName: data.name, email: data.email },
        conn
      );

      // If nidNo is provided, sync with merchant_kyc.nid_number
      if (data.nidNo) {
        await conn.query(
          `UPDATE merchant_kyc SET nid_number = ?, updated_at = NOW() WHERE merchant_id = ?`,
          [data.nidNo, merchant.id]
        );

        // Auto-resolve any open KYC issue regarding NID Number
        const [resolvedIssues] = await conn.query(
          `SELECT id, institution_id, field_key FROM kyc_field_issues
           WHERE merchant_id = ? AND status = 'open'
           AND (field_key = 'nid_number' OR field_key = 'nid' OR field_key = 'nid_no')`,
          [merchant.id]
        );

        if (resolvedIssues.length > 0) {
          await conn.query(
            `UPDATE kyc_field_issues
             SET status = 'resolved', resolution_note = 'NID Number updated by merchant', new_value = ?, updated_at = NOW()
             WHERE merchant_id = ? AND status = 'open'
             AND (field_key = 'nid_number' OR field_key = 'nid' OR field_key = 'nid_no')`,
            [data.nidNo, merchant.id]
          );

          // Notify Admin & Bank
          try {
            const [prof] = await conn.execute("SELECT company_name FROM merchant_profiles WHERE merchant_id = ? LIMIT 1", [merchant.id]);
            const company = prof[0]?.company_name || merchant.merchant_code;

            await merchantRepository.createAdminNotification(
              `Merchant Updated NID Number: ${company}`,
              `Merchant ${company} (${merchant.merchant_code}) has updated their NID Number to ${data.nidNo}.`,
              "kyc",
              `/admin/kyc`,
              conn
            );
          } catch (_) {}
        }
      }

      // Persist dynamic form custom fields for contact step
      const CORE_CONTACT_KEYS = new Set([
        "name", "nameBn", "name_bn", "designation", "email", "phone",
        "nidNo", "nid_no", "division", "country", "dob", "fatherName",
        "father_name", "motherName", "mother_name", "gender", "permanentAddress",
        "permanent_address", "presentAddress", "present_address", "isSameAddress",
        "is_same_address", "maritalStatus", "marital_status", "spouseName",
        "spouse_name", "passportNo", "passport_no", "otherId", "other_id",
        "nomineeName", "nominee_name", "nomineeRelation", "nominee_relation",
        "nomineeCustomRelation", "nomineeMobile", "nominee_mobile", "nomineeNid",
        "nominee_nid", "clearFields"
      ]);
      await saveCustomFieldsForStep(conn, merchant.id, "onboarding_contact", data, CORE_CONTACT_KEYS);

      await conn.commit();
      return await merchantRepository.getContact(merchant.id);
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  async updateCommercial(userId, data) {
    const conn = await db.getConnection();
    await conn.beginTransaction();

    try {
      const merchant = await requireEditableMerchant(userId, conn);
      await merchantRepository.upsertCommercial(merchant.id, data, conn);
      await merchantRepository.updateMerchantStep(merchant.id, 4, conn);
      await merchantRepository.createHistory(
        merchant.id,
        "commercial",
        "update_commercial",
        merchant.account_status,
        merchant.account_status,
        null,
        conn
      );

      // Persist dynamic form custom fields for commercial step
      const CORE_COMMERCIAL_KEYS = new Set([
        "transactionsPerDay", "transactions_per_day", "transactionsPerMonth",
        "transactions_per_month", "volumePerDay", "volume_per_day",
        "volumePerMonth", "volume_per_month", "maximumTicketSize",
        "maximum_ticket_size", "returnUrl", "return_url", "merchantDomain",
        "merchant_domain", "merchantIpAddress", "merchant_ip_address", "clearFields"
      ]);
      await saveCustomFieldsForStep(conn, merchant.id, "onboarding_commercial", data, CORE_COMMERCIAL_KEYS);

      await conn.commit();
      return await merchantRepository.getCommercial(merchant.id);
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
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
      kycFormData: typeof kyc.kyc_form_data === "string"
        ? (() => { try { return JSON.parse(kyc.kyc_form_data); } catch { return null; } })()
        : (kyc.kyc_form_data || null),
    };
  },

  async updateKyc(userId, data) {
    const conn = await db.getConnection();
    await conn.beginTransaction();

    try {
      const merchant = await requireEditableMerchant(userId, conn);

      const payload = { ...data };

      // If branchId is supplied, auto-sync verified branch data from database
      if (payload.branchId) {
        const [branches] = await conn.query(
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

      // Validate institution if institutionId is provided
      if (payload.institutionId) {
        const [insts] = await conn.query(
          "SELECT id, name, institution_type, status FROM institutions WHERE id = ? LIMIT 1",
          [payload.institutionId]
        );
        if (insts.length === 0) {
          const err = new Error("Selected institution was not found.");
          err.statusCode = 404;
          throw err;
        }
        if (insts[0].status !== "active") {
          const err = new Error("Selected institution is not active or available for onboarding.");
          err.statusCode = 400;
          throw err;
        }
        payload.bankName = insts[0].name;

        // Check whether existing account is declared
        const [profRow] = await conn.query(
          "SELECT has_existing_account FROM merchant_profiles WHERE merchant_id = ? LIMIT 1",
          [merchant.id]
        );
        const hasExistingAcc = profRow.length > 0 && profRow[0].has_existing_account !== null ? Boolean(profRow[0].has_existing_account) : (payload.hasExistingAccount !== undefined ? Boolean(payload.hasExistingAccount) : true);

        // If institution is MFS, ensure branch details are not required or kept as bank branches
        if (insts[0].institution_type === "mfs") {
          payload.branchId = null;
          payload.branchName = "";
          payload.branchCode = null;
        }

        // If existing account exists, validate account holder and number only if number is actually provided
        if (hasExistingAcc && payload.accountNumber && payload.accountNumber.trim().length >= 8) {
          // Uniqueness validation is useful once the account number has reached a
          // plausible length. Partial values are allowed during draft autosave.
          const cleanAcc = payload.accountNumber.trim();
          const [existingWithAcc] = await conn.query(
            `SELECT m.id, m.merchant_code
             FROM merchants m
             INNER JOIN merchant_kyc mk ON mk.merchant_id = m.id
             WHERE mk.bank_account_number = ? AND m.id != ? LIMIT 1`,
            [cleanAcc, merchant.id]
          );
          if (existingWithAcc.length > 0) {
            const err = new Error(`হিসাব নম্বর / ওয়ালেট নম্বর (${cleanAcc}) ইতিমধ্যে অন্য একটি মার্চেন্ট প্রোফাইলে ব্যবহৃত হয়েছে। অ্যাকাউন্ট নম্বর অবশ্যই ইউনিক হতে হবে।`);
            err.statusCode = 400;
            throw err;
          }
        }
      }

      // Validate NID Number uniqueness if provided in KYC payload
      if (payload.nidNumber && payload.nidNumber.trim()) {
        const cleanNid = payload.nidNumber.trim();
        const [existingWithNid] = await conn.query(
          `SELECT m.id, m.merchant_code
           FROM merchants m
           INNER JOIN merchant_kyc mk ON mk.merchant_id = m.id
           WHERE mk.nid_number = ? AND m.id != ? LIMIT 1`,
          [cleanNid, merchant.id]
        );
        if (existingWithNid.length > 0) {
          const err = new Error(`জাতীয় পরিচয়পত্র নম্বর (${cleanNid}) ইতিমধ্যে অন্য একটি মার্চেন্ট অ্যাকাউন্টে ব্যবহৃত হয়েছে। প্রতি মার্চেন্টের জন্য এনআইডি নম্বর ইউনিক হতে হবে।`);
          err.statusCode = 400;
          throw err;
        }
      }

      // If authorizedPersonName is not explicitly given, fallback to contact person name
      if (!payload.authorizedPersonName) {
        const [contactRows] = await conn.query(
          "SELECT name, designation FROM merchant_contacts WHERE merchant_id = ? LIMIT 1",
          [merchant.id]
        );
        if (contactRows.length > 0 && contactRows[0].name) {
          payload.authorizedPersonName = contactRows[0].name;
          if (!payload.designation && contactRows[0].designation) {
            payload.designation = contactRows[0].designation;
          }
        }
      }

      await merchantRepository.upsertKyc(merchant.id, payload, conn);

      // Keep merchant_profiles synchronized with the selected institution and business entity type
      if (payload.institutionId || payload.bankName || payload.businessEntityType) {
        await conn.query(
          `UPDATE merchant_profiles
           SET institution_id = COALESCE(?, institution_id),
               bank_name = COALESCE(NULLIF(?, ''), bank_name),
               branch_id = COALESCE(?, branch_id),
               branch_name = COALESCE(NULLIF(?, ''), branch_name),
               routing_number = COALESCE(NULLIF(?, ''), routing_number),
               business_type = COALESCE(NULLIF(?, ''), business_type),
               updated_at = NOW()
           WHERE merchant_id = ?`,
          [
            payload.institutionId || null,
            payload.bankName || null,
            payload.branchId || null,
            payload.branchName || null,
            payload.routingNumber || null,
            payload.businessEntityType || null,
            merchant.id,
          ]
        );
      }

      // Sync only commercial fields actually included in this KYC request.
      // Sending an unrelated/partial KYC update must never reset omitted commercial
      // values to zero or NULL.
      const commData = payload.commercialData || payload.kycFormData?.commercialData;
      const commSource = commData && typeof commData === "object" ? commData : payload;
      const commercialFieldMap = {
        transactionsPerDay: "transactions_per_day",
        transactionsPerMonth: "transactions_per_month",
        volumePerDay: "volume_per_day",
        volumePerMonth: "volume_per_month",
        maximumTicketSize: "maximum_ticket_size",
        returnUrl: "return_url",
        merchantDomain: "merchant_domain",
        merchantIpAddress: "merchant_ip_address",
      };
      const commercialPatch = {};
      for (const [camelKey, snakeKey] of Object.entries(commercialFieldMap)) {
        if (Object.prototype.hasOwnProperty.call(commSource, camelKey)) {
          commercialPatch[camelKey] = commSource[camelKey];
        } else if (Object.prototype.hasOwnProperty.call(commSource, snakeKey)) {
          commercialPatch[camelKey] = commSource[snakeKey];
        }
      }
      if (Object.keys(commercialPatch).length > 0) {
        await merchantRepository.upsertCommercial(merchant.id, commercialPatch, conn);
      }

      await merchantRepository.updateMerchantStep(merchant.id, 4, conn);
      await merchantRepository.createHistory(
        merchant.id,
        "kyc",
        "update_kyc",
        merchant.account_status,
        merchant.account_status,
        null,
        conn
      );

      // Auto-resolve any open KYC field issues that match fields updated in payload
      try {
        const keysToCheck = [];
        if (payload.tradeLicenseNumber) keysToCheck.push("trade_license_number", "trade_license");
        if (payload.tin) keysToCheck.push("tin", "tin_certificate");
        if (payload.bin) keysToCheck.push("bin");
        if (payload.nidNumber) keysToCheck.push("nid_number", "nid");
        if (payload.authorizedPersonName) keysToCheck.push("authorized_person_name", "authorized_person");
        if (payload.designation) keysToCheck.push("designation");
        if (payload.accountNumber) keysToCheck.push("bank_account_number", "account_number");
        if (payload.accountHolderName) keysToCheck.push("bank_account_name", "account_name");
        if (payload.routingNumber) keysToCheck.push("routing_number");
        if (payload.branchName) keysToCheck.push("branch_name");
        if (payload.legalBusinessName) keysToCheck.push("legal_business_name");

        if (keysToCheck.length > 0) {
          for (const k of keysToCheck) {
            await conn.query(
              `UPDATE kyc_field_issues
               SET status = 'resolved', resolution_note = 'Field updated by merchant', updated_at = NOW()
               WHERE merchant_id = ? AND status = 'open' AND (field_key = ? OR LOWER(field_key) LIKE ?)`,
              [merchant.id, k, `%${k}%`]
            );
          }
        }
      } catch (e) {
        console.warn("Auto-resolving kyc field issues warning:", e);
      }

      // Persist dynamic form custom fields for KYC step
      const CORE_KYC_KEYS = new Set([
        "legalBusinessName", "businessEntityType", "tradeLicenseNumber",
        "registrationNumber", "tin", "bin", "authorizedPersonName",
        "designation", "nidNumber", "nidIssueDate", "nidExpiryDate",
        "institutionId", "branchId", "bankName", "branchName",
        "branchCode", "division", "district", "upazila",
        "branchAddress", "accountHolderName", "accountNumber",
        "routingNumber", "accountType", "hasExistingAccount",
        "applyNewAccount", "accountOpeningStatus", "transactionsPerDay",
        "transactionsPerMonth", "volumePerDay", "volumePerMonth",
        "maximumTicketSize", "commercialData", "kycFormData", "clearFields"
      ]);
      await saveCustomFieldsForStep(conn, merchant.id, "onboarding_kyc", data, CORE_KYC_KEYS);

      await conn.commit();
      return await this.getKyc(userId);
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
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

    const normalizedType = normalizeDocType(documentType);
    const isOutletPhoto = normalizedType === "BUSINESS_OUTLET_PHOTO";

    let merchant;
    try {
      if (isOutletPhoto) {
        // Business outlet / shop photo can be uploaded anytime by the merchant
        merchant = await merchantRepository.findOrCreateMerchantByUserId(userId);
      } else {
        merchant = await requireEditableMerchant(userId);
      }
    } catch (error) {
      if (file.path) await secureStorage.deletePhysicalFile(file.path).catch(() => {});
      throw error;
    }

    // Validate the temporary file before it can enter permanent private storage.
    try {
      if (file.path) {
        const sigResult = await validateFileSignature(file.path);
        if (!sigResult.isValid) {
          const error = new Error(sigResult.error || "Invalid file signature");
          error.statusCode = sigResult.isHeic ? 415 : 400;
          throw error;
        }
      }
    } catch (validationError) {
      if (file.path) await secureStorage.deletePhysicalFile(file.path).catch(() => {});
      throw validationError;
    }

    const safeDocName = documentName || customLabel || file.originalname || normalizedType;
    const { storageKey, filePath, size, mimeType } = await secureStorage.saveFile(file, merchant.id);

    let doc;
    let existingDoc;
    let wasRejected = false;
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      // Re-check and lock the merchant row in the same transaction as the document
      // metadata write. Submission cannot race between the status check and insert.
      if (isOutletPhoto) {
        merchant = await merchantRepository.findOrCreateMerchantByUserId(userId, conn);
      } else {
        merchant = await requireEditableMerchant(userId, conn);
      }
      existingDoc = await merchantRepository.getDocumentByType(merchant.id, normalizedType, conn);
      wasRejected = Boolean(existingDoc && (
        String(existingDoc.status || "").toLowerCase() === "rejected" ||
        Boolean(existingDoc.review_comment)
      ));

      doc = await merchantRepository.createDocument(merchant.id, {
        documentType: normalizedType,
        documentName: safeDocName,
        customLabel: customLabel || safeDocName,
        originalFilename: file.originalname,
        storedFilename: storageKey.split("/").pop(),
        storageKey,
        mimeType,
        fileSize: size,
      }, conn);

      await merchantRepository.updateMerchantStep(merchant.id, 6, conn);
      await merchantRepository.createHistory(
        merchant.id,
        "documents",
        "upload_document",
        merchant.account_status,
        merchant.account_status,
        { documentId: doc.id, documentType: normalizedType },
        conn
      );

      await conn.commit();
    } catch (dbErr) {
      await conn.rollback();
      await secureStorage.deletePhysicalFile(filePath).catch(() => {});
      throw dbErr;
    } finally {
      conn.release();
    }

    // If a 1:1 document type replaced an earlier document, unlink the old physical
    // file only after the new database reference has committed successfully.
    if (existingDoc && Number(doc?.id) === Number(existingDoc.id) && existingDoc.storage_key && existingDoc.storage_key !== storageKey) {
      try {
        const [refRows] = await db.execute(
          "SELECT COUNT(*) AS cnt FROM merchant_documents WHERE storage_key = ?",
          [existingDoc.storage_key]
        );
        if (Number(refRows[0]?.cnt || 0) === 0) {
          await secureStorage.deleteFile(existingDoc.storage_key, merchant.id);
        }
      } catch (cleanupError) {
        console.warn("[SafeUploadReplace] Old document cleanup deferred:", cleanupError.message);
      }
    }

    // Auto-resolve open KYC issue matching this document type and notify Admin & Institution
    const docKey = String(normalizedType || "").toLowerCase();
    const [matchingIssues] = await db.query(
      `SELECT id, institution_id, field_key, issue_reason FROM kyc_field_issues
       WHERE merchant_id = ? AND status = 'open'
       AND (field_key = ? OR field_key = ? OR LOWER(field_key) LIKE ?)`,
      [merchant.id, docKey, normalizedType, `%${docKey}%`]
    );

    if (matchingIssues.length > 0) {
      await db.query(
        `UPDATE kyc_field_issues
         SET status = 'resolved', resolution_note = 'Document uploaded by merchant', updated_at = NOW()
         WHERE merchant_id = ? AND status = 'open'
         AND (field_key = ? OR field_key = ? OR LOWER(field_key) LIKE ?)`,
        [merchant.id, docKey, normalizedType, `%${docKey}%`]
      );
    }

    // Always dispatch notification if this document was previously rejected/had comment, or had an issue
    if (matchingIssues.length > 0 || wasRejected) {
      try {
        const [prof] = await db.execute("SELECT company_name FROM merchant_profiles WHERE merchant_id = ? LIMIT 1", [merchant.id]);
        const company = prof[0]?.company_name || merchant.merchant_code;
        const displayDocName = doc.custom_label || doc.document_name || normalizedType.replace(/_/g, " ");

        await merchantRepository.createAdminNotification(
          `ডকুমেন্ট রি-সাবমিশন: ${company}`,
          `মার্চেন্ট ${company} (${merchant.merchant_code}) বাতিলকৃত বা প্রয়োজনীয় ডকুমেন্ট '${displayDocName}' পুনরায় আপলোড ও সাবমিট করেছে।`,
          "document",
          `/admin/merchants/${merchant.id}?tab=documents&highlightDoc=${doc.id || doc.document_type || normalizedType}`
        );

        // Find active institution application if any
        const [appRows] = await db.execute(
          `SELECT id, institution_id, application_number FROM merchant_gateway_applications
           WHERE merchant_id = ? ORDER BY id DESC LIMIT 1`,
          [merchant.id]
        );

        if (appRows.length > 0 && appRows[0].institution_id) {
          const instApp = appRows[0];
          await db.query(
            `INSERT INTO notifications (recipient_type, recipient_id, institution_id, title, message, type, link, is_read, created_at)
             VALUES ('institution', NULL, ?, ?, ?, 'document', ?, 0, NOW())`,
            [
              Number(instApp.institution_id),
              `ডকুমেন্ট রি-সাবমিশন: ${company}`,
              `মার্চেন্ট ${company} (${merchant.merchant_code}) ডকুমেন্ট '${displayDocName}' পুনরায় সাবমিট করেছে (আবেদন #${instApp.application_number || instApp.id})।`,
              `/institution/kyc-review?applicationId=${instApp.id}&tab=documents&highlightDoc=${doc.id || doc.document_type || normalizedType}`
            ]
          );
        } else {
          for (const iss of matchingIssues) {
            if (iss.institution_id) {
              await db.query(
                `INSERT INTO notifications (recipient_type, recipient_id, institution_id, title, message, type, link, is_read, created_at)
                 VALUES ('institution', NULL, ?, ?, ?, 'document', '/institution/kyc-review', 0, NOW())`,
                [
                  Number(iss.institution_id),
                  `ডকুমেন্ট রি-সাবমিশন: ${company}`,
                  `মার্চেন্ট ${company} (${merchant.merchant_code}) ডকুমেন্ট '${displayDocName}' পুনরায় আপলোড করেছে।`,
                ]
              );
            }
          }
        }
      } catch (errNotif) {
        console.error("Failed to dispatch upload notification:", errNotif);
      }
    }

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

    const normalizedType = normalizeDocType(documentType);
    const isOutletPhoto = normalizedType === "BUSINESS_OUTLET_PHOTO";

    let merchant;
    try {
      if (isOutletPhoto) {
        // Business outlet / shop photo can be uploaded anytime by the merchant
        merchant = await merchantRepository.findOrCreateMerchantByUserId(userId);
      } else {
        merchant = await requireEditableMerchant(userId);
      }
    } catch (error) {
      if (file.path) await secureStorage.deletePhysicalFile(file.path).catch(() => {});
      throw error;
    }

    try {
      if (file.path) {
        const sigResult = await validateFileSignature(file.path);
        if (!sigResult.isValid) {
          const error = new Error(sigResult.error || "Invalid file signature");
          error.statusCode = sigResult.isHeic ? 415 : 400;
          throw error;
        }
      }
    } catch (validationError) {
      if (file.path) await secureStorage.deletePhysicalFile(file.path).catch(() => {});
      throw validationError;
    }

    const initialDoc = await merchantRepository.getDocumentById(docId, merchant.id);
    if (!initialDoc) {
      if (file.path) await secureStorage.deletePhysicalFile(file.path).catch(() => {});
      const error = new Error("Document not found or unauthorized");
      error.statusCode = 404;
      throw error;
    }

    // Write the new private file first. The old file remains intact until the
    // metadata transaction commits successfully.
    const { storageKey, filePath: newFilePath, size, mimeType } = await secureStorage.saveFile(file, merchant.id);
    const safeDocName = documentName || customLabel || file.originalname || initialDoc.document_name;

    let existingDoc;
    let updatedDoc;
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      merchant = await merchantRepository.findOrCreateMerchantByUserId(userId, conn);
      existingDoc = await merchantRepository.getDocumentById(docId, merchant.id, conn);

      if (!existingDoc) {
        const error = new Error("Document not found or unauthorized");
        error.statusCode = 404;
        throw error;
      }

      // If document is not a business outlet photo, enforce editable merchant rule
      if (existingDoc.document_type !== "BUSINESS_OUTLET_PHOTO") {
        merchant = await requireEditableMerchant(userId, conn);
      }
      if (existingDoc.storage_key !== initialDoc.storage_key) {
        const error = new Error("This document was changed by another request. Refresh and retry.");
        error.statusCode = 409;
        error.code = "DOCUMENT_CHANGED_CONCURRENTLY";
        throw error;
      }

      updatedDoc = await merchantRepository.replaceDocument(docId, merchant.id, {
        documentName: safeDocName,
        customLabel: customLabel || existingDoc.custom_label || safeDocName,
        originalFilename: file.originalname,
        storedFilename: storageKey.split("/").pop(),
        storageKey,
        mimeType,
        fileSize: size,
      }, conn);

      await merchantRepository.createHistory(
        merchant.id,
        "documents",
        "replace_document",
        merchant.account_status,
        merchant.account_status,
        { documentId: docId },
        conn
      );

      await conn.commit();
    } catch (dbErr) {
      await conn.rollback();
      await secureStorage.deletePhysicalFile(newFilePath).catch(() => {});
      throw dbErr;
    } finally {
      conn.release();
    }

    // 3. Database committed successfully: Now safely delete old file if it isn't referenced elsewhere
    if (existingDoc.storage_key && existingDoc.storage_key !== storageKey) {
      try {
        const [refRows] = await db.execute(
          "SELECT COUNT(*) as cnt FROM merchant_documents WHERE storage_key = ? AND id != ?",
          [existingDoc.storage_key, docId]
        );
        if (Number(refRows[0]?.cnt || 0) === 0) {
          await secureStorage.deleteFile(existingDoc.storage_key, merchant.id);
        }
      } catch (delErr) {
        // Non-blocking orphan warning
        console.warn(`[SafeReplace] Warning: Could not delete old file ${existingDoc.storage_key}:`, delErr.message);
      }
    }

    // Auto-resolve any open KYC issue for this document type and notify Admin & Institution
    const docKey = String(existingDoc.document_type || "").toLowerCase();
    const [matchingIssues] = await db.query(
      `SELECT id, institution_id, field_key, issue_reason FROM kyc_field_issues
       WHERE merchant_id = ? AND status = 'open'
       AND (field_key = ? OR field_key = ? OR LOWER(field_key) LIKE ?)`,
      [merchant.id, docKey, existingDoc.document_type, `%${docKey}%`]
    );

    // If document was previously rejected or had open issues, notify Admin & Bank on replacement/resubmission
    const wasRejected = String(existingDoc.status || "").toLowerCase() === "rejected";
    if (matchingIssues.length > 0 || wasRejected) {
      if (matchingIssues.length > 0) {
        await db.query(
          `UPDATE kyc_field_issues
           SET status = 'resolved', resolution_note = 'New document uploaded by merchant', updated_at = NOW()
           WHERE merchant_id = ? AND status = 'open'
           AND (field_key = ? OR field_key = ? OR LOWER(field_key) LIKE ?)`,
          [merchant.id, docKey, existingDoc.document_type, `%${docKey}%`]
        );
      }

      try {
        const [prof] = await db.execute("SELECT company_name FROM merchant_profiles WHERE merchant_id = ? LIMIT 1", [merchant.id]);
        const company = prof[0]?.company_name || merchant.merchant_code;
        const docLabel = existingDoc.custom_label || existingDoc.document_name || existingDoc.document_type;

        // Admin notification with direct link to merchant documents tab
        await merchantRepository.createAdminNotification(
          `ডকুমেন্ট রি-সাবমিশন: ${company}`,
          `মার্চেন্ট ${company} (${merchant.merchant_code}) বাতিলকৃত বা সংশোধিত ডকুমেন্ট '${docLabel}' পুনরায় আপলোড ও সাবমিট করেছে।`,
          "document",
          `/admin/merchants/${merchant.id}?tab=documents&highlightDoc=${existingDoc.id || existingDoc.document_type}`
        );

        // Find any active institution application for this merchant
        const [appRows] = await db.execute(
          `SELECT id, institution_id, application_number FROM merchant_gateway_applications
           WHERE merchant_id = ? ORDER BY id DESC LIMIT 1`,
          [merchant.id]
        );

        if (appRows.length > 0 && appRows[0].institution_id) {
          const instApp = appRows[0];
          await db.query(
            `INSERT INTO notifications (recipient_type, recipient_id, institution_id, title, message, type, link, is_read, created_at)
             VALUES ('institution', NULL, ?, ?, ?, 'document', ?, 0, NOW())`,
            [
              Number(instApp.institution_id),
              `ডকুমেন্ট রি-সাবমিশন: ${company}`,
              `মার্চেন্ট ${company} (${merchant.merchant_code}) ডকুমেন্ট '${docLabel}' পুনরায় সাবমিট করেছে (আবেদন #${instApp.application_number || instApp.id})।`,
              `/institution/kyc-review?applicationId=${instApp.id}&tab=documents&highlightDoc=${existingDoc.id || existingDoc.document_type}`
            ]
          );
        } else {
          for (const iss of matchingIssues) {
            if (iss.institution_id) {
              await db.query(
                `INSERT INTO notifications (recipient_type, recipient_id, institution_id, title, message, type, link, is_read, created_at)
                 VALUES ('institution', NULL, ?, ?, ?, 'document', '/institution/kyc-review', 0, NOW())`,
                [
                  Number(iss.institution_id),
                  `ডকুমেন্ট রি-সাবমিশন: ${company}`,
                  `মার্চেন্ট ${company} (${merchant.merchant_code}) ডকুমেন্ট '${docLabel}' পুনরায় আপলোড করেছে।`,
                ]
              );
            }
          }
        }
      } catch (errNotif) {
        console.error("Failed to dispatch replace notification:", errNotif);
      }
    }

    return {
      ...updatedDoc,
      documentType: normalizeDocType(updatedDoc.document_type),
    };
  },

  async deleteDocument(userId, docId) {
    let merchant;
    let existingDoc;
    const conn = await db.getConnection();

    try {
      await conn.beginTransaction();
      merchant = await merchantRepository.findOrCreateMerchantByUserId(userId, conn);
      existingDoc = await merchantRepository.getDocumentById(docId, merchant.id, conn);

      if (!existingDoc) {
        const error = new Error("Document not found or unauthorized");
        error.statusCode = 404;
        throw error;
      }

      // If document is not a business outlet photo, enforce editable merchant rule
      if (existingDoc.document_type !== "BUSINESS_OUTLET_PHOTO") {
        merchant = await requireEditableMerchant(userId, conn);
      }

      await merchantRepository.deleteDocument(docId, merchant.id, conn);
      await merchantRepository.createHistory(
        merchant.id,
        "documents",
        "delete_document",
        merchant.account_status,
        merchant.account_status,
        { documentId: docId, documentType: existingDoc.document_type },
        conn
      );

      await conn.commit();
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }

    // The metadata deletion is committed. Remove the private file only when no
    // other merchant document record references the same storage key.
    if (existingDoc.storage_key) {
      try {
        const [refRows] = await db.execute(
          "SELECT COUNT(*) AS cnt FROM merchant_documents WHERE storage_key = ?",
          [existingDoc.storage_key]
        );
        if (Number(refRows[0]?.cnt || 0) === 0) {
          await secureStorage.deleteFile(existingDoc.storage_key, merchant.id);
        }
      } catch (delErr) {
        console.warn("[SafeDelete] Physical document cleanup deferred:", delErr.message);
      }
    }

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
    const [profile, contact, commercial, kyc, documents, verification, openIssueRows, correctionApplicationRows] = await Promise.all([
      merchantRepository.getProfile(merchant.id),
      merchantRepository.getContact(merchant.id),
      merchantRepository.getCommercial(merchant.id),
      merchantRepository.getKyc(merchant.id),
      merchantRepository.getDocuments(merchant.id),
      merchantRepository.getUserVerification(userId),
      db.query(
        `SELECT id FROM kyc_field_issues WHERE merchant_id = ? AND status = 'open' LIMIT 1`,
        [merchant.id]
      ).then(([rows]) => rows).catch(() => []),
      db.query(
        `SELECT id FROM merchant_gateway_applications
         WHERE merchant_id = ? AND application_type = 'onboarding_kyc'
           AND status = 'additional_information_required' LIMIT 1`,
        [merchant.id]
      ).then(([rows]) => rows).catch(() => []),
    ]);
    const accountStatus = String(merchant.account_status || "").toLowerCase();
    const kycStatus = String(merchant.kyc_status || "").toLowerCase();
    const correctionRequested =
      accountStatus === "additional_information_required" ||
      kycStatus === "additional_information_required" ||
      openIssueRows.length > 0 ||
      correctionApplicationRows.length > 0;

    const instId = kyc?.institution_id || profile?.institution_id || null;
    let effectiveDynamicReqs = null;
    if (instId) {
      try {
        const bType = String(profile?.business_type || kyc?.business_entity_type || "").toLowerCase();
        const segment = String(merchant?.merchant_segment || "").toLowerCase();
        const isMicro = segment === "micro" || bType.includes("micro") || bType.includes("sole") || bType.includes("pra") || bType.includes("proprietor");
        effectiveDynamicReqs = await merchantRepository.getInstitutionKycRequirements(instId, null, isMicro ? "micro_merchant" : bType);
      } catch (_) {}
    }

    const progress = calculateProgress(
      profile,
      contact,
      commercial,
      kyc,
      documents,
      verification,
      effectiveDynamicReqs,
      merchant
    );
    const isSubmittedStatus =
      ["submitted", "under_review", "approved", "active", "suspended"].includes(accountStatus) &&
      !correctionRequested;
    const { steps, docChecklist } = progress;
    const percentage = isSubmittedStatus ? 100 : progress.percentage;
    const canSubmit = ["submitted", "under_review", "approved", "active", "suspended"].includes(accountStatus)
      ? false
      : progress.canSubmit;

    return {
      merchantId: merchant.id,
      merchantCode: merchant.merchant_code,
      accountStatus: merchant.account_status,
      kycStatus: merchant.kyc_status,
      onboardingStep: merchant.onboarding_step,
      lastVisitedStep: merchant.last_visited_step || null,
      submittedAt: merchant.submitted_at,
      approvedAt: merchant.approved_at,
      rejectedAt: merchant.rejected_at,
      rejectionReason: merchant.rejection_reason,
      steps,
      percentage,
      canSubmit,
      isSubmitted: isSubmittedStatus,
      correctionRequested,
      docChecklist,
      verification,
    };
  },

  async submitApplication(userId) {
    const conn = await db.getConnection();
    let merchant;
    let profile;
    let contact;
    let commercial;
    let kyc;
    let documents;
    let verification;
    let submittedAt;
    let prevAccountStatus;
    let selectedInstId;
    let activeFormVersionId;

    try {
      await conn.beginTransaction();

      merchant = await merchantRepository.findOrCreateMerchantByUserId(userId, conn);
      const [lockedRows] = await conn.execute(
        `SELECT * FROM merchants WHERE id = ? AND user_id = ? LIMIT 1 FOR UPDATE`,
        [merchant.id, userId]
      );
      merchant = lockedRows[0];

      if (!merchant) {
        const error = new Error("Merchant account was not found for this authenticated user.");
        error.statusCode = 404;
        throw error;
      }

      const currentStatus = String(merchant.account_status || "draft").toLowerCase();
      if (["submitted", "under_review"].includes(currentStatus)) {
        const error = new Error("Your application has already been submitted and is currently under review");
        error.statusCode = 409;
        error.code = "APPLICATION_ALREADY_SUBMITTED";
        throw error;
      }

      if (["approved", "active", "suspended"].includes(currentStatus)) {
        const error = new Error("Your merchant account is finalized. A new submission is not permitted.");
        error.statusCode = 409;
        error.code = "MERCHANT_APPLICATION_FINALIZED";
        throw error;
      }

      // Read every onboarding record on the same transaction/connection while the
      // merchant row is locked. All merchant-side update endpoints acquire this
      // same row lock, so submission and edits cannot race each other.
      profile = await merchantRepository.getProfile(merchant.id, conn);
      contact = await merchantRepository.getContact(merchant.id, conn);
      commercial = await merchantRepository.getCommercial(merchant.id, conn);
      kyc = await merchantRepository.getKyc(merchant.id, conn);
      documents = await merchantRepository.getDocuments(merchant.id, conn);
      verification = await merchantRepository.getUserVerification(userId, conn);

      const missing = [];
      if (!profile || !profile.company_name) {
        missing.push("Company Information (Company Name)");
      }
      if (profile && (!String(profile.address || "").trim() || !String(profile.city || "").trim() || !String(profile.state || "").trim())) {
        missing.push("Company Information (Registered Address, City/Thana and Division)");
      }
      if (!contact || !contact.name || !contact.email || !contact.phone) {
        missing.push("Contact Information (Name, Email, Phone)");
      }

      // Require an explicit, valid active institution association for application submission.
      selectedInstId = kyc?.institution_id || profile?.institution_id || null;
      let selectedInstitution = null;
      if (!selectedInstId) {
        missing.push("Institution Selection (Partner Bank / MFS Provider selection is required)");
      } else {
        const [instCheck] = await conn.query(
          "SELECT id, name, institution_type, status, is_onboarding_active FROM institutions WHERE id = ? LIMIT 1",
          [selectedInstId]
        );
        selectedInstitution = instCheck[0] || null;
        if (!selectedInstitution) {
          missing.push("Valid Institution (Selected institution does not exist)");
        } else if (selectedInstitution.status !== "active") {
          missing.push(`Active Institution (${selectedInstitution.name} is currently inactive on the platform)`);
        } else if (!selectedInstitution.is_onboarding_active) {
          missing.push(`Onboarding Active (${selectedInstitution.name}-এর অনবোর্ডিং প্রক্রিয়া এখনো শুরু হয়নি। অন্য কোনো সচল ব্যাংক বা MFS নির্বাচন করুন)`);
        }
      }

      const bType = String(profile?.business_type || kyc?.business_entity_type || "").toLowerCase();
      const segment = String(merchant?.merchant_segment || "").toLowerCase();
      const isMicro = segment === "micro" || bType.includes("micro") || bType.includes("sole") || bType.includes("pra") || bType.includes("proprietor");

      if (!kyc || !kyc.legal_business_name || (!kyc.nid_number && !contact?.nid_no)) {
        missing.push("KYC Information (Legal Name, NID, Bank details)");
      }
      if (!isMicro && (!kyc?.trade_license_number || !kyc?.tin)) {
        missing.push("Big Merchant KYC (Trade License Number, e-TIN Number)");
      }

      // Phase 1 Submission Validation: Require exactly one eligible Primary Business Activity
      const [primaryActRows] = await conn.query(
        `SELECT mpa.activity_id, basr.is_eligible
         FROM merchant_profile_activities mpa
         LEFT JOIN business_activity_segment_rules basr
           ON basr.activity_id = mpa.activity_id
          AND basr.merchant_segment = ?
         WHERE mpa.merchant_id = ? AND mpa.activity_role = 'primary' LIMIT 2`,
        [merchant.merchant_segment || "micro", merchant.id]
      );

      if (primaryActRows.length === 0) {
        missing.push("প্রধান ব্যবসায়িক কার্যক্রম (Primary Business Activity selection is required)");
      } else if (primaryActRows.length > 1) {
        missing.push("সঠিক ব্যবসায়িক কার্যক্রম (Only one Primary Business Activity is permitted)");
      } else if (merchant.merchant_segment && primaryActRows[0].is_eligible !== 1) {
        missing.push("অনুমোদিত ব্যবসায়িক কার্যক্রম (Selected Primary Business Activity is not eligible for your merchant segment)");
      }

      const uploadedDocTypes = (documents || []).map((d) => normalizeDocType(d.document_type));

      // Dynamic server-side Form Builder validation: If a pinned form version exists, validate required fields
      const pinnedFormVersionId = profile?.form_version_id || null;
      if (pinnedFormVersionId) {
        // Fetch custom values for this merchant
        const [customVals] = await conn.query(
          `SELECT field_id, field_key, field_value FROM merchant_profile_custom_values WHERE merchant_id = ?`,
          [merchant.id]
        );
        const customValMap = {};
        for (const cv of customVals) {
          if (cv.field_key) customValMap[cv.field_key] = cv.field_value;
          customValMap[`field_${cv.field_id}`] = cv.field_value;
        }

        const { formBuilderService } = await import("../admin/formBuilder/formBuilder.service.js");
        const renderedForm = await formBuilderService.previewVersion(pinnedFormVersionId, {
          merchantSegment: merchant.merchant_segment === "big" ? "big" : "micro",
          channel: profile?.channel === "mfs" ? "mfs" : "bank",
        });

        for (const sec of renderedForm.sections || []) {
          for (const f of sec.fields || []) {
            const key = f.field_key;
            const sysKey = f.system_field_key || key;

            // Business TIN, BIN exemptions (optional for all merchants per requirement)
            if (key === "business_tin" || sysKey === "business_tin" || key === "tin" || sysKey === "tin" || key === "bin" || sysKey === "bin") {
              continue;
            }

            if (f.isRequired) {
              // Check if value is present in profile, kyc, contact, or custom values
              const val =
                profile?.[key] ??
                profile?.[sysKey] ??
                kyc?.[key] ??
                kyc?.[sysKey] ??
                contact?.[key] ??
                contact?.[sysKey] ??
                customValMap[key] ??
                customValMap[`field_${f.id}`];

              if (val === undefined || val === null || String(val).trim() === "") {
                missing.push(`${f.label_bn || f.label_en || key} (${sec.title_bn || sec.title_en})`);
              }
            }
          }
        }
      }
      const effectiveRequirements = selectedInstId
        ? await merchantRepository.getInstitutionKycRequirements(selectedInstId, null, isMicro ? "micro_merchant" : bType)
        : [];

      const hasAccount = profile?.has_existing_account !== undefined
        ? Boolean(profile.has_existing_account)
        : true;
      if (hasAccount && (!String(kyc?.bank_account_name || "").trim() || String(kyc?.bank_account_number || "").trim().length < 8)) {
        missing.push("KYC Bank Account (Account holder name and account/wallet number of at least 8 characters)");
      }

      for (const req of effectiveRequirements) {
        if (!req.is_mandatory) continue;

        const rawCode = String(req.requirement_code || "").toUpperCase();
        const code = normalizeDocType(req.requirement_code);

        // TIN is optional for both micro and big merchants; BIN and Cheque optional for micro
        if (rawCode === "TIN_CERTIFICATE" || code === "TIN_CERTIFICATE" || (isMicro && (rawCode === "CANCELLED_BANK_CHEQUE" || rawCode === "BIN_CERTIFICATE" || code === "BANK_STATEMENT"))) {
          continue;
        }

        if (!hasAccount && ["CANCELLED_BANK_CHEQUE", "BANK_STATEMENT", "MFS_WALLET_STATEMENT"].includes(code)) {
          continue;
        }

        let satisfied = false;
        if (rawCode === "CANCELLED_BANK_CHEQUE" || code === "CANCELLED_BANK_CHEQUE" || code === "BANK_STATEMENT") {
          satisfied = uploadedDocTypes.includes("CANCELLED_BANK_CHEQUE") || uploadedDocTypes.includes("BANK_STATEMENT");
        } else if (code === "NOMINEE_PHOTO") {
          satisfied = uploadedDocTypes.includes("NOMINEE_PHOTO") || uploadedDocTypes.includes("NOMINEE_PASSPORT_PHOTO");
        } else if (code === "MFS_WALLET_STATEMENT") {
          satisfied = uploadedDocTypes.includes("MFS_WALLET_STATEMENT") || uploadedDocTypes.includes("BANK_STATEMENT");
        } else {
          satisfied = uploadedDocTypes.includes(code);
        }

        if (!satisfied) {
          missing.push(`${req.name_bn || req.name} (${req.name})`);
        }
      }

      if (!verification?.phoneVerified) {
        missing.push("মোবাইল নম্বর যাচাইকরণ ওটিপি (Mobile Phone OTP Verification)");
      }

      if (missing.length > 0) {
        const error = new Error(`Cannot submit application. Missing requirements: ${missing.join(", ")}`);
        error.statusCode = 422;
        error.details = missing;
        throw error;
      }

      prevAccountStatus = merchant.account_status;
      submittedAt = new Date();

      await merchantRepository.updateMerchantStatus(merchant.id, "submitted", "pending", true, conn);

      // Keep an immutable, database-backed copy of the exact data submitted for review.
      // Documents are represented by metadata only; private file bytes stay in secure storage.
      const snapshotDocuments = (documents || []).map((doc) => ({
        id: doc.id,
        documentType: doc.document_type,
        documentName: doc.document_name,
        customLabel: doc.custom_label,
        originalFilename: doc.original_filename,
        mimeType: doc.mime_type,
        fileSize: doc.file_size,
        status: doc.status,
        uploadedAt: doc.uploaded_at,
      }));
      const snapshotData = {
        profile: profile || {},
        contact: contact || {},
        commercial: commercial || {},
        kyc: kyc || {},
        documents: snapshotDocuments,
      };

      const [[versionRow]] = await conn.query(
        `SELECT COALESCE(MAX(version_no), 0) AS max_version
         FROM kyc_submission_versions WHERE merchant_id = ?`,
        [merchant.id]
      );
      const nextVersion = Number(versionRow?.max_version || 0) + 1;

      const [publishedFormRows] = await conn.query(
        "SELECT id FROM merchant_form_versions WHERE status = 'published' ORDER BY version_number DESC LIMIT 1"
      );
      const activeFormVersionId = profile?.form_version_id || (publishedFormRows.length > 0 ? publishedFormRows[0].id : null);

      await conn.execute(
        `INSERT INTO kyc_submission_versions
         (merchant_id, kyc_id, version_no, form_version_id, snapshot_data, submitted_by_user_id, change_summary, submitted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          merchant.id,
          kyc.id,
          nextVersion,
          activeFormVersionId,
          JSON.stringify(snapshotData),
          userId,
          "Initial merchant onboarding application submission",
        ]
      );

      await merchantRepository.createHistory(
        merchant.id,
        "review",
        "submit_application",
        prevAccountStatus,
        "submitted",
        {
          submittedAt: submittedAt.toISOString(),
          phoneVerified: Boolean(verification?.phoneVerified),
          submissionVersion: nextVersion,
        },
        conn
      );

      await conn.commit();
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }

    // Notifications and institution queue updates are intentionally performed
    // after the submission transaction, so an external notification failure
    // cannot roll back or corrupt the submitted application snapshot.
    try {
      const company = profile?.company_name || merchant.merchant_code;
      await merchantRepository.createAdminNotification(
        `New Merchant Application: ${company}`,
        `Merchant ${company} (${merchant.merchant_code}) has submitted their onboarding & KYC documentation for verification.`,
        "kyc",
        `/admin/kyc`
      );

      if (selectedInstId) {
        const [instInfo] = await db.query(
          "SELECT id, name, institution_type FROM institutions WHERE id = ? LIMIT 1",
          [selectedInstId]
        );
        const resolvedInstName = instInfo[0]?.name || kyc?.bank_name || "Partner Institution";

        const [existingApps] = await db.query(
          `SELECT id FROM merchant_gateway_applications WHERE merchant_id = ? AND institution_id = ? LIMIT 1`,
          [merchant.id, Number(selectedInstId)]
        );

        const hasAccountVal = profile?.has_existing_account !== undefined ? Boolean(profile.has_existing_account) : true;
        const applyNewVal = profile?.apply_new_account !== undefined ? Boolean(profile.apply_new_account) : false;
        const applicationSnapshot = {
          hasExistingAccount: hasAccountVal,
          applyNewAccount: applyNewVal,
          accountOpeningStatus: !hasAccountVal && applyNewVal ? "assisted_account_opening_pending" : "not_applicable",
          channel: profile?.channel || (instInfo[0]?.institution_type === "mfs" ? "mfs" : "bank"),
          merchantCode: merchant.merchant_code,
          companyName: company,
        };

        if (!hasAccountVal && applyNewVal) {
          await db.query(
            `UPDATE merchant_profiles
             SET account_opening_status = 'assisted_account_opening_pending', updated_at = NOW()
             WHERE merchant_id = ?`,
            [merchant.id]
          );
        }

        if (existingApps.length === 0) {
          await db.query(
            `INSERT INTO merchant_gateway_applications
             (application_number, application_type, merchant_id, institution_id, branch_id, form_version_id, status, gateway_name, submitted_data_snapshot, applied_at)
             VALUES (?, 'onboarding_kyc', ?, ?, ?, ?, 'applied', ?, ?, NOW())`,
            [
              `APP-${Date.now().toString().slice(-6)}`,
              merchant.id,
              Number(selectedInstId),
              kyc?.branch_id || null,
              activeFormVersionId,
              resolvedInstName,
              JSON.stringify(applicationSnapshot),
            ]
          );
        } else {
          await db.query(
            `UPDATE merchant_gateway_applications
             SET status = 'applied', application_type = 'onboarding_kyc', branch_id = COALESCE(?, branch_id), gateway_name = ?, submitted_data_snapshot = ?, updated_at = NOW()
             WHERE id = ?`,
            [kyc?.branch_id || null, resolvedInstName, JSON.stringify(applicationSnapshot), existingApps[0].id]
          );
        }

        await db.query(
          `INSERT INTO notifications (recipient_type, recipient_id, institution_id, title, message, type, link, is_read, created_at)
           VALUES ('institution', NULL, ?, ?, ?, 'kyc', '/institution/applications', 0, NOW())`,
          [
            Number(selectedInstId),
            `New Merchant Application: ${company}`,
            `Merchant ${company} (${merchant.merchant_code}) has submitted their onboarding application for KYC compliance review.`,
          ]
        );

        await db.query(
          `INSERT INTO institution_activity_logs
           (institution_id, user_id, user_email, action, resource_type, resource_id, status_transition, details)
           VALUES (?, ?, ?, 'merchant.application.submitted', 'merchant_application', ?, 'draft -> applied', ?)`,
          [
            Number(selectedInstId),
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

      // Send confirmation email to merchant's contact email or user account email
      const merchantRecipientEmail = contact?.email || verification?.email;
      if (merchantRecipientEmail) {
        const formattedDate = (submittedAt || new Date()).toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric",
        });

        emailService
          .sendMerchantApplicationSubmittedEmail({
            to: merchantRecipientEmail,
            merchantName: contact?.name || company,
            companyName: company,
            merchantCode: merchant.merchant_code,
            submittedDate: formattedDate,
          })
          .catch((mailErr) => {
            console.warn("[Submission Email Warning] Could not deliver application submitted email:", mailErr.message);
          });
      }
    } catch (notifErr) {
      console.warn("Non-blocking notification error on submission:", notifErr);
    }

    return {
      success: true,
      message: "Merchant onboarding application submitted successfully. An administrator and your designated bank will review your submission.",
      accountStatus: "submitted",
      kycStatus: "pending",
      submittedAt: submittedAt.toISOString(),
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
      // If there are no open issues in kyc_field_issues, but merchant account or application is additional_information_required,
      // allow resubmission to transition back to under_review and notify Bank/Admin
      const [appRows] = await db.query(
        `SELECT id, institution_id, assigned_reviewer_id FROM merchant_gateway_applications WHERE merchant_id = ? AND status = 'additional_information_required'`,
        [merchant.id]
      );

      if (appRows.length > 0 || merchant.kyc_status === "additional_information_required") {
        await merchantRepository.updateMerchantStatus(merchant.id, "under_review", "under_review");
        await db.query(
          `UPDATE merchant_gateway_applications
           SET status = 'under_review',
               submission_version = submission_version + 1,
               updated_at = NOW()
           WHERE merchant_id = ? AND status = 'additional_information_required'`,
          [merchant.id]
        );

        // Snapshot new version
        const [contactRows] = await db.query("SELECT * FROM merchant_contacts WHERE merchant_id = ? LIMIT 1", [merchant.id]);
        const [kycRows] = await db.query("SELECT * FROM merchant_kyc WHERE merchant_id = ? LIMIT 1", [merchant.id]);
        const [docRows] = await db.query("SELECT id, document_type, document_name, original_filename FROM merchant_documents WHERE merchant_id = ?", [merchant.id]);

        const [[lastVer]] = await db.query(
          `SELECT MAX(version_no) AS max_v FROM kyc_submission_versions WHERE merchant_id = ?`,
          [merchant.id]
        );
        const nextVer = (lastVer?.max_v || 0) + 1;

        await db.query(
          `INSERT INTO kyc_submission_versions
           (merchant_id, kyc_id, version_no, snapshot_data, submitted_by_user_id, change_summary, submitted_at)
           VALUES (?, ?, ?, ?, ?, ?, NOW())`,
          [
            merchant.id,
            kycRows[0]?.id || 0,
            nextVer,
            JSON.stringify({
              profile: profile || {},
              contact: contactRows[0] || {},
              kyc: kycRows[0] || {},
              documents: docRows || [],
            }),
            userId,
            note || "Resubmitted corrected information by merchant",
          ]
        );

        // Notify
        const company = profile?.company_name || merchant.merchant_code;
        const targetInstId = appRows[0]?.institution_id || kyc?.institution_id;
        if (targetInstId) {
          await db.query(
            `INSERT INTO notifications (recipient_type, recipient_id, institution_id, title, message, type, link, is_read, created_at)
             VALUES ('institution', NULL, ?, ?, ?, 'kyc', '/institution/kyc-review', 0, NOW())`,
            [
              Number(targetInstId),
              `Correction Resubmitted: ${company}`,
              `Merchant ${company} (${merchant.merchant_code}) has updated their information and resubmitted their application for review.`,
            ]
          );
        }

        return {
          success: true,
          message: "Correction re-submitted successfully. Bank and Admin compliance teams have been notified.",
          accountStatus: "under_review",
          kycStatus: "under_review",
          remainingOpenIssues: 0,
        };
      }

      return { success: true, message: "No open issues found to resolve." };
    }

    // Verify that any document issues have actually been re-uploaded after the issue was raised
    const [existingDocs] = await db.query(
      `SELECT document_type, uploaded_at, created_at, updated_at FROM merchant_documents WHERE merchant_id = ?`,
      [merchant.id]
    );

    const docTypeMap = {
      nid_front: "NID_FRONT",
      nid_back: "NID_BACK",
      tin_certificate: "TIN_CERTIFICATE",
      tin: "TIN_CERTIFICATE",
      cancelled_bank_cheque: "CANCELLED_BANK_CHEQUE",
      cheque: "CANCELLED_BANK_CHEQUE",
      trade_license: "TRADE_LICENSE",
      bin_certificate: "BIN_CERTIFICATE",
      bin: "BIN_CERTIFICATE",
    };

    const docKeywords = [
      "nid_front",
      "nid_back",
      "tin_certificate",
      "cancelled_bank_cheque",
      "trade_license",
      "bin_certificate",
      "document",
      "image",
      "photo",
      "file",
      "scan",
    ];

    for (const issue of targetIssues) {
      const fieldKeyLower = String(issue.field_key || "").toLowerCase();
      const reasonLower = String(issue.issue_reason || "").toLowerCase();

      // Check if this issue is for a document
      const isDocumentIssue =
        docKeywords.some((k) => fieldKeyLower.includes(k)) ||
        reasonLower.includes("image") ||
        reasonLower.includes("document") ||
        reasonLower.includes("clear nid") ||
        reasonLower.includes("scan");

      if (isDocumentIssue) {
        // Find which document type this refers to
        let targetDocType = null;
        if (fieldKeyLower.includes("nid_front") || (reasonLower.includes("nid") && reasonLower.includes("front"))) {
          targetDocType = "NID_FRONT";
        } else if (fieldKeyLower.includes("nid_back") || (reasonLower.includes("nid") && reasonLower.includes("back"))) {
          targetDocType = "NID_BACK";
        } else if (fieldKeyLower.includes("merchant_signature") || fieldKeyLower.includes("signature")) {
          targetDocType = "MERCHANT_SIGNATURE";
        } else if (fieldKeyLower.includes("utility")) {
          targetDocType = "UTILITY_BILL";
        } else if (fieldKeyLower.includes("nominee_nid")) {
          targetDocType = "NOMINEE_NID";
        } else if (fieldKeyLower.includes("nominee_photo")) {
          targetDocType = "NOMINEE_PHOTO";
        } else if (fieldKeyLower.includes("nid")) {
          targetDocType = "NID_FRONT";
        } else if (fieldKeyLower.includes("tin") || reasonLower.includes("tin")) {
          targetDocType = "TIN_CERTIFICATE";
        } else if (fieldKeyLower.includes("cheque") || reasonLower.includes("cheque")) {
          targetDocType = "CANCELLED_BANK_CHEQUE";
        } else if (fieldKeyLower.includes("trade_license") || reasonLower.includes("trade license")) {
          targetDocType = "TRADE_LICENSE";
        } else if (fieldKeyLower.includes("bin") || reasonLower.includes("bin")) {
          targetDocType = "BIN_CERTIFICATE";
        }

        if (targetDocType) {
          const matchedDoc = existingDocs.find(
            (d) => String(d.document_type || "").toUpperCase() === targetDocType
          );

          const issueDate = new Date(issue.created_at).getTime();
          const docDate = matchedDoc
            ? new Date(matchedDoc.updated_at || matchedDoc.uploaded_at || matchedDoc.created_at).getTime()
            : 0;

          // If document was not uploaded or updated after the issue was raised
          if (!matchedDoc || docDate <= issueDate) {
            const error = new Error(
              `Please re-upload a clear and valid document for "${targetDocType.replace(/_/g, " ")}" before resubmitting.`
            );
            error.statusCode = 400;
            throw error;
          }
        }
      }
    }

    for (const issue of targetIssues) {
      // Record new value or updated document info if available
      let newVal = null;
      const fKey = String(issue.field_key || "").toLowerCase();
      const matchedDoc = existingDocs.find(
        (d) => String(d.document_type || "").toLowerCase() === fKey
      );
      if (matchedDoc) {
        newVal = JSON.stringify({
          original_filename: matchedDoc.original_filename,
          previous_filename: matchedDoc.previous_filename,
          uploaded_at: matchedDoc.uploaded_at,
        });
      }

      await db.query(
        `UPDATE kyc_field_issues
         SET status = 'resolved', resolution_note = ?, new_value = COALESCE(?, new_value), updated_at = NOW()
         WHERE id = ?`,
        [note || "Corrected and re-submitted by merchant", newVal, issue.id]
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
    const newKycStatus = hasRemaining ? "additional_information_required" : "under_review";
    const newAccountStatus = "under_review";

    await merchantRepository.updateMerchantStatus(merchant.id, newAccountStatus, newKycStatus);
    await db.query(
      `UPDATE merchant_gateway_applications
       SET status = ?,
           submission_version = submission_version + 1,
           updated_at = NOW()
       WHERE merchant_id = ? AND status = 'additional_information_required'`,
      [newKycStatus, merchant.id]
    );

    // Snapshot submission version
    try {
      const [contactRows] = await db.query("SELECT * FROM merchant_contacts WHERE merchant_id = ? LIMIT 1", [merchant.id]);
      const [kycRows] = await db.query("SELECT * FROM merchant_kyc WHERE merchant_id = ? LIMIT 1", [merchant.id]);
      const [docRows] = await db.query("SELECT id, document_type, document_name, original_filename FROM merchant_documents WHERE merchant_id = ?", [merchant.id]);

      const [[lastVer]] = await db.query(
        `SELECT MAX(version_no) AS max_v FROM kyc_submission_versions WHERE merchant_id = ?`,
        [merchant.id]
      );
      const nextVer = (lastVer?.max_v || 0) + 1;

      await db.query(
        `INSERT INTO kyc_submission_versions
         (merchant_id, kyc_id, version_no, snapshot_data, submitted_by_user_id, change_summary, submitted_at)
         VALUES (?, ?, ?, ?, ?, ?, NOW())`,
        [
          merchant.id,
          kycRows[0]?.id || 0,
          nextVer,
          JSON.stringify({
            profile: profile || {},
            contact: contactRows[0] || {},
            kyc: kycRows[0] || {},
            documents: docRows || [],
          }),
          userId,
          note || "Resubmitted corrected information by merchant",
        ]
      );
    } catch (verErr) {
      console.warn("Failed to create kyc version snapshot:", verErr);
    }

    // Notify Platform Admin & Institution
    try {
      const company = profile?.company_name || merchant.merchant_code;
      await merchantRepository.createAdminNotification(
        `Merchant Re-submitted Correction: ${company}`,
        `Merchant ${company} (${merchant.merchant_code}) has updated and re-submitted their correction for review.`,
        "kyc",
        `/admin/kyc`
      );

      // Also create persistent notification for the institution if associated
      const instId = kyc?.institution_id || targetIssues[0]?.institution_id || null;
      if (instId) {
        await db.query(
          `INSERT INTO notifications (recipient_type, recipient_id, institution_id, title, message, type, link, is_read, created_at)
           VALUES ('institution', NULL, ?, ?, ?, 'kyc', '/institution/kyc-review', 0, NOW())`,
          [
            Number(instId),
            `Correction Resubmitted: ${company}`,
            `Merchant ${company} (${merchant.merchant_code}) has updated flagged fields and resubmitted their application for review.`,
          ]
        );
      }
    } catch (_) {}

    return {
      success: true,
      message: "Correction re-submitted successfully. Bank and Admin compliance teams have been notified.",
      accountStatus: newAccountStatus,
      kycStatus: newKycStatus,
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
               COALESCE(g.name, i.name, mga.gateway_name, 'Payment Gateway') AS gateway_name,
               COALESCE(g.code, i.institution_code, mga.gateway_code, 'GATEWAY') AS gateway_code,
               COALESCE(g.logo_url, i.logo_url, mga.logo_url) AS logo_url,
               COALESCE(g.service_type, mga.service_type, 'BanglaQR Interoperable Gateway') AS service_type,
               COALESCE(g.service_fee, mga.service_fee, 0) AS service_fee,
               g.supported_methods, g.required_documents
        FROM merchant_gateway_applications mga
        LEFT JOIN gateways g ON mga.gateway_id = g.id
        LEFT JOIN institutions i ON mga.institution_id = i.id
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
               COALESCE(g.name, i.name, mga.gateway_name, 'Payment Gateway') AS gateway_name,
               COALESCE(g.code, i.institution_code, mga.gateway_code, 'GATEWAY') AS gateway_code,
               COALESCE(g.logo_url, i.logo_url, mga.logo_url) AS logo_url,
               COALESCE(g.service_type, mga.service_type, 'BanglaQR Interoperable Gateway') AS service_type,
               COALESCE(g.service_fee, mga.service_fee, 0) AS service_fee,
               g.supported_methods, g.required_documents, g.description
        FROM merchant_gateway_applications mga
        LEFT JOIN gateways g ON mga.gateway_id = g.id
        LEFT JOIN institutions i ON mga.institution_id = i.id
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
        qrCodeUrl: r.qr_code_url || merchant.qr_code_url || null,
        // Snake case aliases
        gateway_name: r.gateway_name,
        gateway_code: r.gateway_code,
        gateway_logo: r.logo_url,
        qr_code_url: r.qr_code_url || merchant.qr_code_url || null,
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

    // Resolve institution_id:
    // If user explicitly chose "other" or "none" (Admin only), institutionId remains null.
    // Otherwise parse number if provided.
    let institutionId = null;
    const rawInst = String(data.institutionId || "").trim().toLowerCase();
    if (rawInst && rawInst !== "other" && rawInst !== "none" && rawInst !== "null") {
      institutionId = Number(data.institutionId) || null;
    }

    const [res] = await db.execute(
      `INSERT INTO support_tickets (ticket_number, merchant_id, user_id, institution_id, subject, priority, status, category, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'open', ?, NOW(), NOW())`,
      [
        ticketNumber,
        merchant.id,
        userId,
        institutionId || null,
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

    const company = merchant.legal_business_name || merchant.merchant_code || "A merchant";

    // In-app notification to Platform Admins about the new support ticket
    try {
      await db.execute(
        `INSERT INTO notifications (recipient_type, recipient_id, title, message, type, link, is_read, created_at)
         VALUES ('admin', NULL, ?, ?, 'contact_inquiry', ?, 0, NOW())`,
        [
          `নতুন সাপোর্ট টিকিট: ${ticketNumber}`,
          `মার্চেন্ট ${company} (${merchant.merchant_code}) একটি সাপোর্ট টিকিট ওপেন করেছেন: "${data.subject}"`,
          `/admin/support/${ticketId}`,
        ]
      );
    } catch (notifErr) {
      console.error("[Notification Error: Support Ticket Admin]", notifErr.message);
    }

    // In-app notification to Institution / Bank staff if institutionId is set
    if (institutionId) {
      try {
        await db.execute(
          `INSERT INTO notifications (recipient_type, recipient_id, institution_id, title, message, type, link, is_read, created_at)
           VALUES ('institution', NULL, ?, ?, ?, 'contact_inquiry', ?, 0, NOW())`,
          [
            institutionId,
            `নতুন মার্চেন্ট সাপোর্ট টিকিট: ${ticketNumber}`,
            `মার্চেন্ট ${company} (${merchant.merchant_code}) একটি সাপোর্ট টিকিট ওপেন করেছেন: "${data.subject}"`,
            `/institution/support/${ticketId}`,
          ]
        );
      } catch (instNotifErr) {
        console.error("[Notification Error: Support Ticket Institution]", instNotifErr.message);
      }
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

    // Notify admins and institution that merchant replied
    try {
      const [tRows] = await db.execute(
        `SELECT ticket_number, subject, institution_id FROM support_tickets WHERE id = ? LIMIT 1`,
        [ticketId]
      );
      const ticketInfo = tRows[0];
      const company = merchant.legal_business_name || merchant.merchant_code || "Merchant";
      await db.execute(
        `INSERT INTO notifications (recipient_type, recipient_id, title, message, type, link, is_read, created_at)
         VALUES ('admin', NULL, ?, ?, 'contact_inquiry', ?, 0, NOW())`,
        [
          `টিকিটে মার্চেন্টের উত্তর: ${ticketInfo?.ticket_number || ticketId}`,
          `মার্চেন্ট ${company} টিকিটে একটি নতুন বার্তা দিয়েছেন: "${ticketInfo?.subject || ''}"`,
          `/admin/support/${ticketId}`,
        ]
      );

      if (ticketInfo?.institution_id) {
        await db.execute(
          `INSERT INTO notifications (recipient_type, recipient_id, institution_id, title, message, type, link, is_read, created_at)
           VALUES ('institution', NULL, ?, ?, ?, 'contact_inquiry', ?, 0, NOW())`,
          [
            ticketInfo.institution_id,
            `টিকিটে মার্চেন্টের উত্তর: ${ticketInfo?.ticket_number || ticketId}`,
            `মার্চেন্ট ${company} টিকিটে একটি নতুন বার্তা দিয়েছেন: "${ticketInfo?.subject || ''}"`,
            `/institution/support/${ticketId}`,
          ]
        );
      }
    } catch (notifErr) {
      console.error("[Notification Error: Merchant Ticket Reply]", notifErr.message);
    }

    return { success: true, message: "Reply added to ticket" };
  },

  // ==========================================
  // SETTINGS
  // ==========================================
  async getSettings(userId) {
    const merchant = await merchantRepository.findOrCreateMerchantByUserId(userId);
    const [user] = await db.execute("SELECT id, email, phone, status, two_factor_enabled FROM users WHERE id = ? LIMIT 1", [userId]);
    const [profile] = await db.execute("SELECT * FROM merchant_profiles WHERE merchant_id = ? LIMIT 1", [merchant.id]);
    const contact = await merchantRepository.getContact(merchant.id);

    return {
      user: user[0] || {},
      merchant: {
        id: merchant.id,
        merchantCode: merchant.merchant_code,
        merchantSegment: merchant.merchant_segment || null,
        accountStatus: merchant.account_status,
        kycStatus: merchant.kyc_status,
      },
      profile: profile[0] || {},
      contact: contact || {},
    };
  },

  async updateSettingsContact(userId, { emergencyContact, secondaryEmail }) {
    const merchant = await merchantRepository.findOrCreateMerchantByUserId(userId);
    if (!merchant) {
      const err = new Error("Merchant not found");
      err.statusCode = 404;
      throw err;
    }

    const cleanEmergency = emergencyContact ? String(emergencyContact).trim() : null;
    const cleanSecondaryEmail = secondaryEmail ? String(secondaryEmail).trim() : null;

    if (cleanSecondaryEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanSecondaryEmail)) {
      const err = new Error("Please enter a valid secondary email address");
      err.statusCode = 400;
      throw err;
    }

    const existing = await merchantRepository.getContact(merchant.id);
    await merchantRepository.upsertContact(merchant.id, {
      ...existing,
      emergencyContact: cleanEmergency,
      secondaryEmail: cleanSecondaryEmail,
    });

    return await merchantRepository.getContact(merchant.id);
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
      const valid = await verifyPassword(rows[0].password_hash, currentPassword);
      if (!valid) {
        const err = new Error("Current password is incorrect");
        err.statusCode = 400;
        throw err;
      }
    }

    const hash = await hashPassword(newPassword);
    await db.execute(
      "UPDATE users SET password_hash = ?, password_changed_at = NOW(), token_version = token_version + 1, updated_at = NOW() WHERE id = ?",
      [hash, userId]
    );

    try {
      await db.execute("DELETE FROM sessions WHERE user_id = ?", [userId]);
    } catch (_) {}

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

  async getInstitutionKycRequirements(institutionId, serviceId = null, businessType = null) {
    return merchantRepository.getInstitutionKycRequirements(institutionId, serviceId, businessType);
  },

  // ==========================================
  // PHASE 1: BUSINESS CATALOGUES & SEGMENTS
  // ==========================================
  async getBusinessLegalStructures() {
    const [rows] = await db.query(
      `SELECT id, code, name_bn, name_en, description, is_active, display_order
       FROM business_legal_structures
       WHERE is_active = 1
       ORDER BY display_order ASC, name_en ASC`
    );
    return rows;
  },

  async getIndustryCategories(userId) {
    // Authenticated merchant determines segment filter
    const merchant = await merchantRepository.findOrCreateMerchantByUserId(userId);
    const segment = merchant.merchant_segment || null;

    if (!segment) {
      // Unresolved segment: return all active industry categories
      const [allCats] = await db.query(
        `SELECT id, code, name_bn, name_en, description, source_authority, display_order
         FROM industry_categories
         WHERE is_active = 1
         ORDER BY display_order ASC, name_en ASC`
      );
      return allCats;
    }

    // Return categories that have eligible activities for this segment
    const [rows] = await db.query(
      `SELECT DISTINCT c.id, c.code, c.name_bn, c.name_en, c.description, c.source_authority, c.display_order
       FROM industry_categories c
       INNER JOIN industry_activity_mapping iam ON iam.industry_category_id = c.id AND iam.is_active = 1
       INNER JOIN trade_license_activities tla ON tla.id = iam.activity_id AND tla.is_active = 1
       INNER JOIN business_activity_segment_rules basr ON basr.activity_id = tla.id
         AND basr.merchant_segment = ?
         AND basr.is_eligible = 1
       WHERE c.is_active = 1
       ORDER BY c.display_order ASC, c.name_en ASC`,
      [segment]
    );
    return rows;
  },

  async getBusinessActivities(userId, industryCategoryId = null) {
    const merchant = await merchantRepository.findOrCreateMerchantByUserId(userId);
    const segment = merchant.merchant_segment || null;

    let query = `
      SELECT DISTINCT
        tla.id, tla.code, tla.name_bn, tla.name_en, tla.description,
        tla.source_authority, tla.verification_status, tla.display_order,
        iam.industry_category_id
      FROM trade_license_activities tla
      LEFT JOIN industry_activity_mapping iam ON iam.activity_id = tla.id AND iam.is_active = 1
    `;
    const params = [];

    if (segment) {
      query += `
        INNER JOIN business_activity_segment_rules basr ON basr.activity_id = tla.id
          AND basr.merchant_segment = ?
          AND basr.is_eligible = 1
      `;
      params.push(segment);
    }

    query += ` WHERE tla.is_active = 1 `;

    if (industryCategoryId) {
      query += ` AND iam.industry_category_id = ? `;
      params.push(industryCategoryId);
    }

    query += ` ORDER BY tla.display_order ASC, tla.name_en ASC `;

    const [rows] = await db.query(query, params);
    return rows;
  },

  async getMerchantActivities(userId) {
    const merchant = await merchantRepository.findOrCreateMerchantByUserId(userId);
    const [rows] = await db.query(
      `SELECT mpa.id, mpa.activity_id, mpa.activity_role, mpa.created_at,
              tla.code, tla.name_bn, tla.name_en, tla.verification_status
       FROM merchant_profile_activities mpa
       INNER JOIN trade_license_activities tla ON tla.id = mpa.activity_id
       WHERE mpa.merchant_id = ?
       ORDER BY mpa.activity_role = 'primary' DESC, tla.display_order ASC`,
      [merchant.id]
    );
    return rows;
  },

  async updateMerchantActivities(userId, { primaryActivityId, additionalActivityIds = [] }) {
    // 1. Strict duplicate validation: Do not silently remove duplicates using Set or filtering
    if (Array.isArray(additionalActivityIds)) {
      const seen = new Set();
      for (const id of additionalActivityIds) {
        if (seen.has(id)) {
          const err = new Error(`Duplicate Additional Activity ID (${id}) found in payload.`);
          err.statusCode = 400;
          throw err;
        }
        seen.add(id);
      }
    }

    if (primaryActivityId && Array.isArray(additionalActivityIds) && additionalActivityIds.includes(primaryActivityId)) {
      const err = new Error(`The same activity (ID: ${primaryActivityId}) cannot be submitted as both Primary and Additional.`);
      err.statusCode = 400;
      throw err;
    }

    const conn = await db.getConnection();
    await conn.beginTransaction();

    try {
      const merchant = await requireEditableMerchant(userId, conn);
      const segment = merchant.merchant_segment || null;

      // Validate primary activity if provided
      if (primaryActivityId) {
        if (segment) {
          const [eligible] = await conn.query(
            `SELECT 1 FROM business_activity_segment_rules
             WHERE activity_id = ? AND merchant_segment = ? AND is_eligible = 1 LIMIT 1`,
            [primaryActivityId, segment]
          );
          if (eligible.length === 0) {
            const err = new Error("Selected primary activity is not eligible for your merchant segment.");
            err.statusCode = 400;
            throw err;
          }
        }
      }

      // Validate additional activities if provided
      const validAdditionals = Array.isArray(additionalActivityIds) ? additionalActivityIds : [];

      for (const addId of validAdditionals) {
        if (segment) {
          const [eligible] = await conn.query(
            `SELECT 1 FROM business_activity_segment_rules
             WHERE activity_id = ? AND merchant_segment = ? AND is_eligible = 1 LIMIT 1`,
            [addId, segment]
          );
          if (eligible.length === 0) {
            const err = new Error(`Selected additional activity (ID: ${addId}) is not eligible for your merchant segment.`);
            err.statusCode = 400;
            throw err;
          }
        }
      }

      // Remove existing activities for this merchant
      await conn.query("DELETE FROM merchant_profile_activities WHERE merchant_id = ?", [merchant.id]);

      // Insert primary activity
      if (primaryActivityId) {
        await conn.query(
          `INSERT INTO merchant_profile_activities (merchant_id, activity_id, activity_role, created_at, updated_at)
           VALUES (?, ?, 'primary', NOW(), NOW())`,
          [merchant.id, primaryActivityId]
        );
      }

      // Insert additional activities
      for (const addId of validAdditionals) {
        await conn.query(
          `INSERT INTO merchant_profile_activities (merchant_id, activity_id, activity_role, created_at, updated_at)
           VALUES (?, ?, 'additional', NOW(), NOW())`,
          [merchant.id, addId]
        );
      }

      await conn.commit();
      return this.getMerchantActivities(userId);
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  /**
   * Generate Native Merchant Application PDF for current authenticated merchant
   */
  async generateMyApplicationPdf(userId, options = {}) {
    const merchant = await merchantRepository.findMerchantByUserId(userId);
    if (!merchant) {
      const err = new Error("Merchant not found");
      err.statusCode = 404;
      throw err;
    }

    const data = await adminMerchantsRepository.getMerchantById(merchant.id);
    if (!data) {
      const err = new Error("Merchant application details not found");
      err.statusCode = 404;
      throw err;
    }

    const code = data.merchant?.merchantCode || data.merchant?.merchant_code || `M-${merchant.id}`;
    const filename = `Merchant_Application_${code}.pdf`;
    const buffer = await generateMerchantApplicationPdf(data, options);
    return { buffer, filename };
  },

  /**
   * Create an institution availability request (Notify Me When Available)
   */
  async createAvailabilityRequest(userId, institutionId) {
    const instId = Number(institutionId);
    if (!instId || isNaN(instId) || instId <= 0) {
      const err = new Error("Invalid institution ID.");
      err.statusCode = 400;
      throw err;
    }

    const merchant = await merchantRepository.findOrCreateMerchantByUserId(userId);
    if (!merchant) {
      const err = new Error("Merchant account not found.");
      err.statusCode = 404;
      throw err;
    }

    // 1. Verify institution exists, status is active, but onboarding is inactive (Coming Soon)
    const [instRows] = await db.query(
      "SELECT id, name, name_bn, status, is_onboarding_active FROM institutions WHERE id = ? LIMIT 1",
      [instId]
    );

    if (instRows.length === 0) {
      const err = new Error("Institution not found.");
      err.statusCode = 404;
      throw err;
    }

    const inst = instRows[0];
    if (inst.status !== "active") {
      const err = new Error("This institution is currently inactive on the platform.");
      err.statusCode = 400;
      throw err;
    }

    if (Boolean(inst.is_onboarding_active)) {
      const err = new Error("Merchant onboarding for this institution is already active. You can apply directly.");
      err.statusCode = 400;
      throw err;
    }

    // 2. Check for an existing pending request by this merchant for this institution
    const [existing] = await db.query(
      `SELECT id, request_status, requested_at 
       FROM institution_availability_requests 
       WHERE merchant_id = ? AND institution_id = ? AND request_status = 'pending' 
       LIMIT 1`,
      [merchant.id, instId]
    );

    if (existing.length > 0) {
      const err = new Error("আপনার Notification Request ইতিমধ্যে জমা রয়েছে। Onboarding চালু হলে আপনাকে জানানো হবে।");
      err.statusCode = 409;
      err.code = "ALREADY_REQUESTED";
      throw err;
    }

    // 3. Insert record (Trigger automatically manages active_pending_key for concurrent safety)
    try {
      const [insertRes] = await db.query(
        `INSERT INTO institution_availability_requests (merchant_id, institution_id, request_status, requested_at)
         VALUES (?, ?, 'pending', NOW())`,
        [merchant.id, instId]
      );

      // 4. Create in-app Notification for Admin Portal so Admin immediately sees the new merchant availability request
      try {
        const [prof] = await db.query(
          "SELECT company_name FROM merchant_profiles WHERE merchant_id = ? LIMIT 1",
          [merchant.id]
        );
        const company = prof[0]?.company_name || merchant.merchant_code || `Merchant #${merchant.id}`;
        const adminTitle = `নতুন অনবোর্ডিং অনুরোধ: ${inst.name}`;
        const adminMessage = `মার্চেন্ট ${company} (${merchant.merchant_code}) ${inst.name}-এর অনবোর্ডিং চালু হওয়ার জন্য অপেক্ষা করছেন এবং Notification Request পাঠিয়েছেন।`;
        const adminLink = `/admin/institutions/banks?tab=requests`;

        await merchantRepository.createAdminNotification(
          adminTitle,
          adminMessage,
          "system",
          adminLink
        );
      } catch (adminNotifErr) {
        console.warn("[AvailabilityRequest] Admin notification warning:", adminNotifErr.message);
      }

      // 5. Send Immediate Confirmation Email to Merchant (Safely tracked in confirmation_email_status)
      try {
        const [userData] = await db.query(
          `SELECT u.email, mp.company_name
           FROM users u
           LEFT JOIN merchant_profiles mp ON mp.merchant_id = ?
           WHERE u.id = ? LIMIT 1`,
          [merchant.id, userId]
        );

        const merchantEmail = userData[0]?.email;
        const merchantDisplayName = userData[0]?.company_name || merchant.merchant_code || "মার্চেন্ট";

        if (merchantEmail) {
          emailService
            .sendInstitutionRequestConfirmationEmail(merchantEmail, merchantDisplayName, inst.name)
            .then(async (emailRes) => {
              const status = emailRes && emailRes.success ? "sent" : "failed";
              const errorText = emailRes && !emailRes.success ? (emailRes.error || "Email delivery failed") : null;
              await db.query(
                `UPDATE institution_availability_requests
                 SET confirmation_email_status = ?, last_error = ?
                 WHERE id = ?`,
                [status, errorText, insertRes.insertId]
              ).catch((e) => console.warn("[AvailabilityRequest] Failed to update confirmation email status:", e.message));
            })
            .catch(async (e) => {
              console.warn("[AvailabilityRequest] Confirmation email error:", e.message);
              await db.query(
                `UPDATE institution_availability_requests
                 SET confirmation_email_status = 'failed', last_error = ?
                 WHERE id = ?`,
                [e.message, insertRes.insertId]
              ).catch(() => {});
            });
        }
      } catch (confirmEmailErr) {
        console.warn("[AvailabilityRequest] Confirmation email dispatch error:", confirmEmailErr.message);
      }

      return {
        id: insertRes.insertId,
        merchantId: merchant.id,
        institutionId: instId,
        institutionName: inst.name,
        requestStatus: "pending",
        message: "আপনার Notification Request সফলভাবে জমা হয়েছে। এই Institution-এর Merchant Onboarding চালু হলে আপনাকে জানানো হবে।",
      };
    } catch (dbErr) {
      if (dbErr.code === "ER_DUP_ENTRY") {
        const err = new Error("আপনার Notification Request ইতিমধ্যে জমা রয়েছে। Onboarding চালু হলে আপনাকে জানানো হবে।");
        err.statusCode = 409;
        err.code = "ALREADY_REQUESTED";
        throw err;
      }
      throw dbErr;
    }
  },

  /**
   * Get all availability requests made by the merchant
   */
  async getMyAvailabilityRequests(userId) {
    const merchant = await merchantRepository.findMerchantByUserId(userId);
    if (!merchant) return [];

    const [rows] = await db.query(
      `SELECT iar.id, iar.institution_id, iar.request_status, iar.requested_at, iar.notified_at,
              i.name AS institution_name, i.institution_code, i.institution_type, i.logo_url,
              i.status AS institution_status, i.is_onboarding_active
       FROM institution_availability_requests iar
       INNER JOIN institutions i ON i.id = iar.institution_id
       WHERE iar.merchant_id = ? AND iar.request_status != 'cancelled'
       ORDER BY iar.requested_at DESC`,
      [merchant.id]
    );

    return rows.map((r) => ({
      id: r.id,
      institutionId: r.institution_id,
      institutionName: r.institution_name,
      institutionCode: r.institution_code,
      institutionType: r.institution_type,
      logoUrl: r.logo_url,
      institutionStatus: r.institution_status,
      isOnboardingActive: Boolean(r.is_onboarding_active),
      requestStatus: r.request_status,
      requestedAt: r.requested_at,
      notifiedAt: r.notified_at,
    }));
  },

  /**
   * Cancel an onboarding availability request for an institution
   */
  async cancelAvailabilityRequest(userId, institutionId) {
    const instId = Number(institutionId);
    if (!instId || isNaN(instId) || instId <= 0) {
      const err = new Error("Invalid institution ID.");
      err.statusCode = 400;
      throw err;
    }

    const merchant = await merchantRepository.findMerchantByUserId(userId);
    if (!merchant) {
      const err = new Error("Merchant account not found.");
      err.statusCode = 404;
      throw err;
    }

    // 1. Find the active request (pending or notified)
    const [existing] = await db.query(
      `SELECT iar.id, iar.institution_id, iar.request_status, i.name as institution_name
       FROM institution_availability_requests iar
       INNER JOIN institutions i ON i.id = iar.institution_id
       WHERE iar.merchant_id = ? AND iar.institution_id = ? AND iar.request_status != 'cancelled'
       ORDER BY iar.id DESC LIMIT 1`,
      [merchant.id, instId]
    );

    if (existing.length === 0) {
      const err = new Error("কোনো সক্রিয় অনবোর্ডিং রিকোয়েস্ট পাওয়া যায়নি।");
      err.statusCode = 404;
      throw err;
    }

    const targetReq = existing[0];
    const instName = targetReq.institution_name || "সংশ্লিষ্ট ব্যাংক/MFS";

    // 2. Update status to 'cancelled' and clear active_pending_key so unique constraint won't block future requests
    await db.query(
      `UPDATE institution_availability_requests
       SET request_status = 'cancelled', active_pending_key = NULL, updated_at = NOW()
       WHERE id = ?`,
      [targetReq.id]
    );

    // 3. Fetch merchant and company name
    const [prof] = await db.query(
      "SELECT company_name FROM merchant_profiles WHERE merchant_id = ? LIMIT 1",
      [merchant.id]
    );
    const company = prof[0]?.company_name || merchant.merchant_code || `Merchant #${merchant.id}`;

    // 4. In-App Notification for Merchant
    try {
      const merchantTitle = `অনবোর্ডিং আবেদন বাতিল: ${instName}`;
      const merchantMsg = `আপনি ${instName}-এর অনবোর্ডিং আবেদন রিকোয়েস্ট সফলভাবে বাতিল করেছেন।`;
      await db.query(
        `INSERT INTO notifications (recipient_type, recipient_id, institution_id, title, message, type, link, is_read, created_at)
         VALUES ('merchant', ?, ?, ?, ?, 'system', '/merchant/payment-methods', 0, NOW())`,
        [userId, instId, merchantTitle, merchantMsg]
      );
    } catch (mNotifErr) {
      console.warn("[CancelAvailabilityRequest] Merchant notification warning:", mNotifErr.message);
    }

    // 5. In-App Notification for Admin
    try {
      const adminTitle = `অনবোর্ডিং রিকোয়েস্ট বাতিল: ${instName}`;
      const adminMsg = `মার্চেন্ট ${company} (${merchant.merchant_code}) ${instName}-এর অনবোর্ডিং আবেদন রিকোয়েস্ট বাতিল করেছেন।`;
      await merchantRepository.createAdminNotification(
        adminTitle,
        adminMsg,
        "system",
        `/admin/institutions/banks?tab=requests`
      );
    } catch (aNotifErr) {
      console.warn("[CancelAvailabilityRequest] Admin notification warning:", aNotifErr.message);
    }

    // 6. In-App Notification for Institution Portal
    try {
      const instTitle = `মার্চেন্ট অনবোর্ডিং রিকোয়েস্ট বাতিল`;
      const instMsg = `মার্চেন্ট ${company} (${merchant.merchant_code}) আপনার প্রতিষ্ঠানে অনবোর্ডিংয়ের আবেদন রিকোয়েস্ট বাতিল করেছেন।`;
      await db.query(
        `INSERT INTO notifications (recipient_type, recipient_id, institution_id, title, message, type, link, is_read, created_at)
         VALUES ('institution', NULL, ?, ?, ?, 'kyc', '/institution/merchants', 0, NOW())`,
        [instId, instTitle, instMsg]
      );
    } catch (iNotifErr) {
      console.warn("[CancelAvailabilityRequest] Institution notification warning:", iNotifErr.message);
    }

    // 7. Audit History
    try {
      await merchantRepository.createHistory(
        merchant.id,
        "availability_request",
        "cancel_request",
        targetReq.request_status,
        "cancelled",
        { institutionId: instId, institutionName: instName }
      );
    } catch (histErr) {
      console.warn("[CancelAvailabilityRequest] History warning:", histErr.message);
    }

    return {
      success: true,
      message: `${instName}-এর অনবোর্ডিং রিকোয়েস্ট সফলভাবে বাতিল করা হয়েছে।`,
      institutionId: instId,
    };
  },

  /**
   * Get consolidated payment methods / institution cards for merchant
   */
  async getMerchantPaymentMethods(userId) {
    const merchant = await merchantRepository.findOrCreateMerchantByUserId(userId);
    if (!merchant) return { primaryAccount: null, requestedAccounts: [], availableInstitutions: [] };

    // 1. Primary onboarding institution & application info
    const [primaryRows] = await db.query(
      `SELECT m.account_status, m.kyc_status,
              mp.institution_id as profile_inst_id, mp.bank_name as profile_bank_name, mp.channel,
              mp.branch_name, mp.routing_number,
              i.id as institution_id, i.name as institution_name, i.institution_code,
              i.logo_url, i.institution_type, i.is_onboarding_active,
              mga.id as app_id, mga.status as app_status, mga.applied_at,
              mk.bank_account_name, mk.bank_account_number, mk.account_type as kyc_account_type
       FROM merchants m
       LEFT JOIN merchant_profiles mp ON mp.merchant_id = m.id
       LEFT JOIN institutions i ON i.id = mp.institution_id
       LEFT JOIN merchant_gateway_applications mga ON mga.merchant_id = m.id AND mga.institution_id = mp.institution_id
       LEFT JOIN merchant_kyc mk ON mk.merchant_id = m.id
       WHERE m.id = ? LIMIT 1`,
      [merchant.id]
    );

    let primaryAccount = null;
    if (primaryRows.length > 0 && primaryRows[0].institution_id) {
      const p = primaryRows[0];
      const isApproved = String(p.account_status).toLowerCase() === "approved" || String(p.app_status).toLowerCase() === "approved";
      primaryAccount = {
        institutionId: p.institution_id,
        institutionName: p.institution_name || p.profile_bank_name,
        institutionCode: p.institution_code,
        institutionType: p.institution_type,
        logoUrl: p.logo_url,
        channel: p.channel || (p.institution_type === "mfs" ? "mfs" : "bank"),
        isOnboardingActive: Boolean(p.is_onboarding_active),
        accountStatus: p.account_status,
        appStatus: p.app_status,
        isApproved,
        cardTitle: isApproved ? "Approved" : "Application Submitted",
        badgeText: isApproved ? "Approved" : "Pending",
        appliedAt: p.applied_at,
        accountDetails: {
          accountName: p.bank_account_name,
          accountNumber: p.bank_account_number,
          branchName: p.branch_name,
          routingNumber: p.routing_number,
          accountType: p.kyc_account_type,
        },
      };
    }

    // 2. Fetch all other gateway applications submitted by this merchant for additional institutions
    const [otherAppRows] = await db.query(
      `SELECT mga.id as app_id, mga.institution_id, mga.status as app_status, mga.applied_at, mga.submitted_data_snapshot,
              i.name as institution_name, i.institution_code, i.logo_url, i.institution_type, i.is_onboarding_active
       FROM merchant_gateway_applications mga
       JOIN institutions i ON i.id = mga.institution_id
       WHERE mga.merchant_id = ?
       ${primaryAccount ? "AND mga.institution_id != " + Number(primaryAccount.institutionId) : ""}
       ORDER BY mga.applied_at DESC`,
      [merchant.id]
    );

    const submittedAccounts = otherAppRows.map((r) => {
      let snap = {};
      try {
        snap = typeof r.submitted_data_snapshot === "string" ? JSON.parse(r.submitted_data_snapshot) : (r.submitted_data_snapshot || {});
      } catch (_) {}
      const isAppApproved = String(r.app_status).toLowerCase() === "approved";
      return {
        applicationId: r.app_id,
        institutionId: r.institution_id,
        institutionName: r.institution_name,
        institutionCode: r.institution_code,
        institutionType: r.institution_type,
        logoUrl: r.logo_url,
        channel: snap.channel || (r.institution_type === "mfs" ? "mfs" : "bank"),
        isOnboardingActive: Boolean(r.is_onboarding_active),
        appStatus: r.app_status,
        isApproved: isAppApproved,
        cardTitle: isAppApproved ? "Approved" : "Application Submitted",
        badgeText: isAppApproved ? "Approved" : "Pending",
        appliedAt: r.applied_at,
        accountDetails: {
          accountName: snap.accountName || "",
          accountNumber: snap.accountNumber || "",
          branchName: snap.branchName || "",
          routingNumber: snap.routingNumber || "",
          accountType: snap.accountType || "",
        },
      };
    });

    // 3. Availability / Onboarding requests sent by merchant (excluding cancelled and already applied institutions)
    const appliedInstIds = new Set([
      ...(primaryAccount ? [Number(primaryAccount.institutionId)] : []),
      ...submittedAccounts.map((s) => Number(s.institutionId)),
    ]);

    const [requestRows] = await db.query(
      `SELECT iar.id, iar.institution_id, iar.request_status, iar.requested_at, iar.notified_at,
              i.name AS institution_name, i.institution_code, i.institution_type, i.logo_url,
              i.status AS institution_status, i.is_onboarding_active
       FROM institution_availability_requests iar
       INNER JOIN institutions i ON i.id = iar.institution_id
       WHERE iar.merchant_id = ? AND iar.request_status != 'cancelled'
       ORDER BY iar.requested_at DESC`,
      [merchant.id]
    );

    const requestedAccounts = requestRows
      .filter((r) => !appliedInstIds.has(Number(r.institution_id)))
      .map((r) => {
        const isLive = Boolean(r.is_onboarding_active);
        return {
          requestId: r.id,
          institutionId: r.institution_id,
          institutionName: r.institution_name,
          institutionCode: r.institution_code,
          institutionType: r.institution_type,
          logoUrl: r.logo_url,
          channel: r.institution_type === "mfs" ? "mfs" : "bank",
          requestStatus: r.request_status, // 'pending' or 'notified'
          isOnboardingActive: isLive,
          canStart: isLive, // Start button visible when institution onboarding process has started
          cardTitle: "Onboarding Pending",
          badgeText: "Requested",
          requestedAt: r.requested_at,
          notifiedAt: r.notified_at,
        };
      });

    // 3. Pre-existing merchant basic details for overview in modal
    const [profileData, contactData, kycData] = await Promise.all([
      merchantRepository.getProfile(merchant.id),
      merchantRepository.getContact(merchant.id),
      merchantRepository.getKyc(merchant.id),
    ]);

    const overview = {
      companyName: profileData?.company_name || "",
      businessType: profileData?.business_type || "",
      address: profileData?.address || "",
      city: profileData?.city || "",
      state: profileData?.state || "",
      contactName: contactData?.name || "",
      contactEmail: contactData?.email || "",
      contactPhone: contactData?.phone || "",
      authorizedPersonName: kycData?.authorized_person_name || "",
      nidNumber: kycData?.nid_number || "",
      tradeLicenseNumber: kycData?.trade_license_number || "",
      tin: kycData?.tin || "",
    };

    return {
      primaryAccount,
      submittedAccounts,
      requestedAccounts,
      overview,
    };
  },

  /**
   * Submit / Start onboarding application for a specific institution using existing overview
   */
  async submitInstitutionSpecificAccount(userId, payload) {
    const instId = Number(payload.institutionId);
    if (!instId || isNaN(instId) || instId <= 0) {
      const err = new Error("অনুগ্রহ করে একটি সঠিক ব্যাংক বা MFS নির্বাচন করুন।");
      err.statusCode = 400;
      throw err;
    }

    const merchant = await merchantRepository.findOrCreateMerchantByUserId(userId);
    if (!merchant) {
      const err = new Error("Merchant account not found.");
      err.statusCode = 404;
      throw err;
    }

    // Verify institution
    const [instRows] = await db.query(
      "SELECT id, name, institution_code, institution_type, is_onboarding_active, status FROM institutions WHERE id = ? LIMIT 1",
      [instId]
    );
    if (instRows.length === 0) {
      const err = new Error("Institution not found.");
      err.statusCode = 404;
      throw err;
    }
    const inst = instRows[0];

    // Check if branchId exists and fetch branch name if bank
    let branchName = payload.branchName || "";
    let routingNumber = payload.routingNumber || "";
    if (payload.branchId) {
      const [brRows] = await db.query(
        "SELECT branch_name, routing_number FROM institution_branches WHERE id = ? LIMIT 1",
        [payload.branchId]
      );
      if (brRows.length > 0) {
        branchName = brRows[0].branch_name;
        routingNumber = brRows[0].routing_number || routingNumber;
      }
    }

    // Check if an application already exists in merchant_gateway_applications
    const [existingApps] = await db.query(
      "SELECT id, status FROM merchant_gateway_applications WHERE merchant_id = ? AND institution_id = ? LIMIT 1",
      [merchant.id, instId]
    );

    const snapshot = {
      institutionId: instId,
      institutionName: inst.name,
      institutionType: inst.institution_type,
      channel: inst.institution_type === "mfs" ? "mfs" : "bank",
      accountName: payload.accountName || payload.accountHolderName || "",
      accountNumber: payload.accountNumber || payload.phone || payload.walletNumber || "",
      branchName,
      branchId: payload.branchId || null,
      routingNumber,
      accountType: payload.accountType || (inst.institution_type === "mfs" ? "Merchant" : "Current"),
      appliedAt: new Date().toISOString(),
    };

    let applicationId;
    if (existingApps.length > 0) {
      await db.query(
        `UPDATE merchant_gateway_applications
         SET status = 'applied', branch_id = COALESCE(?, branch_id), gateway_name = ?, submitted_data_snapshot = ?, updated_at = NOW()
         WHERE id = ?`,
        [payload.branchId || null, inst.name, JSON.stringify(snapshot), existingApps[0].id]
      );
      applicationId = existingApps[0].id;
    } else {
      const appNumber = `APP-${Date.now().toString().slice(-6)}`;
      const [insRes] = await db.query(
        `INSERT INTO merchant_gateway_applications
         (application_number, application_type, merchant_id, institution_id, branch_id, status, gateway_name, submitted_data_snapshot, applied_at, created_at, updated_at)
         VALUES (?, 'onboarding_kyc', ?, ?, ?, 'applied', ?, ?, NOW(), NOW(), NOW())`,
        [appNumber, merchant.id, instId, payload.branchId || null, inst.name, JSON.stringify(snapshot)]
      );
      applicationId = insRes.insertId;
    }

    // Mark the availability request if any as notified or completed
    await db.query(
      `UPDATE institution_availability_requests
       SET request_status = 'notified', notified_at = COALESCE(notified_at, NOW()), updated_at = NOW()
       WHERE merchant_id = ? AND institution_id = ? AND request_status = 'pending'`,
      [merchant.id, instId]
    );

    // Fetch merchant details for notification
    const [prof] = await db.query(
      "SELECT company_name FROM merchant_profiles WHERE merchant_id = ? LIMIT 1",
      [merchant.id]
    );
    const company = prof[0]?.company_name || merchant.merchant_code || `Merchant #${merchant.id}`;

    // Admin Notification
    try {
      await merchantRepository.createAdminNotification(
        `নতুন পেমেন্ট মাধ্যম আবেদন: ${inst.name}`,
        `মার্চেন্ট ${company} (${merchant.merchant_code}) ${inst.name}-এর জন্য একাউন্ট ও অনবোর্ডিং তথ্য সাবমিট করেছেন।`,
        "kyc",
        "/admin/kyc"
      );
    } catch (_) {}

    // Institution Notification
    try {
      await db.query(
        `INSERT INTO notifications (recipient_type, recipient_id, institution_id, title, message, type, link, is_read, created_at)
         VALUES ('institution', NULL, ?, ?, ?, 'kyc', '/institution/applications', 0, NOW())`,
        [
          instId,
          `নতুন মার্চেন্ট আবেদন: ${company}`,
          `মার্চেন্ট ${company} (${merchant.merchant_code}) অনবোর্ডিং ও একাউন্ট আবেদন তথ্য জমা দিয়েছেন।`,
        ]
      );
    } catch (_) {}

    // Merchant in-app notification
    try {
      await db.query(
        `INSERT INTO notifications (recipient_type, recipient_id, institution_id, title, message, type, link, is_read, created_at)
         VALUES ('merchant', ?, ?, ?, ?, 'system', '/merchant/payment-methods', 0, NOW())`,
        [
          userId,
          instId,
          `আবেদন জমা সম্পন্ন: ${inst.name}`,
          `${inst.name}-এর জন্য আপনার একাউন্ট ও অনবোর্ডিং আবেদন সফলভাবে জমা হয়েছে।`,
        ]
      );
    } catch (_) {}

    // History
    try {
      await merchantRepository.createHistory(
        merchant.id,
        "payment_method_application",
        "submit_institution_account",
        "requested",
        "applied",
        { institutionId: instId, institutionName: inst.name, applicationId }
      );
    } catch (_) {}

    return {
      success: true,
      message: `${inst.name}-এর জন্য আপনার আবেদন সফলভাবে জমা হয়েছে।`,
      applicationId,
    };
  },

  async updateLastVisitedStep(userId, path) {
    const merchant = await merchantRepository.findOrCreateMerchantByUserId(userId);
    await merchantRepository.updateLastVisitedStep(merchant.id, path);
    return { success: true, lastVisitedStep: path };
  },
};
