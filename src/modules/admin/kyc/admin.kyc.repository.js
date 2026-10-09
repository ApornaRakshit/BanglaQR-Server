import { db } from "../../../config/db.js";

export const adminKycRepository = {
  async listKyc({
    search = "",
    status = "",
    businessType = "",
    page = 1,
    limit = 15,
  }) {
    const offset = (page - 1) * limit;
    const conditions = [];
    const params = [];

    if (search && search.trim() !== "") {
      const s = `%${search.trim()}%`;
      conditions.push(
        "(m.merchant_code LIKE ? OR k.legal_business_name LIKE ? OR k.tin LIKE ? OR k.nid_number LIKE ? OR u.email LIKE ?)"
      );
      params.push(s, s, s, s, s);
    }

    if (status && status !== "all") {
      conditions.push("m.kyc_status = ?");
      params.push(status);
    }

    if (businessType && businessType !== "all") {
      conditions.push("k.business_entity_type = ?");
      params.push(businessType);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const [countRows] = await db.execute(
      `
        SELECT COUNT(DISTINCT m.id) AS total
        FROM merchants m
        JOIN users u ON m.user_id = u.id
        LEFT JOIN merchant_kyc k ON k.merchant_id = m.id
        LEFT JOIN merchant_profiles p ON p.merchant_id = m.id
        ${whereClause}
      `,
      params
    );

    const total = Number(countRows[0]?.total || 0);

    const [rows] = await db.execute(
      `
        SELECT
          m.id AS merchant_id,
          m.merchant_code,
          m.account_status,
          m.kyc_status,
          m.submitted_at,
          m.created_at,
          u.email,
          u.phone,
          k.legal_business_name,
          k.business_entity_type,
          k.trade_license_number,
          k.tin,
          k.nid_number,
          k.authorized_person_name,
          k.bank_name,
          k.bank_account_name,
          k.bank_account_number,
          k.account_type,
          COALESCE(p.company_name, k.legal_business_name, 'Pending Setup') AS company_name,
          (SELECT COUNT(*) FROM merchant_documents md WHERE md.merchant_id = m.id) AS document_count,
          (SELECT COUNT(*) FROM merchant_documents md WHERE md.merchant_id = m.id AND md.status = 'Approved') AS approved_document_count
        FROM merchants m
        JOIN users u ON m.user_id = u.id
        LEFT JOIN merchant_kyc k ON k.merchant_id = m.id
        LEFT JOIN merchant_profiles p ON p.merchant_id = m.id
        ${whereClause}
        ORDER BY m.submitted_at DESC, m.created_at DESC
        LIMIT ? OFFSET ?
      `,
      [...params, String(limit), String(offset)]
    );

    return {
      items: rows.map((r) => ({
        merchantId: r.merchant_id,
        merchantCode: r.merchant_code,
        companyName: r.company_name,
        legalBusinessName: r.legal_business_name,
        businessEntityType: r.business_entity_type,
        email: r.email,
        phone: r.phone,
        tradeLicenseNumber: r.trade_license_number,
        tin: r.tin ? mask(r.tin) : "N/A",
        nidNumber: r.nid_number ? mask(r.nid_number) : "N/A",
        authorizedPersonName: r.authorized_person_name,
        bankName: r.bank_name,
        bankAccountName: r.bank_account_name,
        bankAccountNumber: r.bank_account_number ? mask(r.bank_account_number) : "N/A",
        accountType: r.account_type,
        accountStatus: r.account_status,
        kycStatus: r.kyc_status,
        documentCount: Number(r.document_count || 0),
        approvedDocumentCount: Number(r.approved_document_count || 0),
        submittedAt: r.submitted_at,
        createdAt: r.created_at,
      })),
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / limit) || 1,
    };
  },

  async getKycByMerchantId(merchantId) {
    const [rows] = await db.execute(
      `
        SELECT
          m.id AS merchant_id,
          m.merchant_code,
          m.account_status,
          m.kyc_status,
          m.submitted_at,
          m.approved_at,
          m.admin_comments,
          u.email,
          u.phone,
          p.company_name,
          p.business_type,
          k.*
        FROM merchants m
        JOIN users u ON m.user_id = u.id
        LEFT JOIN merchant_kyc k ON k.merchant_id = m.id
        LEFT JOIN merchant_profiles p ON p.merchant_id = m.id
        WHERE m.id = ?
        LIMIT 1
      `,
      [merchantId]
    );

    if (!rows.length) return null;
    const r = rows[0];

    const [docs] = await db.execute(
      `
        SELECT id, document_type, document_name, mime_type, file_size, status, review_comment, uploaded_at, reviewed_at
        FROM merchant_documents
        WHERE merchant_id = ?
      `,
      [merchantId]
    );

    return {
      merchantId: r.merchant_id,
      merchantCode: r.merchant_code,
      companyName: r.company_name,
      businessType: r.business_type,
      email: r.email,
      phone: r.phone,
      accountStatus: r.account_status,
      kycStatus: r.kyc_status,
      submittedAt: r.submitted_at,
      approvedAt: r.approved_at,
      adminComments: r.admin_comments,
      kyc: {
        legalBusinessName: r.legal_business_name,
        businessEntityType: r.business_entity_type,
        registrationNumber: r.registration_number,
        tradeLicenseNumber: r.trade_license_number,
        tin: r.tin ? mask(r.tin) : null,
        rawTin: r.tin,
        bin: r.bin ? mask(r.bin) : null,
        rawBin: r.bin,
        nidNumber: r.nid_number ? mask(r.nid_number) : null,
        rawNid: r.nid_number,
        authorizedPersonName: r.authorized_person_name,
        designation: r.designation,
        bankName: r.bank_name,
        bankAccountName: r.bank_account_name,
        bankAccountNumber: r.bank_account_number ? mask(r.bank_account_number) : null,
        rawBankAccountNumber: r.bank_account_number,
        branchName: r.branch_name,
        routingNumber: r.routing_number,
        accountType: r.account_type,
      },
      documents: docs.map((d) => ({
        id: d.id,
        documentType: d.document_type,
        documentName: d.document_name,
        mimeType: d.mime_type,
        fileSize: d.file_size,
        status: d.status,
        reviewComment: d.review_comment,
        uploadedAt: d.uploaded_at,
        reviewedAt: d.reviewed_at,
      })),
    };
  },
};

function mask(val) {
  if (!val) return "";
  const str = String(val);
  if (str.length <= 4) return "****";
  return `${str.slice(0, 2)}****${str.slice(-2)}`;
}

