import fs from "fs";
import { adminDocumentsRepository } from "./admin.documents.repository.js";
import { secureStorage } from "../../../config/storage.js";
import { logAdminAudit } from "../../../utils/auditLogger.js";
import { db } from "../../../config/db.js";

export const adminDocumentsService = {
  async listDocuments(filters) {
    return await adminDocumentsRepository.listDocuments(filters);
  },

  async getDocumentFile(merchantId, documentId) {
    const doc = await adminDocumentsRepository.getDocumentById(merchantId, documentId);
    if (!doc) {
      const err = new Error("Document not found or does not belong to merchant");
      err.statusCode = 404;
      throw err;
    }

    try {
      const filePath = secureStorage.getFilePath(doc.storage_key, merchantId);
      if (!fs.existsSync(filePath)) {
        const err = new Error("Physical document file not found in secure storage");
        err.statusCode = 404;
        throw err;
      }
      return {
        filePath,
        mimeType: doc.mime_type || "application/octet-stream",
        documentName: doc.document_name,
        documentType: doc.document_type,
        doc,
      };
    } catch (e) {
      const err = new Error(e.message || "Cannot access document storage");
      err.statusCode = 403;
      throw err;
    }
  },

  async reviewDocument({
    merchantId,
    documentId,
    status,
    reviewComment,
    adminUser,
    ip,
    userAgent,
  }) {
    const doc = await adminDocumentsRepository.getDocumentById(merchantId, documentId);
    if (!doc) {
      const err = new Error("Document not found");
      err.statusCode = 404;
      throw err;
    }

    await adminDocumentsRepository.updateDocumentStatus(documentId, status, reviewComment);

    // If document is Approved, resolve any open issues for this document
    if (status === "Approved") {
      try {
        const docKey = String(doc.document_type || "").toLowerCase();
        await db.query(
          `UPDATE kyc_field_issues 
           SET status = 'resolved', resolution_note = 'Document approved by compliance officer', updated_at = NOW()
           WHERE merchant_id = ? AND status = 'open' 
           AND (field_key = ? OR field_key = ? OR LOWER(field_key) LIKE ?)`,
          [merchantId, docKey, doc.document_type, `%${docKey}%`]
        );
      } catch (apprErr) {
        console.warn("Failed to resolve kyc_field_issues on document approval:", apprErr.message);
      }
    }

    // If document is Rejected, notify merchant to resubmit and create a KYC field issue
    if (status === "Rejected") {
      try {
        const [merchants] = await db.query(
          "SELECT user_id, merchant_code FROM merchants WHERE id = ? LIMIT 1",
          [merchantId]
        );
        const userId = merchants[0]?.user_id;
        const merchantCode = merchants[0]?.merchant_code;

        if (userId) {
          const docLabel = doc.custom_label || doc.document_name || doc.document_type || "ডকুমেন্ট";
          const reasonText = reviewComment || "ডকুমেন্টটি অস্পষ্ট বা নির্দেশিকা অনুযায়ী নয়";

          await db.execute(
            `INSERT INTO notifications (recipient_type, recipient_id, title, message, type, link, is_read, created_at)
             VALUES ('merchant', ?, ?, ?, 'document', '/merchant/onboarding/documents', 0, NOW())`,
            [
              userId,
              `ডকুমেন্ট বাতিল করা হয়েছে: ${docLabel}`,
              `আপনার '${docLabel}' ডকুমেন্টটি বাতিল করা হয়েছে। কারণ: ${reasonText}। অনুগ্রহ করে ডকুমেন্টস পেজে গিয়ে পুনরায় আপলোড (Resubmit) করুন।`
            ]
          );

          // Track in kyc_field_issues so it flags clearly across dashboards
          const docKey = String(doc.document_type || "").toLowerCase();
          const [kycRows] = await db.query(
            "SELECT id FROM merchant_kyc WHERE merchant_id = ? LIMIT 1",
            [merchantId]
          );
          const kycId = kycRows[0]?.id || null;

          if (kycId) {
            // Check if open issue exists for this field
            const [existingIssues] = await db.query(
              "SELECT id FROM kyc_field_issues WHERE merchant_id = ? AND field_key = ? AND status = 'open' LIMIT 1",
              [merchantId, docKey]
            );

            if (existingIssues.length > 0) {
              await db.execute(
                "UPDATE kyc_field_issues SET issue_reason = ?, issue_type = 'illegible_scan', updated_at = NOW() WHERE id = ?",
                [reasonText, existingIssues[0].id]
              );
            } else {
              await db.execute(
                `INSERT INTO kyc_field_issues (merchant_id, kyc_id, institution_id, field_key, issue_type, issue_reason, reviewer_id, status, created_at, updated_at)
                 VALUES (?, ?, NULL, ?, 'illegible_scan', ?, ?, 'open', NOW(), NOW())`,
                [merchantId, kycId, docKey, reasonText, adminUser?.id || 1]
              );
            }
          }

          // Ensure merchant status indicates review is in progress or requires info
          await db.execute(
            `UPDATE merchants 
             SET kyc_status = IF(kyc_status = 'approved', 'under_review', kyc_status),
                 updated_at = NOW() 
             WHERE id = ?`,
            [merchantId]
          );
        }
      } catch (notifErr) {
        console.error("Failed to notify merchant of rejected document:", notifErr);
      }
    }

    await logAdminAudit({
      userId: adminUser?.id,
      adminEmail: adminUser?.email,
      action: `document_${status.toLowerCase().replace(/ /g, "_")}`,
      resourceType: "document",
      resourceId: documentId,
      merchantId,
      details: {
        documentType: doc.document_type,
        documentName: doc.document_name,
        previousStatus: doc.status,
        newStatus: status,
        reviewComment,
      },
      ip,
      userAgent,
    });

    return {
      success: true,
      message: `Document status updated to '${status}'`,
      documentId,
      status,
    };
  },
};

