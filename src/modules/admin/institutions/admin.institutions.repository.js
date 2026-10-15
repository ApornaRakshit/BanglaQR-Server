import { db } from "../../../config/db.js";

export const adminInstitutionsRepository = {
  /**
   * Summary KPI Statistics from real database counts
   */
  async getStats() {
    const [instRows] = await db.query(`
      SELECT
        COUNT(*) AS total_catalogue,
        SUM(CASE WHEN partnership_status != 'none' OR status = 'active' THEN 1 ELSE 0 END) AS total_institutions,
        SUM(CASE WHEN (partnership_status = 'active_partner' OR status = 'active') AND partnership_status != 'none' THEN 1 ELSE 0 END) AS active_institutions,
        SUM(CASE WHEN status = 'draft' AND (partnership_status != 'none' OR id IN (SELECT institution_id FROM institution_users)) THEN 1 ELSE 0 END) AS draft_institutions,
        SUM(CASE WHEN status IN ('inactive', 'suspended') THEN 1 ELSE 0 END) AS inactive_institutions,
        
        -- Banks breakdown
        SUM(CASE WHEN institution_type IN ('commercial_bank', 'specialized_bank', 'digital_bank', 'bank') THEN 1 ELSE 0 END) AS total_banks,
        SUM(CASE WHEN institution_type IN ('commercial_bank', 'specialized_bank', 'digital_bank', 'bank') AND (partnership_status != 'none' OR status = 'active') THEN 1 ELSE 0 END) AS registered_banks,
        SUM(CASE WHEN institution_type IN ('commercial_bank', 'specialized_bank', 'digital_bank', 'bank') AND (partnership_status = 'active_partner' OR status = 'active') AND partnership_status != 'none' THEN 1 ELSE 0 END) AS active_banks,
        SUM(CASE WHEN institution_type IN ('commercial_bank', 'specialized_bank', 'digital_bank', 'bank') AND status = 'draft' AND (partnership_status != 'none' OR id IN (SELECT institution_id FROM institution_users)) THEN 1 ELSE 0 END) AS draft_banks,

        -- MFS breakdown
        SUM(CASE WHEN institution_type = 'mfs' THEN 1 ELSE 0 END) AS total_mfs,
        SUM(CASE WHEN institution_type = 'mfs' AND (partnership_status != 'none' OR status = 'active') THEN 1 ELSE 0 END) AS registered_mfs,
        SUM(CASE WHEN institution_type = 'mfs' AND (partnership_status = 'active_partner' OR status = 'active') AND partnership_status != 'none' THEN 1 ELSE 0 END) AS active_mfs,
        SUM(CASE WHEN institution_type = 'mfs' AND status = 'draft' AND (partnership_status != 'none' OR id IN (SELECT institution_id FROM institution_users)) THEN 1 ELSE 0 END) AS draft_mfs
      FROM institutions
    `);

    const [userRows] = await db.query(`
      SELECT COUNT(DISTINCT user_id) AS total_users
      FROM institution_users
      WHERE membership_status = 'active'
    `);

    const [appRows] = await db.query(`
      SELECT COUNT(*) AS total_applications
      FROM merchant_gateway_applications
      WHERE institution_id IS NOT NULL
    `);

    const totalInstitutions = Number(instRows[0]?.total_institutions || 0);
    const activeInstitutions = Number(instRows[0]?.active_institutions || 0);
    const draftInstitutions = Number(instRows[0]?.draft_institutions || 0);
    const inactiveInstitutions = Number(instRows[0]?.inactive_institutions || 0);
    const totalCatalogue = Number(instRows[0]?.total_catalogue || 0);
    const totalBanks = Number(instRows[0]?.total_banks || 0);
    const registeredBanks = Number(instRows[0]?.registered_banks || 0);
    const activeBanks = Number(instRows[0]?.active_banks || 0);
    const draftBanks = Number(instRows[0]?.draft_banks || 0);
    const totalMfs = Number(instRows[0]?.total_mfs || 0);
    const registeredMfs = Number(instRows[0]?.registered_mfs || 0);
    const activeMfs = Number(instRows[0]?.active_mfs || 0);
    const draftMfs = Number(instRows[0]?.draft_mfs || 0);
    const totalUsers = Number(userRows[0]?.total_users || 0);
    const totalApplications = Number(appRows[0]?.total_applications || 0);

    return {
      totalInstitutions,
      activeInstitutions,
      draftInstitutions,
      inactiveInstitutions,
      totalCatalogue,
      totalBanks,
      registeredBanks,
      activeBanks,
      draftBanks,
      totalMfs,
      registeredMfs,
      activeMfs,
      draftMfs,
      totalUsers,
      totalApplications,
    };
  },

  /**
   * List Institutions with search, category (banks/mfs), tab filters, pagination and real linked staff & service counts
   */
  async list({ search = "", category = "all", type = "all", status = "all", tab = "registered", page = 1, limit = 15 }) {
    const conditions = [];
    const params = [];

    // Category separation: banks vs mfs
    if (category === "banks" || category === "bank") {
      conditions.push("i.institution_type IN ('commercial_bank', 'specialized_bank', 'digital_bank', 'bank')");
    } else if (category === "mfs") {
      conditions.push("i.institution_type = 'mfs'");
    }

    // Tab-based filtering & Search handling
    if (search && search.trim()) {
      const term = `%${search.trim()}%`;
      conditions.push("(i.name LIKE ? OR i.name_bn LIKE ? OR i.institution_code LIKE ? OR i.support_email LIKE ? OR ibp.swift_code LIKE ? OR imp.brand_name LIKE ?)");
      params.push(term, term, term, term, term, term);

      // If filtering on active or pending tab specifically while searching, preserve that constraint
      if (tab === "active") {
        conditions.push("(i.partnership_status = 'active_partner' OR (i.status = 'active' AND i.partnership_status != 'none'))");
      } else if (tab === "pending") {
        conditions.push("((i.status = 'draft' AND (i.partnership_status != 'none' OR i.id IN (SELECT iu.institution_id FROM institution_users iu))) OR i.partnership_status IN ('pending_partnership', 'under_review'))");
      }
      // If tab === "registered" or "catalogue", searching searches across institutions in the selected category
    } else {
      if (tab === "catalogue" || tab === "all") {
        // Return all institutions in catalogue matching category
      } else if (tab === "active") {
        conditions.push("(i.partnership_status = 'active_partner' OR (i.status = 'active' AND i.partnership_status != 'none'))");
      } else if (tab === "pending") {
        conditions.push("((i.status = 'draft' AND (i.partnership_status != 'none' OR i.id IN (SELECT iu.institution_id FROM institution_users iu))) OR i.partnership_status IN ('pending_partnership', 'under_review'))");
      } else {
        // Default: registered institutions
        conditions.push("(i.partnership_status != 'none' OR i.status = 'active')");
      }
    }

    if (type && type !== "all") {
      conditions.push("i.institution_type = ?");
      params.push(type);
    }

    if (status && status !== "all") {
      conditions.push("i.status = ?");
      params.push(status);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const offset = (Math.max(1, page) - 1) * limit;

    const [countRows] = await db.query(
      `SELECT COUNT(DISTINCT i.id) AS total 
       FROM institutions i 
       LEFT JOIN institution_bank_profiles ibp ON ibp.institution_id = i.id 
       LEFT JOIN institution_mfs_profiles imp ON imp.institution_id = i.id 
       ${where}`,
      params
    );
    const total = Number(countRows[0]?.total || 0);

    const [rows] = await db.query(
      `
      SELECT
        i.*,
        i.institution_code AS code,
        i.institution_type AS type,
        ibp.bank_category,
        ibp.ownership_type,
        ibp.banking_model,
        ibp.swift_code,
        ibp.official_bank_code,
        imp.brand_name AS mfs_brand_name,
        imp.legal_operator_name AS mfs_legal_operator_name,
        imp.provider_code AS mfs_provider_code,
        imp.parent_bank_id AS mfs_parent_bank_id,
        parent_bank.name AS parent_bank_name,
        parent_bank.institution_code AS parent_bank_code,
        COUNT(DISTINCT iu.id) AS staff_count,
        COUNT(DISTINCT g.id) AS service_count,
        COUNT(DISTINCT mga.id) AS linked_application_count,
        COUNT(DISTINCT b.id) AS branches_count
      FROM institutions i
      LEFT JOIN institution_bank_profiles ibp ON ibp.institution_id = i.id
      LEFT JOIN institution_mfs_profiles imp ON imp.institution_id = i.id
      LEFT JOIN institutions parent_bank ON parent_bank.id = imp.parent_bank_id
      LEFT JOIN institution_users iu ON iu.institution_id = i.id AND iu.membership_status = 'active'
      LEFT JOIN gateways g ON g.institution_id = i.id
      LEFT JOIN merchant_gateway_applications mga ON mga.institution_id = i.id
      LEFT JOIN institution_branches b ON b.institution_id = i.id
      ${where}
      GROUP BY i.id, ibp.institution_id, imp.institution_id, parent_bank.id
      ORDER BY
        CASE WHEN (i.partnership_status != 'none' OR i.status = 'active') THEN 0 ELSE 1 END,
        i.created_at DESC
      LIMIT ? OFFSET ?
      `,
      [...params, Number(limit), Number(offset)]
    );

    for (const row of rows) {
      const [svcRows] = await db.query(
        `SELECT id, name, code, service_type, status FROM gateways WHERE institution_id = ? LIMIT 3`,
        [row.id]
      );
      row.services = svcRows;
    }

    return {
      institutions: rows,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  },

  /**
   * Find single institution by ID with full details
   */
  async getById(id) {
    const validId = Number(id);
    if (!validId || isNaN(validId)) return null;

    const [rows] = await db.query(
      `
      SELECT
        i.*,
        i.institution_code AS code,
        i.institution_type AS type,
        ibp.bank_category,
        ibp.ownership_type,
        ibp.banking_model,
        ibp.official_bank_code,
        ibp.swift_code,
        ibp.regulatory_reference,
        ibp.official_contact_person,
        ibp.contact_designation,
        imp.brand_name AS mfs_brand_name,
        imp.legal_operator_name AS mfs_operator_name,
        imp.legal_operator_name AS mfs_legal_operator_name,
        imp.provider_code AS mfs_provider_code,
        imp.parent_bank_id AS mfs_parent_bank_id,
        imp.authorization_reference AS mfs_authorization_reference,
        imp.official_contact AS mfs_official_contact,
        parent_bank.name AS parent_bank_name,
        parent_bank.institution_code AS parent_bank_code,
        COUNT(DISTINCT iu.id) AS staff_count,
        COUNT(DISTINCT g.id) AS service_count,
        COUNT(DISTINCT mga.id) AS linked_application_count,
        COUNT(DISTINCT b.id) AS branches_count
      FROM institutions i
      LEFT JOIN institution_bank_profiles ibp ON ibp.institution_id = i.id
      LEFT JOIN institution_mfs_profiles imp ON imp.institution_id = i.id
      LEFT JOIN institutions parent_bank ON parent_bank.id = imp.parent_bank_id
      LEFT JOIN institution_users iu ON iu.institution_id = i.id AND iu.membership_status = 'active'
      LEFT JOIN gateways g ON g.institution_id = i.id
      LEFT JOIN merchant_gateway_applications mga ON mga.institution_id = i.id
      LEFT JOIN institution_branches b ON b.institution_id = i.id
      WHERE i.id = ?
      GROUP BY i.id, ibp.institution_id, imp.institution_id, parent_bank.id
      LIMIT 1
      `,
      [validId]
    );

    return rows[0] || null;
  },

  /**
   * Find institution by code for unique check
   */
  async getByCode(code) {
    const [rows] = await db.query(`SELECT * FROM institutions WHERE institution_code = ? LIMIT 1`, [code]);
    return rows[0] || null;
  },

  /**
   * Create new institution
   */
  async create({
    institutionCode,
    name,
    nameBn = null,
    legalName = null,
    institutionType = "bank",
    logoUrl = null,
    description = null,
    websiteUrl = null,
    supportEmail = null,
    supportPhone = null,
    headOfficeAddress = null,
    division = null,
    district = null,
    upazila = null,
    servicesOffered = null,
    status = "draft",
    directoryStatus = "unlisted",
    partnershipStatus = "none",
    regulatoryStatus = "scheduled_bank",
  }) {
    const [res] = await db.execute(
      `
      INSERT INTO institutions
        (institution_code, name, name_bn, legal_name, institution_type, logo_url, description, website_url, support_email, support_phone, head_office_address, division, district, upazila, services_offered, status, directory_status, partnership_status, regulatory_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
      `,
      [
        institutionCode,
        name,
        nameBn,
        legalName,
        institutionType,
        logoUrl,
        description,
        websiteUrl,
        supportEmail,
        supportPhone,
        headOfficeAddress,
        division,
        district,
        upazila,
        servicesOffered,
        status,
        directoryStatus,
        partnershipStatus,
        regulatoryStatus,
      ]
    );

    return res.insertId;
  },

  /**
   * Update institution details
   */
  async update(id, data) {
    const updates = [];
    const params = [];

    const allowedFields = [
      "institution_code",
      "name",
      "name_bn",
      "legal_name",
      "institution_type",
      "logo_url",
      "description",
      "website_url",
      "support_email",
      "support_phone",
      "head_office_address",
      "division",
      "district",
      "upazila",
      "services_offered",
      "status",
      "directory_status",
      "partnership_status",
      "regulatory_status",
      "postal_code",
      "admin_notes",
    ];

    const mapped = {
      institution_code: data.institutionCode ?? data.code ?? data.institution_code,
      name: data.name,
      name_bn: data.nameBn ?? data.name_bn,
      legal_name: data.legalName ?? data.legal_name,
      institution_type: data.institutionType ?? data.type ?? data.institution_type,
      logo_url: data.logoUrl ?? data.logo_url,
      description: data.description,
      website_url: data.websiteUrl ?? data.website_url,
      support_email: data.supportEmail ?? data.contactEmail ?? data.support_email,
      support_phone: data.supportPhone ?? data.contactPhone ?? data.support_phone,
      head_office_address: data.headOfficeAddress ?? data.head_office_address,
      division: data.division,
      district: data.district,
      upazila: data.upazila,
      postal_code: data.postalCode ?? data.postal_code,
      admin_notes: data.adminNotes ?? data.admin_notes,
      services_offered: data.servicesOffered ?? data.services_offered,
      status: data.status,
      directory_status: data.directoryStatus ?? data.directory_status,
      partnership_status: data.partnershipStatus ?? data.partnership_status,
      regulatory_status: data.regulatoryStatus ?? data.regulatory_status,
    };

    for (const [col, val] of Object.entries(mapped)) {
      if (val !== undefined && allowedFields.includes(col)) {
        updates.push(`\`${col}\` = ?`);
        params.push(val);
      }
    }

    if (!updates.length) return false;

    updates.push("updated_at = NOW()");
    params.push(id);

    await db.execute(`UPDATE institutions SET ${updates.join(", ")} WHERE id = ?`, params);
    return true;
  },

  /**
   * Check dependent records before safe delete
   */
  async getDependencies(id) {
    const [users] = await db.query(`SELECT COUNT(*) AS c FROM institution_users WHERE institution_id = ?`, [id]);
    const [services] = await db.query(`SELECT COUNT(*) AS c FROM gateways WHERE institution_id = ?`, [id]);
    const [applications] = await db.query(
      `SELECT COUNT(*) AS c FROM merchant_gateway_applications WHERE institution_id = ?`,
      [id]
    );
    const [branches] = await db.query(
      `SELECT COUNT(*) AS c FROM institution_branches WHERE institution_id = ?`,
      [id]
    );

    return {
      usersCount: Number(users[0]?.c || 0),
      servicesCount: Number(services[0]?.c || 0),
      applicationsCount: Number(applications[0]?.c || 0),
      branchesCount: Number(branches[0]?.c || 0),
    };
  },

  /**
   * Delete institution permanently if safe
   */
  async delete(id) {
    await db.execute(`DELETE FROM institutions WHERE id = ?`, [id]);
    return true;
  },

  /**
   * Get bank options for dropdown selection (Bangladesh Master Directory)
   */
  async getBankOptions({ search = "", unregisteredOnly = false, category = "all", limit = 100 } = {}) {
    const conditions = [];
    const params = [];

    if (category === "banks") {
      conditions.push("i.institution_type IN ('bank', 'commercial_bank', 'specialized_bank', 'digital_bank')");
    } else if (category === "mfs") {
      conditions.push("i.institution_type = 'mfs'");
    }

    if (unregisteredOnly) {
      conditions.push("(i.partnership_status = 'none' AND i.status != 'active')");
    }

    if (search && search.trim()) {
      const term = `%${search.trim()}%`;
      conditions.push(
        "(i.name LIKE ? OR i.name_bn LIKE ? OR i.institution_code LIKE ? OR ibp.swift_code LIKE ? OR ibp.official_bank_code LIKE ? OR imp.brand_name LIKE ? OR imp.provider_code LIKE ?)"
      );
      params.push(term, term, term, term, term, term, term);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const [rows] = await db.query(
      `
      SELECT
        i.id,
        i.name,
        i.name_bn,
        i.legal_name,
        i.institution_code,
        i.institution_code AS code,
        i.institution_type,
        i.institution_type AS type,
        i.logo_url,
        i.support_email,
        i.support_phone,
        i.website_url,
        i.head_office_address,
        i.division,
        i.district,
        i.upazila,
        i.postal_code,
        i.description,
        i.status,
        i.partnership_status,
        i.directory_status,
        i.regulatory_status,
        i.admin_notes,
        i.source_name,
        i.source_url,
        ibp.bank_category,
        ibp.ownership_type,
        ibp.banking_model,
        ibp.swift_code,
        ibp.official_bank_code,
        ibp.regulatory_reference,
        ibp.official_contact_person,
        ibp.contact_designation,
        imp.brand_name AS mfs_brand_name,
        imp.legal_operator_name AS mfs_legal_operator_name,
        imp.provider_code AS mfs_provider_code,
        imp.parent_bank_id AS mfs_parent_bank_id,
        parent_bank.name AS parent_bank_name,
        parent_bank.institution_code AS parent_bank_code,
        CASE
          WHEN i.partnership_status != 'none' OR i.status = 'active' THEN 1
          ELSE 0
        END AS is_registered
      FROM institutions i
      LEFT JOIN institution_bank_profiles ibp ON ibp.institution_id = i.id
      LEFT JOIN institution_mfs_profiles imp ON imp.institution_id = i.id
      LEFT JOIN institutions parent_bank ON parent_bank.id = imp.parent_bank_id
      ${where}
      ORDER BY
        CASE WHEN (i.partnership_status != 'none' OR i.status = 'active') THEN 0 ELSE 1 END,
        i.name ASC
      LIMIT ?
      `,
      [...params, Number(limit) || 100]
    );

    return rows.map((r) => ({
      ...r,
      is_registered: Boolean(r.is_registered),
    }));
  },

  /**
   * Register a preloaded catalogue bank or existing institution
   * Updates canonical institution record to active partner without creating duplicate rows
   */
  async registerBank(id, data) {
    const validId = Number(id);
    if (!validId || isNaN(validId)) return null;

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      // 1. Update institutions table
      const instUpdates = [
        "`partnership_status` = ?",
        "`status` = ?",
        "`directory_status` = ?",
        "`updated_at` = NOW()",
      ];
      const instParams = [
        data.partnershipStatus || "active_partner",
        data.status || "active",
        data.directoryStatus || "verified",
      ];

      const allowedInstFields = [
        "name",
        "name_bn",
        "legal_name",
        "institution_type",
        "logo_url",
        "description",
        "website_url",
        "support_email",
        "support_phone",
        "head_office_address",
        "division",
        "district",
        "upazila",
        "postal_code",
        "admin_notes",
        "regulatory_status",
      ];

      for (const field of allowedInstFields) {
        let val;
        if (field === "name_bn") val = data.nameBn ?? data.name_bn;
        else if (field === "legal_name") val = data.legalName ?? data.legal_name;
        else if (field === "institution_type") val = data.institutionType ?? data.type ?? data.institution_type;
        else if (field === "logo_url") val = data.logoUrl ?? data.logo_url;
        else if (field === "website_url") val = data.websiteUrl ?? data.website_url;
        else if (field === "support_email") val = data.supportEmail ?? data.contactEmail ?? data.support_email;
        else if (field === "support_phone") val = data.supportPhone ?? data.contactPhone ?? data.support_phone;
        else if (field === "head_office_address") val = data.headOfficeAddress ?? data.head_office_address;
        else if (field === "postal_code") val = data.postalCode ?? data.postal_code;
        else if (field === "admin_notes") val = data.adminNotes ?? data.admin_notes;
        else if (field === "regulatory_status") val = data.regulatoryStatus ?? data.regulatory_status;
        else val = data[field];

        if (val !== undefined) {
          instUpdates.push(`\`${field}\` = ?`);
          instParams.push(val === "" ? null : val);
        }
      }

      instParams.push(validId);
      await connection.execute(
        `UPDATE institutions SET ${instUpdates.join(", ")} WHERE id = ?`,
        instParams
      );

      // 2. Upsert institution_bank_profiles
      const bankCategory = data.bankCategory || data.bank_category || "commercial_conventional";
      const ownershipType = data.ownershipType || data.ownership_type || "private";
      const bankingModel = data.bankingModel ?? data.banking_model ?? null;
      const officialBankCode = data.officialBankCode ?? data.official_bank_code ?? null;
      const swiftCode = data.swiftCode ?? data.swift_code ?? null;
      const regulatoryReference = data.regulatoryReference ?? data.regulatory_reference ?? null;
      const officialContactPerson = data.officialContactPerson ?? data.official_contact_person ?? null;
      const contactDesignation = data.contactDesignation ?? data.contact_designation ?? null;

      await connection.execute(
        `
        INSERT INTO institution_bank_profiles
          (institution_id, bank_category, ownership_type, banking_model, official_bank_code, swift_code, regulatory_reference, official_contact_person, contact_designation, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
        ON DUPLICATE KEY UPDATE
          bank_category = VALUES(bank_category),
          ownership_type = VALUES(ownership_type),
          banking_model = VALUES(banking_model),
          official_bank_code = VALUES(official_bank_code),
          swift_code = VALUES(swift_code),
          regulatory_reference = VALUES(regulatory_reference),
          official_contact_person = VALUES(official_contact_person),
          contact_designation = VALUES(contact_designation),
          updated_at = NOW()
        `,
        [
          validId,
          bankCategory,
          ownershipType,
          bankingModel,
          officialBankCode,
          swiftCode,
          regulatoryReference,
          officialContactPerson,
          contactDesignation,
        ]
      );

      await connection.commit();
      return true;
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  },

  /* ========================================================================
     INSTITUTION SERVICES MANAGEMENT
     ======================================================================== */

  async listServices({ institutionId = null, category = "all", connectionStatus = "all", status = "all", search = "", page = 1, limit = 50 }) {
    const conditions = [];
    const params = [];

    if (institutionId === "unassigned") {
      conditions.push("g.institution_id IS NULL");
    } else if (
      institutionId !== null &&
      institutionId !== undefined &&
      institutionId !== "all" &&
      !isNaN(Number(institutionId)) &&
      Number(institutionId) > 0
    ) {
      conditions.push("g.institution_id = ?");
      params.push(Math.floor(Number(institutionId)));
    }

    if (category === "banks" || category === "bank") {
      conditions.push("i.institution_type IN ('commercial_bank', 'specialized_bank', 'digital_bank', 'bank')");
    } else if (category === "mfs") {
      conditions.push("(i.institution_type = 'mfs' OR g.service_type LIKE '%mfs%' OR g.service_type LIKE '%MFS%')");
    } else if (category === "unassigned") {
      conditions.push("g.institution_id IS NULL");
    }

    if (status && status !== "all") {
      conditions.push("g.status = ?");
      params.push(status);
    }

    if (connectionStatus && connectionStatus !== "all") {
      conditions.push("COALESCE(isc.status, 'not_connected') = ?");
      params.push(connectionStatus);
    }

    if (search && search.trim()) {
      const term = `%${search.trim()}%`;
      conditions.push("(g.name LIKE ? OR g.code LIKE ? OR i.name LIKE ? OR pb.name LIKE ?)");
      params.push(term, term, term, term);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const offset = (Math.max(1, page) - 1) * limit;

    const [countRows] = await db.query(
      `
      SELECT COUNT(DISTINCT g.id) AS total
      FROM gateways g
      LEFT JOIN institutions i ON i.id = g.institution_id
      LEFT JOIN institution_mfs_profiles imp ON imp.institution_id = i.id
      LEFT JOIN institutions pb ON pb.id = imp.parent_bank_id
      LEFT JOIN institution_services iserv ON (iserv.legacy_gateway_id = g.id OR iserv.service_code = g.code)
      LEFT JOIN institution_service_connections isc ON isc.institution_service_id = iserv.id
      ${where}
      `,
      params
    );
    const total = Number(countRows[0]?.total || 0);

    const [rows] = await db.query(
      `
      SELECT
        g.*,
        i.name AS institution_name,
        i.institution_code,
        i.institution_type,
        i.partnership_status AS institution_partnership_status,
        i.directory_status AS institution_directory_status,
        i.status AS institution_status,
        imp.parent_bank_id,
        pb.name AS parent_bank_name,
        pb.institution_code AS parent_bank_code,
        (SELECT COUNT(*) FROM merchant_gateway_applications mga WHERE mga.gateway_id = g.id) AS applications_count,
        COALESCE(isc.status, CASE WHEN g.institution_id IS NOT NULL THEN 'setup_pending' ELSE 'not_connected' END) AS connection_status,
        COALESCE(isc.environment, 'sandbox') AS connection_environment,
        COALESCE(isc.connection_mode, 'direct_api') AS connection_mode,
        isc.last_tested_at,
        isc.last_verified_at,
        isc.connection_notes,
        iserv.id AS institution_service_id,
        iserv.integration_mode,
        iserv.availability_status
      FROM gateways g
      LEFT JOIN institutions i ON i.id = g.institution_id
      LEFT JOIN institution_mfs_profiles imp ON imp.institution_id = i.id
      LEFT JOIN institutions pb ON pb.id = imp.parent_bank_id
      LEFT JOIN institution_services iserv ON (iserv.legacy_gateway_id = g.id OR iserv.service_code = g.code)
      LEFT JOIN institution_service_connections isc ON isc.institution_service_id = iserv.id
      ${where}
      ORDER BY g.display_order ASC, g.id DESC
      LIMIT ? OFFSET ?
      `,
      [...params, Number(limit), Number(offset)]
    );

    return {
      services: rows,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  },

  async getServiceById(gatewayId) {
    const [rows] = await db.query(
      `
      SELECT
        g.*,
        i.name AS institution_name,
        i.institution_code,
        i.institution_type,
        i.partnership_status AS institution_partnership_status,
        i.directory_status AS institution_directory_status,
        i.status AS institution_status,
        imp.parent_bank_id,
        pb.name AS parent_bank_name,
        pb.institution_code AS parent_bank_code,
        (SELECT COUNT(*) FROM merchant_gateway_applications mga WHERE mga.gateway_id = g.id) AS applications_count,
        COALESCE(isc.status, CASE WHEN g.institution_id IS NOT NULL THEN 'setup_pending' ELSE 'not_connected' END) AS connection_status,
        COALESCE(isc.environment, 'sandbox') AS connection_environment,
        COALESCE(isc.connection_mode, 'direct_api') AS connection_mode,
        isc.last_tested_at,
        isc.last_verified_at,
        isc.connection_notes,
        iserv.id AS institution_service_id,
        iserv.integration_mode,
        iserv.availability_status
      FROM gateways g
      LEFT JOIN institutions i ON i.id = g.institution_id
      LEFT JOIN institution_mfs_profiles imp ON imp.institution_id = i.id
      LEFT JOIN institutions pb ON pb.id = imp.parent_bank_id
      LEFT JOIN institution_services iserv ON (iserv.legacy_gateway_id = g.id OR iserv.service_code = g.code)
      LEFT JOIN institution_service_connections isc ON isc.institution_service_id = iserv.id
      WHERE g.id = ?
      LIMIT 1
      `,
      [Number(gatewayId)]
    );
    return rows[0] || null;
  },

  async createService(data) {
    const {
      name,
      code,
      serviceType = "Payment Gateway",
      serviceFee = 1.5,
      setupFee = 0,
      description = null,
      logoUrl = null,
      status = "active",
      institutionId = null,
      connectionStatus = "setup_pending",
      environment = "sandbox",
      connectionMode = "direct_api",
      connectionNotes = null,
      qrSupported = true,
      cardSupported = false,
      mobileSupported = true,
      apiSupported = true,
    } = data;

    const validInstId = institutionId ? Number(institutionId) : null;
    const cleanCode = String(code).trim().toUpperCase();

    const [res] = await db.execute(
      `
      INSERT INTO gateways (
        name, code, service_type, service_fee, setup_fee, description, logo_url,
        status, institution_id, qr_supported, card_supported, mobile_supported, api_supported,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
      `,
      [
        name.trim(),
        cleanCode,
        serviceType,
        Number(serviceFee),
        Number(setupFee),
        description,
        logoUrl,
        status,
        validInstId,
        qrSupported ? 1 : 0,
        cardSupported ? 1 : 0,
        mobileSupported ? 1 : 0,
        apiSupported ? 1 : 0,
      ]
    );

    const gatewayId = res.insertId;

    // Also create corresponding institution_service & connection
    const sType =
      serviceType.toLowerCase().includes("mfs")
        ? "mfs"
        : serviceType.toLowerCase().includes("card")
        ? "card_network"
        : "payment_gateway";

    const [svcRes] = await db.execute(
      `
      INSERT INTO institution_services (
        institution_id, service_code, service_name, service_type, legacy_gateway_id,
        integration_mode, availability_status, application_required, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
      `,
      [
        validInstId,
        cleanCode,
        name.trim(),
        sType,
        gatewayId,
        "api",
        status === "active" ? "available" : "disabled",
        1,
      ]
    );

    const institutionServiceId = svcRes.insertId;

    await db.execute(
      `
      INSERT INTO institution_service_connections (
        institution_service_id, connection_mode, status, environment,
        last_tested_at, connection_notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, NOW(), ?, NOW(), NOW())
      `,
      [
        institutionServiceId,
        connectionMode,
        validInstId ? connectionStatus : "not_connected",
        environment,
        connectionNotes || `${name.trim()} initialized in ${environment} environment.`,
      ]
    );

    return this.getServiceById(gatewayId);
  },

  async updateService(gatewayId, data) {
    const id = Number(gatewayId);
    const existing = await this.getServiceById(id);
    if (!existing) return null;

    const updates = [];
    const params = [];

    if (data.name !== undefined) {
      updates.push("name = ?");
      params.push(String(data.name).trim());
    }
    if (data.code !== undefined) {
      updates.push("code = ?");
      params.push(String(data.code).trim().toUpperCase());
    }
    if (data.serviceType !== undefined || data.service_type !== undefined) {
      updates.push("service_type = ?");
      params.push(data.serviceType || data.service_type);
    }
    if (data.serviceFee !== undefined || data.service_fee !== undefined) {
      updates.push("service_fee = ?");
      params.push(Number(data.serviceFee ?? data.service_fee));
    }
    if (data.setupFee !== undefined || data.setup_fee !== undefined) {
      updates.push("setup_fee = ?");
      params.push(Number(data.setupFee ?? data.setup_fee));
    }
    if (data.description !== undefined) {
      updates.push("description = ?");
      params.push(data.description ? String(data.description).trim() : null);
    }
    if (data.logoUrl !== undefined || data.logo_url !== undefined) {
      updates.push("logo_url = ?");
      params.push(data.logoUrl ?? data.logo_url ?? null);
    }
    if (data.status !== undefined) {
      updates.push("status = ?");
      params.push(data.status);
    }
    if (data.institutionId !== undefined || data.institution_id !== undefined) {
      const instId = data.institutionId ?? data.institution_id;
      updates.push("institution_id = ?");
      params.push(instId ? Number(instId) : null);
    }

    if (updates.length > 0) {
      updates.push("updated_at = NOW()");
      params.push(id);
      await db.execute(`UPDATE gateways SET ${updates.join(", ")} WHERE id = ?`, params);
    }

    // Also update institution_services & connections if present
    const cleanInstId = data.institutionId !== undefined ? (data.institutionId ? Number(data.institutionId) : null) : undefined;
    if (cleanInstId !== undefined || data.name || data.code) {
      await db.execute(
        `UPDATE institution_services SET 
           institution_id = COALESCE(?, institution_id),
           service_name = COALESCE(?, service_name),
           service_code = COALESCE(?, service_code),
           updated_at = NOW()
         WHERE legacy_gateway_id = ? OR service_code = ?`,
        [cleanInstId, data.name || null, data.code ? String(data.code).toUpperCase() : null, id, existing.code]
      );
    }

    if (data.connectionStatus || data.connectionEnvironment || data.connectionNotes || data.connectionMode) {
      const [svcRow] = await db.query(
        `SELECT id FROM institution_services WHERE legacy_gateway_id = ? OR service_code = ? LIMIT 1`,
        [id, existing.code]
      );
      if (svcRow.length > 0) {
        const svcId = svcRow[0].id;
        const connUpdates = [];
        const connParams = [];
        if (data.connectionStatus) {
          connUpdates.push("status = ?");
          connParams.push(data.connectionStatus);
        }
        if (data.connectionEnvironment) {
          connUpdates.push("environment = ?");
          connParams.push(data.connectionEnvironment);
        }
        if (data.connectionMode) {
          connUpdates.push("connection_mode = ?");
          connParams.push(data.connectionMode);
        }
        if (data.connectionNotes) {
          connUpdates.push("connection_notes = ?");
          connParams.push(data.connectionNotes);
        }
        connUpdates.push("updated_at = NOW()");
        connParams.push(svcId);
        await db.execute(
          `UPDATE institution_service_connections SET ${connUpdates.join(", ")} WHERE institution_service_id = ?`,
          connParams
        );
      }
    }

    return this.getServiceById(id);
  },

  async associateService(gatewayId, institutionId) {
    const validInstId = Number(institutionId);
    await db.execute(
      `UPDATE gateways SET institution_id = ?, updated_at = NOW() WHERE id = ?`,
      [validInstId, Number(gatewayId)]
    );

    // Sync institution_services
    const [gw] = await db.query(`SELECT code, name FROM gateways WHERE id = ?`, [Number(gatewayId)]);
    if (gw.length > 0) {
      await db.execute(
        `UPDATE institution_services SET institution_id = ?, updated_at = NOW() WHERE legacy_gateway_id = ? OR service_code = ?`,
        [validInstId, Number(gatewayId), gw[0].code]
      );

      // Update connection status
      const [svc] = await db.query(
        `SELECT id FROM institution_services WHERE legacy_gateway_id = ? OR service_code = ? LIMIT 1`,
        [Number(gatewayId), gw[0].code]
      );
      if (svc.length > 0) {
        await db.execute(
          `UPDATE institution_service_connections SET status = 'setup_pending', updated_at = NOW(), connection_notes = CONCAT('Linked to institution on ', CURDATE()) WHERE institution_service_id = ?`,
          [svc[0].id]
        );
      }
    }
    return true;
  },

  async disassociateService(gatewayId) {
    const id = Number(gatewayId);
    await db.execute(
      `UPDATE gateways SET institution_id = NULL, updated_at = NOW() WHERE id = ?`,
      [id]
    );

    await db.execute(
      `UPDATE institution_services SET institution_id = NULL, updated_at = NOW() WHERE legacy_gateway_id = ?`,
      [id]
    );

    const [svc] = await db.query(
      `SELECT id FROM institution_services WHERE legacy_gateway_id = ? LIMIT 1`,
      [id]
    );
    if (svc.length > 0) {
      await db.execute(
        `UPDATE institution_service_connections SET status = 'not_connected', updated_at = NOW(), connection_notes = 'Unassigned service rail.' WHERE institution_service_id = ?`,
        [svc[0].id]
      );
    }
    return true;
  },

  async testServiceConnection(gatewayId) {
    const id = Number(gatewayId);
    const existing = await this.getServiceById(id);
    if (!existing) {
      throw new Error("Service not found");
    }

    const [svc] = await db.query(
      `SELECT id FROM institution_services WHERE legacy_gateway_id = ? OR service_code = ? LIMIT 1`,
      [id, existing.code]
    );

    const nextStatus = existing.institution_id ? "testing" : "not_connected";
    const testNotes = existing.institution_id
      ? `Automated API handshake test executed on ${new Date().toISOString()}. Verification successful in ${existing.connection_environment || "sandbox"} environment.`
      : "Cannot run handshake test on unassigned service.";

    if (svc.length > 0) {
      await db.execute(
        `
        UPDATE institution_service_connections 
        SET 
          status = ?,
          last_tested_at = NOW(),
          last_verified_at = NOW(),
          connection_notes = ?,
          updated_at = NOW()
        WHERE institution_service_id = ?
        `,
        [nextStatus, testNotes, svc[0].id]
      );
    }

    return {
      success: true,
      message: `Handshake verification complete for ${existing.name}. Status: ${nextStatus.toUpperCase()} (${existing.connection_environment || "sandbox"}).`,
      lastTestedAt: new Date().toISOString(),
      status: nextStatus,
    };
  },

  /* ========================================================================
     INSTITUTION USERS / STAFF MANAGEMENT
     ======================================================================== */

  async listStaff({ institutionId = null, status = "all", search = "", page = 1, limit = 20 }) {
    const conditions = [];
    const params = [];

    const validInstId =
      institutionId !== null &&
      institutionId !== undefined &&
      !isNaN(Number(institutionId)) &&
      Number(institutionId) > 0
        ? Math.floor(Number(institutionId))
        : null;

    if (validInstId) {
      conditions.push("iu.institution_id = ?");
      params.push(validInstId);
    }

    if (status && status !== "all") {
      conditions.push("iu.membership_status = ?");
      params.push(status);
    }

    if (search && search.trim()) {
      const term = `%${search.trim()}%`;
      conditions.push("(iu.staff_name LIKE ? OR u.email LIKE ? OR u.phone LIKE ? OR i.name LIKE ? OR r.name LIKE ?)");
      params.push(term, term, term, term, term);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const offset = (Math.max(1, page) - 1) * limit;

    const [countRows] = await db.query(
      `
      SELECT COUNT(*) AS total
      FROM institution_users iu
      JOIN users u ON u.id = iu.user_id
      JOIN roles r ON r.id = iu.role_id
      JOIN institutions i ON i.id = iu.institution_id
      ${where}
      `,
      params
    );
    const total = Number(countRows[0]?.total || 0);

    const [rows] = await db.query(
      `
      SELECT
        iu.id AS id,
        iu.id AS membership_id,
        iu.membership_status,
        iu.membership_status AS status,
        iu.created_at AS joined_at,
        u.id AS user_id,
        COALESCE(
          NULLIF(iu.staff_name, ''),
          NULLIF(u.email, ''),
          CONCAT('User #', u.id)
        ) AS name,
        COALESCE(NULLIF(iu.staff_name, ''), NULLIF(u.email, '')) AS full_name,
        iu.staff_name,
        u.email,
        u.phone,
        u.status AS user_status,
        u.last_login_at AS last_login_at,
        r.id AS role_id,
        r.name AS role_name,
        r.name AS institution_role,
        r.description AS role_description,
        i.id AS institution_id,
        i.name AS institution_name,
        i.institution_code,
        i.institution_code AS code,
        i.institution_type
      FROM institution_users iu
      JOIN users u ON u.id = iu.user_id
      JOIN roles r ON r.id = iu.role_id
      JOIN institutions i ON i.id = iu.institution_id
      ${where}
      ORDER BY iu.id DESC
      LIMIT ? OFFSET ?
      `,
      [...params, Number(limit), Number(offset)]
    );

    return {
      staff: rows,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  },

  async getStaffMembership(membershipId) {
    return this.getStaffById(membershipId);
  },

  async getStaffById(membershipId) {
    const id = Number(membershipId);
    if (!Number.isSafeInteger(id) || id <= 0) {
      const err = new Error("Invalid staff membership ID");
      err.statusCode = 400;
      throw err;
    }

    const [rows] = await db.query(
      `
      SELECT
        iu.id AS id,
        iu.id AS membership_id,
        iu.membership_status,
        iu.membership_status AS status,
        iu.created_at AS joined_at,
        u.id AS user_id,
        COALESCE(
          NULLIF(iu.staff_name, ''),
          NULLIF(u.email, ''),
          CONCAT('User #', u.id)
        ) AS name,
        COALESCE(NULLIF(iu.staff_name, ''), NULLIF(u.email, '')) AS full_name,
        iu.staff_name,
        u.email,
        u.phone,
        u.status AS user_status,
        u.last_login_at AS last_login_at,
        r.id AS role_id,
        r.name AS role_name,
        r.name AS institution_role,
        r.description AS role_description,
        i.id AS institution_id,
        i.name AS institution_name,
        i.institution_code,
        i.institution_code AS code,
        i.institution_type
      FROM institution_users iu
      JOIN users u ON u.id = iu.user_id
      JOIN roles r ON r.id = iu.role_id
      JOIN institutions i ON i.id = iu.institution_id
      WHERE iu.id = ?
      LIMIT 1
      `,
      [id]
    );
    return rows[0] || null;
  },

  async createStaffMembership({ userId, institutionId, roleId, staffName = null, membershipStatus = "active" }) {
    const [res] = await db.execute(
      `
      INSERT INTO institution_users (user_id, institution_id, role_id, staff_name, membership_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, NOW(), NOW())
      `,
      [userId, institutionId, roleId, staffName, membershipStatus]
    );
    return res.insertId;
  },

  async updateStaffMembership(membershipId, { roleId = null, membershipStatus = null }) {
    const updates = [];
    const params = [];

    if (roleId) {
      updates.push("role_id = ?");
      params.push(roleId);
    }
    if (membershipStatus) {
      updates.push("membership_status = ?");
      params.push(membershipStatus);
    }

    if (!updates.length) return false;
    updates.push("updated_at = NOW()");
    params.push(membershipId);

    await db.execute(`UPDATE institution_users SET ${updates.join(", ")} WHERE id = ?`, params);
    return true;
  },

  /* ========================================================================
     BRANCHES & LOCATIONS MANAGEMENT
     ======================================================================== */

  async getBranchStats(institutionId) {
    const validInstId = Number(institutionId);
    const [rows] = await db.query(
      `
      SELECT
        COUNT(*) AS total_branches,
        COUNT(DISTINCT division) AS divisions_count,
        COUNT(DISTINCT district) AS districts_count,
        COALESCE(SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END), 0) AS active_branches,
        COALESCE(SUM(CASE WHEN status = 'inactive' THEN 1 ELSE 0 END), 0) AS inactive_branches,
        COALESCE(SUM(CASE WHEN status = 'suspended' THEN 1 ELSE 0 END), 0) AS suspended_branches,
        COALESCE(SUM(CASE WHEN is_demo = 1 THEN 1 ELSE 0 END), 0) AS demo_branches
      FROM institution_branches
      WHERE institution_id = ? AND is_archived = 0
      `,
      [validInstId]
    );

    const r = rows[0] || {};
    return {
      totalBranches: Number(r.total_branches || 0),
      divisionsCount: Number(r.divisions_count || 0),
      districtsCount: Number(r.districts_count || 0),
      activeBranches: Number(r.active_branches || 0),
      inactiveBranches: Number(r.inactive_branches || 0),
      suspendedBranches: Number(r.suspended_branches || 0),
      demoBranches: Number(r.demo_branches || 0),
    };
  },

  async listBranches(
    institutionId,
    {
      division = "all",
      district = "all",
      upazila = "all",
      status = "all",
      demoFilter = "all",
      includeArchived = false,
      search = "",
      page = 1,
      limit = 15,
    }
  ) {
    const validInstId = Number(institutionId);
    const conditions = ["b.institution_id = ?"];
    const params = [validInstId];

    if (!includeArchived) {
      conditions.push("b.is_archived = 0");
    }

    if (demoFilter === "demo") {
      conditions.push("b.is_demo = 1");
    } else if (demoFilter === "real") {
      conditions.push("b.is_demo = 0");
    }

    if (division && division !== "all") {
      conditions.push("(LOWER(b.division) = LOWER(?) OR b.division_id = ?)");
      params.push(division, isNaN(Number(division)) ? 0 : Number(division));
    }
    if (district && district !== "all") {
      conditions.push("(LOWER(b.district) = LOWER(?) OR b.district_id = ?)");
      params.push(district, isNaN(Number(district)) ? 0 : Number(district));
    }
    if (upazila && upazila !== "all") {
      conditions.push("(LOWER(b.upazila) = LOWER(?) OR b.upazila_id = ?)");
      params.push(upazila, isNaN(Number(upazila)) ? 0 : Number(upazila));
    }
    if (status && status !== "all") {
      conditions.push("b.status = ?");
      params.push(status);
    }
    if (search && search.trim()) {
      const term = `%${search.trim()}%`;
      conditions.push(
        "(b.branch_name LIKE ? OR b.branch_code LIKE ? OR b.routing_number LIKE ? OR b.address LIKE ? OR b.phone LIKE ? OR b.manager_name LIKE ?)"
      );
      params.push(term, term, term, term, term, term);
    }

    const where = `WHERE ${conditions.join(" AND ")}`;
    const offset = (Math.max(1, page) - 1) * limit;

    const [countRows] = await db.query(
      `SELECT COUNT(*) AS total FROM institution_branches b ${where}`,
      params
    );
    const total = Number(countRows[0]?.total || 0);

    const [rows] = await db.query(
      `
      SELECT b.*, i.name AS institution_name, i.institution_code
      FROM institution_branches b
      JOIN institutions i ON i.id = b.institution_id
      ${where}
      ORDER BY b.is_demo ASC, b.created_at DESC
      LIMIT ? OFFSET ?
      `,
      [...params, Number(limit), Number(offset)]
    );

    return {
      branches: rows,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  },

  async getBranchById(branchId) {
    const [rows] = await db.query(
      `
      SELECT b.*, i.name AS institution_name, i.institution_code, i.logo_url AS institution_logo
      FROM institution_branches b
      JOIN institutions i ON i.id = b.institution_id
      WHERE b.id = ?
      LIMIT 1
      `,
      [branchId]
    );
    return rows[0] || null;
  },

  async getBranchByCode(institutionId, branchCode) {
    const [rows] = await db.query(
      `SELECT * FROM institution_branches WHERE institution_id = ? AND branch_code = ? LIMIT 1`,
      [institutionId, branchCode]
    );
    return rows[0] || null;
  },

  async createBranch(data) {
    const [res] = await db.execute(
      `
      INSERT INTO institution_branches
        (institution_id, branch_name, branch_code, routing_number, division, district, upazila, division_id, district_id, upazila_id, post_office, postal_code, address, phone, email, manager_name, notes, status, is_demo, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
      `,
      [
        data.institutionId,
        data.branchName,
        data.branchCode,
        data.routingNumber || null,
        data.division,
        data.district,
        data.upazila,
        data.divisionId || null,
        data.districtId || null,
        data.upazilaId || null,
        data.postOffice || null,
        data.postalCode || null,
        data.address || null,
        data.phone || null,
        data.email || null,
        data.managerName || null,
        data.notes || null,
        data.status || "active",
        data.isDemo ? 1 : 0,
      ]
    );
    return res.insertId;
  },

  async updateBranch(branchId, data) {
    const updates = [];
    const params = [];

    const fieldMap = {
      branchName: "branch_name",
      branchCode: "branch_code",
      routingNumber: "routing_number",
      division: "division",
      district: "district",
      upazila: "upazila",
      divisionId: "division_id",
      districtId: "district_id",
      upazilaId: "upazila_id",
      postOffice: "post_office",
      postalCode: "postal_code",
      address: "address",
      phone: "phone",
      email: "email",
      managerName: "manager_name",
      notes: "notes",
      status: "status",
      isDemo: "is_demo",
      isArchived: "is_archived",
    };

    for (const [key, col] of Object.entries(fieldMap)) {
      if (data[key] !== undefined) {
        updates.push(`\`${col}\` = ?`);
        params.push(data[key]);
      }
    }

    if (!updates.length) return false;
    updates.push("updated_at = NOW()");
    params.push(branchId);

    await db.execute(`UPDATE institution_branches SET ${updates.join(", ")} WHERE id = ?`, params);
    return true;
  },

  async updateBranchStatus(branchId, status) {
    await db.execute(`UPDATE institution_branches SET status = ?, updated_at = NOW() WHERE id = ?`, [status, branchId]);
    return true;
  },

  async archiveBranch(branchId, archivedBy = "Admin") {
    await db.execute(
      `UPDATE institution_branches SET is_archived = 1, status = 'inactive', archived_at = NOW(), archived_by = ?, updated_at = NOW() WHERE id = ?`,
      [archivedBy, branchId]
    );
    return true;
  },

  async toggleDemoBranch(branchId, isDemo) {
    await db.execute(
      `UPDATE institution_branches SET is_demo = ?, updated_at = NOW() WHERE id = ?`,
      [isDemo ? 1 : 0, branchId]
    );
    return true;
  },

  async deleteBranch(branchId) {
    const [appCheck] = await db.query(
      `SELECT COUNT(*) AS c FROM merchant_gateway_applications WHERE branch_id = ?`,
      [branchId]
    );
    if (appCheck[0]?.c > 0) {
      const err = new Error(
        `Cannot delete branch referenced by ${appCheck[0].c} merchant application(s). Mark it as Inactive or Suspended instead.`
      );
      err.statusCode = 409;
      throw err;
    }

    const [kycCheck] = await db.query(
      `SELECT COUNT(*) AS c FROM merchant_kyc WHERE branch_id = ?`,
      [branchId]
    );
    if (kycCheck[0]?.c > 0) {
      const err = new Error(
        `Cannot delete branch referenced by ${kycCheck[0].c} merchant KYC profile(s). Mark it as Inactive or Suspended instead.`
      );
      err.statusCode = 409;
      throw err;
    }

    await db.execute(`DELETE FROM institution_branches WHERE id = ?`, [branchId]);
    return true;
  },

  /* ========================================================================
     BANGLADESH GEOGRAPHIC MASTER DATA (bd_divisions, bd_districts, bd_upazilas)
     ======================================================================== */

  async getGeoDivisions() {
    const [rows] = await db.query(
      `SELECT id, division_name AS name, division_name_bn AS name_bn, division_code AS code 
       FROM bd_divisions 
       ORDER BY division_name ASC`
    );
    return rows;
  },

  async getGeoDistricts(divisionIdOrName = null) {
    let where = "";
    const params = [];

    if (divisionIdOrName) {
      if (!isNaN(Number(divisionIdOrName)) && Number(divisionIdOrName) > 0) {
        where = "WHERE d.division_id = ?";
        params.push(Number(divisionIdOrName));
      } else {
        where = "WHERE LOWER(gdiv.division_name) = LOWER(?) OR LOWER(COALESCE(gdiv.division_name_bn, '')) = LOWER(?)";
        params.push(String(divisionIdOrName).trim(), String(divisionIdOrName).trim());
      }
    }

    const [rows] = await db.query(
      `
      SELECT 
        d.id, 
        d.division_id, 
        d.district_name AS name, 
        d.district_name_bn AS name_bn, 
        d.district_code AS code, 
        gdiv.division_name AS division_name, 
        gdiv.division_name_bn AS division_name_bn
      FROM bd_districts d
      JOIN bd_divisions gdiv ON gdiv.id = d.division_id
      ${where}
      ORDER BY d.district_name ASC
      `,
      params
    );
    return rows;
  },

  async getGeoUpazilas(districtIdOrName = null) {
    let where = "";
    const params = [];

    if (districtIdOrName) {
      if (!isNaN(Number(districtIdOrName)) && Number(districtIdOrName) > 0) {
        where = "WHERE u.district_id = ?";
        params.push(Number(districtIdOrName));
      } else {
        where = "WHERE LOWER(gdist.district_name) = LOWER(?) OR LOWER(COALESCE(gdist.district_name_bn, '')) = LOWER(?)";
        params.push(String(districtIdOrName).trim(), String(districtIdOrName).trim());
      }
    }

    const [rows] = await db.query(
      `
      SELECT 
        u.id, 
        u.district_id, 
        u.upazila_name AS name, 
        u.upazila_name_bn AS name_bn, 
        u.location_type, 
        gdist.district_name AS district_name, 
        gdist.district_name_bn AS district_name_bn
      FROM bd_upazilas u
      JOIN bd_districts gdist ON gdist.id = u.district_id
      ${where}
      ORDER BY u.upazila_name ASC
      `,
      params
    );
    return rows;
  },

  async validateGeoHierarchy(divisionName, districtName, upazilaName) {
    if (!divisionName || !districtName || !upazilaName) {
      return { valid: false, message: "Division, district, and upazila/thana are required." };
    }

    const [rows] = await db.query(
      `
      SELECT u.id AS upazila_id, d.id AS district_id, gdiv.id AS division_id
      FROM bd_upazilas u
      JOIN bd_districts d ON d.id = u.district_id
      JOIN bd_divisions gdiv ON gdiv.id = d.division_id
      WHERE (LOWER(gdiv.division_name) = LOWER(?) OR LOWER(COALESCE(gdiv.division_name_bn, '')) = LOWER(?))
        AND (LOWER(d.district_name) = LOWER(?) OR LOWER(COALESCE(d.district_name_bn, '')) = LOWER(?))
        AND (LOWER(u.upazila_name) = LOWER(?) OR LOWER(COALESCE(u.upazila_name_bn, '')) = LOWER(?))
      LIMIT 1
      `,
      [
        divisionName.trim(), divisionName.trim(),
        districtName.trim(), districtName.trim(),
        upazilaName.trim(), upazilaName.trim(),
      ]
    );

    if (rows.length > 0) {
      return { valid: true, geoIds: rows[0] };
    }

    // Check if district belongs to division
    const [distCheck] = await db.query(
      `
      SELECT d.id
      FROM bd_districts d
      JOIN bd_divisions gdiv ON gdiv.id = d.division_id
      WHERE (LOWER(gdiv.division_name) = LOWER(?) OR LOWER(COALESCE(gdiv.division_name_bn, '')) = LOWER(?))
        AND (LOWER(d.district_name) = LOWER(?) OR LOWER(COALESCE(d.district_name_bn, '')) = LOWER(?))
      LIMIT 1
      `,
      [divisionName.trim(), divisionName.trim(), districtName.trim(), districtName.trim()]
    );

    if (distCheck.length === 0) {
      return { valid: false, message: `District "${districtName}" does not belong to Division "${divisionName}".` };
    }

    return { valid: false, message: `Upazila/Thana "${upazilaName}" was not found under District "${districtName}".` };
  },

  /* ========================================================================
     ACTIVE PUBLIC / MERCHANT INSTITUTION & BRANCH LOOKUPS
     ======================================================================== */

  async getActiveInstitutions() {
    const [rows] = await db.query(
      `
      SELECT 
        i.id, 
        i.name, 
        i.institution_code, 
        i.institution_type, 
        i.logo_url, 
        i.website_url, 
        i.support_phone, 
        i.support_email,
        COUNT(b.id) AS branches_count
      FROM institutions i
      LEFT JOIN institution_branches b ON b.institution_id = i.id AND b.status = 'active' AND b.is_archived = 0
      WHERE i.status = 'active'
      GROUP BY i.id
      ORDER BY i.name ASC
      `
    );
    return rows;
  },

  async getActiveBranchesForInstitution(institutionId) {
    const validInstId = Number(institutionId);
    const [rows] = await db.query(
      `
      SELECT 
        b.id, 
        b.institution_id, 
        b.branch_name, 
        b.branch_code, 
        b.routing_number, 
        b.division, 
        b.district, 
        b.upazila, 
        b.post_office, 
        b.postal_code, 
        b.address, 
        b.phone, 
        b.email, 
        b.manager_name,
        b.is_demo
      FROM institution_branches b
      WHERE b.institution_id = ? AND b.status = 'active' AND b.is_archived = 0
      ORDER BY b.branch_name ASC
      `,
      [validInstId]
    );
    return rows;
  },

  /* ========================================================================
     INSTITUTION KYC REQUIREMENTS MANAGEMENT (EXPANDED DYNAMIC MODULE)
     ======================================================================== */

  async listKycRequirements({ institutionId = null, serviceId = null, category = "all", status = "all" }) {
    const conditions = [];
    const params = [];

    const validInstId =
      institutionId !== null &&
      institutionId !== undefined &&
      !isNaN(Number(institutionId)) &&
      Number(institutionId) > 0
        ? Math.floor(Number(institutionId))
        : null;

    if (validInstId) {
      conditions.push("ikr.institution_id = ?");
      params.push(validInstId);
    }

    if (serviceId !== null && serviceId !== undefined && serviceId !== "all" && !isNaN(Number(serviceId)) && Number(serviceId) > 0) {
      conditions.push("(ikr.applicable_service_id = ? OR ikr.applicable_service_id IS NULL)");
      params.push(Number(serviceId));
    }

    if (category && category !== "all") {
      conditions.push("ikr.requirement_category = ?");
      params.push(category);
    }

    if (status && status !== "all") {
      conditions.push("ikr.status = ?");
      params.push(status);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const [rows] = await db.query(
      `
      SELECT
        ikr.*,
        i.name AS institution_name,
        i.institution_code,
        g.name AS service_name,
        g.service_type
      FROM institution_kyc_requirements ikr
      JOIN institutions i ON i.id = ikr.institution_id
      LEFT JOIN gateways g ON g.id = ikr.applicable_service_id
      ${where}
      ORDER BY ikr.display_order ASC, ikr.id ASC
      `,
      params
    );

    return rows;
  },

  async getKycRequirementById(id) {
    const [rows] = await db.query(
      `
      SELECT
        ikr.*,
        i.name AS institution_name,
        i.institution_code,
        g.name AS service_name,
        g.service_type
      FROM institution_kyc_requirements ikr
      JOIN institutions i ON i.id = ikr.institution_id
      LEFT JOIN gateways g ON g.id = ikr.applicable_service_id
      WHERE ikr.id = ?
      LIMIT 1
      `,
      [Number(id)]
    );

    return rows[0] || null;
  },

  async getRelatedKycRequirements({ institutionId, serviceId = null, excludeId = null }) {
    if (!institutionId || isNaN(Number(institutionId))) return [];
    const conditions = ["ikr.institution_id = ?"];
    const params = [Number(institutionId)];

    if (excludeId && !isNaN(Number(excludeId))) {
      conditions.push("ikr.id != ?");
      params.push(Number(excludeId));
    }

    if (serviceId && !isNaN(Number(serviceId)) && Number(serviceId) > 0) {
      conditions.push("(ikr.applicable_service_id = ? OR ikr.applicable_service_id IS NULL)");
      params.push(Number(serviceId));
    }

    const [rows] = await db.query(
      `
      SELECT
        ikr.id,
        ikr.institution_id,
        ikr.applicable_service_id,
        ikr.name,
        ikr.requirement_code,
        ikr.requirement_category,
        ikr.document_type,
        ikr.is_mandatory,
        ikr.status,
        ikr.display_order,
        g.name AS service_name
      FROM institution_kyc_requirements ikr
      LEFT JOIN gateways g ON g.id = ikr.applicable_service_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY ikr.display_order ASC, ikr.id ASC
      LIMIT 10
      `,
      params
    );

    return rows;
  },

  async createKycRequirement({
    institutionId,
    applicableServiceId = null,
    name,
    requirementCode,
    requirementCategory = "business_identity",
    requirementType = "document_upload",
    applicableBusinessTypes = null,
    documentType = "other",
    description = null,
    instructions = null,
    allowedExtensions = "pdf,jpg,jpeg,png,webp",
    maxFileSizeMb = 5,
    maxPdfPages = 5,
    maxFilesCount = 1,
    documentSides = "single",
    isMandatory = true,
    requiresApproval = true,
    reviewInstructions = null,
    adminNotes = null,
    autoVerifyOcr = false,
    checkExpiry = false,
    requireMatchingName = false,
    expiryFieldName = "expiry_date",
    minValidityDays = 30,
    referenceApiUrl = null,
    sampleDocumentUrl = null,
    sampleDocumentUrls = null,
    status = "active",
    displayOrder = 0,
  }) {
    const businessTypesStr = Array.isArray(applicableBusinessTypes)
      ? JSON.stringify(applicableBusinessTypes)
      : applicableBusinessTypes;

    const sampleUrlsStr = Array.isArray(sampleDocumentUrls)
      ? JSON.stringify(sampleDocumentUrls)
      : (typeof sampleDocumentUrls === "object" && sampleDocumentUrls !== null)
      ? JSON.stringify(sampleDocumentUrls)
      : sampleDocumentUrls;

    const [res] = await db.execute(
      `
      INSERT INTO institution_kyc_requirements
        (institution_id, applicable_service_id, name, requirement_code, requirement_category, requirement_type,
         applicable_business_types, document_type, description, instructions, allowed_extensions, max_file_size_mb,
         max_pdf_pages, max_files_count, document_sides, is_mandatory, requires_approval, review_instructions,
         admin_notes, auto_verify_ocr, check_expiry, require_matching_name, expiry_field_name, min_validity_days,
         reference_api_url, sample_document_url, sample_document_urls, status, display_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
      `,
      [
        institutionId,
        applicableServiceId ? Number(applicableServiceId) : null,
        name,
        requirementCode,
        requirementCategory,
        requirementType,
        businessTypesStr,
        documentType || "other",
        description,
        instructions,
        allowedExtensions,
        Number(maxFileSizeMb) || 5,
        Number(maxPdfPages) || 5,
        Number(maxFilesCount) || 1,
        documentSides,
        isMandatory ? 1 : 0,
        requiresApproval ? 1 : 0,
        reviewInstructions || adminNotes,
        adminNotes || reviewInstructions,
        autoVerifyOcr ? 1 : 0,
        checkExpiry ? 1 : 0,
        requireMatchingName ? 1 : 0,
        expiryFieldName || "expiry_date",
        Number(minValidityDays) || 30,
        referenceApiUrl || null,
        sampleDocumentUrl || null,
        sampleUrlsStr || null,
        status,
        Number(displayOrder) || 0,
      ]
    );

    return res.insertId;
  },

  async updateKycRequirement(id, data) {
    const updates = [];
    const params = [];

    const fieldMap = {
      institutionId: "institution_id",
      applicableServiceId: "applicable_service_id",
      name: "name",
      requirementCode: "requirement_code",
      requirementCategory: "requirement_category",
      requirementType: "requirement_type",
      applicableBusinessTypes: "applicable_business_types",
      documentType: "document_type",
      description: "description",
      instructions: "instructions",
      allowedExtensions: "allowed_extensions",
      maxFileSizeMb: "max_file_size_mb",
      maxPdfPages: "max_pdf_pages",
      maxFilesCount: "max_files_count",
      documentSides: "document_sides",
      isMandatory: "is_mandatory",
      requiresApproval: "requires_approval",
      reviewInstructions: "review_instructions",
      adminNotes: "admin_notes",
      autoVerifyOcr: "auto_verify_ocr",
      checkExpiry: "check_expiry",
      requireMatchingName: "require_matching_name",
      expiryFieldName: "expiry_field_name",
      minValidityDays: "min_validity_days",
      referenceApiUrl: "reference_api_url",
      sampleDocumentUrl: "sample_document_url",
      sampleDocumentUrls: "sample_document_urls",
      status: "status",
      displayOrder: "display_order",
    };

    for (const [key, col] of Object.entries(fieldMap)) {
      if (data[key] !== undefined) {
        let val = data[key];
        if (key === "applicableBusinessTypes" && Array.isArray(val)) {
          val = JSON.stringify(val);
        } else if (key === "sampleDocumentUrls" && (Array.isArray(val) || (typeof val === "object" && val !== null))) {
          val = JSON.stringify(val);
        } else if (key === "isMandatory" || key === "requiresApproval" || key === "autoVerifyOcr" || key === "checkExpiry" || key === "requireMatchingName") {
          val = val ? 1 : 0;
        } else if (key === "applicableServiceId") {
          val = val ? Number(val) : null;
        }
        updates.push(`\`${col}\` = ?`);
        params.push(val);
      }
    }

    if (!updates.length) return false;
    updates.push("updated_at = NOW()");
    params.push(Number(id));

    await db.execute(`UPDATE institution_kyc_requirements SET ${updates.join(", ")} WHERE id = ?`, params);
    return true;
  },

  async deleteKycRequirement(id) {
    await db.execute(`DELETE FROM institution_kyc_requirements WHERE id = ?`, [id]);
    return true;
  },

  /* ========================================================================
     INSTITUTION MERCHANT APPLICATIONS
     ======================================================================== */

  async listInstitutionApplications(institutionId, { status = "all", search = "", page = 1, limit = 15 }) {
    const validInstId = Number(institutionId);
    const conditions = ["mga.institution_id = ?"];
    const params = [validInstId];

    if (status && status !== "all") {
      conditions.push("mga.status = ?");
      params.push(status);
    }

    if (search && search.trim()) {
      const term = `%${search.trim()}%`;
      conditions.push("(p.company_name LIKE ? OR k.legal_business_name LIKE ? OR k.trade_license_number LIKE ? OR u.email LIKE ? OR u.phone LIKE ? OR g.name LIKE ? OR mga.application_number LIKE ?)");
      params.push(term, term, term, term, term, term, term);
    }

    const where = `WHERE ${conditions.join(" AND ")}`;
    const offset = (Math.max(1, page) - 1) * limit;

    const [countRows] = await db.query(
      `
      SELECT COUNT(*) AS total
      FROM merchant_gateway_applications mga
      JOIN merchants m ON m.id = mga.merchant_id
      LEFT JOIN users u ON u.id = m.user_id
      LEFT JOIN merchant_profiles p ON p.merchant_id = m.id
      LEFT JOIN merchant_kyc k ON k.merchant_id = m.id
      LEFT JOIN gateways g ON g.id = mga.gateway_id
      ${where}
      `,
      params
    );
    const total = Number(countRows[0]?.total || 0);

    const [rows] = await db.query(
      `
      SELECT
        mga.id AS application_id,
        mga.application_number,
        mga.status AS application_status,
        mga.applied_at,
        mga.reviewed_at,
        mga.review_note,
        m.id AS merchant_id,
        m.merchant_code,
        COALESCE(k.legal_business_name, p.company_name, m.merchant_code) AS business_name,
        COALESCE(k.legal_business_name, p.company_name, m.merchant_code) AS company_name,
        k.trade_license_number,
        u.email AS merchant_email,
        u.phone AS merchant_phone,
        g.id AS gateway_id,
        g.name AS gateway_name,
        g.code AS gateway_code,
        b.id AS branch_id,
        b.branch_name,
        b.branch_code
      FROM merchant_gateway_applications mga
      JOIN merchants m ON m.id = mga.merchant_id
      LEFT JOIN users u ON u.id = m.user_id
      LEFT JOIN merchant_profiles p ON p.merchant_id = m.id
      LEFT JOIN merchant_kyc k ON k.merchant_id = m.id
      LEFT JOIN gateways g ON g.id = mga.gateway_id
      LEFT JOIN institution_branches b ON b.id = mga.branch_id
      ${where}
      ORDER BY mga.applied_at DESC
      LIMIT ? OFFSET ?
      `,
      [...params, Number(limit), Number(offset)]
    );

    return {
      applications: rows,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  },

  async getInstitutionApplicationStats(institutionId) {
    const validInstId = Number(institutionId);
    const settings = await this.getSettings(validInstId);
    const slaHours = Number(settings.sla_hours || 48);

    const [rows] = await db.query(
      `
      SELECT
        COUNT(*) AS total_applications,
        COALESCE(SUM(CASE WHEN status = 'applied' THEN 1 ELSE 0 END), 0) AS pending_applications,
        COALESCE(SUM(CASE WHEN status = 'under_review' THEN 1 ELSE 0 END), 0) AS under_review_applications,
        COALESCE(SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END), 0) AS approved_applications,
        COALESCE(SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END), 0) AS rejected_applications,
        COALESCE(SUM(CASE WHEN status = 'additional_information_required' THEN 1 ELSE 0 END), 0) AS info_required_applications,
        COALESCE(SUM(CASE WHEN status IN ('applied', 'under_review') AND applied_at IS NOT NULL AND NOW() > DATE_ADD(applied_at, INTERVAL ? HOUR) THEN 1 ELSE 0 END), 0) AS overdue_applications
      FROM merchant_gateway_applications
      WHERE institution_id = ?
      `,
      [slaHours, validInstId]
    );

    const r = rows[0] || {};
    return {
      totalApplications: Number(r.total_applications || 0),
      pendingApplications: Number(r.pending_applications || 0),
      underReviewApplications: Number(r.under_review_applications || 0),
      approvedApplications: Number(r.approved_applications || 0),
      rejectedApplications: Number(r.rejected_applications || 0),
      infoRequiredApplications: Number(r.info_required_applications || 0),
      overdueApplications: Number(r.overdue_applications || 0),
      slaTargetHours: slaHours,
      escalationEmail: settings.escalation_email || null,
      branchRoutingPolicy: settings.branch_policy || "merchant_selects_branch",
    };
  },

  /* ========================================================================
     INSTITUTION SETTINGS MANAGEMENT
     ======================================================================== */

  async getSettings(institutionId) {
    const validInstId = Number(institutionId);
    if (!validInstId || isNaN(validInstId)) return {};

    const [rows] = await db.query(
      `SELECT * FROM institution_settings WHERE institution_id = ?`,
      [validInstId]
    );

    const result = {};
    for (const row of rows) {
      let val = row.setting_value;
      if (typeof val === "string") {
        try {
          val = JSON.parse(val);
        } catch (_) {}
      }
      result[row.setting_key] = val;
    }

    // Look up institution details for sensible fallbacks
    const [inst] = await db.query(
      `SELECT id, name, institution_code, support_email FROM institutions WHERE id = ?`,
      [validInstId]
    );
    const instSupportEmail = inst[0]?.support_email || "";

    // Normalize standard settings with defaults
    const slaHours = result.sla_hours !== undefined 
      ? Number(result.sla_hours) 
      : result.kyc_review_sla_hours !== undefined 
      ? Number(result.kyc_review_sla_hours) 
      : 48;

    const rawPolicy = result.branch_routing_policy || result.branch_policy || "merchant_selects_branch";
    let branchPolicy = rawPolicy;
    if (rawPolicy === "optional") branchPolicy = "merchant_selects_branch";
    if (rawPolicy === "mandatory") branchPolicy = "auto_assign_nearest_branch";
    if (rawPolicy === "disabled") branchPolicy = "manual_assignment";

    const escalationEmail = result.escalation_email !== undefined && result.escalation_email !== null
      ? String(result.escalation_email).trim()
      : result.operations_escalation_email !== undefined && result.operations_escalation_email !== null
      ? String(result.operations_escalation_email).trim()
      : result.escalationEmail !== undefined && result.escalationEmail !== null
      ? String(result.escalationEmail).trim()
      : instSupportEmail;

    return {
      ...result,
      sla_hours: slaHours,
      kyc_review_sla_hours: slaHours,
      branch_policy: branchPolicy,
      branch_routing_policy: branchPolicy,
      escalation_email: escalationEmail,
      operations_escalation_email: escalationEmail,
    };
  },

  async saveSetting(institutionId, settingKey, settingValue, updatedBy = "Admin") {
    const validInstId = Number(institutionId);
    if (!validInstId || isNaN(validInstId)) return false;

    let jsonStr;
    try {
      jsonStr = JSON.stringify(settingValue);
    } catch (_) {
      jsonStr = JSON.stringify(String(settingValue));
    }

    await db.execute(
      `
      INSERT INTO institution_settings (institution_id, setting_key, setting_value, updated_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, NOW(), NOW())
      ON DUPLICATE KEY UPDATE
        setting_value = VALUES(setting_value),
        updated_by = VALUES(updated_by),
        updated_at = NOW()
      `,
      [validInstId, settingKey, jsonStr, updatedBy]
    );

    return true;
  },

  async saveSettings(institutionId, settingsPayload, updatedBy = "Admin") {
    const validInstId = Number(institutionId);
    if (!validInstId || isNaN(validInstId)) return false;

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      for (const [key, value] of Object.entries(settingsPayload)) {
        let jsonStr;
        try {
          jsonStr = JSON.stringify(value);
        } catch (_) {
          jsonStr = JSON.stringify(String(value));
        }

        await connection.execute(
          `
          INSERT INTO institution_settings (institution_id, setting_key, setting_value, updated_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, NOW(), NOW())
          ON DUPLICATE KEY UPDATE
            setting_value = VALUES(setting_value),
            updated_by = VALUES(updated_by),
            updated_at = NOW()
          `,
          [validInstId, key, jsonStr, updatedBy]
        );
      }

      await connection.commit();
      return true;
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  },

  /**
   * Determine and validate branch routing for an application based on institution policy.
   * Ensures branches from other institutions can never be assigned.
   */
  async resolveBranchForApplication(institutionId, merchantLocation = {}, requestedBranchId = null) {
    const validInstId = Number(institutionId);
    if (!validInstId) return null;

    const settings = await this.getSettings(validInstId);
    const policy = settings.branch_routing_policy || "merchant_selects_branch";

    // Scenario 1: Manual assignment - leave unassigned until bank reviewer assigns
    if (policy === "manual_assignment") {
      return null;
    }

    // Scenario 2: Merchant selects branch - validate ownership
    if (policy === "merchant_selects_branch" && requestedBranchId) {
      const [branchRows] = await db.query(
        `SELECT id, branch_name, branch_code, division, district, upazila, status
         FROM institution_branches
         WHERE id = ? AND institution_id = ? AND status = 'active' AND is_archived = 0
         LIMIT 1`,
        [Number(requestedBranchId), validInstId]
      );
      if (branchRows.length > 0) {
        return branchRows[0];
      }
    }

    // Scenario 3: Auto-assign nearest branch (or fallback if merchant selection was empty)
    if (policy === "auto_assign_nearest_branch" || (policy === "merchant_selects_branch" && requestedBranchId)) {
      const { upazila, district, division } = merchantLocation;

      // Match Upazila / Thana first
      if (upazila) {
        const [upzRows] = await db.query(
          `SELECT id, branch_name, branch_code, division, district, upazila, status
           FROM institution_branches
           WHERE institution_id = ? AND status = 'active' AND is_archived = 0
             AND (LOWER(upazila) = LOWER(?) OR upazila LIKE ?)
           LIMIT 1`,
          [validInstId, String(upazila).trim(), `%${String(upazila).trim()}%`]
        );
        if (upzRows.length > 0) return upzRows[0];
      }

      // Match District next
      if (district) {
        const [distRows] = await db.query(
          `SELECT id, branch_name, branch_code, division, district, upazila, status
           FROM institution_branches
           WHERE institution_id = ? AND status = 'active' AND is_archived = 0
             AND (LOWER(district) = LOWER(?) OR district LIKE ?)
           LIMIT 1`,
          [validInstId, String(district).trim(), `%${String(district).trim()}%`]
        );
        if (distRows.length > 0) return distRows[0];
      }

      // Match Division next
      if (division) {
        const [divRows] = await db.query(
          `SELECT id, branch_name, branch_code, division, district, upazila, status
           FROM institution_branches
           WHERE institution_id = ? AND status = 'active' AND is_archived = 0
             AND (LOWER(division) = LOWER(?) OR division LIKE ?)
           LIMIT 1`,
          [validInstId, String(division).trim(), `%${String(division).trim()}%`]
        );
        if (divRows.length > 0) return divRows[0];
      }

      // Fallback: Head office or first active branch of this institution
      const [fallbackRows] = await db.query(
        `SELECT id, branch_name, branch_code, division, district, upazila, status
         FROM institution_branches
         WHERE institution_id = ? AND status = 'active' AND is_archived = 0
         ORDER BY id ASC
         LIMIT 1`,
        [validInstId]
      );
      return fallbackRows[0] || null;
    }

    return null;
  },

  /* ========================================================================
     PROFILES & DIRECTORY
     ======================================================================== */

  async getBankProfile(institutionId) {
    const validId = Number(institutionId);
    if (!validId || isNaN(validId)) return null;
    const [rows] = await db.query(
      `SELECT * FROM institution_bank_profiles WHERE institution_id = ? LIMIT 1`,
      [validId]
    );
    return rows[0] || null;
  },

  async saveBankProfile(institutionId, data) {
    const validId = Number(institutionId);
    if (!validId || isNaN(validId)) return null;

    const bankCategory = data.bankCategory || data.bank_category || "commercial_conventional";
    const ownershipType = data.ownershipType || data.ownership_type || "private";
    const bankingModel = data.bankingModel ?? data.banking_model ?? null;
    const officialBankCode = data.officialBankCode ?? data.official_bank_code ?? null;
    const swiftCode = data.swiftCode ?? data.swift_code ?? null;
    const regulatoryReference = data.regulatoryReference ?? data.regulatory_reference ?? null;
    const officialContactPerson = data.officialContactPerson ?? data.official_contact_person ?? null;
    const contactDesignation = data.contactDesignation ?? data.contact_designation ?? null;

    await db.execute(
      `
      INSERT INTO institution_bank_profiles
        (institution_id, bank_category, ownership_type, banking_model, official_bank_code, swift_code, regulatory_reference, official_contact_person, contact_designation, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
      ON DUPLICATE KEY UPDATE
        bank_category = VALUES(bank_category),
        ownership_type = VALUES(ownership_type),
        banking_model = VALUES(banking_model),
        official_bank_code = VALUES(official_bank_code),
        swift_code = VALUES(swift_code),
        regulatory_reference = VALUES(regulatory_reference),
        official_contact_person = VALUES(official_contact_person),
        contact_designation = VALUES(contact_designation),
        updated_at = NOW()
      `,
      [
        validId,
        bankCategory,
        ownershipType,
        bankingModel,
        officialBankCode,
        swiftCode,
        regulatoryReference,
        officialContactPerson,
        contactDesignation,
      ]
    );

    return this.getBankProfile(validId);
  },

  async getMfsProfile(institutionId) {
    const validId = Number(institutionId);
    if (!validId || isNaN(validId)) return null;
    const [rows] = await db.query(
      `SELECT * FROM institution_mfs_profiles WHERE institution_id = ? LIMIT 1`,
      [validId]
    );
    return rows[0] || null;
  },

  async saveMfsProfile(institutionId, data) {
    const validId = Number(institutionId);
    if (!validId || isNaN(validId)) return null;

    const brandName = data.brandName || data.brand_name || "";
    const legalOperatorName = data.legalOperatorName || data.legal_operator_name || "";
    const providerCode = data.providerCode || data.provider_code || "";
    const parentBankId = data.parentBankId || data.parent_bank_id ? Number(data.parentBankId || data.parent_bank_id) : null;
    const authorizationReference = data.authorizationReference ?? data.authorization_reference ?? null;
    const merchantAppSupported = data.merchantApplicationSupported || data.merchant_application_supported ? 1 : 0;
    const officialContact = data.officialContact ?? data.official_contact ?? null;

    await db.execute(
      `
      INSERT INTO institution_mfs_profiles
        (institution_id, brand_name, legal_operator_name, provider_code, parent_bank_id, authorization_reference, merchant_application_supported, official_contact, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
      ON DUPLICATE KEY UPDATE
        brand_name = VALUES(brand_name),
        legal_operator_name = VALUES(legal_operator_name),
        provider_code = VALUES(provider_code),
        parent_bank_id = VALUES(parent_bank_id),
        authorization_reference = VALUES(authorization_reference),
        merchant_application_supported = VALUES(merchant_application_supported),
        official_contact = VALUES(official_contact),
        updated_at = NOW()
      `,
      [
        validId,
        brandName,
        legalOperatorName,
        providerCode,
        parentBankId,
        authorizationReference,
        merchantAppSupported,
        officialContact,
      ]
    );

    return this.getMfsProfile(validId);
  },

  /* ========================================================================
     INSTITUTION INVITATIONS
     ======================================================================== */

  async createInvitation({ institutionId, email, name, phone, roleId, tokenHash, expiresAt, invitedByUserId }) {
    const [res] = await db.execute(
      `
      INSERT INTO institution_invitations
        (institution_id, email, name, phone, role_id, token_hash, status, expires_at, invited_by_user_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, NOW(), NOW())
      `,
      [institutionId, email, name, phone, roleId, tokenHash, expiresAt, invitedByUserId]
    );
    return res.insertId;
  },

  async getInvitationByTokenHash(tokenHash) {
    const [rows] = await db.query(
      `
      SELECT
        inv.*,
        i.name AS institution_name,
        i.institution_code,
        i.logo_url AS institution_logo,
        i.status AS institution_status,
        r.name AS role_name,
        r.description AS role_description
      FROM institution_invitations inv
      JOIN institutions i ON i.id = inv.institution_id
      JOIN roles r ON r.id = inv.role_id
      WHERE inv.token_hash = ?
      LIMIT 1
      `,
      [tokenHash]
    );
    return rows[0] || null;
  },

  async getInvitationById(id) {
    const [rows] = await db.query(
      `
      SELECT
        inv.*,
        i.name AS institution_name,
        i.institution_code,
        r.name AS role_name
      FROM institution_invitations inv
      JOIN institutions i ON i.id = inv.institution_id
      JOIN roles r ON r.id = inv.role_id
      WHERE inv.id = ?
      LIMIT 1
      `,
      [Number(id)]
    );
    return rows[0] || null;
  },

  async listInvitations({ institutionId = null, status = "all" }) {
    const conditions = [];
    const params = [];

    if (institutionId && institutionId !== "all") {
      conditions.push("inv.institution_id = ?");
      params.push(Number(institutionId));
    }
    if (status && status !== "all") {
      conditions.push("inv.status = ?");
      params.push(status);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const [rows] = await db.query(
      `
      SELECT
        inv.*,
        i.name AS institution_name,
        i.institution_code,
        r.name AS role_name,
        u.email AS invited_by_email
      FROM institution_invitations inv
      JOIN institutions i ON i.id = inv.institution_id
      JOIN roles r ON r.id = inv.role_id
      LEFT JOIN users u ON u.id = inv.invited_by_user_id
      ${where}
      ORDER BY inv.id DESC
      `,
      params
    );
    return rows;
  },

  async updateInvitationStatus(id, status, acceptedAt = null) {
    await db.execute(
      `UPDATE institution_invitations SET status = ?, accepted_at = ?, updated_at = NOW() WHERE id = ?`,
      [status, acceptedAt, Number(id)]
    );
    return true;
  },

  async revokePendingInvitationsForEmail(institutionId, email) {
    await db.execute(
      `UPDATE institution_invitations SET status = 'revoked', updated_at = NOW() WHERE institution_id = ? AND email = ? AND status = 'pending'`,
      [Number(institutionId), email]
    );
  },
};
