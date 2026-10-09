import { db } from "../../config/db.js";

export const adminRepository = {
  async getStats() {
    const [merchantRows] = await db.execute(`
      SELECT
        COUNT(*) AS totalMerchants,
        COALESCE(SUM(CASE WHEN created_at >= CURDATE() - INTERVAL 7 DAY THEN 1 ELSE 0 END), 0) AS newRegistrations,
        COALESCE(SUM(CASE WHEN account_status = 'submitted' THEN 1 ELSE 0 END), 0) AS pendingReview,
        COALESCE(SUM(CASE WHEN account_status = 'under_review' THEN 1 ELSE 0 END), 0) AS underReview,
        COALESCE(SUM(CASE WHEN account_status = 'approved' THEN 1 ELSE 0 END), 0) AS approved,
        COALESCE(SUM(CASE WHEN account_status = 'rejected' THEN 1 ELSE 0 END), 0) AS rejected,
        COALESCE(SUM(CASE WHEN kyc_status = 'pending' THEN 1 ELSE 0 END), 0) AS kycPending,
        COALESCE(SUM(CASE WHEN account_status = 'additional_information_required' THEN 1 ELSE 0 END), 0) AS additionalInformationRequired,
        COALESCE(SUM(CASE WHEN account_status = 'suspended' THEN 1 ELSE 0 END), 0) AS suspended
      FROM merchants
    `);

    const [docRows] = await db.execute(`
      SELECT COUNT(*) AS documentsPending
      FROM merchant_documents
      WHERE LOWER(status) IN ('pending', 'under_review', 'additional_document_required')
    `);

    const m = merchantRows[0] || {};
    const d = docRows[0] || {};

    return {
      totalMerchants: Number(m.totalMerchants || 0),
      newRegistrations: Number(m.newRegistrations || 0),
      pendingReview: Number(m.pendingReview || 0),
      underReview: Number(m.underReview || 0),
      approved: Number(m.approved || 0),
      rejected: Number(m.rejected || 0),
      kycPending: Number(m.kycPending || 0),
      documentsPending: Number(d.documentsPending || 0),
      additionalInformationRequired: Number(m.additionalInformationRequired || 0),
      suspended: Number(m.suspended || 0),
    };
  },

  async getRegistrationTrend(days = 30) {
    const intervalDays = days === "today" ? 1 : days === "7days" ? 7 : 30;

    const [rows] = await db.execute(
      `
        SELECT
          DATE_FORMAT(created_at, '%Y-%m-%d') AS date,
          COUNT(*) AS count
        FROM merchants
        WHERE created_at >= CURDATE() - INTERVAL ? DAY
        GROUP BY DATE_FORMAT(created_at, '%Y-%m-%d')
        ORDER BY date ASC
      `,
      [intervalDays]
    );

    return rows.map((r) => ({
      date: r.date,
      count: Number(r.count),
    }));
  },

  async getApplicationStatusDistribution() {
    const [rows] = await db.execute(`
      SELECT
        account_status,
        COUNT(*) AS count
      FROM merchants
      GROUP BY account_status
    `);

    const ALL_STATUSES = [
      "draft",
      "submitted",
      "under_review",
      "additional_information_required",
      "approved",
      "rejected",
      "suspended",
      "active",
    ];

    const countMap = {};
    rows.forEach((r) => {
      countMap[r.account_status] = Number(r.count);
    });

    return ALL_STATUSES.map((status) => ({
      status,
      count: countMap[status] || 0,
    }));
  },

  async getKycStatusDistribution() {
    const [rows] = await db.execute(`
      SELECT
        kyc_status,
        COUNT(*) AS count
      FROM merchants
      GROUP BY kyc_status
    `);

    const counts = {
      pending: 0,
      under_review: 0,
      approved: 0,
      rejected: 0,
      additional_information_required: 0,
    };

    rows.forEach((r) => {
      const st = r.kyc_status?.toLowerCase();
      if (counts[st] !== undefined) {
        counts[st] = Number(r.count);
      }
    });

    return counts;
  },

  async getDocumentStatusDistribution() {
    const [statusRows] = await db.execute(`
      SELECT
        LOWER(status) AS status,
        COUNT(*) AS count
      FROM merchant_documents
      GROUP BY LOWER(status)
    `);

    const [typeRows] = await db.execute(`
      SELECT
        UPPER(document_type) AS doc_type,
        COUNT(*) AS count
      FROM merchant_documents
      WHERE LOWER(status) IN ('pending', 'under_review', 'additional_document_required')
      GROUP BY UPPER(document_type)
    `);

    const statusCounts = {
      pending: 0,
      under_review: 0,
      approved: 0,
      rejected: 0,
      additional_document_required: 0,
    };

    statusRows.forEach((r) => {
      const key = r.status;
      if (key === "verified" || key === "approved") {
        statusCounts.approved += Number(r.count);
      } else if (statusCounts[key] !== undefined) {
        statusCounts[key] += Number(r.count);
      }
    });

    const typeCounts = {
      nid_front: 0,
      nid_back: 0,
      tin_certificate: 0,
      cancelled_bank_cheque: 0,
      bin_certificate: 0,
    };

    typeRows.forEach((r) => {
      const type = (r.doc_type || "").toLowerCase();
      if (typeCounts[type] !== undefined) {
        typeCounts[type] = Number(r.count);
      }
    });

    return {
      status: statusCounts,
      byType: typeCounts,
    };
  },

  async getPendingApplications(limit = 10) {
    const [rows] = await db.execute(
      `
        SELECT
          m.id,
          m.merchant_code,
          COALESCE(p.company_name, k.legal_business_name, 'N/A') AS business_name,
          u.email,
          m.kyc_status,
          m.account_status,
          m.submitted_at,
          m.created_at
        FROM merchants m
        JOIN users u ON m.user_id = u.id
        LEFT JOIN merchant_profiles p ON p.merchant_id = m.id
        LEFT JOIN merchant_kyc k ON k.merchant_id = m.id
        WHERE m.account_status = 'submitted'
        ORDER BY m.submitted_at DESC, m.created_at DESC
        LIMIT ?
      `,
      [limit]
    );

    return rows.map((r) => ({
      id: r.id,
      merchantCode: r.merchant_code,
      businessName: r.business_name,
      email: r.email,
      kycStatus: r.kyc_status,
      accountStatus: r.account_status,
      submittedAt: r.submitted_at,
      createdAt: r.created_at,
    }));
  },

  async getRecentMerchants(limit = 10) {
    const [rows] = await db.execute(
      `
        SELECT
          m.id,
          m.merchant_code,
          COALESCE(p.company_name, k.legal_business_name, 'N/A') AS company_name,
          u.email,
          m.created_at,
          m.account_status,
          m.kyc_status
        FROM merchants m
        JOIN users u ON m.user_id = u.id
        LEFT JOIN merchant_profiles p ON p.merchant_id = m.id
        LEFT JOIN merchant_kyc k ON k.merchant_id = m.id
        ORDER BY m.created_at DESC
        LIMIT ?
      `,
      [limit]
    );

    return rows.map((r) => ({
      id: r.id,
      merchantCode: r.merchant_code,
      companyName: r.company_name,
      email: r.email,
      createdAt: r.created_at,
      accountStatus: r.account_status,
      kycStatus: r.kyc_status,
    }));
  },

  async getRecentActivity(limit = 10) {
    // Check audit_logs
    const [auditRows] = await db.execute(
      `
        SELECT
          a.id,
          COALESCE(a.admin_email, u.email, 'Admin') AS admin_name,
          COALESCE(a.admin_email, u.email, 'admin@banglaqr.com') AS admin_email,
          a.action,
          a.merchant_id,
          COALESCE(m.merchant_code, CONCAT('BQR-M-', LPAD(a.merchant_id, 6, '0')), 'System') AS merchant_code,
          a.created_at
        FROM audit_logs a
        LEFT JOIN users u ON a.user_id = u.id
        LEFT JOIN merchants m ON a.merchant_id = m.id
        ORDER BY a.created_at DESC
        LIMIT ?
      `,
      [limit]
    );

    if (auditRows.length > 0) {
      return auditRows.map((r) => ({
        id: r.id,
        adminName: r.admin_name,
        adminEmail: r.admin_email,
        action: r.action,
        merchantCode: r.merchant_code,
        createdAt: r.created_at,
      }));
    }

    // Return empty array if no admin activity exists
    return [];
  },
};
