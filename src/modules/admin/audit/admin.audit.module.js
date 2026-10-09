import { db } from "../../../config/db.js";

export const adminAuditRepository = {
  async listAuditLogs({ search = "", action = "", dateFrom = "", dateTo = "", page = 1, limit = 20 }) {
    const offset = (page - 1) * limit;
    const conditions = [];
    const params = [];

    if (search) {
      conditions.push("(admin_email LIKE ? OR action LIKE ? OR resource_type LIKE ? OR resource_id LIKE ?)");
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }
    if (action && action !== "all") {
      conditions.push("action = ?");
      params.push(action);
    }
    if (dateFrom) {
      conditions.push("created_at >= ?");
      params.push(dateFrom);
    }
    if (dateTo) {
      conditions.push("created_at <= ?");
      params.push(dateTo + " 23:59:59");
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const [countRows] = await db.execute(
      `SELECT COUNT(id) AS total FROM audit_logs ${whereClause}`,
      params
    );
    const total = Number(countRows[0]?.total || 0);

    const [rows] = await db.execute(
      `
        SELECT *
        FROM audit_logs
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `,
      [...params, String(limit), String(offset)]
    );

    return {
      logs: rows.map((r) => ({
        id: r.id,
        userId: r.user_id,
        adminEmail: r.admin_email,
        action: r.action,
        resourceType: r.resource_type,
        resourceId: r.resource_id,
        merchantId: r.merchant_id,
        details: typeof r.details === "string" ? JSON.parse(r.details) : r.details,
        ipAddress: r.ip_address,
        userAgent: r.user_agent,
        createdAt: r.created_at,
      })),
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / limit) || 1,
    };
  },
};

export const adminAuditController = {
  async list(req, res, next) {
    try {
      const data = await adminAuditRepository.listAuditLogs(req.query);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },
};

