import { db } from "../../config/db.js";

export const adminRepository = {
  async getStats(timeframe = "30days") {
    let merchantDateFilter = "";
    if (timeframe === "today") {
      merchantDateFilter = "AND DATE(created_at) = CURDATE()";
    } else if (timeframe === "7days") {
      merchantDateFilter = "AND created_at >= CURDATE() - INTERVAL 7 DAY";
    } else if (timeframe === "30days") {
      merchantDateFilter = "AND created_at >= CURDATE() - INTERVAL 30 DAY";
    } else if (timeframe === "this_month") {
      merchantDateFilter = "AND YEAR(created_at) = YEAR(CURDATE()) AND MONTH(created_at) = MONTH(CURDATE())";
    }

    const [merchantRows] = await db.execute(`
      SELECT
        COUNT(*) AS totalMerchants,
        COALESCE(SUM(CASE WHEN created_at >= CURDATE() - INTERVAL 7 DAY THEN 1 ELSE 0 END), 0) AS newRegistrations,
        COALESCE(SUM(CASE WHEN DATE(created_at) = CURDATE() THEN 1 ELSE 0 END), 0) AS todayRegistrations,
        COALESCE(SUM(CASE WHEN YEAR(created_at) = YEAR(CURDATE()) AND MONTH(created_at) = MONTH(CURDATE()) THEN 1 ELSE 0 END), 0) AS thisMonthRegistrations,
        COALESCE(SUM(CASE WHEN account_status = 'submitted' THEN 1 ELSE 0 END), 0) AS pendingReview,
        COALESCE(SUM(CASE WHEN account_status = 'under_review' THEN 1 ELSE 0 END), 0) AS underReview,
        COALESCE(SUM(CASE WHEN account_status = 'approved' THEN 1 ELSE 0 END), 0) AS approved,
        COALESCE(SUM(CASE WHEN account_status = 'rejected' THEN 1 ELSE 0 END), 0) AS rejected,
        COALESCE(SUM(CASE WHEN kyc_status = 'pending' THEN 1 ELSE 0 END), 0) AS kycPending,
        COALESCE(SUM(CASE WHEN account_status = 'additional_information_required' THEN 1 ELSE 0 END), 0) AS additionalInformationRequired,
        COALESCE(SUM(CASE WHEN account_status = 'suspended' THEN 1 ELSE 0 END), 0) AS suspended
      FROM merchants
    `);

    const [periodRows] = await db.execute(`
      SELECT
        COUNT(*) AS periodTotal,
        COALESCE(SUM(CASE WHEN account_status = 'submitted' THEN 1 ELSE 0 END), 0) AS periodPendingReview,
        COALESCE(SUM(CASE WHEN account_status = 'under_review' THEN 1 ELSE 0 END), 0) AS periodUnderReview,
        COALESCE(SUM(CASE WHEN account_status = 'approved' THEN 1 ELSE 0 END), 0) AS periodApproved,
        COALESCE(SUM(CASE WHEN account_status = 'rejected' THEN 1 ELSE 0 END), 0) AS periodRejected
      FROM merchants
      WHERE 1=1 ${merchantDateFilter}
    `);

    const [docRows] = await db.execute(`
      SELECT COUNT(*) AS documentsPending
      FROM merchant_documents
      WHERE LOWER(status) IN ('pending', 'under_review', 'additional_document_required')
    `);

    const m = merchantRows[0] || {};
    const p = periodRows[0] || {};
    const d = docRows[0] || {};

    return {
      totalMerchants: Number(m.totalMerchants || 0),
      newRegistrations: Number(m.newRegistrations || 0),
      todayRegistrations: Number(m.todayRegistrations || 0),
      thisMonthRegistrations: Number(m.thisMonthRegistrations || 0),
      pendingReview: Number(m.pendingReview || 0),
      underReview: Number(m.underReview || 0),
      approved: Number(m.approved || 0),
      rejected: Number(m.rejected || 0),
      kycPending: Number(m.kycPending || 0),
      documentsPending: Number(d.documentsPending || 0),
      additionalInformationRequired: Number(m.additionalInformationRequired || 0),
      suspended: Number(m.suspended || 0),
      periodTotal: Number(p.periodTotal || 0),
      periodApproved: Number(p.periodApproved || 0),
      periodPendingReview: Number(p.periodPendingReview || 0),
      periodUnderReview: Number(p.periodUnderReview || 0),
      periodRejected: Number(p.periodRejected || 0),
      timeframe,
    };
  },

  async getRegistrationTrend(timeframe = "30days") {
    let whereClause = "WHERE created_at >= CURDATE() - INTERVAL 30 DAY";
    let params = [];

    if (timeframe === "today") {
      whereClause = "WHERE DATE(created_at) = CURDATE()";
    } else if (timeframe === "7days") {
      whereClause = "WHERE created_at >= CURDATE() - INTERVAL 7 DAY";
    } else if (timeframe === "this_month") {
      whereClause = "WHERE YEAR(created_at) = YEAR(CURDATE()) AND MONTH(created_at) = MONTH(CURDATE())";
    } else if (timeframe === "all") {
      whereClause = "";
    } else {
      // default 30 days
      whereClause = "WHERE created_at >= CURDATE() - INTERVAL 30 DAY";
    }

    const [rows] = await db.execute(
      `
        SELECT
          DATE_FORMAT(created_at, '%Y-%m-%d') AS date,
          COUNT(*) AS count
        FROM merchants
        ${whereClause}
        GROUP BY DATE_FORMAT(created_at, '%Y-%m-%d')
        ORDER BY date ASC
      `,
      params
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

  async globalSearch(query, limit = 6) {
    if (!query || typeof query !== "string" || !query.trim()) {
      return { merchants: [], applications: [], payments: [], institutions: [] };
    }

    const term = `%${query.trim()}%`;

    const [merchants] = await db.execute(
      `
        SELECT 
          m.id, 
          m.merchant_code, 
          m.account_status, 
          m.kyc_status,
          COALESCE(mp.company_name, 'No Company Name') AS company_name, 
          COALESCE(u.email, '') AS email, 
          COALESCE(u.phone, '') AS phone
        FROM merchants m
        LEFT JOIN merchant_profiles mp ON m.id = mp.merchant_id
        LEFT JOIN users u ON m.user_id = u.id
        WHERE m.merchant_code LIKE ? 
           OR mp.company_name LIKE ? 
           OR u.email LIKE ? 
           OR u.phone LIKE ?
        ORDER BY m.id DESC
        LIMIT ?
      `,
      [term, term, term, term, Number(limit)]
    );

    const [applications] = await db.execute(
      `
        SELECT 
          a.id, 
          a.application_number, 
          a.status, 
          a.gateway_name, 
          a.merchant_id,
          COALESCE(mp.company_name, 'Unknown Merchant') AS company_name
        FROM merchant_gateway_applications a
        LEFT JOIN merchant_profiles mp ON a.merchant_id = mp.merchant_id
        WHERE a.application_number LIKE ? 
           OR a.gateway_name LIKE ? 
           OR mp.company_name LIKE ?
        ORDER BY a.id DESC
        LIMIT ?
      `,
      [term, term, term, Number(limit)]
    );

    const [payments] = await db.execute(
      `
        SELECT 
          p.id, 
          p.payment_reference, 
          p.amount, 
          p.currency, 
          p.status, 
          p.merchant_id,
          COALESCE(mp.company_name, 'Unknown Merchant') AS company_name
        FROM addon_payments p
        LEFT JOIN merchant_profiles mp ON p.merchant_id = mp.merchant_id
        WHERE p.payment_reference LIKE ? 
           OR mp.company_name LIKE ?
        ORDER BY p.id DESC
        LIMIT ?
      `,
      [term, term, Number(limit)]
    );

    const [institutions] = await db.execute(
      `
        SELECT 
          id, 
          name, 
          institution_code, 
          institution_type, 
          status
        FROM institutions
        WHERE name LIKE ? 
           OR institution_code LIKE ?
        ORDER BY id DESC
        LIMIT ?
      `,
      [term, term, Number(limit)]
    );

    return {
      merchants: merchants.map((m) => ({
        id: m.id,
        merchantCode: m.merchant_code,
        companyName: m.company_name,
        email: m.email,
        phone: m.phone,
        status: m.account_status,
        url: `/admin/merchants/${m.id}`,
      })),
      applications: applications.map((a) => ({
        id: a.id,
        applicationNumber: a.application_number,
        gatewayName: a.gateway_name,
        companyName: a.company_name,
        merchantId: a.merchant_id,
        status: a.status,
        url: `/admin/gateways/applications?search=${encodeURIComponent(a.application_number || "")}`,
      })),
      payments: payments.map((p) => ({
        id: p.id,
        paymentReference: p.payment_reference,
        amount: p.amount,
        currency: p.currency,
        companyName: p.company_name,
        status: p.status,
        url: `/admin/payments?search=${encodeURIComponent(p.payment_reference || "")}`,
      })),
      institutions: institutions.map((i) => ({
        id: i.id,
        name: i.name,
        institutionCode: i.institution_code,
        type: i.institution_type,
        status: i.status,
        url: `/admin/institutions/${i.id}`,
      })),
    };
  },
};
