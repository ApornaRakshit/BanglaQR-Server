import { hashPassword, verifyPassword } from "../../../utils/password.js";
import crypto from "crypto";
import { db } from "../../../config/db.js";
import { secureStorage } from "../../../config/storage.js";
import { adminMerchantsRepository } from "./admin.merchants.repository.js";
import { logAdminAudit } from "../../../utils/auditLogger.js";
import { emailService } from "../../../services/email.service.js";
import {
  generateMerchantOverviewPdf,
  generateMerchantOverviewExcel,
  generateAllMerchantsExcel,
} from "../../../utils/merchantExportGenerator.js";
import { generateMerchantApplicationPdf } from "../../../utils/merchantApplicationPdfService.js";
import { trashService } from "../trash/trash.module.js";

export const adminMerchantsService = {
  async listMerchants(filters) {
    return await adminMerchantsRepository.listMerchants(filters);
  },

  async getMerchantDetails(merchantId) {
    const data = await adminMerchantsRepository.getMerchantById(merchantId);
    if (!data) {
      const err = new Error("Merchant not found");
      err.statusCode = 404;
      throw err;
    }
    return data;
  },

  async getMerchantHistory(merchantId) {
    return await adminMerchantsRepository.getMerchantHistory(merchantId);
  },

  async reviewMerchant({
    merchantId,
    action,
    reason,
    comment,
    requiredItems = [],
    adminUser,
    ip,
    userAgent,
  }) {
    const conn = await db.getConnection();

    try {
      await conn.beginTransaction();

      const [merchantRows] = await conn.execute(
        "SELECT * FROM merchants WHERE id = ? FOR UPDATE",
        [merchantId]
      );

      if (!merchantRows.length) {
        const err = new Error("Merchant record not found");
        err.statusCode = 404;
        throw err;
      }

      const merchant = merchantRows[0];
      const prevAccountStatus = merchant.account_status;
      const prevKycStatus = merchant.kyc_status;

      let newAccountStatus = prevAccountStatus;
      let newKycStatus = prevKycStatus;
      let historyStep = "review";
      let historyAction = action;

      if (action === "start_review") {
        if (prevAccountStatus !== "submitted" && prevAccountStatus !== "additional_information_required") {
          const err = new Error(`Cannot start review from status '${prevAccountStatus}'`);
          err.statusCode = 400;
          throw err;
        }
        newAccountStatus = "under_review";
        newKycStatus = "under_review";

        await conn.execute(
          `UPDATE merchants SET account_status = 'under_review', kyc_status = 'under_review', updated_at = NOW() WHERE id = ?`,
          [merchantId]
        );
      } else if (action === "approve") {
        // Verification before approval (Section 28)
        const [merchants] = await conn.execute("SELECT * FROM merchants WHERE id = ?", [merchantId]);
        const [profiles] = await conn.execute("SELECT * FROM merchant_profiles WHERE merchant_id = ?", [merchantId]);
        const [contacts] = await conn.execute("SELECT * FROM merchant_contacts WHERE merchant_id = ?", [merchantId]);
        const [commercials] = await conn.execute("SELECT * FROM merchant_commercial_details WHERE merchant_id = ?", [merchantId]);
        const [kycs] = await conn.execute("SELECT * FROM merchant_kyc WHERE merchant_id = ?", [merchantId]);
        const [docs] = await conn.execute("SELECT * FROM merchant_documents WHERE merchant_id = ?", [merchantId]);

        const missing = [];
        if (!profiles.length || !profiles[0].company_name) missing.push("Company Information");
        if (!contacts.length || !contacts[0].name || !contacts[0].email || !contacts[0].phone) missing.push("Contact Information");
        if (!commercials.length) missing.push("Commercial Projections");
        if (!kycs.length || !kycs[0].legal_business_name || !kycs[0].nid_number || !kycs[0].bank_name || !kycs[0].bank_account_number) {
          missing.push("Complete KYC & Bank Information");
        }

        const mSegment = String(merchants[0]?.merchant_segment || "").toLowerCase();
        const pType = String(profiles[0]?.business_type || "").toLowerCase();
        const isMicro = mSegment === "micro" || pType.includes("micro") || pType.includes("sole") || pType.includes("pra") || pType.includes("proprietor");

        const docTypes = docs.map((d) => String(d.document_type || "").toUpperCase());
        if (!docTypes.includes("NID_FRONT")) missing.push("NID Front Document");
        if (!docTypes.includes("NID_BACK")) missing.push("NID Back Document");
        
        // TIN certificate is mandatory for Big Merchant, optional for Micro Merchant unless uploaded
        if (!isMicro && !docTypes.includes("TIN_CERTIFICATE")) {
          missing.push("TIN Certificate Document");
        }

        // Cancelled Bank Cheque or Bank Statement
        const hasBankCheque = docTypes.includes("CANCELLED_BANK_CHEQUE") || docTypes.includes("BANK_STATEMENT");
        const hasExistingAcc = profiles[0]?.has_existing_account !== undefined ? Boolean(profiles[0].has_existing_account) : true;
        const isBankChannel = String(profiles[0]?.channel || "").toLowerCase() !== "mfs";

        // For Big Merchant or when bank cheque/statement is required
        if (!isMicro && hasExistingAcc && isBankChannel && !hasBankCheque) {
          missing.push("Cancelled Bank Cheque Document");
        }

        if (missing.length > 0) {
          const err = new Error(`Cannot approve merchant. Missing requirements: ${missing.join(", ")}`);
          err.statusCode = 422;
          err.details = missing;
          throw err;
        }

        newAccountStatus = "approved";
        newKycStatus = "approved";

        // Mark mandatory documents as Approved if not already rejected
        await conn.execute(
          `UPDATE merchant_documents SET status = 'Approved', reviewed_at = NOW(), review_comment = 'Approved by compliance officer' WHERE merchant_id = ? AND status != 'Rejected'`,
          [merchantId]
        );

        // Resolve any open kyc_field_issues since merchant has been fully approved
        await conn.execute(
          `UPDATE kyc_field_issues SET status = 'resolved', resolution_note = 'Resolved upon merchant approval', updated_at = NOW() WHERE merchant_id = ? AND status = 'open'`,
          [merchantId]
        );

        await conn.execute(
          `UPDATE merchants SET account_status = 'approved', kyc_status = 'approved', approved_at = NOW(), admin_comments = ?, updated_at = NOW() WHERE id = ?`,
          [comment || "Application approved by compliance officer", merchantId]
        );

        // Update the merchant's onboarding application to approved
        await conn.execute(
          `UPDATE merchant_gateway_applications 
           SET status = 'approved', approved_at = NOW(), reviewed_at = NOW(), updated_at = NOW(),
               review_comment = COALESCE(review_comment, ?)
           WHERE merchant_id = ? AND application_type = 'onboarding_kyc' AND status != 'approved'`,
          [comment || "Final platform approval granted by Admin", merchantId]
        );

        // Provision default BanglaQR Interoperable Gateway service if not existing
        const [existingServices] = await conn.execute(
          "SELECT id FROM merchant_gateway_services WHERE merchant_id = ?",
          [merchantId]
        );
        if (existingServices.length === 0) {
          const [defaultGateway] = await conn.execute(
            "SELECT id, name, code, logo_url FROM gateways WHERE code = 'BANGLAQR_DIRECT' OR (status = 'active' AND name LIKE '%BanglaQR%') ORDER BY id DESC LIMIT 1"
          );
          if (defaultGateway.length > 0) {
            await conn.execute(
              `INSERT INTO merchant_gateway_services (merchant_id, gateway_id, gateway_name, gateway_code, logo_url, service_type, status, activated_at, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, 'BanglaQR Interoperable', 'active', NOW(), NOW(), NOW())`,
              [
                merchantId,
                defaultGateway[0].id,
                defaultGateway[0].name || "আমার বাংলা কিউআর",
                defaultGateway[0].code || "BANGLAQR_DIRECT",
                defaultGateway[0].logo_url || "/logo.png",
              ]
            );
          }
        }
      } else if (action === "reject") {
        if (!reason && !comment) {
          const err = new Error("Rejection reason or comment is mandatory");
          err.statusCode = 400;
          throw err;
        }

        newAccountStatus = "rejected";
        newKycStatus = "rejected";

        await conn.execute(
          `UPDATE merchants SET account_status = 'rejected', kyc_status = 'rejected', rejected_at = NOW(), rejection_reason = ?, admin_comments = ?, updated_at = NOW() WHERE id = ?`,
          [reason || "Compliance mismatch", comment || reason, merchantId]
        );

        // Update the merchant's onboarding application to rejected
        await conn.execute(
          `UPDATE merchant_gateway_applications 
           SET status = 'rejected', rejection_reason = ?, review_comment = ?, reviewed_at = NOW(), updated_at = NOW()
           WHERE merchant_id = ? AND application_type = 'onboarding_kyc'`,
          [reason || "Compliance mismatch", comment || reason, merchantId]
        );

        // Close any pending open kyc_field_issues as merchant application is rejected
        await conn.execute(
          `UPDATE kyc_field_issues SET status = 'waived', resolution_note = 'Application rejected by platform', updated_at = NOW() WHERE merchant_id = ? AND status = 'open'`,
          [merchantId]
        );
      } else if (action === "request_information" || action === "request_info") {
        newAccountStatus = "under_review";
        newKycStatus = "additional_information_required";

        await conn.execute(
          `UPDATE merchants SET account_status = 'under_review', kyc_status = 'additional_information_required', admin_comments = ?, updated_at = NOW() WHERE id = ?`,
          [
            JSON.stringify({
              reason: reason || "Additional information requested",
              comment: comment || "",
              requiredItems: requiredItems || [],
              requestedAt: new Date().toISOString(),
            }),
            merchantId,
          ]
        );

        // Update the merchant's onboarding application to additional_information_required
        await conn.execute(
          `UPDATE merchant_gateway_applications 
           SET status = 'additional_information_required', review_comment = ?, updated_at = NOW()
           WHERE merchant_id = ? AND application_type = 'onboarding_kyc'`,
          [comment || reason || "Additional information requested by Admin", merchantId]
        );

        // Also record individual field issues in kyc_field_issues so merchant UI flags them precisely
        if (Array.isArray(requiredItems) && requiredItems.length > 0) {
          const [kycRows] = await conn.execute(
            `SELECT id, institution_id FROM merchant_kyc WHERE merchant_id = ? LIMIT 1`,
            [merchantId]
          );
          const kycId = kycRows[0]?.id || null;
          const instId = kycRows[0]?.institution_id || null;

          const itemKeyMap = {
            "Company Information": "company_name",
            "Contact Details": "authorized_person_name",
            "Commercial Projections": "commercial",
            "KYC Legal Details": "trade_license_number",
            "NID Front Document": "nid_front",
            "NID Back Document": "nid_back",
            "TIN Certificate": "tin_certificate",
            "Cancelled Bank Cheque": "cancelled_bank_cheque",
            "Trade License": "trade_license",
            "BIN Certificate": "bin",
          };

          for (const item of requiredItems) {
            const fieldKey = itemKeyMap[item] || item.toLowerCase().replace(/\s+/g, "_");
            // Mark existing open issue for this field or insert new
            await conn.execute(
              `INSERT INTO kyc_field_issues 
               (merchant_id, kyc_id, institution_id, field_key, issue_type, issue_reason, reviewer_id, status, created_at, updated_at)
               VALUES (?, ?, ?, ?, 'incorrect_value', ?, ?, 'open', NOW(), NOW())`,
              [
                merchantId,
                kycId,
                instId,
                fieldKey,
                comment || reason || `Correction requested: ${item}`,
                adminUser?.id || null,
              ]
            );
          }
        }
      } else if (action === "suspend") {
        newAccountStatus = "suspended";
        await conn.execute(
          `UPDATE merchants SET account_status = 'suspended', admin_comments = ?, updated_at = NOW() WHERE id = ?`,
          [comment || reason || "Merchant account suspended by administration", merchantId]
        );
      } else if (action === "activate") {
        newAccountStatus = "active";
        await conn.execute(
          `UPDATE merchants SET account_status = 'active', admin_comments = ?, updated_at = NOW() WHERE id = ?`,
          [comment || "Merchant account set to active status", merchantId]
        );
      } else {
        const err = new Error(`Unsupported review action: ${action}`);
        err.statusCode = 400;
        throw err;
      }

      // Record Onboarding History
      await conn.execute(
        `INSERT INTO merchant_onboarding_history (merchant_id, step, action, previous_status, new_status, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, NOW())`,
        [
          merchantId,
          historyStep,
          historyAction,
          prevAccountStatus,
          newAccountStatus,
          JSON.stringify({
            adminEmail: adminUser?.email,
            reason: reason || null,
            comment: comment || null,
            requiredItems: requiredItems || [],
          }),
        ]
      );

      // Record System Audit Log
      await logAdminAudit({
        connection: conn,
        userId: adminUser?.id,
        adminEmail: adminUser?.email,
        action: `merchant_${action}`,
        resourceType: "merchant",
        resourceId: merchantId,
        merchantId: merchantId,
        details: {
          previousStatus: prevAccountStatus,
          newStatus: newAccountStatus,
          previousKycStatus: prevKycStatus,
          newKycStatus: newKycStatus,
          reason,
          comment,
          requiredItems,
        },
        ip,
        userAgent,
      });

      // Insert Persistent Notification for Merchant & Platform
      await conn.execute(
        `INSERT INTO notifications (recipient_type, recipient_id, title, message, type, link, is_read, created_at)
         VALUES ('merchant', ?, ?, ?, 'merchant_update', '/merchant/dashboard', 0, NOW())`,
        [
          merchant.user_id,
          `Application Update: ${newAccountStatus.toUpperCase()}`,
          comment || `Your merchant onboarding application status has been updated to ${newAccountStatus}.`,
        ]
      );

      // Notify the relevant Partner Bank/MFS if application is associated with an institution
      const [appRows] = await conn.execute(
        `SELECT id, institution_id, gateway_name FROM merchant_gateway_applications 
         WHERE merchant_id = ? AND application_type = 'onboarding_kyc' ORDER BY id DESC LIMIT 1`,
        [merchantId]
      );
      if (appRows.length > 0 && appRows[0].institution_id) {
        const instId = appRows[0].institution_id;
        const [profRows] = await conn.execute(
          `SELECT company_name FROM merchant_profiles WHERE merchant_id = ? LIMIT 1`,
          [merchantId]
        );
        const compName = profRows[0]?.company_name || merchant.merchant_code;

        await conn.execute(
          `INSERT INTO notifications (recipient_type, recipient_id, institution_id, title, message, type, link, is_read, created_at)
           VALUES ('institution', NULL, ?, ?, ?, 'kyc', '/institution/applications', 0, NOW())`,
          [
            instId,
            `Admin Final Review: ${newAccountStatus.toUpperCase()}`,
            `Platform Admin finalized review for merchant ${compName} (${merchant.merchant_code}) with decision: ${newAccountStatus}.`,
          ]
        );
      }

      await conn.commit();

      return {
        success: true,
        message: `Merchant application successfully updated with action '${action}'`,
        merchantId,
        accountStatus: newAccountStatus,
        kycStatus: newKycStatus,
      };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  async createMerchant({
    fullName,
    companyName,
    email,
    phone,
    password,
    businessType,
    institutionId,
    files = [],
    adminUser,
    ip,
    userAgent,
  }) {
    const conn = await db.getConnection();

    try {
      await conn.beginTransaction();

      const normalizedEmail = (email || "").trim().toLowerCase();
      let normalizedPhone = (phone || "").trim();
      if (normalizedPhone.startsWith("+880")) normalizedPhone = "0" + normalizedPhone.slice(4);
      else if (normalizedPhone.startsWith("880")) normalizedPhone = "0" + normalizedPhone.slice(3);

      // Check existing user
      const [existingUsers] = await conn.execute(
        "SELECT id FROM users WHERE email = ? OR phone = ? LIMIT 1",
        [normalizedEmail, normalizedPhone]
      );
      if (existingUsers.length > 0) {
        const err = new Error("User with this email or phone number already exists.");
        err.statusCode = 409;
        throw err;
      }

      // Hash password using bcryptjs
      const passwordHash = await hashPassword(password || crypto.randomBytes(8).toString("hex"));

      // Insert user
      const [userResult] = await conn.execute(
        `INSERT INTO users (email, phone, password_hash, email_verified_at, phone_verified_at, status, created_at, updated_at)
         VALUES (?, ?, ?, NOW(), NOW(), 'active', NOW(), NOW())`,
        [normalizedEmail, normalizedPhone, passwordHash]
      );
      const userId = userResult.insertId;

      // Assign merchant role (role_id 5)
      await conn.execute(
        "INSERT INTO user_roles (user_id, role_id) VALUES (?, 5)",
        [userId]
      );

      // Generate merchant code
      const merchantCode = `BQR-M-${Math.floor(1000000000 + Math.random() * 9000000000)}`;

      // Insert merchant
      const [merchantResult] = await conn.execute(
        `INSERT INTO merchants (user_id, merchant_code, account_status, kyc_status, onboarding_step, created_at, updated_at)
         VALUES (?, ?, 'draft', 'pending', 1, NOW(), NOW())`,
        [userId, merchantCode]
      );
      const merchantId = merchantResult.insertId;

      // Insert merchant contact
      await conn.execute(
        `INSERT INTO merchant_contacts (merchant_id, name, phone, email, designation, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'Authorized Signatory', NOW(), NOW())`,
        [merchantId, fullName, normalizedPhone, normalizedEmail]
      );

      // Institution lookup if provided
      let instName = null;
      if (institutionId) {
        const [instRows] = await conn.execute(
          "SELECT id, name, status FROM institutions WHERE id = ? LIMIT 1",
          [institutionId]
        );
        if (instRows.length === 0) {
          const err = new Error("Selected institution was not found.");
          err.statusCode = 404;
          throw err;
        }
        if (instRows[0].status !== "active") {
          const err = new Error("Selected institution is not active or available for onboarding.");
          err.statusCode = 400;
          throw err;
        }
        instName = instRows[0].name;
      }

      // Insert merchant profile
      await conn.execute(
        `INSERT INTO merchant_profiles (merchant_id, company_name, business_type, institution_id, bank_name, country, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'Bangladesh', NOW(), NOW())`,
        [merchantId, companyName, businessType || "Individual / Sole Proprietorship", institutionId || null, instName]
      );

      // Save uploaded documents if provided
      if (Array.isArray(files) && files.length > 0) {
        for (const file of files) {
          const originalName = file.originalname || "document";
          const lowerName = originalName.toLowerCase();
          let docType = "OTHER";
          let docTitle = originalName;

          if (lowerName.includes("nid") || lowerName.includes("national")) {
            docType = lowerName.includes("back") ? "NID_BACK" : "NID_FRONT";
            docTitle = docType === "NID_BACK" ? "National ID (Back)" : "National ID (Front)";
          } else if (lowerName.includes("trade") || lowerName.includes("license")) {
            docType = "TRADE_LICENSE";
            docTitle = "Trade License";
          } else if (lowerName.includes("tin")) {
            docType = "TIN_CERTIFICATE";
            docTitle = "e-TIN Certificate";
          } else if (lowerName.includes("bin") || lowerName.includes("vat")) {
            docType = "BIN_CERTIFICATE";
            docTitle = "BIN / VAT Certificate";
          } else if (lowerName.includes("cheque") || lowerName.includes("bank") || lowerName.includes("statement")) {
            docType = "CANCELLED_BANK_CHEQUE";
            docTitle = "Bank Cheque / Statement";
          } else if (lowerName.includes("photo") || lowerName.includes("picture") || lowerName.includes("image")) {
            docType = "PASSPORT_PHOTO";
            docTitle = "Passport Photo";
          } else if (lowerName.includes("signature") || lowerName.includes("sign")) {
            docType = "MERCHANT_SIGNATURE";
            docTitle = "Merchant Signature";
          }

          const saved = await secureStorage.saveFile(file, merchantId);

          const [docResult] = await conn.execute(
            `INSERT INTO merchant_documents (
              merchant_id, document_type, document_name, original_filename, stored_filename, storage_key, mime_type, file_size, status, uploaded_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Uploaded', NOW(), NOW(), NOW())`,
            [
              merchantId,
              docType,
              docTitle,
              originalName,
              saved.storedFilename || originalName,
              saved.storageKey,
              saved.mimeType || file.mimetype,
              saved.size || file.size || 0,
            ]
          );

          // Insert document version
          await conn.execute(
            `INSERT INTO merchant_document_versions (
              document_id, version_no, storage_key, original_filename, mime_type, file_size, uploaded_at, review_status
            ) VALUES (?, 1, ?, ?, ?, ?, NOW(), 'pending')`,
            [docResult.insertId, saved.storageKey, originalName, saved.mimeType || file.mimetype, saved.size || file.size || 0]
          );
        }
      }

      // If institution selected, create initial onboarding gateway application
      if (institutionId) {
        const appNumber = `APP-${Math.floor(100000 + Math.random() * 900000)}`;
        await conn.execute(
          `INSERT INTO merchant_gateway_applications (
            application_number, application_type, merchant_id, institution_id,
            gateway_name, status, submission_version, applied_at, created_at, updated_at
          ) VALUES (?, 'onboarding_kyc', ?, ?, ?, 'applied', 1, NOW(), NOW(), NOW())`,
          [appNumber, merchantId, institutionId, instName || "BanglaQR Gateway"]
        );
      }

      // Insert onboarding history log
      await conn.execute(
        `INSERT INTO merchant_onboarding_history (merchant_id, step, action, previous_status, new_status, metadata, created_at)
         VALUES (?, 'manual_provisioning', 'merchant_created', 'none', 'draft', ?, NOW())`,
        [merchantId, JSON.stringify({ note: `Merchant dynamically added by platform admin (${adminUser?.email || "Admin"})` })]
      );

      if (adminUser) {
        await logAdminAudit({
          userId: adminUser.id,
          action: "MERCHANT_CREATE",
          entityType: "merchant",
          entityId: merchantId,
          details: {
            merchantCode,
            companyName,
            email: normalizedEmail,
            institutionId,
          },
          ip,
          userAgent,
        });
      }

      await conn.commit();

      return {
        success: true,
        message: "Merchant created successfully",
        merchantId,
        merchantCode,
        userId,
      };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  async deleteMerchant({ merchantId, adminUser, ip, userAgent }) {
    const conn = await db.getConnection();

    try {
      await conn.beginTransaction();

      const [merchants] = await conn.execute(
        "SELECT id, user_id, merchant_code FROM merchants WHERE id = ? FOR UPDATE",
        [merchantId]
      );

      if (!merchants.length) {
        const err = new Error("Merchant not found");
        err.statusCode = 404;
        throw err;
      }

      const merchant = merchants[0];
      const userId = merchant.user_id;

      // 1. Delete document versions
      await conn.execute(
        `DELETE v FROM merchant_document_versions v
         JOIN merchant_documents d ON v.document_id = d.id
         WHERE d.merchant_id = ?`,
        [merchantId]
      );

      // 2. Delete merchant documents
      await conn.execute("DELETE FROM merchant_documents WHERE merchant_id = ?", [merchantId]);

      // 3. Delete KYC submission versions & field issues
      await conn.execute("DELETE FROM kyc_submission_versions WHERE merchant_id = ?", [merchantId]);
      await conn.execute("DELETE FROM kyc_field_issues WHERE merchant_id = ?", [merchantId]);

      // 4. Delete merchant KYC
      await conn.execute("DELETE FROM merchant_kyc WHERE merchant_id = ?", [merchantId]);

      // 5. Delete merchant contacts & profile & commercials
      await conn.execute("DELETE FROM merchant_contacts WHERE merchant_id = ?", [merchantId]);
      await conn.execute("DELETE FROM merchant_profiles WHERE merchant_id = ?", [merchantId]);
      await conn.execute("DELETE FROM merchant_commercial_details WHERE merchant_id = ?", [merchantId]);

      // 6. Delete gateway applications and application sub-items
      const [apps] = await conn.execute(
        "SELECT id FROM merchant_gateway_applications WHERE merchant_id = ?",
        [merchantId]
      );
      if (apps.length > 0) {
        const appIds = apps.map((a) => a.id);
        const placeholders = appIds.map(() => "?").join(",");
        await conn.execute(
          `DELETE FROM institution_application_services WHERE application_id IN (${placeholders})`,
          appIds
        );
        await conn.execute(
          `DELETE FROM institution_documents WHERE application_id IN (${placeholders})`,
          appIds
        );
        await conn.execute("DELETE FROM merchant_gateway_applications WHERE merchant_id = ?", [merchantId]);
      }

      // 7. Delete gateway services
      await conn.execute("DELETE FROM merchant_gateway_services WHERE merchant_id = ?", [merchantId]);

      // 8. Delete addons & orders
      await conn.execute("DELETE FROM addon_payments WHERE merchant_id = ?", [merchantId]);
      await conn.execute("DELETE FROM merchant_addons WHERE merchant_id = ?", [merchantId]);
      await conn.execute("DELETE FROM addon_orders WHERE merchant_id = ?", [merchantId]);

      // 9. Delete invoices & history
      await conn.execute("DELETE FROM invoice_payments WHERE merchant_id = ?", [merchantId]);
      await conn.execute("DELETE FROM invoice_history WHERE merchant_id = ?", [merchantId]);
      await conn.execute("DELETE FROM invoices WHERE merchant_id = ?", [merchantId]);
      await conn.execute("DELETE FROM invoice_customers WHERE merchant_id = ?", [merchantId]);

      // 10. Delete support tickets & messages
      const [tickets] = await conn.execute(
        "SELECT id FROM support_tickets WHERE merchant_id = ? OR user_id = ?",
        [merchantId, userId]
      );
      if (tickets.length > 0) {
        const tIds = tickets.map((t) => t.id);
        const tPlaceholders = tIds.map(() => "?").join(",");
        await conn.execute(
          `DELETE FROM support_ticket_messages WHERE ticket_id IN (${tPlaceholders})`,
          tIds
        );
        await conn.execute(
          `DELETE FROM support_tickets WHERE id IN (${tPlaceholders})`,
          tIds
        );
      }

      // 11. Delete onboarding history
      await conn.execute("DELETE FROM merchant_onboarding_history WHERE merchant_id = ?", [merchantId]);

      // 12. Delete notifications
      await conn.execute(
        "DELETE FROM notifications WHERE recipient_id = ? OR link LIKE ?",
        [userId, `%/merchants/${merchantId}%`]
      );

      // 13. Delete merchant record
      await conn.execute("DELETE FROM merchants WHERE id = ?", [merchantId]);

      // 14. Delete user-related records
      if (userId) {
        await conn.execute("DELETE FROM user_roles WHERE user_id = ?", [userId]);
        await conn.execute("DELETE FROM user_devices WHERE user_id = ?", [userId]);
        await conn.execute("DELETE FROM sessions WHERE user_id = ?", [userId]);
        await conn.execute("DELETE FROM otp_codes WHERE user_id = ?", [userId]);
        await conn.execute("DELETE FROM password_resets WHERE user_id = ?", [userId]);
        await conn.execute("DELETE FROM users WHERE id = ?", [userId]);
      }

      if (adminUser) {
        await logAdminAudit({
          userId: adminUser.id,
          action: "MERCHANT_DELETE",
          entityType: "merchant",
          entityId: merchantId,
          details: {
            merchantCode: merchant.merchant_code,
            userId,
          },
          ip,
          userAgent,
        });
      }

      await conn.commit();

      return {
        success: true,
        message: `Merchant ${merchant.merchant_code} and all associated records permanently deleted.`,
      };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  async batchDeleteMerchants({ merchantIds = [], scope = "both", adminUser, ip, userAgent }) {
    if (!Array.isArray(merchantIds) || merchantIds.length === 0) {
      return { success: true, count: 0, message: "No merchants selected" };
    }

    let deletedCount = 0;
    for (const id of merchantIds) {
      const merchantId = Number(id);
      if (!merchantId) continue;

      // Preserve full details in trash bin before deletion
      try {
        const details = await this.getMerchantDetails(merchantId);
        if (details && details.merchant) {
          const m = details.merchant;
          await trashService.moveToTrash({
            section: "merchant",
            originalId: merchantId,
            title: details.profile?.companyName || m.merchantCode || `Merchant #${merchantId}`,
            description: `${m.merchantCode} • ${details.user?.email || details.user?.phone || ""} (${m.accountStatus})`,
            scope,
            deletedBy: adminUser?.email || "Admin",
            payload: {
              merchant: m,
              profile: details.profile,
              user: details.user,
              previousAccountStatus: m.accountStatus,
            },
          });
        }
      } catch (err) {
        console.warn(`Trash backup skipped for merchant ${merchantId}:`, err.message);
      }

      if (scope === "institution") {
        // Remove only from institution applications (removes from Bank/MFS portal)
        await db.execute(
          "DELETE FROM merchant_gateway_applications WHERE merchant_id = ?",
          [merchantId]
        );
        deletedCount++;
      } else {
        // Both or Admin: Delete complete merchant record & cascade
        try {
          await this.deleteMerchant({ merchantId, adminUser, ip, userAgent });
          deletedCount++;
        } catch (err) {
          console.error(`Failed to delete merchant ${merchantId}:`, err.message);
        }
      }
    }

    return {
      success: true,
      count: deletedCount,
      scope,
      message: `${deletedCount} merchant(s) processed for ${scope} deletion`,
    };
  },

  async resetMerchantPassword({ merchantId, adminUser, ip, userAgent }) {
    // 1. Fetch merchant and user details
    const [merchants] = await db.query(
      `SELECT m.id, m.merchant_code, m.user_id, u.email, u.phone, p.company_name
       FROM merchants m
       JOIN users u ON m.user_id = u.id
       LEFT JOIN merchant_profiles p ON m.id = p.merchant_id
       WHERE m.id = ? LIMIT 1`,
      [merchantId]
    );

    if (merchants.length === 0) {
      const err = new Error("Merchant not found");
      err.statusCode = 404;
      throw err;
    }

    const merchant = merchants[0];
    const userId = merchant.user_id;
    const userEmail = merchant.email;
    const merchantName = merchant.company_name || merchant.merchant_code;

    if (!userEmail) {
      const err = new Error("Merchant user does not have a registered email address.");
      err.statusCode = 400;
      throw err;
    }

    // 2. Automatically generate secure random password (e.g. Bqr#9a8b7c)
    const randomHex = crypto.randomBytes(4).toString("hex");
    const specialChars = ["#", "!", "@", "$", "&"];
    const randomSpecial = specialChars[Math.floor(Math.random() * specialChars.length)];
    const generatedPassword = `Bqr${randomSpecial}${randomHex}`;

    // 3. Hash password with bcryptjs
    const passwordHash = await hashPassword(generatedPassword);

    // 4. Update password in database, record audit timestamp and increment token_version
    await db.execute(
      `UPDATE users
       SET password_hash = ?,
           password_changed_at = NOW(),
           token_version = token_version + 1,
           must_change_password = 1,
           updated_at = NOW()
       WHERE id = ?`,
      [passwordHash, userId]
    );

    // Invalidate any active sessions
    try {
      await db.execute(`DELETE FROM sessions WHERE user_id = ?`, [userId]);
    } catch (_) {}

    // 5. Create notification for the merchant
    try {
      await db.execute(
        `INSERT INTO notifications (recipient_type, recipient_id, title, message, type, link, is_read, created_at)
         VALUES ('merchant', ?, 'পাসওয়ার্ড রিসেট করা হয়েছে', 'আপনার মার্চেন্ট অ্যাকাউন্টের পাসওয়ার্ড এডমিন দ্বারা রিসেট করা হয়েছে এবং নতুন লগইন তথ্য ইমেইলে পাঠানো হয়েছে।', 'security', '/merchant/settings', 0, NOW())`,
        [userId]
      );
    } catch (_) {}

    // 6. Send email with new credentials to merchant
    const mailResult = await emailService.sendMerchantCredentialsEmail({
      to: userEmail,
      merchantName,
      email: userEmail,
      password: generatedPassword,
      loginUrl: process.env.CLIENT_URL ? `${process.env.CLIENT_URL}/login` : "https://banglaqr.com.bd/login",
    });

    // 7. Audit log for administrator action
    if (adminUser?.id) {
      await logAdminAudit({
        userId: adminUser.id,
        adminEmail: adminUser.email || "admin@banglaqr.com",
        action: "MERCHANT_PASSWORD_RESET",
        resourceType: "merchant",
        resourceId: String(merchantId),
        merchantId: Number(merchantId),
        details: {
          merchantCode: merchant.merchant_code,
          email: userEmail,
          emailDelivered: mailResult?.delivered || mailResult?.success || false,
        },
        ip: ip || null,
        userAgent: userAgent || null,
      });
    }

    return {
      success: true,
      message: `পাসওয়ার্ড সফলভাবে রিসেট করা হয়েছে এবং নতুন লগইন তথ্য ${userEmail} ঠিকানায় ইমেইল করা হয়েছে।`,
      data: {
        merchantId,
        merchantCode: merchant.merchant_code,
        email: userEmail,
        newPassword: generatedPassword,
        emailDelivered: mailResult?.delivered || mailResult?.success || false,
      },
    };
  },

  async exportMerchantPdf(merchantId, options = {}) {
    const data = await this.getMerchantDetails(merchantId);
    const code = data.merchant?.merchantCode || data.merchant?.merchant_code || `M-${merchantId}`;
    const filename = `Merchant_Application_${code}.pdf`;
    const buffer = await generateMerchantApplicationPdf(data, options);
    return { buffer, filename };
  },

  async exportMerchantExcel(merchantId) {
    const data = await this.getMerchantDetails(merchantId);
    const code = data.merchant?.merchantCode || data.merchant?.merchant_code || `M-${merchantId}`;
    const filename = `BanglaQR_Merchant_Overview_${code}.xlsx`;
    const buffer = await generateMerchantOverviewExcel(data);
    return { buffer, filename };
  },

  async exportAllMerchantsExcel(filters = {}) {
    const merchants = await adminMerchantsRepository.getAllMerchantsForExport(filters);
    const dateStr = new Date().toISOString().split("T")[0];
    const filename = `BanglaQR_All_Merchants_${dateStr}.xlsx`;
    const buffer = await generateAllMerchantsExcel(merchants);
    return { buffer, filename };
  },
};

