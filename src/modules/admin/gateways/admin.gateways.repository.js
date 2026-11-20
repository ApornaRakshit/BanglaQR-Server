import { db } from "../../../config/db.js";

export const adminGatewaysRepository = {
  async getGatewayStats() {
    const [counts] = await db.execute(`
      SELECT 
        COUNT(*) AS totalGateways,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS activeGateways,
        SUM(CASE WHEN status = 'inactive' THEN 1 ELSE 0 END) AS inactiveGateways,
        SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) AS draftGateways
      FROM gateways
    `);

    const [appCounts] = await db.execute(`
      SELECT 
        COUNT(*) AS totalApplications,
        SUM(CASE WHEN status = 'applied' OR status = 'under_review' THEN 1 ELSE 0 END) AS pendingApplications,
        SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) AS approvedApplications,
        SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejectedApplications
      FROM merchant_gateway_applications
    `);

    const [serviceCounts] = await db.execute(`
      SELECT 
        COUNT(*) AS totalServices,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS activeServices,
        SUM(CASE WHEN status = 'suspended' THEN 1 ELSE 0 END) AS suspendedServices
      FROM merchant_gateway_services
    `);

    const g = counts[0] || {};
    const a = appCounts[0] || {};
    const s = serviceCounts[0] || {};

    return {
      totalGateways: Number(g.totalGateways || 0),
      activeGateways: Number(g.activeGateways || 0),
      inactiveGateways: Number(g.inactiveGateways || 0),
      draftGateways: Number(g.draftGateways || 0),
      publishedGateways: Number(g.activeGateways || 0),
      gatewayApplications: Number(a.totalApplications || 0),
      pendingApplications: Number(a.pendingApplications || 0),
      approvedApplications: Number(a.approvedApplications || 0),
      rejectedApplications: Number(a.rejectedApplications || 0),
      provisionedServices: Number(s.activeServices || 0),
      totalServices: Number(s.totalServices || 0),
    };
  },

  async listGateways({ search = "", status = "" } = {}) {
    const conditions = [];
    const params = [];

    if (search) {
      conditions.push("(name LIKE ? OR code LIKE ? OR description LIKE ? OR service_type LIKE ?)");
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }

    if (status && status !== "all") {
      conditions.push("status = ?");
      params.push(status);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const [rows] = await db.execute(
      `SELECT * FROM gateways ${whereClause} ORDER BY created_at DESC`,
      params
    );

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      code: r.code,
      logoUrl: r.logo_url,
      description: r.description,
      shortDescription: r.short_description,
      category: r.category || "gateway",
      isPublished: Boolean(r.is_published ?? 1),
      acceptsApplications: Boolean(r.accepts_applications ?? 1),
      displayOrder: Number(r.display_order || 0),
      eligibility: r.eligibility,
      supportedMethods: typeof r.supported_methods === "string" ? JSON.parse(r.supported_methods) : (r.supported_methods || []),
      serviceType: r.service_type,
      qrSupported: Boolean(r.qr_supported),
      cardSupported: Boolean(r.card_supported),
      mobileSupported: Boolean(r.mobile_supported),
      apiSupported: Boolean(r.api_supported),
      requiredDocuments: typeof r.required_documents === "string" ? JSON.parse(r.required_documents) : (r.required_documents || []),
      serviceFee: Number(r.service_fee),
      setupFee: Number(r.setup_fee),
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  },

  async getGatewayById(id) {
    const [rows] = await db.execute("SELECT * FROM gateways WHERE id = ? LIMIT 1", [id]);
    if (!rows.length) return null;
    const r = rows[0];
    return {
      id: r.id,
      name: r.name,
      code: r.code,
      logoUrl: r.logo_url,
      description: r.description,
      shortDescription: r.short_description,
      category: r.category || "gateway",
      isPublished: Boolean(r.is_published ?? 1),
      acceptsApplications: Boolean(r.accepts_applications ?? 1),
      displayOrder: Number(r.display_order || 0),
      eligibility: r.eligibility,
      supportedMethods: typeof r.supported_methods === "string" ? JSON.parse(r.supported_methods) : (r.supported_methods || []),
      serviceType: r.service_type,
      qrSupported: Boolean(r.qr_supported),
      cardSupported: Boolean(r.card_supported),
      mobileSupported: Boolean(r.mobile_supported),
      apiSupported: Boolean(r.api_supported),
      requiredDocuments: typeof r.required_documents === "string" ? JSON.parse(r.required_documents) : (r.required_documents || []),
      serviceFee: Number(r.service_fee),
      setupFee: Number(r.setup_fee),
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  },

  async createGateway(data) {
    const [res] = await db.execute(
      `INSERT INTO gateways (name, code, logo_url, description, short_description, category, is_published, accepts_applications, display_order, eligibility, supported_methods, service_type, qr_supported, card_supported, mobile_supported, api_supported, required_documents, service_fee, setup_fee, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.name,
        data.code,
        data.logoUrl || null,
        data.description || null,
        data.shortDescription || null,
        data.category || "gateway",
        data.isPublished !== undefined ? (data.isPublished ? 1 : 0) : 1,
        data.acceptsApplications !== undefined ? (data.acceptsApplications ? 1 : 0) : 1,
        data.displayOrder || 0,
        data.eligibility || null,
        JSON.stringify(data.supportedMethods || []),
        data.serviceType || "Payment Gateway",
        data.qrSupported ? 1 : 0,
        data.cardSupported ? 1 : 0,
        data.mobileSupported ? 1 : 0,
        data.apiSupported ? 1 : 0,
        JSON.stringify(data.requiredDocuments || []),
        data.serviceFee || 1.5,
        data.setupFee || 0,
        data.status || "active",
      ]
    );
    return res.insertId;
  },

  async updateGateway(id, data) {
    await db.execute(
      `UPDATE gateways SET
        name = ?, code = ?, logo_url = ?, description = ?, short_description = ?, category = ?,
        is_published = ?, accepts_applications = ?, display_order = ?, eligibility = ?,
        supported_methods = ?, service_type = ?, qr_supported = ?, card_supported = ?, mobile_supported = ?,
        api_supported = ?, required_documents = ?, service_fee = ?, setup_fee = ?, status = ?, updated_at = NOW()
       WHERE id = ?`,
      [
        data.name,
        data.code,
        data.logoUrl || null,
        data.description || null,
        data.shortDescription || null,
        data.category || "gateway",
        data.isPublished !== undefined ? (data.isPublished ? 1 : 0) : 1,
        data.acceptsApplications !== undefined ? (data.acceptsApplications ? 1 : 0) : 1,
        data.displayOrder || 0,
        data.eligibility || null,
        JSON.stringify(data.supportedMethods || []),
        data.serviceType || "Payment Gateway",
        data.qrSupported ? 1 : 0,
        data.cardSupported ? 1 : 0,
        data.mobileSupported ? 1 : 0,
        data.apiSupported ? 1 : 0,
        JSON.stringify(data.requiredDocuments || []),
        data.serviceFee || 1.5,
        data.setupFee || 0,
        data.status || "active",
        id,
      ]
    );
  },

  async updateGatewayStatus(id, status) {
    await db.execute("UPDATE gateways SET status = ?, updated_at = NOW() WHERE id = ?", [status, id]);
  },

  async updateGatewayPublish(id, isPublished, acceptsApplications) {
    const sets = ["updated_at = NOW()"];
    const params = [];
    if (isPublished !== undefined) {
      sets.push("is_published = ?");
      params.push(isPublished ? 1 : 0);
    }
    if (acceptsApplications !== undefined) {
      sets.push("accepts_applications = ?");
      params.push(acceptsApplications ? 1 : 0);
    }
    params.push(id);
    await db.execute(`UPDATE gateways SET ${sets.join(", ")} WHERE id = ?`, params);
  },

  async deleteGateway(id) {
    const [gwRows] = await db.execute("SELECT * FROM gateways WHERE id = ? LIMIT 1", [id]);
    if (gwRows.length === 0) {
      const err = new Error("Gateway not found");
      err.statusCode = 404;
      throw err;
    }
    const gw = gwRows[0];

    // Snapshot dependent applications and preserve history
    await db.execute(
      `UPDATE merchant_gateway_applications 
       SET gateway_name = COALESCE(gateway_name, ?),
           gateway_code = COALESCE(gateway_code, ?),
           logo_url = COALESCE(logo_url, ?),
           service_type = COALESCE(service_type, ?),
           service_fee = COALESCE(service_fee, ?),
           gateway_id = NULL
       WHERE gateway_id = ?`,
      [gw.name, gw.code, gw.logo_url, gw.service_type, gw.service_fee, id]
    );

    // Snapshot dependent services and preserve history
    await db.execute(
      `UPDATE merchant_gateway_services 
       SET gateway_name = COALESCE(gateway_name, ?),
           gateway_code = COALESCE(gateway_code, ?),
           logo_url = COALESCE(logo_url, ?),
           service_fee = COALESCE(service_fee, ?),
           gateway_id = NULL
       WHERE gateway_id = ?`,
      [gw.name, gw.code, gw.logo_url, gw.service_fee, id]
    );

    // Delete permanently from gateways catalogue
    await db.execute("DELETE FROM gateways WHERE id = ?", [id]);
    return { deleted: true, softDeleted: false, message: `Gateway '${gw.name}' deleted permanently.` };
  },

  async listApplications({ search = "", status = "" } = {}) {
    const conditions = [];
    const params = [];

    if (search) {
      conditions.push("(m.merchant_code LIKE ? OR p.company_name LIKE ? OR COALESCE(g.name, mga.gateway_name) LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)");
      const s = `%${search}%`;
      params.push(s, s, s, s, s);
    }

    if (status && status !== "all") {
      if (status === "pending") {
        conditions.push("(mga.status = 'applied' OR mga.status = 'under_review')");
      } else {
        conditions.push("mga.status = ?");
        params.push(status);
      }
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const [rows] = await db.execute(
      `
        SELECT mga.*, m.merchant_code, m.user_id, COALESCE(p.company_name, m.merchant_code) AS company_name, 
               COALESCE(c.email, u.email) AS email, COALESCE(c.phone, u.phone) AS phone, COALESCE(c.name, p.company_name, u.email) AS full_name,
               COALESCE(g.name, mga.gateway_name, 'Deleted Gateway') AS gateway_name, 
               COALESCE(g.code, mga.gateway_code, 'DELETED') AS gateway_code, 
               COALESCE(g.logo_url, mga.logo_url) AS logo_url, 
               COALESCE(g.service_fee, mga.service_fee, 0) AS service_fee, 
               COALESCE(g.service_type, mga.service_type, 'Payment Gateway') AS service_type
        FROM merchant_gateway_applications mga
        JOIN merchants m ON mga.merchant_id = m.id
        JOIN users u ON m.user_id = u.id
        LEFT JOIN gateways g ON mga.gateway_id = g.id
        LEFT JOIN merchant_profiles p ON p.merchant_id = m.id
        LEFT JOIN merchant_contacts c ON c.merchant_id = m.id
        ${whereClause}
        ORDER BY mga.applied_at DESC
      `,
      params
    );

    return rows.map((r) => ({
      id: r.id,
      applicationReference: `BQR-APP-${String(r.id).padStart(6, "0")}`,
      merchantId: r.merchant_id,
      userId: r.user_id,
      gatewayId: r.gateway_id,
      merchantCode: r.merchant_code,
      companyName: r.company_name,
      contactName: r.full_name,
      email: r.email,
      phone: r.phone,
      gatewayName: r.gateway_name,
      gatewayCode: r.gateway_code,
      logoUrl: r.logo_url,
      serviceType: r.service_type,
      serviceFee: Number(r.service_fee),
      status: r.status,
      reviewNote: r.review_note,
      appliedAt: r.applied_at,
      reviewedAt: r.reviewed_at,
      updatedAt: r.updated_at,
    }));
  },

  async listServices({ search = "", status = "" } = {}) {
    const conditions = [];
    const params = [];

    if (search) {
      conditions.push("(m.merchant_code LIKE ? OR p.company_name LIKE ? OR g.name LIKE ? OR u.email LIKE ?)");
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }

    if (status && status !== "all") {
      conditions.push("mgs.status = ?");
      params.push(status);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const [rows] = await db.execute(
      `
        SELECT mgs.*, m.merchant_code, m.user_id, COALESCE(p.company_name, m.merchant_code) AS company_name, 
               COALESCE(c.email, u.email) AS email, COALESCE(c.phone, u.phone) AS phone, COALESCE(c.name, p.company_name, u.email) AS full_name,
               COALESCE(g.name, mgs.gateway_name, 'Deleted Gateway') AS gateway_name, 
               COALESCE(g.code, mgs.gateway_code, 'DELETED') AS gateway_code, 
               COALESCE(g.logo_url, mgs.logo_url) AS logo_url, 
               COALESCE(g.service_fee, mgs.service_fee, 0) AS service_fee,
               COALESCE(g.qr_supported, 1) AS qr_supported, 
               COALESCE(g.card_supported, 0) AS card_supported, 
               COALESCE(g.mobile_supported, 1) AS mobile_supported, 
               COALESCE(g.api_supported, 1) AS api_supported
        FROM merchant_gateway_services mgs
        JOIN merchants m ON mgs.merchant_id = m.id
        JOIN users u ON m.user_id = u.id
        LEFT JOIN gateways g ON mgs.gateway_id = g.id
        LEFT JOIN merchant_profiles p ON p.merchant_id = m.id
        LEFT JOIN merchant_contacts c ON c.merchant_id = m.id
        ${whereClause}
        ORDER BY mgs.created_at DESC
      `,
      params
    );

    return rows.map((r) => {
      const rawConfig = typeof r.configuration === "string" ? JSON.parse(r.configuration) : (r.configuration || {});
      const maskedConfig = { ...rawConfig };
      if (maskedConfig.secret_key) maskedConfig.secret_key = "••••••••" + String(maskedConfig.secret_key).slice(-4);
      if (maskedConfig.apiKey) maskedConfig.apiKey = "••••••••" + String(maskedConfig.apiKey).slice(-4);
      if (maskedConfig.secretKey) maskedConfig.secretKey = "••••••••" + String(maskedConfig.secretKey).slice(-4);

      return {
        id: r.id,
        merchantId: r.merchant_id,
        userId: r.user_id,
        gatewayId: r.gateway_id,
        merchantCode: r.merchant_code,
        companyName: r.company_name,
        contactName: r.full_name,
        email: r.email,
        phone: r.phone,
        gatewayName: r.gateway_name,
        gatewayCode: r.gateway_code,
        logoUrl: r.logo_url,
        serviceType: r.service_type,
        serviceFee: Number(r.service_fee),
        status: r.status,
        configuration: maskedConfig,
        rawConfiguration: rawConfig,
        qrSupported: Boolean(r.qr_supported),
        cardSupported: Boolean(r.card_supported),
        mobileSupported: Boolean(r.mobile_supported),
        apiSupported: Boolean(r.api_supported),
        activatedAt: r.activated_at,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      };
    });
  },

  async getApplicationById(id) {
    const [rows] = await db.execute(
      `
        SELECT mga.*, m.merchant_code, m.user_id, COALESCE(p.company_name, m.merchant_code) AS company_name, 
               COALESCE(c.email, u.email) AS email, COALESCE(c.phone, u.phone) AS phone, COALESCE(c.name, p.company_name, u.email) AS full_name,
               COALESCE(g.name, mga.gateway_name, 'Deleted Gateway') AS gateway_name, 
               COALESCE(g.code, mga.gateway_code, 'DELETED') AS gateway_code, 
               COALESCE(g.logo_url, mga.logo_url) AS logo_url, 
               COALESCE(g.service_fee, mga.service_fee, 0) AS service_fee, 
               COALESCE(g.service_type, mga.service_type, 'Payment Gateway') AS service_type, 
               g.supported_methods, g.required_documents, g.description
        FROM merchant_gateway_applications mga
        JOIN merchants m ON mga.merchant_id = m.id
        JOIN users u ON m.user_id = u.id
        LEFT JOIN gateways g ON mga.gateway_id = g.id
        LEFT JOIN merchant_profiles p ON p.merchant_id = m.id
        LEFT JOIN merchant_contacts c ON c.merchant_id = m.id
        WHERE mga.id = ?
        LIMIT 1
      `,
      [id]
    );

    if (!rows.length) return null;
    const r = rows[0];

    return {
      id: r.id,
      applicationReference: `BQR-APP-${String(r.id).padStart(6, "0")}`,
      merchantId: r.merchant_id,
      userId: r.user_id,
      gatewayId: r.gateway_id,
      merchantCode: r.merchant_code,
      companyName: r.company_name,
      contactName: r.full_name,
      email: r.email,
      phone: r.phone,
      gatewayName: r.gateway_name,
      gatewayCode: r.gateway_code,
      logoUrl: r.logo_url,
      description: r.description,
      serviceType: r.service_type,
      serviceFee: Number(r.service_fee),
      supportedMethods: typeof r.supported_methods === "string" ? JSON.parse(r.supported_methods) : (r.supported_methods || []),
      requiredDocuments: typeof r.required_documents === "string" ? JSON.parse(r.required_documents) : (r.required_documents || []),
      status: r.status,
      reviewNote: r.review_note,
      appliedAt: r.applied_at,
      reviewedAt: r.reviewed_at,
      updatedAt: r.updated_at,
    };
  },

  async updateApplicationStatus(id, status, reviewNote) {
    await db.execute(
      `UPDATE merchant_gateway_applications SET status = ?, review_note = ?, reviewed_at = NOW(), updated_at = NOW() WHERE id = ?`,
      [status, reviewNote || null, id]
    );
  },

  async provisionGatewayService(merchantId, gatewayId, serviceType = "BanglaQR Interoperable", initialConfig = null) {
    const [existing] = await db.execute(
      `SELECT id, configuration FROM merchant_gateway_services WHERE merchant_id = ? AND gateway_id = ? LIMIT 1`,
      [merchantId, gatewayId]
    );

    // Fetch gateway snapshot info
    let gwName = null, gwCode = null, logoUrl = null, serviceFee = 1.5;
    if (gatewayId) {
      const [gws] = await db.execute("SELECT name, code, logo_url, service_fee FROM gateways WHERE id = ? LIMIT 1", [gatewayId]);
      if (gws.length > 0) {
        gwName = gws[0].name;
        gwCode = gws[0].code;
        logoUrl = gws[0].logo_url;
        serviceFee = gws[0].service_fee || 1.5;
      }
    }

    const defaultConfig = initialConfig || {
      storeId: `STORE_${merchantId}_${gatewayId || 'GW'}`,
      merchantId: `MID_${merchantId}`,
      sandboxMode: true,
      apiKey: "",
      secretKey: "",
      webhookUrl: "",
      callbackUrl: "",
      updatedAt: new Date().toISOString(),
    };

    if (existing.length > 0) {
      await db.execute(
        `UPDATE merchant_gateway_services 
         SET status = 'active', 
             gateway_name = COALESCE(gateway_name, ?),
             gateway_code = COALESCE(gateway_code, ?),
             logo_url = COALESCE(logo_url, ?),
             service_fee = COALESCE(service_fee, ?),
             activated_at = NOW(), updated_at = NOW() 
         WHERE id = ?`,
        [gwName, gwCode, logoUrl, serviceFee, existing[0].id]
      );
      return existing[0].id;
    }

    const [res] = await db.execute(
      `INSERT INTO merchant_gateway_services (merchant_id, gateway_id, gateway_name, gateway_code, logo_url, service_fee, service_type, configuration, status, activated_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', NOW(), NOW(), NOW())`,
      [merchantId, gatewayId, gwName, gwCode, logoUrl, serviceFee, serviceType, JSON.stringify(defaultConfig)]
    );
    return res.insertId;
  },

  async updateServiceStatus(id, status) {
    await db.execute(
      `UPDATE merchant_gateway_services SET status = ?, updated_at = NOW() WHERE id = ?`,
      [status, id]
    );
  },
};
