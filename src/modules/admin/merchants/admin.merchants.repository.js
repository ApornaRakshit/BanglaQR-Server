import { db } from "../../../config/db.js";

export const adminMerchantsRepository = {
  async listMerchants({
    search = "",
    status = "",
    kycStatus = "",
    businessType = "",
    dateFrom = "",
    dateTo = "",
    page = 1,
    limit = 15,
  }) {
    const offset = (page - 1) * limit;
    const conditions = [];
    const params = [];

    if (search && search.trim() !== "") {
      const s = `%${search.trim()}%`;
      conditions.push(
        "(m.merchant_code LIKE ? OR p.company_name LIKE ? OR k.legal_business_name LIKE ? OR u.email LIKE ? OR u.phone LIKE ? OR c.name LIKE ?)"
      );
      params.push(s, s, s, s, s, s);
    }

    if (status && status !== "all") {
      conditions.push("m.account_status = ?");
      params.push(status);
    }

    if (kycStatus && kycStatus !== "all") {
      conditions.push("m.kyc_status = ?");
      params.push(kycStatus);
    }

    if (businessType && businessType !== "all") {
      conditions.push("(p.business_type = ? OR k.business_entity_type = ?)");
      params.push(businessType, businessType);
    }

    if (dateFrom) {
      conditions.push("m.created_at >= ?");
      params.push(dateFrom);
    }

    if (dateTo) {
      conditions.push("m.created_at <= ?");
      params.push(dateTo + " 23:59:59");
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    // Total Count Query
    const [countRows] = await db.execute(
      `
        SELECT COUNT(DISTINCT m.id) AS total
        FROM merchants m
        JOIN users u ON m.user_id = u.id
        LEFT JOIN merchant_profiles p ON p.merchant_id = m.id
        LEFT JOIN merchant_kyc k ON k.merchant_id = m.id
        LEFT JOIN merchant_contacts c ON c.merchant_id = m.id
        ${whereClause}
      `,
      params
    );

    const total = Number(countRows[0]?.total || 0);

    // List Query with Pagination
    const [rows] = await db.execute(
      `
        SELECT
          m.id,
          m.merchant_code,
          m.account_status,
          m.kyc_status,
          m.onboarding_step,
          m.submitted_at,
          m.approved_at,
          m.rejected_at,
          m.created_at,
          m.updated_at,
          u.email,
          u.phone,
          u.status AS user_status,
          COALESCE(p.company_name, k.legal_business_name, 'Pending Setup') AS company_name,
          p.business_type,
          p.industry,
          c.name AS contact_name,
          c.phone AS contact_phone,
          k.legal_business_name,
          k.bank_name,
          (SELECT COUNT(*) FROM merchant_documents md WHERE md.merchant_id = m.id) AS document_count
        FROM merchants m
        JOIN users u ON m.user_id = u.id
        LEFT JOIN merchant_profiles p ON p.merchant_id = m.id
        LEFT JOIN merchant_kyc k ON k.merchant_id = m.id
        LEFT JOIN merchant_contacts c ON c.merchant_id = m.id
        ${whereClause}
        ORDER BY m.created_at DESC
        LIMIT ? OFFSET ?
      `,
      [...params, String(limit), String(offset)]
    );

    return {
      merchants: rows.map((r) => ({
        id: r.id,
        merchantCode: r.merchant_code,
        companyName: r.company_name,
        legalBusinessName: r.legal_business_name,
        businessType: r.business_type,
        industry: r.industry,
        email: r.email,
        phone: r.phone,
        contactName: r.contact_name,
        contactPhone: r.contact_phone,
        accountStatus: r.account_status,
        kycStatus: r.kyc_status,
        userStatus: r.user_status,
        bankName: r.bank_name,
        documentCount: Number(r.document_count || 0),
        onboardingStep: r.onboarding_step,
        submittedAt: r.submitted_at,
        approvedAt: r.approved_at,
        rejectedAt: r.rejected_at,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / limit) || 1,
    };
  },

  async getMerchantById(merchantId) {
    const [mRows] = await db.execute(
      `
        SELECT
          m.*,
          u.email,
          u.phone AS user_phone,
          u.email_verified_at,
          u.phone_verified_at,
          u.status AS user_status
        FROM merchants m
        JOIN users u ON m.user_id = u.id
        WHERE m.id = ?
        LIMIT 1
      `,
      [merchantId]
    );

    if (!mRows.length) return null;
    const m = mRows[0];

    const [profiles] = await db.execute("SELECT * FROM merchant_profiles WHERE merchant_id = ? LIMIT 1", [merchantId]);
    const [contacts] = await db.execute("SELECT * FROM merchant_contacts WHERE merchant_id = ? LIMIT 1", [merchantId]);
    const [commercials] = await db.execute("SELECT * FROM merchant_commercial_details WHERE merchant_id = ? LIMIT 1", [merchantId]);
    const [kycs] = await db.execute("SELECT * FROM merchant_kyc WHERE merchant_id = ? LIMIT 1", [merchantId]);
    const [documents] = await db.execute("SELECT id, merchant_id, document_type, document_name, mime_type, file_size, status, review_comment, uploaded_at, reviewed_at, created_at FROM merchant_documents WHERE merchant_id = ?", [merchantId]);
    const [fieldIssues] = await db.execute("SELECT * FROM kyc_field_issues WHERE merchant_id = ? ORDER BY id DESC", [merchantId]);
    const [services] = await db.execute(`
      SELECT mgs.*, g.name AS gateway_name, g.code AS gateway_code, g.service_fee
      FROM merchant_gateway_services mgs
      JOIN gateways g ON g.id = mgs.gateway_id
      WHERE mgs.merchant_id = ?
    `, [merchantId]);
    const [applications] = await db.execute(`
      SELECT mga.*, 
             COALESCE(i.name, mga.gateway_name) AS institution_name,
             i.institution_code,
             ib.branch_name,
             ib.branch_code
      FROM merchant_gateway_applications mga
      LEFT JOIN institutions i ON i.id = mga.institution_id
      LEFT JOIN institution_branches ib ON ib.id = mga.branch_id
      WHERE mga.merchant_id = ?
      ORDER BY mga.id DESC
    `, [merchantId]);
    const [versions] = await db.execute(`
      SELECT id, version_no, submitted_at, change_summary, snapshot_data
      FROM kyc_submission_versions
      WHERE merchant_id = ?
      ORDER BY version_no DESC
    `, [merchantId]);

    return {
      merchant: {
        id: m.id,
        userId: m.user_id,
        merchantCode: m.merchant_code,
        accountStatus: m.account_status,
        kycStatus: m.kyc_status,
        onboardingStep: m.onboarding_step,
        submittedAt: m.submitted_at,
        approvedAt: m.approved_at,
        rejectedAt: m.rejected_at,
        rejectionReason: m.rejection_reason,
        adminComments: m.admin_comments,
        createdAt: m.created_at,
        updatedAt: m.updated_at,
        user: {
          email: m.email,
          phone: m.user_phone,
          emailVerified: Boolean(m.email_verified_at),
          phoneVerified: Boolean(m.phone_verified_at),
          status: m.user_status,
        },
      },
      profile: profiles[0] ? {
        companyName: profiles[0].company_name,
        businessType: profiles[0].business_type,
        industry: profiles[0].industry,
        website: profiles[0].website,
        address: profiles[0].address,
        city: profiles[0].city,
        state: profiles[0].state,
        postalCode: profiles[0].postal_code,
        country: profiles[0].country,
        updatedAt: profiles[0].updated_at,
      } : null,
      contact: contacts[0] ? {
        name: contacts[0].name,
        phone: contacts[0].phone,
        email: contacts[0].email,
        designation: contacts[0].designation,
      } : null,
      commercial: commercials[0] ? {
        transactionsPerDay: commercials[0].transactions_per_day,
        transactionsPerMonth: commercials[0].transactions_per_month,
        volumePerDay: commercials[0].volume_per_day,
        volumePerMonth: commercials[0].volume_per_month,
        maximumTicketSize: commercials[0].maximum_ticket_size,
        returnUrl: commercials[0].return_url,
        merchantDomain: commercials[0].merchant_domain,
        merchantIpAddress: commercials[0].merchant_ip_address,
      } : null,
      kyc: kycs[0] ? {
        legalBusinessName: kycs[0].legal_business_name,
        businessEntityType: kycs[0].business_entity_type,
        registrationNumber: kycs[0].registration_number,
        tin: kycs[0].tin ? maskSensitive(kycs[0].tin) : null,
        rawTin: kycs[0].tin,
        bin: kycs[0].bin ? maskSensitive(kycs[0].bin) : null,
        tradeLicenseNumber: kycs[0].trade_license_number,
        nidNumber: kycs[0].nid_number ? maskSensitive(kycs[0].nid_number) : null,
        rawNid: kycs[0].nid_number,
        authorizedPersonName: kycs[0].authorized_person_name,
        designation: kycs[0].designation,
        bankName: kycs[0].bank_name,
        bankAccountName: kycs[0].bank_account_name,
        bankAccountNumber: kycs[0].bank_account_number ? maskSensitive(kycs[0].bank_account_number) : null,
        rawBankAccountNumber: kycs[0].bank_account_number,
        branchName: kycs[0].branch_name,
        routingNumber: kycs[0].routing_number,
        accountType: kycs[0].account_type,
      } : null,
      documents: documents.map((d) => ({
        id: d.id,
        merchantId: d.merchant_id,
        documentType: d.document_type,
        documentName: d.document_name,
        mimeType: d.mime_type,
        fileSize: d.file_size,
        status: d.status,
        reviewComment: d.review_comment,
        uploadedAt: d.uploaded_at,
        reviewedAt: d.reviewed_at,
        createdAt: d.created_at,
      })),
      services: services.map((s) => ({
        id: s.id,
        gatewayName: s.gateway_name,
        gatewayCode: s.gateway_code,
        serviceType: s.service_type,
        serviceFee: s.service_fee,
        status: s.status,
        activatedAt: s.activated_at,
      })),
      fieldIssues: fieldIssues.map((fi) => ({
        id: fi.id,
        fieldKey: fi.field_key,
        issueType: fi.issue_type,
        issueReason: fi.issue_reason,
        status: fi.status,
        resolutionNote: fi.resolution_note,
        createdAt: fi.created_at,
        updatedAt: fi.updated_at,
      })),
      applications: applications.map((app) => ({
        id: app.id,
        applicationNumber: app.application_number || `APP-${app.id}`,
        applicationType: app.application_type,
        gatewayId: app.gateway_id,
        institutionId: app.institution_id,
        institutionName: app.institution_name,
        branchName: app.branch_name,
        status: app.status,
        reviewNote: app.review_note,
        reviewComment: app.review_comment,
        rejectionReason: app.rejection_reason,
        appliedAt: app.applied_at,
        reviewedAt: app.reviewed_at,
        approvedAt: app.approved_at,
        createdAt: app.created_at,
      })),
      versions: versions.map((v) => ({
        id: v.id,
        versionNo: v.version_no,
        submittedAt: v.submitted_at,
        changeSummary: v.change_summary,
        snapshotData: typeof v.snapshot_data === "string" ? JSON.parse(v.snapshot_data) : v.snapshot_data,
      })),
    };
  },

  async getMerchantHistory(merchantId) {
    const [historyRows] = await db.execute(
      `
        SELECT *
        FROM merchant_onboarding_history
        WHERE merchant_id = ?
        ORDER BY created_at DESC
      `,
      [merchantId]
    );

    const [auditRows] = await db.execute(
      `
        SELECT *
        FROM audit_logs
        WHERE merchant_id = ?
        ORDER BY created_at DESC
      `,
      [merchantId]
    );

    return {
      onboardingHistory: historyRows.map((h) => ({
        id: h.id,
        step: h.step,
        action: h.action,
        previousStatus: h.previous_status,
        newStatus: h.new_status,
        metadata: h.metadata,
        createdAt: h.created_at,
      })),
      auditHistory: auditRows.map((a) => ({
        id: a.id,
        adminEmail: a.admin_email,
        action: a.action,
        resourceType: a.resource_type,
        resourceId: a.resource_id,
        details: a.details,
        ipAddress: a.ip_address,
        createdAt: a.created_at,
      })),
    };
  },
};

function maskSensitive(val) {
  if (!val) return "";
  const str = String(val);
  if (str.length <= 4) return "****";
  const start = str.slice(0, 2);
  const end = str.slice(-2);
  const masked = "*".repeat(Math.max(4, str.length - 4));
  return `${start}${masked}${end}`;
}

