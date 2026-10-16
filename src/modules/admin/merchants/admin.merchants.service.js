import { db } from "../../../config/db.js";
import { adminMerchantsRepository } from "./admin.merchants.repository.js";
import { logAdminAudit } from "../../../utils/auditLogger.js";

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

        const docTypes = docs.map((d) => String(d.document_type || "").toUpperCase());
        if (!docTypes.includes("NID_FRONT")) missing.push("NID Front Document");
        if (!docTypes.includes("NID_BACK")) missing.push("NID Back Document");
        if (!docTypes.includes("TIN_CERTIFICATE")) missing.push("TIN Certificate Document");
        if (!docTypes.includes("CANCELLED_BANK_CHEQUE")) missing.push("Cancelled Bank Cheque Document");

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

        await conn.execute(
          `UPDATE merchants SET account_status = 'approved', kyc_status = 'approved', approved_at = NOW(), admin_comments = ?, updated_at = NOW() WHERE id = ?`,
          [comment || "Application approved by compliance officer", merchantId]
        );

        // Provision default BanglaQR Interoperable Gateway service if not existing
        const [existingServices] = await conn.execute(
          "SELECT id FROM merchant_gateway_services WHERE merchant_id = ?",
          [merchantId]
        );
        if (existingServices.length === 0) {
          const [defaultGateway] = await conn.execute("SELECT id FROM gateways WHERE status = 'active' LIMIT 1");
          if (defaultGateway.length > 0) {
            await conn.execute(
              `INSERT INTO merchant_gateway_services (merchant_id, gateway_id, service_type, status, activated_at, created_at, updated_at)
               VALUES (?, ?, 'BanglaQR Interoperable', 'active', NOW(), NOW(), NOW())`,
              [merchantId, defaultGateway[0].id]
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
      } else if (action === "request_information" || action === "request_info") {
        newAccountStatus = "additional_information_required";
        newKycStatus = "additional_information_required";

        await conn.execute(
          `UPDATE merchants SET account_status = 'additional_information_required', kyc_status = 'additional_information_required', admin_comments = ?, updated_at = NOW() WHERE id = ?`,
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

        // Also record individual field issues in kyc_field_issues so merchant UI flags them precisely
        if (Array.isArray(requiredItems) && requiredItems.length > 0) {
          const [kycRows] = await conn.execute(
            `SELECT id, institution_id FROM merchant_kyc WHERE merchant_id = ? LIMIT 1`,
            [merchantId]
          );
          const kycId = kycRows[0]?.id || null;
          const instId = kycRows[0]?.institution_id || null;

          const itemKeyMap = {
            "Company Information": "legal_business_name",
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
};

