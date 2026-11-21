import { db } from "../../../config/db.js";

export const adminMerchantsRepository = {
  async listMerchants({
    search = "",
    status = "",
    kycStatus = "",
    businessType = "",
    channel = "",
    dateFrom = "",
    dateTo = "",
    sort = "desc",
    page = 1,
    limit = 15,
  }) {
    const offset = (page - 1) * limit;
    const conditions = [];
    const params = [];

    if (search && search.trim() !== "") {
      const s = `%${search.trim()}%`;
      conditions.push(
        "(m.merchant_code LIKE ? OR p.company_name LIKE ? OR k.legal_business_name LIKE ? OR u.email LIKE ? OR u.phone LIKE ? OR c.name LIKE ? OR m.merchant_segment LIKE ? OR i.name LIKE ? OR p.bank_name LIKE ? OR k.bank_name LIKE ?)"
      );
      params.push(s, s, s, s, s, s, s, s, s, s);
    }

    if (status && status !== "all") {
      if (status === "approved") {
        conditions.push("m.account_status IN ('approved', 'active')");
      } else {
        conditions.push("m.account_status = ?");
        params.push(status);
      }
    }

    if (kycStatus && kycStatus !== "all") {
      conditions.push("m.kyc_status = ?");
      params.push(kycStatus);
    }

    if (businessType && businessType !== "all") {
      conditions.push("(p.business_type = ? OR k.business_entity_type = ?)");
      params.push(businessType, businessType);
    }

    if (channel && channel !== "all") {
      if (channel.toLowerCase() === "mfs") {
        conditions.push("(p.channel = 'mfs' OR i.institution_type = 'mfs')");
      } else if (channel.toLowerCase() === "bank") {
        conditions.push("((p.channel = 'bank' OR i.institution_type != 'mfs') AND (p.channel IS NOT NULL OR i.id IS NOT NULL OR k.bank_name IS NOT NULL))");
      }
    }

    if (dateFrom) {
      if (!dateTo || dateFrom === dateTo) {
        conditions.push("DATE(m.created_at) = ?");
        params.push(dateFrom);
      } else {
        conditions.push("m.created_at >= ?");
        params.push(dateFrom);
      }
    }

    if (dateTo && dateFrom !== dateTo) {
      conditions.push("m.created_at <= ?");
      params.push(dateTo + " 23:59:59");
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const sortOrder = String(sort).toLowerCase() === "asc" ? "ASC" : "DESC";

    // Total Count Query
    const [countRows] = await db.execute(
      `
        SELECT COUNT(DISTINCT m.id) AS total
        FROM merchants m
        JOIN users u ON m.user_id = u.id
        LEFT JOIN merchant_profiles p ON p.merchant_id = m.id
        LEFT JOIN merchant_kyc k ON k.merchant_id = m.id
        LEFT JOIN merchant_contacts c ON c.merchant_id = m.id
        LEFT JOIN institutions i ON i.id = COALESCE(p.institution_id, k.institution_id)
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
          m.merchant_segment,
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
          COALESCE(i.name, k.bank_name, p.bank_name) AS bank_name,
          COALESCE(p.channel, CASE WHEN i.institution_type = 'mfs' THEN 'mfs' ELSE 'bank' END) AS channel_type,
          i.institution_type,
          i.logo_url AS institution_logo,
          (SELECT COUNT(*) FROM merchant_documents md WHERE md.merchant_id = m.id) AS document_count
        FROM merchants m
        JOIN users u ON m.user_id = u.id
        LEFT JOIN merchant_profiles p ON p.merchant_id = m.id
        LEFT JOIN merchant_kyc k ON k.merchant_id = m.id
        LEFT JOIN merchant_contacts c ON c.merchant_id = m.id
        LEFT JOIN institutions i ON i.id = COALESCE(p.institution_id, k.institution_id)
        ${whereClause}
        ORDER BY m.created_at ${sortOrder}
        LIMIT ? OFFSET ?
      `,
      [...params, String(limit), String(offset)]
    );

    return {
      merchants: rows.map((r) => ({
        id: r.id,
        merchantCode: r.merchant_code,
        merchantSegment: r.merchant_segment || null,
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
        channelType: r.channel_type || "bank",
        institutionType: r.institution_type,
        institutionLogo: r.institution_logo,
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

  async getAllMerchantsForExport({
    search = "",
    status = "",
    kycStatus = "",
    businessType = "",
    dateFrom = "",
    dateTo = "",
  }) {
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
      if (status === "approved") {
        conditions.push("m.account_status IN ('approved', 'active')");
      } else {
        conditions.push("m.account_status = ?");
        params.push(status);
      }
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
          m.created_at,
          u.email,
          u.phone,
          COALESCE(p.company_name, k.legal_business_name, 'Pending Setup') AS company_name,
          COALESCE(p.business_type, k.business_entity_type, 'Unassigned') AS business_type,
          p.industry,
          p.address AS registered_address,
          p.city,
          p.state,
          p.postal_code,
          c.name AS contact_name,
          c.designation AS contact_designation,
          c.phone AS contact_phone,
          c.nid_no AS contact_nid,
          k.legal_business_name,
          COALESCE(k.bank_name, p.bank_name, 'N/A') AS bank_name,
          k.bank_account_name,
          k.bank_account_number,
          k.branch_name,
          k.routing_number,
          k.trade_license_number,
          k.tin,
          k.bin,
          (SELECT COUNT(*) FROM merchant_documents md WHERE md.merchant_id = m.id) AS document_count
        FROM merchants m
        JOIN users u ON m.user_id = u.id
        LEFT JOIN merchant_profiles p ON p.merchant_id = m.id
        LEFT JOIN merchant_kyc k ON k.merchant_id = m.id
        LEFT JOIN merchant_contacts c ON c.merchant_id = m.id
        ${whereClause}
        ORDER BY m.created_at DESC
      `,
      params
    );

    return rows;
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
    const [documents] = await db.execute("SELECT id, merchant_id, document_type, document_name, custom_label, original_filename, stored_filename, storage_key, mime_type, file_size, status, review_comment, review_note, uploaded_at, reviewed_at, created_at FROM merchant_documents WHERE merchant_id = ?", [merchantId]);
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
             i.institution_type,
             i.logo_url,
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

    // Fetch custom profile values and pinned form metadata
    const [customValues] = await db.execute(`
      SELECT mpcv.field_id, mpcv.field_key, mpcv.field_value,
             mff.label_bn, mff.label_en, mff.field_type, mfs.title_bn as section_title_bn, mfs.title_en as section_title_en
      FROM merchant_profile_custom_values mpcv
      LEFT JOIN merchant_form_fields mff ON mff.id = mpcv.field_id
      LEFT JOIN merchant_form_sections mfs ON mfs.id = mff.section_id
      WHERE mpcv.merchant_id = ?
      ORDER BY mfs.display_order ASC, mff.display_order ASC
    `, [merchantId]);

    // Fetch primary institution details
    const targetInstId = kycs[0]?.institution_id || profiles[0]?.institution_id || applications[0]?.institution_id || null;
    let selectedInstitution = null;
    if (targetInstId) {
      try {
        const [instRows] = await db.query(
          `SELECT id, name, institution_code, logo_url, institution_type FROM institutions WHERE id = ? LIMIT 1`,
          [targetInstId]
        );
        selectedInstitution = instRows[0] || null;
      } catch (e) {
        console.warn("Failed to fetch institution for merchant:", e?.message);
      }
    }

    return {
      merchant: {
        id: m.id,
        userId: m.user_id,
        merchantCode: m.merchant_code,
        merchantSegment: m.merchant_segment || "micro",
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
        channel: profiles[0].channel,
        formVersionId: profiles[0].form_version_id,
        bankName: profiles[0].bank_name,
        branchName: profiles[0].branch_name,
        routingNumber: profiles[0].routing_number,
        updatedAt: profiles[0].updated_at,
      } : null,
      customValues: (customValues || []).map((cv) => ({
        fieldId: cv.field_id,
        fieldKey: cv.field_key,
        fieldValue: cv.field_value,
        labelBn: cv.label_bn,
        labelEn: cv.label_en,
        fieldType: cv.field_type,
        sectionTitleBn: cv.section_title_bn,
        sectionTitleEn: cv.section_title_en,
      })),
      contact: contacts[0] ? {
        name: contacts[0].name,
        nameBn: contacts[0].name_bn,
        phone: contacts[0].phone,
        email: contacts[0].email,
        designation: contacts[0].designation,
        nidNo: contacts[0].nid_no,
        division: contacts[0].division,
        country: contacts[0].country,
        dob: contacts[0].dob,
        fatherName: contacts[0].father_name,
        motherName: contacts[0].mother_name,
        gender: contacts[0].gender,
        permanentAddress: contacts[0].permanent_address,
        presentAddress: contacts[0].present_address,
        isSameAddress: Boolean(contacts[0].is_same_address),
        maritalStatus: contacts[0].marital_status,
        spouseName: contacts[0].spouse_name,
        passportNo: contacts[0].passport_no,
        otherId: contacts[0].other_id,
        nomineeName: contacts[0].nominee_name,
        nomineeRelation: contacts[0].nominee_relation,
        nomineeMobile: contacts[0].nominee_mobile,
        nomineeNid: contacts[0].nominee_nid,
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
        tin: kycs[0].tin,
        rawTin: kycs[0].tin,
        bin: kycs[0].bin,
        rawBin: kycs[0].bin,
        tradeLicenseNumber: kycs[0].trade_license_number,
        nidNumber: kycs[0].nid_number,
        rawNid: kycs[0].nid_number,
        authorizedPersonName: kycs[0].authorized_person_name,
        designation: kycs[0].designation,
        bankName: kycs[0].bank_name,
        bankAccountName: kycs[0].bank_account_name,
        bankAccountNumber: kycs[0].bank_account_number,
        rawBankAccountNumber: kycs[0].bank_account_number,
        accountNumber: kycs[0].bank_account_number,
        branchName: kycs[0].branch_name,
        routingNumber: kycs[0].routing_number,
        accountType: kycs[0].account_type,
        kycFormData: typeof kycs[0].kyc_form_data === "string" ? JSON.parse(kycs[0].kyc_form_data) : (kycs[0].kyc_form_data || {}),
      } : null,
      documents: documents.map((d) => ({
        id: d.id,
        merchantId: d.merchant_id,
        documentType: d.document_type,
        documentName: d.document_name,
        customLabel: d.custom_label,
        originalFilename: d.original_filename,
        storedFilename: d.stored_filename,
        storageKey: d.storage_key,
        mimeType: d.mime_type,
        fileSize: d.file_size,
        status: d.status,
        reviewComment: d.review_comment,
        reviewNote: d.review_note,
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
        institutionCode: app.institution_code,
        institutionType: app.institution_type,
        logoUrl: app.logo_url,
        branchName: app.branch_name,
        status: app.status,
        submittedDataSnapshot: typeof app.submitted_data_snapshot === "string" ? JSON.parse(app.submitted_data_snapshot) : (app.submitted_data_snapshot || {}),
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
      institution: selectedInstitution,
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

