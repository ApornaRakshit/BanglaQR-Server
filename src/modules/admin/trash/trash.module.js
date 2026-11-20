import { db } from "../../../config/db.js";

export const trashService = {
  /**
   * Move an item to the trash bin
   */
  async moveToTrash({ section, originalId, title, description, scope = "both", deletedBy = "Admin", payload = {} }) {
    await db.query(
      `
      INSERT INTO admin_trash_bin
      (section, original_id, title, description, scope, deleted_by, payload, deleted_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), DATE_ADD(NOW(), INTERVAL 30 DAY))
      `,
      [
        section,
        String(originalId),
        title.slice(0, 255),
        description || null,
        scope,
        deletedBy,
        JSON.stringify(payload),
      ]
    );
  },

  /**
   * Batch move multiple items to trash
   */
  async batchMoveToTrash(items = []) {
    if (!items.length) return;
    for (const item of items) {
      await this.moveToTrash(item);
    }
  },

  /**
   * List trash items with filtering, statistics & days remaining
   */
  async listTrash({ section = "all", search = "", page = 1, limit = 20 } = {}) {
    // Purge expired records older than 30 days automatically
    try {
      await db.query("DELETE FROM admin_trash_bin WHERE expires_at < NOW()");
    } catch (_) {}

    const conditions = [];
    const params = [];

    if (section && section !== "all") {
      conditions.push("section = ?");
      params.push(section);
    }

    if (search && search.trim()) {
      conditions.push("(title LIKE ? OR description LIKE ? OR original_id LIKE ?)");
      const term = `%${search.trim()}%`;
      params.push(term, term, term);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const offset = (Math.max(1, page) - 1) * limit;

    const [countRows] = await db.query(
      `SELECT COUNT(*) AS total FROM admin_trash_bin ${where}`,
      params
    );
    const total = Number(countRows[0]?.total || 0);

    const [rows] = await db.query(
      `
      SELECT
        id,
        section,
        original_id,
        title,
        description,
        scope,
        deleted_by,
        deleted_at,
        expires_at,
        GREATEST(0, DATEDIFF(expires_at, NOW())) AS days_left
      FROM admin_trash_bin
      ${where}
      ORDER BY deleted_at DESC
      LIMIT ? OFFSET ?
      `,
      [...params, Number(limit), Number(offset)]
    );

    // Section counts for top filter tabs
    const [statsRows] = await db.query(`
      SELECT
        COUNT(*) AS total_all,
        SUM(CASE WHEN section = 'merchant' THEN 1 ELSE 0 END) AS total_merchant,
        SUM(CASE WHEN section = 'user' THEN 1 ELSE 0 END) AS total_user,
        SUM(CASE WHEN section = 'audit' THEN 1 ELSE 0 END) AS total_audit,
        SUM(CASE WHEN section = 'notification' THEN 1 ELSE 0 END) AS total_notification,
        SUM(CASE WHEN section = 'inquiry' THEN 1 ELSE 0 END) AS total_inquiry,
        SUM(CASE WHEN section = 'staff' THEN 1 ELSE 0 END) AS total_staff,
        SUM(CASE WHEN section = 'platform_admin' THEN 1 ELSE 0 END) AS total_platform_admin
      FROM admin_trash_bin
    `);

    const stats = {
      all: Number(statsRows[0]?.total_all || 0),
      merchant: Number(statsRows[0]?.total_merchant || 0),
      user: Number(statsRows[0]?.total_user || 0),
      audit: Number(statsRows[0]?.total_audit || 0),
      notification: Number(statsRows[0]?.total_notification || 0),
      inquiry: Number(statsRows[0]?.total_inquiry || 0),
      staff: Number(statsRows[0]?.total_staff || 0),
      platform_admin: Number(statsRows[0]?.total_platform_admin || 0),
    };

    return {
      items: rows,
      stats,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  },

  /**
   * Restore an item back to its origin (supports custom options: customStatus, customScope)
   */
  async restoreItem(trashId, customOptions = {}) {
    const [rows] = await db.query("SELECT * FROM admin_trash_bin WHERE id = ?", [trashId]);
    if (!rows.length) {
      const err = new Error("Trash item not found or expired.");
      err.statusCode = 404;
      throw err;
    }

    const item = rows[0];
    const payload = JSON.parse(item.payload || "{}");
    const { targetStatus = null, targetScope = null } = customOptions;

    // Helper to format ISO strings or Date objects to MySQL DATETIME (YYYY-MM-DD HH:MM:SS)
    const formatMysqlDate = (dt) => {
      if (!dt) return null;
      const d = new Date(dt);
      if (isNaN(d.getTime())) return null;
      return d.toISOString().slice(0, 19).replace("T", " ");
    };

    const nowFormatted = () => new Date().toISOString().slice(0, 19).replace("T", " ");

    if (item.section === "notification") {
      // Re-insert notification
      if (payload.id) {
        const finalRecipientType = targetScope === "admin" ? "admin" : (targetScope === "institution" ? "institution" : (payload.recipient_type || "all"));
        const createdAt = formatMysqlDate(payload.created_at || item.deleted_at) || nowFormatted();
        await db.query(
          `
          INSERT INTO notifications (id, recipient_type, recipient_id, title, message, type, link, is_read, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE recipient_type = VALUES(recipient_type), is_read = VALUES(is_read)
          `,
          [
            payload.id,
            finalRecipientType,
            payload.recipient_id || null,
            payload.title || item.title,
            payload.message || "",
            payload.type || "system",
            payload.link || null,
            payload.is_read || 0,
            createdAt,
          ]
        );
      }
    } else if (item.section === "inquiry") {
      // Re-insert contact inquiry
      if (payload.id) {
        const finalStatus = targetStatus || payload.status || "new";
        const createdAt = formatMysqlDate(payload.created_at || item.deleted_at) || nowFormatted();
        await db.query(
          `
          INSERT INTO contact_inquiries (id, full_name, email, phone, company_name, service_name, message, status, inquiry_reference, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
          ON DUPLICATE KEY UPDATE status = VALUES(status)
          `,
          [
            payload.id,
            payload.full_name || item.title,
            payload.email || "",
            payload.phone || "",
            payload.company_name || null,
            payload.service_name || null,
            payload.message || "",
            finalStatus,
            payload.inquiry_reference || null,
            createdAt,
          ]
        );
      }
    } else if (item.section === "audit") {
      // Re-insert audit log
      if (payload.id) {
        const createdAt = formatMysqlDate(payload.created_at || item.deleted_at) || nowFormatted();
        await db.query(
          `
          INSERT INTO audit_logs (id, user_id, admin_email, action, resource_type, resource_id, merchant_id, details, ip_address, user_agent, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE action = VALUES(action)
          `,
          [
            payload.id,
            payload.user_id || null,
            payload.admin_email || "system@banglaqr.com",
            payload.action || "RESTORED",
            payload.resource_type || "System",
            payload.resource_id || null,
            payload.merchant_id || null,
            typeof payload.details === "object" ? JSON.stringify(payload.details) : payload.details || null,
            payload.ip_address || null,
            payload.user_agent || null,
            createdAt,
          ]
        );
      }
    } else if (item.section === "staff") {
      // Re-insert institution staff membership
      if (payload.id) {
        const finalMembershipStatus = targetStatus || payload.membership_status || "active";
        const createdAt = formatMysqlDate(payload.created_at || item.deleted_at) || nowFormatted();
        await db.query(
          `
          INSERT INTO institution_users (id, institution_id, user_id, role_id, staff_name, membership_status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
          ON DUPLICATE KEY UPDATE membership_status = VALUES(membership_status)
          `,
          [
            payload.id,
            payload.institution_id,
            payload.user_id,
            payload.role_id,
            payload.staff_name || item.title,
            finalMembershipStatus,
            createdAt,
          ]
        );
      }
    } else if (item.section === "merchant") {
      // Restore merchant: custom status or previousAccountStatus
      const mId = payload.merchant?.id || item.original_id;
      const finalAccountStatus = targetStatus || payload.previousAccountStatus || "draft";
      if (mId) {
        await db.query(
          `UPDATE merchants SET account_status = ?, updated_at = NOW() WHERE id = ?`,
          [finalAccountStatus, mId]
        );
      }
    } else if (item.section === "user") {
      // Restore merchant user
      const uId = payload.user?.id || item.original_id;
      const finalUserStatus = targetStatus || payload.previousStatus || "active";
      if (payload.user) {
        const emailVerifiedAt = formatMysqlDate(payload.user.email_verified_at);
        const phoneVerifiedAt = formatMysqlDate(payload.user.phone_verified_at);
        const userCreatedAt = formatMysqlDate(payload.user.created_at) || formatMysqlDate(item.deleted_at) || nowFormatted();

        // Re-insert or update user record
        await db.query(
          `
          INSERT INTO users (id, email, phone, password_hash, email_verified_at, phone_verified_at, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
          ON DUPLICATE KEY UPDATE
            status = VALUES(status),
            email_verified_at = VALUES(email_verified_at),
            phone_verified_at = VALUES(phone_verified_at),
            updated_at = NOW()
          `,
          [
            payload.user.id,
            payload.user.email,
            payload.user.phone,
            payload.user.password_hash || "",
            emailVerifiedAt,
            phoneVerifiedAt,
            finalUserStatus,
            userCreatedAt,
          ]
        );

        // Ensure role is intact
        if (payload.roles && payload.roles.length) {
          for (const roleId of payload.roles) {
            await db.query("INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)", [payload.user.id, roleId]);
          }
        }
      } else if (uId) {
        await db.query("UPDATE users SET status = ?, updated_at = NOW() WHERE id = ?", [finalUserStatus, uId]);
      }
    } else if (item.section === "platform_admin") {
      // Restore platform administrator
      const aData = payload.adminUser;
      const uData = payload.user;
      if (aData) {
        const createdAt = formatMysqlDate(aData.created_at || item.deleted_at) || nowFormatted();
        const finalStatus = targetStatus || aData.status || "active";

        // Re-insert or update user record if provided
        if (uData) {
          const emailVerifiedAt = formatMysqlDate(uData.email_verified_at);
          const phoneVerifiedAt = formatMysqlDate(uData.phone_verified_at);
          const userCreatedAt = formatMysqlDate(uData.created_at) || nowFormatted();
          await db.query(
            `
            INSERT INTO users (id, email, phone, password_hash, email_verified_at, phone_verified_at, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
            ON DUPLICATE KEY UPDATE
              status = VALUES(status),
              email_verified_at = VALUES(email_verified_at),
              phone_verified_at = VALUES(phone_verified_at),
              updated_at = NOW()
            `,
            [
              uData.id,
              uData.email,
              uData.phone,
              uData.password_hash || "",
              emailVerifiedAt,
              phoneVerifiedAt,
              "active",
              userCreatedAt,
            ]
          );
        } else if (aData.user_id) {
          await db.query("UPDATE users SET status = 'active', updated_at = NOW() WHERE id = ?", [aData.user_id]);
        }

        // Re-insert into platform_admin_users
        await db.query(
          `
          INSERT INTO platform_admin_users (id, user_id, full_name, avatar_url, role_id, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
          ON DUPLICATE KEY UPDATE
            status = VALUES(status),
            full_name = VALUES(full_name),
            role_id = VALUES(role_id),
            updated_at = NOW()
          `,
          [
            aData.id,
            aData.user_id,
            aData.full_name || item.title,
            aData.avatar_url || null,
            aData.role_id,
            finalStatus,
            createdAt,
          ]
        );

        // Re-assign role
        if (aData.role_id && aData.user_id) {
          await db.query("INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)", [aData.user_id, aData.role_id]);
        }
      }
    }

    // Delete from trash bin once restored
    await db.query("DELETE FROM admin_trash_bin WHERE id = ?", [trashId]);
    return { success: true, message: `"${item.title}" successfully restored.` };
  },

  /**
   * Batch restore multiple items
   */
  async batchRestore(ids = [], customOptions = {}) {
    let count = 0;
    for (const id of ids) {
      try {
        await this.restoreItem(id, customOptions);
        count++;
      } catch (_) {}
    }
    return count;
  },

  /**
   * Batch permanently delete items
   */
  async batchPermanentDelete(ids = []) {
    if (!ids.length) return 0;
    const placeholders = ids.map(() => "?").join(",");
    const [res] = await db.query(`DELETE FROM admin_trash_bin WHERE id IN (${placeholders})`, ids);
    return res.affectedRows;
  },

  /**
   * Permanently delete single item from trash
   */
  async permanentDelete(trashId) {
    const [rows] = await db.query("SELECT * FROM admin_trash_bin WHERE id = ?", [trashId]);
    if (!rows.length) return false;
    await db.query("DELETE FROM admin_trash_bin WHERE id = ?", [trashId]);
    return true;
  },

  /**
   * Empty trash completely or by section
   */
  async emptyTrash(section = "all") {
    if (section && section !== "all") {
      const [res] = await db.query("DELETE FROM admin_trash_bin WHERE section = ?", [section]);
      return res.affectedRows;
    }
    const [res] = await db.query("DELETE FROM admin_trash_bin");
    return res.affectedRows;
  },
};

export const trashController = {
  async list(req, res, next) {
    try {
      const { section, search, page, limit } = req.query;
      const data = await trashService.listTrash({ section, search, page, limit });
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  async restore(req, res, next) {
    try {
      const { id } = req.params;
      const result = await trashService.restoreItem(id, req.body);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async batchRestore(req, res, next) {
    try {
      const { ids = [], customOptions = {} } = req.body;
      const count = await trashService.batchRestore(ids, customOptions);
      res.json({ success: true, count, message: `${count} item(s) restored.` });
    } catch (err) {
      next(err);
    }
  },

  async batchDelete(req, res, next) {
    try {
      const { ids = [] } = req.body;
      const count = await trashService.batchPermanentDelete(ids);
      res.json({ success: true, count, message: `${count} item(s) permanently deleted.` });
    } catch (err) {
      next(err);
    }
  },

  async permanentDelete(req, res, next) {
    try {
      const { id } = req.params;
      await trashService.permanentDelete(id);
      res.json({ success: true, message: "Item permanently removed from trash." });
    } catch (err) {
      next(err);
    }
  },

  async empty(req, res, next) {
    try {
      const { section } = req.body || {};
      const count = await trashService.emptyTrash(section);
      res.json({ success: true, message: `Trash cleared (${count} items removed).` });
    } catch (err) {
      next(err);
    }
  },
};
