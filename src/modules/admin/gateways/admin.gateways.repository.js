import { db } from "../../../config/db.js";

export const adminGatewaysRepository = {
  async listGateways() {
    const [rows] = await db.execute("SELECT * FROM gateways ORDER BY created_at DESC");
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      code: r.code,
      logoUrl: r.logo_url,
      description: r.description,
      supportedMethods: typeof r.supported_methods === "string" ? JSON.parse(r.supported_methods) : r.supported_methods,
      serviceType: r.service_type,
      qrSupported: Boolean(r.qr_supported),
      cardSupported: Boolean(r.card_supported),
      mobileSupported: Boolean(r.mobile_supported),
      apiSupported: Boolean(r.api_supported),
      requiredDocuments: typeof r.required_documents === "string" ? JSON.parse(r.required_documents) : r.required_documents,
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
      supportedMethods: typeof r.supported_methods === "string" ? JSON.parse(r.supported_methods) : r.supported_methods,
      serviceType: r.service_type,
      qrSupported: Boolean(r.qr_supported),
      cardSupported: Boolean(r.card_supported),
      mobileSupported: Boolean(r.mobile_supported),
      apiSupported: Boolean(r.api_supported),
      requiredDocuments: typeof r.required_documents === "string" ? JSON.parse(r.required_documents) : r.required_documents,
      serviceFee: Number(r.service_fee),
      setupFee: Number(r.setup_fee),
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  },

  async createGateway(data) {
    const [res] = await db.execute(
      `INSERT INTO gateways (name, code, logo_url, description, supported_methods, service_type, qr_supported, card_supported, mobile_supported, api_supported, required_documents, service_fee, setup_fee, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.name,
        data.code,
        data.logoUrl || null,
        data.description || null,
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
        name = ?, code = ?, logo_url = ?, description = ?, supported_methods = ?,
        service_type = ?, qr_supported = ?, card_supported = ?, mobile_supported = ?,
        api_supported = ?, required_documents = ?, service_fee = ?, setup_fee = ?, status = ?, updated_at = NOW()
       WHERE id = ?`,
      [
        data.name,
        data.code,
        data.logoUrl || null,
        data.description || null,
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

  async deleteGateway(id) {
    await db.execute("DELETE FROM gateways WHERE id = ?", [id]);
  },

  async listApplications({ search = "", status = "" }) {
    const conditions = [];
    const params = [];
    if (search) {
      conditions.push("(m.merchant_code LIKE ? OR p.company_name LIKE ? OR g.name LIKE ?)");
      const s = `%${search}%`;
      params.push(s, s, s);
    }
    if (status && status !== "all") {
      conditions.push("mga.status = ?");
      params.push(status);
    }
    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const [rows] = await db.execute(
      `
        SELECT mga.*, m.merchant_code, COALESCE(p.company_name, m.merchant_code) AS company_name, u.email,
               g.name AS gateway_name, g.code AS gateway_code, g.service_fee
        FROM merchant_gateway_applications mga
        JOIN merchants m ON mga.merchant_id = m.id
        JOIN users u ON m.user_id = u.id
        JOIN gateways g ON mga.gateway_id = g.id
        LEFT JOIN merchant_profiles p ON p.merchant_id = m.id
        ${whereClause}
        ORDER BY mga.applied_at DESC
      `,
      params
    );

    return rows.map((r) => ({
      id: r.id,
      merchantId: r.merchant_id,
      gatewayId: r.gateway_id,
      merchantCode: r.merchant_code,
      companyName: r.company_name,
      email: r.email,
      gatewayName: r.gateway_name,
      gatewayCode: r.gateway_code,
      serviceFee: Number(r.service_fee),
      status: r.status,
      reviewNote: r.review_note,
      appliedAt: r.applied_at,
      reviewedAt: r.reviewed_at,
    }));
  },

  async listServices({ search = "", status = "" }) {
    const conditions = [];
    const params = [];
    if (search) {
      conditions.push("(m.merchant_code LIKE ? OR p.company_name LIKE ? OR g.name LIKE ?)");
      const s = `%${search}%`;
      params.push(s, s, s);
    }
    if (status && status !== "all") {
      conditions.push("mgs.status = ?");
      params.push(status);
    }
    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const [rows] = await db.execute(
      `
        SELECT mgs.*, m.merchant_code, COALESCE(p.company_name, m.merchant_code) AS company_name, u.email,
               g.name AS gateway_name, g.code AS gateway_code, g.service_fee
        FROM merchant_gateway_services mgs
        JOIN merchants m ON mgs.merchant_id = m.id
        JOIN users u ON m.user_id = u.id
        JOIN gateways g ON mgs.gateway_id = g.id
        LEFT JOIN merchant_profiles p ON p.merchant_id = m.id
        ${whereClause}
        ORDER BY mgs.created_at DESC
      `,
      params
    );

    return rows.map((r) => ({
      id: r.id,
      merchantId: r.merchant_id,
      gatewayId: r.gateway_id,
      merchantCode: r.merchant_code,
      companyName: r.company_name,
      email: r.email,
      gatewayName: r.gateway_name,
      gatewayCode: r.gateway_code,
      serviceType: r.service_type,
      serviceFee: Number(r.service_fee),
      status: r.status,
      configuration: typeof r.configuration === "string" ? JSON.parse(r.configuration) : r.configuration,
      activatedAt: r.activated_at,
      createdAt: r.created_at,
    }));
  },
};

