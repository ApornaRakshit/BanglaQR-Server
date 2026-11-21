import { db } from "../../../config/db.js";
import { secureStorage } from "../../../config/storage.js";

export const adminMerchantQrRepository = {
  /**
   * List all approved merchants with their QR status and connected Bank/MFS
   */
  async listApprovedMerchantsForQr({ search } = {}) {
    const conditions = ["(m.account_status IN ('approved', 'active') OR mga.status = 'approved')"];
    const params = [];

    if (search && search.trim()) {
      conditions.push(
        "(p.company_name LIKE ? OR k.legal_business_name LIKE ? OR m.merchant_code LIKE ? OR u.email LIKE ? OR u.phone LIKE ? OR i.name LIKE ? OR mi.name LIKE ?)"
      );
      const s = `%${search.trim()}%`;
      params.push(s, s, s, s, s, s, s);
    }

    const whereClause = conditions.join(" AND ");

    const [rows] = await db.query(
      `
      SELECT DISTINCT
        m.id AS merchant_id,
        m.merchant_code,
        m.account_status,
        m.kyc_status,
        m.qr_code_url,
        m.user_id,
        COALESCE(p.company_name, k.legal_business_name, m.merchant_code) AS company_name,
        COALESCE(m.merchant_segment, 'micro') AS merchant_segment,
        COALESCE(c.name, p.company_name, 'Merchant Owner') AS contact_name,
        u.email AS merchant_email,
        u.phone AS merchant_phone,
        COALESCE(k.business_entity_type, p.business_type, 'Retail') AS business_type,
        COALESCE(i.name, mi.name, 'N/A') AS institution_name,
        COALESCE(i.institution_type, mi.institution_type, 'Bank / MFS') AS institution_type,
        COALESCE(p.institution_id, mga.institution_id) AS institution_id,
        m.approved_at,
        m.created_at,
        (
          SELECT doc.id
          FROM merchant_documents doc
          WHERE doc.merchant_id = m.id AND doc.document_type = 'MERCHANT_QR'
          ORDER BY doc.id DESC
          LIMIT 1
        ) AS qr_document_id,
        (
          SELECT doc.original_filename
          FROM merchant_documents doc
          WHERE doc.merchant_id = m.id AND doc.document_type = 'MERCHANT_QR'
          ORDER BY doc.id DESC
          LIMIT 1
        ) AS qr_original_filename,
        (
          SELECT doc.uploaded_at
          FROM merchant_documents doc
          WHERE doc.merchant_id = m.id AND doc.document_type = 'MERCHANT_QR'
          ORDER BY doc.id DESC
          LIMIT 1
        ) AS qr_uploaded_at,
        (
          SELECT doc.review_comment
          FROM merchant_documents doc
          WHERE doc.merchant_id = m.id AND doc.document_type = 'MERCHANT_QR'
          ORDER BY doc.id DESC
          LIMIT 1
        ) AS qr_provider_info
      FROM merchants m
      LEFT JOIN merchant_gateway_applications mga ON m.id = mga.merchant_id
      LEFT JOIN users u ON u.id = m.user_id
      LEFT JOIN merchant_profiles p ON p.merchant_id = m.id
      LEFT JOIN merchant_contacts c ON c.merchant_id = m.id
      LEFT JOIN merchant_kyc k ON k.merchant_id = m.id
      LEFT JOIN institutions i ON i.id = p.institution_id
      LEFT JOIN institutions mi ON mi.id = mga.institution_id
      WHERE ${whereClause}
      ORDER BY m.approved_at DESC, m.id DESC
      `,
      params
    );

    return rows;
  },

  /**
   * Get merchant details for QR upload
   */
  async getApprovedMerchantById(merchantId) {
    const [rows] = await db.query(
      `
      SELECT 
        m.id, 
        m.user_id,
        m.merchant_code, 
        m.account_status, 
        m.qr_code_url,
        COALESCE(k.legal_business_name, p.company_name, m.merchant_code) AS company_name,
        COALESCE(p.institution_id, mga.institution_id) AS institution_id,
        COALESCE(i.name, mi.name, 'Bank / MFS Partner') AS institution_name
      FROM merchants m
      LEFT JOIN merchant_profiles p ON m.id = p.merchant_id
      LEFT JOIN merchant_kyc k ON m.id = k.merchant_id
      LEFT JOIN merchant_gateway_applications mga ON m.id = mga.merchant_id
      LEFT JOIN institutions i ON i.id = p.institution_id
      LEFT JOIN institutions mi ON mi.id = mga.institution_id
      WHERE m.id = ? AND (m.account_status IN ('approved', 'active') OR mga.status = 'approved')
      LIMIT 1
      `,
      [Number(merchantId)]
    );
    return rows[0] || null;
  },

  /**
   * Save uploaded QR code and update merchant records
   */
  async saveMerchantQrCode({ merchantId, file, user, reqMeta = {} }) {
    if (!file) {
      const err = new Error("Please select a QR code image or PDF file to upload.");
      err.statusCode = 400;
      throw err;
    }

    const merchant = await this.getApprovedMerchantById(merchantId);
    if (!merchant) {
      const err = new Error("Merchant not found or not in approved status.");
      err.statusCode = 404;
      throw err;
    }

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      // Save file into secureStorage under merchant folder
      const saved = await secureStorage.saveFile(file, merchantId);
      const originalName = file.originalname || "Merchant_BanglaQR";
      const mime = saved.mimeType || file.mimetype || "application/octet-stream";
      const size = saved.size || file.size || 0;

      // Mark any previous MERCHANT_QR documents as replaced
      await conn.execute(
        `UPDATE merchant_documents
         SET status = 'Uploaded'
         WHERE merchant_id = ? AND document_type = 'MERCHANT_QR'`,
        [merchantId]
      );

      // Insert new MERCHANT_QR document with review_comment = 'Provided by Admin'
      const [docResult] = await conn.execute(
        `INSERT INTO merchant_documents (
          merchant_id, document_type, document_name, original_filename, stored_filename,
          storage_key, mime_type, file_size, status, uploaded_at, created_at, updated_at, custom_label, review_comment
        ) VALUES (?, 'MERCHANT_QR', 'Merchant Bangla QR', ?, ?, ?, ?, ?, 'Approved', NOW(), NOW(), NOW(), 'অফিসিয়াল বাংলা কিউআর (Official Bangla QR)', 'Provided by Admin')`,
        [
          merchantId,
          originalName,
          saved.storedFilename || originalName,
          saved.storageKey,
          mime,
          size,
        ]
      );

      const qrDocumentId = docResult.insertId;
      const qrUrl = `/api/v1/merchants/me/documents/${qrDocumentId}/view`;

      // Update merchant table qr_code_url
      await conn.execute(
        `UPDATE merchants SET qr_code_url = ?, updated_at = NOW() WHERE id = ?`,
        [qrUrl, merchantId]
      );

      // Also sync active merchant_gateway_services for BanglaQR
      await conn.execute(
        `UPDATE merchant_gateway_services 
         SET qr_code_url = ?, updated_at = NOW() 
         WHERE merchant_id = ?`,
        [qrUrl, merchantId]
      );

      // 1. Notification to Merchant: Name of Institution under which merchant is approved
      const instName = merchant.institution_name || "Bangla QR Network";
      await conn.execute(
        `INSERT INTO notifications (
          recipient_id, institution_id, recipient_type, title, message, type, link, is_read, created_at
        ) VALUES (?, NULL, 'merchant', ?, ?, 'merchant_update', '/merchant/services/amar-bangla-qr', 0, NOW())`,
        [
          merchant.user_id,
          "বাংলা কিউআর (Bangla QR) প্রদান করা হয়েছে",
          `${instName} এর পক্ষ থেকে আপনার অফিসিয়াল বাংলা কিউআর (Bangla QR) প্রদান করা হয়েছে। আমার বাংলা কিউআর মেনু থেকে কিউআর ডাউনলোড বা ব্যবহার করতে পারবেন।`,
        ]
      );

      // 2. Notification to Institution (Bank/MFS) if connected: Admin provided QR
      if (merchant.institution_id) {
        await conn.execute(
          `INSERT INTO notifications (
            recipient_id, institution_id, recipient_type, title, message, type, link, is_read, created_at
          ) VALUES (NULL, ?, 'institution', ?, ?, 'system', '/institution/merchant-qr', 0, NOW())`,
          [
            merchant.institution_id,
            "মার্চেন্ট কিউআর আপডেট: Admin Issued QR",
            `সুপার এডমিন কর্তৃক মার্চেন্ট ${merchant.company_name} (${merchant.merchant_code}) এর জন্য অফিসিয়াল বাংলা কিউআর প্রদান করা হয়েছে।`,
          ]
        );
      }

      await conn.commit();

      return {
        success: true,
        message: `Official Bangla QR successfully uploaded for merchant ${merchant.merchant_code}.`,
        data: {
          documentId: qrDocumentId,
          qrCodeUrl: qrUrl,
          originalFilename: originalName,
          uploadedAt: new Date().toISOString(),
          providerInfo: "Provided by Admin",
        },
      };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },
};
