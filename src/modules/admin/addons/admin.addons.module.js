import { db } from "../../../config/db.js";
import { logAdminAudit } from "../../../utils/auditLogger.js";

export const adminAddonsRepository = {
  async getAddonStats() {
    const [counts] = await db.execute(`
      SELECT 
        COUNT(*) AS totalAddons,
        SUM(CASE WHEN status = 'available' OR status = 'active' THEN 1 ELSE 0 END) AS activeAddons,
        SUM(CASE WHEN status = 'inactive' OR status = 'deprecated' THEN 1 ELSE 0 END) AS inactiveAddons
      FROM addons
    `);

    const [appCounts] = await db.execute(`
      SELECT 
        COUNT(*) AS totalApplications,
        SUM(CASE WHEN status = 'applied' OR status = 'under_review' THEN 1 ELSE 0 END) AS pendingApplications,
        SUM(CASE WHEN status = 'activated' OR status = 'approved' THEN 1 ELSE 0 END) AS activatedAddons
      FROM merchant_addons
    `);

    const a = counts[0] || {};
    const ma = appCounts[0] || {};

    return {
      totalAddons: Number(a.totalAddons || 0),
      activeAddons: Number(a.activeAddons || 0),
      inactiveAddons: Number(a.inactiveAddons || 0),
      publishedAddons: Number(a.activeAddons || 0),
      pendingApplications: Number(ma.pendingApplications || 0),
      activatedAddons: Number(ma.activatedAddons || 0),
      totalApplications: Number(ma.totalApplications || 0),
    };
  },

  async listAddons({ search = "", status = "", category = "" } = {}) {
    const conditions = [];
    const params = [];

    if (search) {
      conditions.push("(name LIKE ? OR code LIKE ? OR description LIKE ? OR category LIKE ?)");
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }

    if (status && status !== "all") {
      conditions.push("status = ?");
      params.push(status);
    }

    if (category && category !== "all") {
      conditions.push("category = ?");
      params.push(category);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const [rows] = await db.execute(
      `SELECT * FROM addons ${whereClause} ORDER BY created_at DESC`,
      params
    );

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      code: r.code,
      description: r.description,
      shortDescription: r.short_description,
      category: r.category,
      logoUrl: r.logo_url,
      isPublished: Boolean(r.is_published ?? 1),
      acceptsApplications: Boolean(r.accepts_applications ?? 1),
      displayOrder: Number(r.display_order || 0),
      eligibility: r.eligibility,
      pricingType: r.pricing_type,
      pricing_type: r.pricing_type,
      price: Number(r.price),
      billingCycle: r.billing_cycle,
      billing_cycle: r.billing_cycle,
      billing_type: r.pricing_type,
      requirements: r.requirements,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  },

  async getAddonById(id) {
    const [rows] = await db.execute("SELECT * FROM addons WHERE id = ? LIMIT 1", [id]);
    if (!rows.length) return null;
    const r = rows[0];
    return {
      id: r.id,
      name: r.name,
      code: r.code,
      description: r.description,
      shortDescription: r.short_description,
      category: r.category,
      logoUrl: r.logo_url,
      isPublished: Boolean(r.is_published ?? 1),
      acceptsApplications: Boolean(r.accepts_applications ?? 1),
      displayOrder: Number(r.display_order || 0),
      eligibility: r.eligibility,
      pricingType: r.pricing_type,
      pricing_type: r.pricing_type,
      price: Number(r.price),
      billingCycle: r.billing_cycle,
      billing_cycle: r.billing_cycle,
      billing_type: r.pricing_type,
      requirements: r.requirements,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  },

  async createAddon(data) {
    const [res] = await db.execute(
      `INSERT INTO addons (name, code, description, short_description, category, logo_url, is_published, accepts_applications, display_order, eligibility, pricing_type, price, billing_cycle, requirements, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.name,
        data.code,
        data.description || null,
        data.shortDescription || null,
        data.category || "Operations",
        data.logoUrl || null,
        data.isPublished !== undefined ? (data.isPublished ? 1 : 0) : 1,
        data.acceptsApplications !== undefined ? (data.acceptsApplications ? 1 : 0) : 1,
        data.displayOrder || 0,
        data.eligibility || null,
        data.pricingType || data.pricing_type || data.billing_type || "monthly",
        data.price || 0,
        data.billingCycle || data.billing_cycle || "Monthly",
        data.requirements || null,
        data.status || "available",
      ]
    );
    return res.insertId;
  },

  async updateAddon(id, data) {
    await db.execute(
      `UPDATE addons SET
        name = ?, code = ?, description = ?, short_description = ?, category = ?, logo_url = ?,
        is_published = ?, accepts_applications = ?, display_order = ?, eligibility = ?,
        pricing_type = ?, price = ?, billing_cycle = ?, requirements = ?, status = ?, updated_at = NOW()
       WHERE id = ?`,
      [
        data.name,
        data.code,
        data.description || null,
        data.shortDescription || null,
        data.category || "Operations",
        data.logoUrl || null,
        data.isPublished !== undefined ? (data.isPublished ? 1 : 0) : 1,
        data.acceptsApplications !== undefined ? (data.acceptsApplications ? 1 : 0) : 1,
        data.displayOrder || 0,
        data.eligibility || null,
        data.pricingType || data.pricing_type || data.billing_type || "monthly",
        data.price || 0,
        data.billingCycle || data.billing_cycle || "Monthly",
        data.requirements || null,
        data.status || "available",
        id,
      ]
    );
  },

  async updateAddonStatus(id, status) {
    await db.execute("UPDATE addons SET status = ?, updated_at = NOW() WHERE id = ?", [status, id]);
  },

  async updateAddonPublish(id, isPublished, acceptsApplications) {
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
    await db.execute(`UPDATE addons SET ${sets.join(", ")} WHERE id = ?`, params);
  },

  async deleteAddon(id) {
    const [aRows] = await db.execute("SELECT * FROM addons WHERE id = ? LIMIT 1", [id]);
    if (aRows.length === 0) {
      const err = new Error("Add-on not found");
      err.statusCode = 404;
      throw err;
    }
    const addon = aRows[0];

    // Snapshot dependent merchant addons and set addon_id to NULL
    await db.execute(
      `UPDATE merchant_addons 
       SET addon_name = COALESCE(addon_name, ?),
           addon_code = COALESCE(addon_code, ?),
           logo_url = COALESCE(logo_url, ?),
           category = COALESCE(category, ?),
           price = COALESCE(price, ?),
           pricing_type = COALESCE(pricing_type, ?),
           addon_id = NULL
       WHERE addon_id = ?`,
      [addon.name, addon.code, addon.logo_url, addon.category, addon.price, addon.pricing_type, id]
    );

    // Delete permanently from addons catalogue
    await db.execute("DELETE FROM addons WHERE id = ?", [id]);
    return { deleted: true, softDeleted: false, message: `Add-on '${addon.name}' deleted permanently.` };
  },

  async listAddonApplications({ search = "", status = "" } = {}) {
    const conditions = [];
    const params = [];

    if (search) {
      conditions.push("(m.merchant_code LIKE ? OR p.company_name LIKE ? OR COALESCE(a.name, ma.addon_name) LIKE ? OR u.email LIKE ?)");
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }

    if (status && status !== "all") {
      conditions.push("ma.status = ?");
      params.push(status);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const [rows] = await db.execute(
      `
        SELECT ma.*, m.merchant_code, m.user_id, COALESCE(p.company_name, m.merchant_code) AS company_name,
               COALESCE(c.email, u.email) AS email, COALESCE(c.phone, u.phone) AS phone, COALESCE(c.name, p.company_name, u.email) AS full_name,
               COALESCE(a.name, ma.addon_name, 'Deleted Add-on') AS addon_name, 
               COALESCE(a.code, ma.addon_code, 'DELETED') AS addon_code, 
               COALESCE(a.logo_url, ma.logo_url) AS logo_url,
               COALESCE(a.category, ma.category, 'Operations') AS category, 
               COALESCE(a.price, ma.price, 0) AS price, 
               COALESCE(a.pricing_type, ma.pricing_type, 'monthly') AS pricing_type
        FROM merchant_addons ma
        JOIN merchants m ON ma.merchant_id = m.id
        JOIN users u ON m.user_id = u.id
        LEFT JOIN addons a ON ma.addon_id = a.id
        LEFT JOIN merchant_profiles p ON p.merchant_id = m.id
        LEFT JOIN merchant_contacts c ON c.merchant_id = m.id
        ${whereClause}
        ORDER BY ma.applied_at DESC
      `,
      params
    );

    return rows.map((r) => ({
      id: r.id,
      merchantId: r.merchant_id,
      userId: r.user_id,
      addonId: r.addon_id,
      merchantCode: r.merchant_code,
      companyName: r.company_name,
      contactName: r.full_name,
      email: r.email,
      phone: r.phone,
      addonName: r.addon_name,
      addonCode: r.addon_code,
      category: r.category,
      price: Number(r.price),
      pricingType: r.pricing_type,
      status: r.status,
      configuration: typeof r.configuration === "string" ? JSON.parse(r.configuration) : r.configuration,
      appliedAt: r.applied_at,
      activatedAt: r.activated_at,
      createdAt: r.created_at,
    }));
  },

  async reviewAddonApplication(id, status) {
    const isActivated = status === "activated" || status === "approved";
    await db.execute(
      `UPDATE merchant_addons 
       SET status = ?, activated_at = ${isActivated ? "NOW()" : "NULL"}, updated_at = NOW() 
       WHERE id = ?`,
      [status, id]
    );
  },
};

export const adminAddonsService = {
  async getAddonStats() {
    return await adminAddonsRepository.getAddonStats();
  },

  async listAddons(filters = {}) {
    return await adminAddonsRepository.listAddons(filters);
  },

  async getAddon(id) {
    const a = await adminAddonsRepository.getAddonById(id);
    if (!a) {
      const err = new Error("Add-on not found");
      err.statusCode = 404;
      throw err;
    }
    return a;
  },

  async createAddon(data, adminUser, ip, userAgent) {
    const id = await adminAddonsRepository.createAddon(data);
    await logAdminAudit({
      userId: adminUser?.id,
      adminEmail: adminUser?.email,
      action: "addon_create",
      resourceType: "addon",
      resourceId: id,
      details: { name: data.name, code: data.code, price: data.price },
      ip,
      userAgent,
    });
    return { success: true, message: "Add-on created successfully", id };
  },

  async updateAddon(id, data, adminUser, ip, userAgent) {
    await adminAddonsRepository.updateAddon(id, data);
    await logAdminAudit({
      userId: adminUser?.id,
      adminEmail: adminUser?.email,
      action: "addon_update",
      resourceType: "addon",
      resourceId: id,
      details: { name: data.name, code: data.code, status: data.status },
      ip,
      userAgent,
    });
    return { success: true, message: "Add-on updated successfully" };
  },

  async updateAddonStatus(id, status, adminUser, ip, userAgent) {
    await adminAddonsRepository.updateAddonStatus(id, status);
    await logAdminAudit({
      userId: adminUser?.id,
      adminEmail: adminUser?.email,
      action: "addon_status_update",
      resourceType: "addon",
      resourceId: id,
      details: { status },
      ip,
      userAgent,
    });
    return { success: true, message: `Add-on status updated to ${status}.` };
  },

  async updateAddonPublish(id, publishData, adminUser, ip, userAgent) {
    await adminAddonsRepository.updateAddonPublish(id, publishData.isPublished, publishData.acceptsApplications);
    await logAdminAudit({
      userId: adminUser?.id,
      adminEmail: adminUser?.email,
      action: "addon_publish_update",
      resourceType: "addon",
      resourceId: id,
      details: publishData,
      ip,
      userAgent,
    });
    return { success: true, message: "Add-on publish settings updated." };
  },

  async deleteAddon(id, adminUser, ip, userAgent) {
    const result = await adminAddonsRepository.deleteAddon(id);
    await logAdminAudit({
      userId: adminUser?.id,
      adminEmail: adminUser?.email,
      action: "addon_delete",
      resourceType: "addon",
      resourceId: id,
      details: result,
      ip,
      userAgent,
    });
    return { success: true, message: result.message, softDeleted: false, deleted: true };
  },

  async listApplications(filters = {}) {
    return await adminAddonsRepository.listAddonApplications(filters);
  },

  async reviewApplication(id, action, adminUser, ip, userAgent) {
    let newStatus = action;
    if (action === "approve") newStatus = "approved";
    if (action === "activate") newStatus = "activated";
    if (action === "reject") newStatus = "closed";
    if (action === "suspend") newStatus = "suspended";

    await adminAddonsRepository.reviewAddonApplication(id, newStatus);
    await logAdminAudit({
      userId: adminUser?.id,
      adminEmail: adminUser?.email,
      action: `addon_application_${action}`,
      resourceType: "addon_application",
      resourceId: id,
      details: { status: newStatus },
      ip,
      userAgent,
    });
    return { success: true, message: `Add-on application marked as ${newStatus}` };
  },
};

export const adminAddonsController = {
  async getStats(req, res, next) {
    try {
      const data = await adminAddonsService.getAddonStats();
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  async list(req, res, next) {
    try {
      const data = await adminAddonsService.listAddons(req.query);
      res.json({ success: true, data, addons: data });
    } catch (err) {
      next(err);
    }
  },

  async getById(req, res, next) {
    try {
      const id = Number(req.params.addonId);
      const data = await adminAddonsService.getAddon(id);
      res.json({ success: true, data, addon: data });
    } catch (err) {
      next(err);
    }
  },

  async create(req, res, next) {
    try {
      const result = await adminAddonsService.createAddon(
        req.body,
        req.user,
        req.ip,
        req.get("user-agent")
      );
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },

  async update(req, res, next) {
    try {
      const id = Number(req.params.addonId);
      const result = await adminAddonsService.updateAddon(
        id,
        req.body,
        req.user,
        req.ip,
        req.get("user-agent")
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async updateStatus(req, res, next) {
    try {
      const id = Number(req.params.addonId);
      const status = req.body.status;
      if (!["available", "active", "inactive", "draft"].includes(status)) {
        return res.status(400).json({ success: false, message: "Invalid status value." });
      }
      const result = await adminAddonsService.updateAddonStatus(
        id,
        status,
        req.user,
        req.ip,
        req.get("user-agent")
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async updatePublish(req, res, next) {
    try {
      const id = Number(req.params.addonId);
      const { isPublished, acceptsApplications } = req.body;
      const result = await adminAddonsService.updateAddonPublish(
        id,
        { isPublished, acceptsApplications },
        req.user,
        req.ip,
        req.get("user-agent")
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async delete(req, res, next) {
    try {
      const id = Number(req.params.addonId);
      const result = await adminAddonsService.deleteAddon(
        id,
        req.user,
        req.ip,
        req.get("user-agent")
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async listApplications(req, res, next) {
    try {
      const data = await adminAddonsService.listApplications(req.query);
      res.json({ success: true, data, applications: data });
    } catch (err) {
      next(err);
    }
  },

  async reviewApplication(req, res, next) {
    try {
      const id = Number(req.params.applicationId);
      const action = req.body.action || req.body.status;
      const result = await adminAddonsService.reviewApplication(
        id,
        action,
        req.user,
        req.ip,
        req.get("user-agent")
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
};
