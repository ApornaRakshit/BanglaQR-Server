import { db } from "../../config/db.js";

export const institutionRepository = {
  /**
   * Get institution profile with bank or MFS details
   */
  async getInstitutionProfile(institutionId) {
    const [instRows] = await db.query(
      `
      SELECT 
        i.*,
        ibp.bank_category,
        ibp.ownership_type,
        ibp.official_bank_code,
        ibp.swift_code,
        ibp.regulatory_reference AS bank_regulatory_ref,
        ibp.official_contact_person AS bank_contact_person,
        ibp.contact_designation AS bank_contact_designation,
        imp.brand_name AS mfs_brand_name,
        imp.legal_operator_name AS mfs_operator_name,
        imp.provider_code AS mfs_provider_code,
        imp.parent_bank_id AS mfs_parent_bank_id,
        imp.authorization_reference AS mfs_auth_ref,
        imp.merchant_application_supported AS mfs_merchant_supported
      FROM institutions i
      LEFT JOIN institution_bank_profiles ibp ON ibp.institution_id = i.id
      LEFT JOIN institution_mfs_profiles imp ON imp.institution_id = i.id
      WHERE i.id = ?
      LIMIT 1
      `,
      [Number(institutionId)]
    );

    return instRows[0] || null;
  },

  /**
   * Get institution-scoped dashboard statistics
   */
  async getDashboardStats(institutionId) {
    const instId = Number(institutionId);

    const [[appStats]] = await db.query(
      `
      SELECT
        COUNT(*) AS total_applications,
        SUM(CASE WHEN status = 'applied' THEN 1 ELSE 0 END) AS pending_review,
        SUM(CASE WHEN status = 'under_review' THEN 1 ELSE 0 END) AS under_review,
        SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) AS approved_applications,
        SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected_applications,
        SUM(CASE WHEN status = 'additional_information_required' THEN 1 ELSE 0 END) AS correction_required
      FROM merchant_gateway_applications
      WHERE institution_id = ?
      `,
      [instId]
    );

    const [[branchStats]] = await db.query(
      `
      SELECT
        COUNT(*) AS total_branches,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_branches,
        SUM(CASE WHEN unit_type = 'sub_branch' THEN 1 ELSE 0 END) AS sub_branches
      FROM institution_branches
      WHERE institution_id = ? AND is_archived = 0
      `,
      [instId]
    );

    const [[serviceStats]] = await db.query(
      `
      SELECT
        COUNT(*) AS total_services,
        SUM(CASE WHEN availability_status = 'available' THEN 1 ELSE 0 END) AS active_services
      FROM institution_services
      WHERE institution_id = ?
      `,
      [instId]
    );

    const [[staffStats]] = await db.query(
      `
      SELECT COUNT(*) AS total_staff
      FROM institution_users
      WHERE institution_id = ? AND membership_status = 'active'
      `,
      [instId]
    );

    const [[issueStats]] = await db.query(
      `
      SELECT COUNT(*) AS open_kyc_issues
      FROM kyc_field_issues
      WHERE institution_id = ? AND status = 'open'
      `,
      [instId]
    );

    // Active merchants connected to this institution (approved applications or kyc institution association)
    const [[activeMerchantsRow]] = await db.query(
      `
      SELECT COUNT(DISTINCT mga.merchant_id) AS active_merchants
      FROM merchant_gateway_applications mga
      JOIN merchants m ON m.id = mga.merchant_id
      WHERE mga.institution_id = ? 
        AND mga.status = 'approved'
        AND m.account_status = 'active'
      `,
      [instId]
    );

    // Top Merchant Types distribution for this institution
    const [merchantTypeRows] = await db.query(
      `
      SELECT 
        COALESCE(k.business_entity_type, p.business_type, 'Retail') AS type_name,
        COUNT(DISTINCT mga.merchant_id) AS count
      FROM merchant_gateway_applications mga
      LEFT JOIN merchant_kyc k ON k.merchant_id = mga.merchant_id
      LEFT JOIN merchant_profiles p ON p.merchant_id = mga.merchant_id
      WHERE mga.institution_id = ?
      GROUP BY type_name
      ORDER BY count DESC
      LIMIT 5
      `,
      [instId]
    );

    // Recent 5 applications for this institution
    const [recentAppRows] = await db.query(
      `
      SELECT
        mga.id,
        mga.application_number,
        mga.merchant_id,
        mga.status,
        mga.applied_at,
        mga.created_at,
        COALESCE(k.legal_business_name, p.company_name, m.merchant_code, 'Merchant') AS merchant_name,
        COALESCE(k.business_entity_type, p.business_type, 'General Retail') AS business_type,
        mga.gateway_name,
        mga.service_type,
        ib.branch_name
      FROM merchant_gateway_applications mga
      JOIN merchants m ON m.id = mga.merchant_id
      LEFT JOIN merchant_profiles p ON p.merchant_id = m.id
      LEFT JOIN merchant_kyc k ON k.merchant_id = m.id
      LEFT JOIN institution_branches ib ON ib.id = mga.branch_id
      WHERE mga.institution_id = ?
      ORDER BY mga.applied_at DESC, mga.id DESC
      LIMIT 5
      `,
      [instId]
    );

    // Recent 5 activity logs for this institution
    const [recentLogs] = await db.query(
      `
      SELECT
        id,
        action,
        resource_type,
        resource_id,
        status_transition,
        details,
        user_email,
        created_at
      FROM institution_activity_logs
      WHERE institution_id = ?
      ORDER BY created_at DESC
      LIMIT 5
      `,
      [instId]
    );

    // Daily / 30-day application trend
    const [trendRows] = await db.query(
      `
      SELECT 
        DATE(applied_at) AS date_str,
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) AS approved,
        SUM(CASE WHEN status IN ('applied', 'under_review') THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected
      FROM merchant_gateway_applications
      WHERE institution_id = ? AND applied_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      GROUP BY DATE(applied_at)
      ORDER BY date_str ASC
      `,
      [instId]
    );

    const totalApps = Number(appStats?.total_applications || 0);

    return {
      applications: {
        total: totalApps,
        pending: Number(appStats?.pending_review || 0),
        underReview: Number(appStats?.under_review || 0),
        approved: Number(appStats?.approved_applications || 0),
        rejected: Number(appStats?.rejected_applications || 0),
        additionalInfo: Number(appStats?.correction_required || 0),
        correctionRequired: Number(appStats?.correction_required || 0),
      },
      activeMerchants: Number(activeMerchantsRow?.active_merchants || 0),
      branches: {
        total: Number(branchStats?.total_branches || 0),
        active: Number(branchStats?.active_branches || 0),
        subBranches: Number(branchStats?.sub_branches || 0),
      },
      services: {
        total: Number(serviceStats?.total_services || 0),
        active: Number(serviceStats?.active_services || 0),
      },
      staffCount: Number(staffStats?.total_staff || 0),
      openKycIssues: Number(issueStats?.open_kyc_issues || 0),
      merchantTypes: merchantTypeRows.map((r) => ({
        type: r.type_name,
        count: Number(r.count),
        percentage: totalApps > 0 ? Math.round((Number(r.count) / totalApps) * 100) : 0,
      })),
      recentApplications: recentAppRows.map((r) => ({
        id: r.id,
        applicationNumber: r.application_number || `APP-${r.id}`,
        merchantName: r.merchant_name,
        businessType: r.business_type,
        service: r.gateway_name || r.service_type || "BanglaQR Gateway",
        branchName: r.branch_name,
        status: r.status,
        submittedAt: r.applied_at || r.created_at,
      })),
      recentActivities: recentLogs.map((l) => ({
        id: l.id,
        action: l.action,
        userEmail: l.user_email,
        resourceType: l.resource_type,
        resourceId: l.resource_id,
        statusTransition: l.status_transition,
        createdAt: l.created_at,
      })),
      trend: trendRows.map((t) => ({
        date: t.date_str,
        total: Number(t.total),
        approved: Number(t.approved),
        pending: Number(t.pending),
        rejected: Number(t.rejected),
      })),
    };
  },

  /**
   * List merchant applications assigned to this institution
   */
  async listApplications({ institutionId, status, search, page = 1, limit = 20, assignedBranchIds = [] }) {
    const instId = Number(institutionId);
    const offset = (Number(page) - 1) * Number(limit);
    const conditions = ["mga.institution_id = ?"];
    const params = [instId];

    if (assignedBranchIds && Array.isArray(assignedBranchIds) && assignedBranchIds.length > 0) {
      conditions.push(`mga.branch_id IN (${assignedBranchIds.map(() => "?").join(", ")})`);
      params.push(...assignedBranchIds.map(Number));
    }

    if (status && status !== "all") {
      conditions.push("mga.status = ?");
      params.push(status);
    }

    if (search && search.trim()) {
      conditions.push(
        "(p.company_name LIKE ? OR k.legal_business_name LIKE ? OR mga.application_number LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)"
      );
      const s = `%${search.trim()}%`;
      params.push(s, s, s, s, s);
    }

    const whereClause = conditions.join(" AND ");

    const [[countRow]] = await db.query(
      `
      SELECT COUNT(*) AS total
      FROM merchant_gateway_applications mga
      JOIN merchants m ON m.id = mga.merchant_id
      LEFT JOIN users u ON u.id = m.user_id
      LEFT JOIN merchant_profiles p ON p.merchant_id = m.id
      LEFT JOIN merchant_kyc k ON k.merchant_id = m.id
      WHERE ${whereClause}
      `,
      params
    );

    const [rows] = await db.query(
      `
      SELECT
        mga.id,
        mga.application_number,
        mga.merchant_id,
        mga.gateway_id,
        mga.institution_id,
        mga.branch_id,
        mga.status,
        mga.review_note,
        mga.review_comment,
        mga.rejection_reason,
        mga.applied_at,
        mga.reviewed_at,
        mga.approved_at,
        mga.gateway_name,
        mga.service_type,
        COALESCE(iserv.service_name, mga.gateway_name, 'BanglaQR Gateway') AS requested_service,
        COALESCE(k.legal_business_name, p.company_name, m.merchant_code) AS business_name,
        COALESCE(k.legal_business_name, p.company_name, m.merchant_code) AS trade_name,
        COALESCE(k.business_entity_type, p.business_type, 'Retail') AS business_type,
        m.merchant_code,
        u.email AS merchant_email,
        u.phone AS merchant_phone,
        ib.branch_name,
        ib.branch_code,
        ib.routing_number,
        (SELECT COUNT(*) FROM kyc_field_issues WHERE merchant_id = mga.merchant_id AND institution_id = mga.institution_id AND status = 'open') AS open_issues_count
      FROM merchant_gateway_applications mga
      JOIN merchants m ON m.id = mga.merchant_id
      LEFT JOIN users u ON u.id = m.user_id
      LEFT JOIN merchant_profiles p ON p.merchant_id = m.id
      LEFT JOIN merchant_kyc k ON k.merchant_id = m.id
      LEFT JOIN institution_branches ib ON ib.id = mga.branch_id
      LEFT JOIN institution_services iserv ON iserv.id = mga.institution_service_id
      WHERE ${whereClause}
      ORDER BY mga.applied_at DESC
      LIMIT ? OFFSET ?
      `,
      [...params, Number(limit), offset]
    );

    return {
      applications: rows,
      total: Number(countRow.total),
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(Number(countRow.total) / Number(limit)),
    };
  },

  /**
   * Get single application details with merchant info, KYC, documents & issues
   */
  async getApplicationDetails(applicationId, institutionId, assignedBranchIds = null) {
    const [appRows] = await db.query(
      `
      SELECT
        mga.*,
        COALESCE(k.legal_business_name, p.company_name, m.merchant_code) AS business_name,
        COALESCE(k.legal_business_name, p.company_name, m.merchant_code) AS trade_name,
        m.merchant_code,
        m.account_status AS merchant_status,
        u.id AS user_id,
        u.email AS merchant_email,
        u.phone AS merchant_phone,
        ib.branch_name,
        ib.branch_code,
        ib.routing_number,
        ib.address AS branch_address,
        iserv.service_name,
        iserv.service_code,
        iserv.integration_mode
      FROM merchant_gateway_applications mga
      JOIN merchants m ON m.id = mga.merchant_id
      LEFT JOIN users u ON u.id = m.user_id
      LEFT JOIN merchant_profiles p ON p.merchant_id = m.id
      LEFT JOIN merchant_kyc k ON k.merchant_id = m.id
      LEFT JOIN institution_branches ib ON ib.id = mga.branch_id
      LEFT JOIN institution_services iserv ON iserv.id = mga.institution_service_id
      WHERE mga.id = ? AND mga.institution_id = ?
      LIMIT 1
      `,
      [Number(applicationId), Number(institutionId)]
    );

    if (!appRows.length) return null;
    const application = appRows[0];

    // If staff has branch restrictions, verify application branch
    if (assignedBranchIds && Array.isArray(assignedBranchIds) && assignedBranchIds.length > 0) {
      if (!application.branch_id || !assignedBranchIds.includes(Number(application.branch_id))) {
        return null;
      }
    }

    // Fetch Merchant KYC
    const [kycRows] = await db.query(
      `SELECT * FROM merchant_kyc WHERE merchant_id = ? LIMIT 1`,
      [application.merchant_id]
    );
    const kyc = kycRows[0] || null;

    // Fetch Merchant Documents
    const [docRows] = await db.query(
      `
      SELECT 
        id,
        document_type,
        document_name,
        custom_label,
        original_filename,
        storage_key,
        mime_type,
        file_size,
        status,
        review_comment,
        uploaded_at,
        reviewed_at
      FROM merchant_documents
      WHERE merchant_id = ?
      ORDER BY created_at DESC
      `,
      [application.merchant_id]
    );

    // Fetch open & resolved KYC field issues
    const [fieldIssues] = await db.query(
      `
      SELECT 
        kfi.*,
        u.email AS reviewer_email
      FROM kyc_field_issues kfi
      LEFT JOIN users u ON u.id = kfi.reviewer_id
      WHERE kfi.merchant_id = ? AND (kfi.institution_id = ? OR kfi.institution_id IS NULL)
      ORDER BY kfi.created_at DESC
      `,
      [application.merchant_id, Number(institutionId)]
    );

    // Fetch submission versions
    const [versions] = await db.query(
      `
      SELECT id, version_no, submitted_at, change_summary
      FROM kyc_submission_versions
      WHERE merchant_id = ?
      ORDER BY version_no DESC
      `,
      [application.merchant_id]
    );

    return {
      application,
      kyc,
      documents: docRows,
      fieldIssues,
      versions,
    };
  },

  /**
   * Update application review status
   */
  async updateApplicationReview({
    applicationId,
    institutionId,
    status,
    reviewerId,
    reviewComment,
    rejectionReason,
  }) {
    const isApproved = status === "approved";

    await db.query(
      `
      UPDATE merchant_gateway_applications
      SET 
        status = ?,
        assigned_reviewer_id = ?,
        review_comment = ?,
        rejection_reason = ?,
        reviewed_at = NOW(),
        approved_at = CASE WHEN ? = 1 THEN NOW() ELSE approved_at END,
        updated_at = NOW()
      WHERE id = ? AND institution_id = ?
      `,
      [
        status,
        reviewerId,
        reviewComment || null,
        rejectionReason || null,
        isApproved ? 1 : 0,
        Number(applicationId),
        Number(institutionId),
      ]
    );

    return true;
  },

  /**
   * Create a KYC field-level issue
   */
  async createKycFieldIssue({
    merchantId,
    kycId,
    institutionId,
    fieldKey,
    issueType,
    issueReason,
    reviewerId,
  }) {
    const [res] = await db.query(
      `
      INSERT INTO kyc_field_issues
      (merchant_id, kyc_id, institution_id, field_key, issue_type, issue_reason, reviewer_id, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'open')
      `,
      [
        Number(merchantId),
        Number(kycId),
        Number(institutionId),
        fieldKey,
        issueType || "incorrect_value",
        issueReason,
        Number(reviewerId),
      ]
    );

    return res.insertId;
  },

  /**
   * Mark field issue resolved or waived
   */
  async resolveKycFieldIssue({ issueId, resolutionNote, status = "resolved" }) {
    await db.query(
      `
      UPDATE kyc_field_issues
      SET status = ?, resolution_note = ?, updated_at = NOW()
      WHERE id = ?
      `,
      [status, resolutionNote || null, Number(issueId)]
    );
    return true;
  },

  /**
   * Create KYC submission version snapshot
   */
  async createKycVersionSnapshot({
    merchantId,
    kycId,
    snapshotData,
    submittedByUserId,
    changeSummary,
  }) {
    const [[lastVer]] = await db.query(
      `SELECT MAX(version_no) AS max_v FROM kyc_submission_versions WHERE merchant_id = ?`,
      [Number(merchantId)]
    );
    const nextVer = (lastVer?.max_v || 0) + 1;

    const [res] = await db.query(
      `
      INSERT INTO kyc_submission_versions
      (merchant_id, kyc_id, version_no, snapshot_data, submitted_by_user_id, change_summary)
      VALUES (?, ?, ?, ?, ?, ?)
      `,
      [
        Number(merchantId),
        Number(kycId),
        nextVer,
        JSON.stringify(snapshotData),
        submittedByUserId || null,
        changeSummary || null,
      ]
    );

    return { id: res.insertId, versionNo: nextVer };
  },

  /**
   * List authorized branches for this institution
   */
  async listBranches({
    institutionId,
    search,
    status,
    districtId,
    upazilaId,
    page = 1,
    limit = 20,
  }) {
    const instId = Number(institutionId);
    const offset = (Number(page) - 1) * Number(limit);
    const conditions = ["ib.institution_id = ?", "ib.is_archived = 0"];
    const params = [instId];

    if (status && status !== "all") {
      conditions.push("ib.status = ?");
      params.push(status);
    }
    if (districtId) {
      conditions.push("ib.district_id = ?");
      params.push(Number(districtId));
    }
    if (upazilaId) {
      conditions.push("ib.upazila_id = ?");
      params.push(Number(upazilaId));
    }
    if (search && search.trim()) {
      conditions.push(
        "(ib.branch_name LIKE ? OR ib.branch_code LIKE ? OR ib.routing_number LIKE ? OR ib.address LIKE ?)"
      );
      const s = `%${search.trim()}%`;
      params.push(s, s, s, s);
    }

    const whereClause = conditions.join(" AND ");

    const [[countRow]] = await db.query(
      `SELECT COUNT(*) AS total FROM institution_branches ib WHERE ${whereClause}`,
      params
    );

    const [rows] = await db.query(
      `
      SELECT 
        ib.*,
        COALESCE(divi.division_name, ib.division) AS division_name,
        COALESCE(dist.district_name, ib.district) AS district_name,
        COALESCE(upz.upazila_name, ib.upazila) AS upazila_name,
        pb.branch_name AS parent_branch_name
      FROM institution_branches ib
      LEFT JOIN bd_divisions divi ON divi.id = ib.division_id
      LEFT JOIN bd_districts dist ON dist.id = ib.district_id
      LEFT JOIN bd_upazilas upz ON upz.id = ib.upazila_id
      LEFT JOIN institution_branches pb ON pb.id = ib.parent_branch_id
      WHERE ${whereClause}
      ORDER BY ib.branch_name ASC
      LIMIT ? OFFSET ?
      `,
      [...params, Number(limit), offset]
    );

    return {
      branches: rows,
      total: Number(countRow.total),
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(Number(countRow.total) / Number(limit)),
    };
  },

  /**
   * List staff members for this institution with assigned branches
   */
  async listStaff({ institutionId }) {
    const instId = Number(institutionId);

    const [rows] = await db.query(
      `
      SELECT
        iu.id AS membership_id,
        iu.user_id,
        iu.institution_id,
        iu.role_id,
        iu.membership_status,
        iu.created_at AS joined_at,
        u.email,
        u.phone,
        u.status AS user_status,
        r.name AS role_name
      FROM institution_users iu
      JOIN users u ON u.id = iu.user_id
      LEFT JOIN roles r ON r.id = iu.role_id
      WHERE iu.institution_id = ?
      ORDER BY iu.created_at ASC
      `,
      [instId]
    );

    // Fetch branch assignments for all staff
    const [assignments] = await db.query(
      `
      SELECT 
        iuba.membership_id,
        iuba.branch_id,
        ib.branch_name,
        ib.branch_code
      FROM institution_user_branch_assignments iuba
      JOIN institution_branches ib ON ib.id = iuba.branch_id
      WHERE iuba.membership_id IN (SELECT id FROM institution_users WHERE institution_id = ?)
      `,
      [instId]
    );

    const branchMap = {};
    for (const a of assignments) {
      if (!branchMap[a.membership_id]) branchMap[a.membership_id] = [];
      branchMap[a.membership_id].push({
        id: a.branch_id,
        name: a.branch_name,
        code: a.branch_code,
      });
    }

    return rows.map((s) => ({
      ...s,
      assignedBranches: branchMap[s.membership_id] || [],
    }));
  },

  /**
   * Assign branches to staff member
   */
  async assignStaffBranches({ membershipId, branchIds, assignedBy }) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      await connection.query(
        `DELETE FROM institution_user_branch_assignments WHERE membership_id = ?`,
        [Number(membershipId)]
      );

      for (const branchId of branchIds) {
        await connection.query(
          `
          INSERT INTO institution_user_branch_assignments (membership_id, branch_id, assigned_by)
          VALUES (?, ?, ?)
          `,
          [Number(membershipId), Number(branchId), assignedBy || null]
        );
      }

      await connection.commit();
      return true;
    } catch (e) {
      await connection.rollback();
      throw e;
    } finally {
      connection.release();
    }
  },

  /**
   * List institution services
   */
  async listServices({ institutionId }) {
    const [rows] = await db.query(
      `
      SELECT
        iserv.*,
        g.name AS legacy_gateway_name,
        g.code AS legacy_gateway_code,
        (
          SELECT status 
          FROM institution_service_connections 
          WHERE institution_service_id = iserv.id 
          ORDER BY id DESC LIMIT 1
        ) AS connection_status,
        (
          SELECT environment 
          FROM institution_service_connections 
          WHERE institution_service_id = iserv.id 
          ORDER BY id DESC LIMIT 1
        ) AS connection_environment,
        (
          SELECT last_tested_at 
          FROM institution_service_connections 
          WHERE institution_service_id = iserv.id 
          ORDER BY id DESC LIMIT 1
        ) AS last_tested_at
      FROM institution_services iserv
      LEFT JOIN gateways g ON g.id = iserv.legacy_gateway_id
      WHERE iserv.institution_id = ?
      ORDER BY iserv.service_name ASC
      `,
      [Number(institutionId)]
    );

    return rows;
  },

  /**
   * Create or update an institution service
   */
  async createOrUpdateService(data) {
    const {
      id,
      institutionId,
      serviceCode,
      serviceName,
      serviceType,
      legacyGatewayId,
      integrationMode,
      availabilityStatus,
      applicationRequired,
      serviceRequirements,
    } = data;

    if (id) {
      await db.query(
        `
        UPDATE institution_services
        SET 
          service_code = ?,
          service_name = ?,
          service_type = ?,
          legacy_gateway_id = ?,
          integration_mode = ?,
          availability_status = ?,
          application_required = ?,
          service_requirements = ?,
          updated_at = NOW()
        WHERE id = ? AND institution_id = ?
        `,
        [
          serviceCode,
          serviceName,
          serviceType || "payment_gateway",
          legacyGatewayId || null,
          integrationMode || "api",
          availabilityStatus || "available",
          applicationRequired ? 1 : 0,
          serviceRequirements ? JSON.stringify(serviceRequirements) : null,
          Number(id),
          Number(institutionId),
        ]
      );
      return id;
    }

    const [res] = await db.query(
      `
      INSERT INTO institution_services
      (institution_id, service_code, service_name, service_type, legacy_gateway_id, integration_mode, availability_status, application_required, service_requirements)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        Number(institutionId),
        serviceCode,
        serviceName,
        serviceType || "payment_gateway",
        legacyGatewayId || null,
        integrationMode || "api",
        availabilityStatus || "available",
        applicationRequired ? 1 : 0,
        serviceRequirements ? JSON.stringify(serviceRequirements) : null,
      ]
    );

    return res.insertId;
  },

  /**
   * List connections for this institution's services
   */
  async listConnections({ institutionId }) {
    const [rows] = await db.query(
      `
      SELECT
        isc.id,
        isc.institution_service_id,
        isc.connection_mode,
        isc.status,
        isc.environment,
        isc.last_tested_at,
        isc.last_verified_at,
        isc.connection_notes,
        isc.created_at,
        isc.updated_at,
        iserv.service_name,
        iserv.service_code,
        iserv.service_type,
        u.email AS verified_by_email
      FROM institution_service_connections isc
      JOIN institution_services iserv ON iserv.id = isc.institution_service_id
      LEFT JOIN users u ON u.id = isc.verified_by_user_id
      WHERE iserv.institution_id = ?
      ORDER BY isc.updated_at DESC
      `,
      [Number(institutionId)]
    );

    return rows;
  },

  /**
   * Create or update service connection
   */
  async saveConnection({
    institutionServiceId,
    connectionMode,
    status,
    environment,
    credentialSecretRef,
    connectionNotes,
    verifiedByUserId,
  }) {
    const [existing] = await db.query(
      `SELECT id FROM institution_service_connections WHERE institution_service_id = ? LIMIT 1`,
      [Number(institutionServiceId)]
    );

    if (existing.length > 0) {
      await db.query(
        `
        UPDATE institution_service_connections
        SET
          connection_mode = ?,
          status = ?,
          environment = ?,
          credential_secret_ref = COALESCE(?, credential_secret_ref),
          connection_notes = ?,
          verified_by_user_id = ?,
          last_tested_at = NOW(),
          last_verified_at = CASE WHEN ? = 'connected' THEN NOW() ELSE last_verified_at END,
          updated_at = NOW()
        WHERE id = ?
        `,
        [
          connectionMode,
          status,
          environment,
          credentialSecretRef || null,
          connectionNotes || null,
          verifiedByUserId || null,
          status,
          existing[0].id,
        ]
      );
      return existing[0].id;
    }

    const [res] = await db.query(
      `
      INSERT INTO institution_service_connections
      (institution_service_id, connection_mode, status, environment, credential_secret_ref, connection_notes, verified_by_user_id, last_tested_at, last_verified_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), CASE WHEN ? = 'connected' THEN NOW() ELSE NULL END)
      `,
      [
        Number(institutionServiceId),
        connectionMode,
        status,
        environment,
        credentialSecretRef || null,
        connectionNotes || null,
        verifiedByUserId || null,
        status,
      ]
    );

    return res.insertId;
  },

  /**
   * Log operational event in institution_activity_logs
   */
  async logActivity({
    institutionId,
    userId,
    userEmail,
    action,
    resourceType,
    resourceId,
    statusTransition,
    details,
    ip,
    userAgent,
  }) {
    try {
      await db.query(
        `
        INSERT INTO institution_activity_logs
        (institution_id, user_id, user_email, action, resource_type, resource_id, status_transition, details, ip_address, user_agent)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          Number(institutionId),
          userId || null,
          userEmail || null,
          action,
          resourceType,
          resourceId ? String(resourceId) : null,
          statusTransition || null,
          details ? JSON.stringify(details) : null,
          ip || null,
          userAgent ? userAgent.substring(0, 500) : null,
        ]
      );
    } catch (e) {
      console.warn("Failed to write to institution_activity_logs:", e.message);
    }
  },

  /**
   * Get operational activity logs for this institution
   */
  async listActivityLogs({ institutionId, limit = 50 }) {
    const [rows] = await db.query(
      `
      SELECT *
      FROM institution_activity_logs
      WHERE institution_id = ?
      ORDER BY created_at DESC
      LIMIT ?
      `,
      [Number(institutionId), Number(limit)]
    );
    return rows;
  },
};
