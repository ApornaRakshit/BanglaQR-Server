import { db } from "../../../config/db.js";
import { trashService } from "../trash/trash.module.js";

export const adminAuditRepository = {
  async listAuditLogs({ search = "", action = "", dateFrom = "", dateTo = "", sort = "desc", page = 1, limit = 20 }) {
    const offset = (page - 1) * limit;
    const conditions = [];
    const params = [];

    if (search) {
      conditions.push("(a.admin_email LIKE ? OR a.action LIKE ? OR a.resource_type LIKE ? OR a.resource_id LIKE ? OR u.email LIKE ?)");
      const s = `%${search}%`;
      params.push(s, s, s, s, s);
    }
    if (action && action !== "all") {
      conditions.push("a.action = ?");
      params.push(action);
    }
    if (dateFrom) {
      conditions.push("a.created_at >= ?");
      params.push(dateFrom);
    }
    if (dateTo) {
      conditions.push("a.created_at <= ?");
      params.push(dateTo + " 23:59:59");
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const sortOrder = String(sort).toLowerCase() === "asc" ? "ASC" : "DESC";

    const [countRows] = await db.execute(
      `SELECT COUNT(a.id) AS total FROM audit_logs a LEFT JOIN users u ON a.user_id = u.id ${whereClause}`,
      params
    );
    const total = Number(countRows[0]?.total || 0);

    const [rows] = await db.execute(
      `
        SELECT a.*, COALESCE(a.admin_email, u.email, 'system@banglaqr.com') AS resolved_email,
               mp.company_name
        FROM audit_logs a
        LEFT JOIN users u ON a.user_id = u.id
        LEFT JOIN merchants m ON a.user_id = m.user_id
        LEFT JOIN merchant_profiles mp ON m.id = mp.merchant_id
        ${whereClause}
        ORDER BY a.created_at ${sortOrder}
        LIMIT ? OFFSET ?
      `,
      [...params, String(limit), String(offset)]
    );

    return {
      logs: rows.map((r) => {
        let parsedDetails = {};
        if (typeof r.details === "string") {
          try {
            parsedDetails = JSON.parse(r.details);
          } catch {
            parsedDetails = { raw: r.details };
          }
        } else if (r.details) {
          parsedDetails = r.details;
        }

        const email = r.resolved_email || r.admin_email || "system@banglaqr.com";

        return {
          id: r.id,
          user_id: r.user_id,
          userId: r.user_id,
          admin_email: email,
          adminEmail: email,
          user_email: email,
          userEmail: email,
          user_name: r.company_name || null,
          userName: r.company_name || null,
          company_name: r.company_name || null,
          companyName: r.company_name || null,
          action: r.action,
          resource_type: r.resource_type || "System",
          resourceType: r.resource_type || "System",
          entity_type: r.resource_type || "System",
          entityType: r.resource_type || "System",
          resource_id: r.resource_id,
          resourceId: r.resource_id,
          entity_id: r.resource_id,
          entityId: r.resource_id,
          merchant_id: r.merchant_id,
          merchantId: r.merchant_id,
          details: parsedDetails,
          ip_address: r.ip_address || "127.0.0.1",
          ipAddress: r.ip_address || "127.0.0.1",
          user_agent: r.user_agent,
          userAgent: r.user_agent,
          created_at: r.created_at,
          createdAt: r.created_at,
        };
      }),
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / limit) || 1,
    };
  },

  async batchDeleteLogs(ids = [], scope = "both", deletedBy = "Admin") {
    const cleanIds = (Array.isArray(ids) ? ids : [])
      .map((id) => Number(id))
      .filter((id) => Number.isInteger(id) && id > 0);

    if (!cleanIds.length) return 0;
    const placeholders = cleanIds.map(() => "?").join(",");

    // Preserve snapshots in Trash Bin before deleting
    try {
      const [existingLogs] = await db.execute(`SELECT * FROM audit_logs WHERE id IN (${placeholders})`, cleanIds);
      for (const log of existingLogs) {
        await trashService.moveToTrash({
          section: "audit",
          originalId: log.id,
          title: `Audit: ${log.action || "Log"}`,
          description: `${log.admin_email || "System"} • ${log.resource_type || "Resource"} #${log.resource_id || ""}`,
          scope,
          deletedBy,
          payload: log,
        });
      }
    } catch (e) {
      console.warn("Failed to backup audit logs to trash:", e.message);
    }

    const [res] = await db.execute(`DELETE FROM audit_logs WHERE id IN (${placeholders})`, cleanIds);
    return res.affectedRows;
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

  async batchDelete(req, res, next) {
    try {
      const { logIds = [], scope = "both" } = req.body;
      const count = await adminAuditRepository.batchDeleteLogs(logIds, scope, req.user?.email || "Admin");
      res.json({ success: true, count, scope, message: `${count} audit log(s) moved to trash bin.` });
    } catch (err) {
      next(err);
    }
  },
};

