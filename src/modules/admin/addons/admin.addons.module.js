import { db } from "../../../config/db.js";
import { logAdminAudit } from "../../../utils/auditLogger.js";

export const adminAddonsRepository = {
  async listAddons() {
    const [rows] = await db.execute("SELECT * FROM addons ORDER BY created_at DESC");
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      code: r.code,
      description: r.description,
      category: r.category,
      pricingType: r.pricing_type,
      price: Number(r.price),
      billingCycle: r.billing_cycle,
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
      category: r.category,
      pricingType: r.pricing_type,
      price: Number(r.price),
      billingCycle: r.billing_cycle,
      requirements: r.requirements,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  },

  async createAddon(data) {
    const [res] = await db.execute(
      `INSERT INTO addons (name, code, description, category, pricing_type, price, billing_cycle, requirements, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.name,
        data.code,
        data.description || null,
        data.category || "Operations",
        data.pricingType || "monthly",
        data.price || 0,
        data.billingCycle || "Monthly",
        data.requirements || null,
        data.status || "available",
      ]
    );
    return res.insertId;
  },

  async updateAddon(id, data) {
    await db.execute(
      `UPDATE addons SET
        name = ?, code = ?, description = ?, category = ?, pricing_type = ?,
        price = ?, billing_cycle = ?, requirements = ?, status = ?, updated_at = NOW()
       WHERE id = ?`,
      [
        data.name,
        data.code,
        data.description || null,
        data.category || "Operations",
        data.pricingType || "monthly",
        data.price || 0,
        data.billingCycle || "Monthly",
        data.requirements || null,
        data.status || "available",
        id,
      ]
    );
  },

  async deleteAddon(id) {
    await db.execute("DELETE FROM addons WHERE id = ?", [id]);
  },
};

export const adminAddonsService = {
  async listAddons() {
    return await adminAddonsRepository.listAddons();
  },

  async getAddon(id) {
    const a = await adminAddonsRepository.getAddonById(id);
    if (!a) {
      const err = new Error("Addon not found");
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

  async deleteAddon(id, adminUser, ip, userAgent) {
    await adminAddonsRepository.deleteAddon(id);
    await logAdminAudit({
      userId: adminUser?.id,
      adminEmail: adminUser?.email,
      action: "addon_delete",
      resourceType: "addon",
      resourceId: id,
      details: null,
      ip,
      userAgent,
    });
    return { success: true, message: "Add-on deleted successfully" };
  },
};

export const adminAddonsController = {
  async list(req, res, next) {
    try {
      const data = await adminAddonsService.listAddons();
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  async getById(req, res, next) {
    try {
      const id = Number(req.params.addonId);
      const data = await adminAddonsService.getAddon(id);
      res.json({ success: true, data });
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
};

