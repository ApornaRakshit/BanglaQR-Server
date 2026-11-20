import { db } from "../../../config/db.js";

export const adminDocumentsRepository = {
  async listDocuments({
    search = "",
    status = "",
    documentType = "",
    page = 1,
    limit = 15,
  }) {
    const offset = (page - 1) * limit;
    const conditions = [];
    const params = [];

    if (search && search.trim() !== "") {
      const s = `%${search.trim()}%`;
      conditions.push(
        "(m.merchant_code LIKE ? OR p.company_name LIKE ? OR md.document_name LIKE ? OR u.email LIKE ?)"
      );
      params.push(s, s, s, s);
    }

    if (status && status !== "all") {
      conditions.push("md.status = ?");
      params.push(status);
    }

    if (documentType && documentType !== "all") {
      conditions.push("md.document_type = ?");
      params.push(documentType);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const [countRows] = await db.execute(
      `
        SELECT COUNT(md.id) AS total
        FROM merchant_documents md
        JOIN merchants m ON md.merchant_id = m.id
        JOIN users u ON m.user_id = u.id
        LEFT JOIN merchant_profiles p ON p.merchant_id = m.id
        ${whereClause}
      `,
      params
    );

    const total = Number(countRows[0]?.total || 0);

    const [rows] = await db.execute(
      `
        SELECT
          md.id,
          md.merchant_id,
          md.document_type,
          md.document_name,
          md.mime_type,
          md.file_size,
          md.status,
          md.review_comment,
          md.uploaded_at,
          md.reviewed_at,
          md.created_at,
          m.merchant_code,
          m.account_status,
          u.email,
          COALESCE(p.company_name, m.merchant_code) AS company_name
        FROM merchant_documents md
        JOIN merchants m ON md.merchant_id = m.id
        JOIN users u ON m.user_id = u.id
        LEFT JOIN merchant_profiles p ON p.merchant_id = m.id
        ${whereClause}
        ORDER BY md.uploaded_at DESC, md.created_at DESC
        LIMIT ? OFFSET ?
      `,
      [...params, String(limit), String(offset)]
    );

    return {
      documents: rows.map((r) => ({
        id: r.id,
        merchantId: r.merchant_id,
        merchantCode: r.merchant_code,
        companyName: r.company_name,
        email: r.email,
        accountStatus: r.account_status,
        documentType: r.document_type,
        documentName: r.document_name,
        mimeType: r.mime_type,
        fileSize: r.file_size,
        status: r.status,
        reviewComment: r.review_comment,
        uploadedAt: r.uploaded_at,
        reviewedAt: r.reviewed_at,
        createdAt: r.created_at,
      })),
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / limit) || 1,
    };
  },

  async getDocumentById(merchantId, documentId) {
    const [rows] = await db.execute(
      `
        SELECT md.*, m.merchant_code, u.email, COALESCE(p.company_name, m.merchant_code) AS company_name
        FROM merchant_documents md
        JOIN merchants m ON md.merchant_id = m.id
        JOIN users u ON m.user_id = u.id
        LEFT JOIN merchant_profiles p ON p.merchant_id = m.id
        WHERE md.id = ? AND md.merchant_id = ?
        LIMIT 1
      `,
      [documentId, merchantId]
    );

    return rows[0] || null;
  },

  async updateDocumentStatus(documentId, status, reviewComment) {
    await db.execute(
      `
        UPDATE merchant_documents
        SET status = ?, review_comment = ?, reviewed_at = NOW(), updated_at = NOW()
        WHERE id = ?
      `,
      [status, reviewComment, documentId]
    );
  },
};

