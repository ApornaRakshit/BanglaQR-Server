import { db } from "../../../config/db.js";
import { trashService } from "../trash/trash.module.js";

export const adminNotificationsRepository = {
  async listNotifications(limit = 100, sort = "desc") {
    const numLimit = Math.max(1, parseInt(limit, 10) || 100);
    const sortOrder = String(sort).toLowerCase() === "asc" ? "ASC" : "DESC";
    const [rows] = await db.query(
      `
        SELECT *
        FROM notifications
        WHERE recipient_type IN ('admin', 'all')
        ORDER BY created_at ${sortOrder}
        LIMIT ${numLimit}
      `
    );

    const [countRows] = await db.execute(
      `
        SELECT COUNT(*) AS unread_count
        FROM notifications
        WHERE recipient_type IN ('admin', 'all') AND is_read = 0
      `
    );

    const notifications = rows.map((r) => ({
      id: r.id,
      title: r.title,
      message: r.message,
      type: r.type,
      link: r.link,
      isRead: Boolean(r.is_read),
      createdAt: r.created_at,
    }));

    return {
      notifications,
      unreadCount: Number(countRows[0]?.unread_count || 0),
    };
  },

  async getUnreadCount() {
    const [countRows] = await db.execute(
      `
        SELECT COUNT(*) AS unread_count
        FROM notifications
        WHERE recipient_type IN ('admin', 'all') AND is_read = 0
      `
    );
    return Number(countRows[0]?.unread_count || 0);
  },

  async markAsRead(id) {
    await db.execute("UPDATE notifications SET is_read = 1 WHERE id = ?", [id]);
  },

  async markAllAsRead() {
    await db.execute("UPDATE notifications SET is_read = 1 WHERE recipient_type IN ('admin', 'all')");
  },

  async createNotification({ recipientType = "admin", title, message, type = "system", link = null }) {
    const [res] = await db.execute(
      `INSERT INTO notifications (recipient_type, title, message, type, link, is_read, created_at)
       VALUES (?, ?, ?, ?, ?, 0, NOW())`,
      [recipientType, title, message, type, link]
    );
    return res.insertId;
  },

  async deleteNotification(id) {
    await db.execute("DELETE FROM notifications WHERE id = ?", [id]);
  },

  async batchDeleteNotifications(ids = [], scope = "both", deletedBy = "Admin") {
    const cleanIds = (Array.isArray(ids) ? ids : [])
      .map((id) => Number(id))
      .filter((id) => Number.isInteger(id) && id > 0);

    if (!cleanIds.length) return 0;
    const placeholders = cleanIds.map(() => "?").join(",");

    // Preserve in Trash Bin
    try {
      const [existing] = await db.execute(`SELECT * FROM notifications WHERE id IN (${placeholders})`, cleanIds);
      for (const notif of existing) {
        await trashService.moveToTrash({
          section: "notification",
          originalId: notif.id,
          title: notif.title || "Platform Notification",
          description: notif.message ? notif.message.slice(0, 150) : null,
          scope,
          deletedBy,
          payload: notif,
        });
      }
    } catch (e) {
      console.warn("Failed to backup notifications to trash:", e.message);
    }
    
    if (scope === "institution") {
      await db.execute(
        `UPDATE notifications SET recipient_type = 'admin' WHERE id IN (${placeholders}) AND recipient_type = 'all'`,
        cleanIds
      );
      await db.execute(
        `DELETE FROM notifications WHERE id IN (${placeholders}) AND recipient_type = 'institution'`,
        cleanIds
      );
    } else if (scope === "admin") {
      await db.execute(
        `UPDATE notifications SET recipient_type = 'institution' WHERE id IN (${placeholders}) AND recipient_type = 'all'`,
        cleanIds
      );
      await db.execute(
        `DELETE FROM notifications WHERE id IN (${placeholders}) AND recipient_type = 'admin'`,
        cleanIds
      );
    } else {
      await db.execute(`DELETE FROM notifications WHERE id IN (${placeholders})`, cleanIds);
    }
    return cleanIds.length;
  },
};

export const adminNotificationsController = {
  async list(req, res, next) {
    try {
      const limit = Number(req.query.limit) || 100;
      const sort = req.query.sort || "desc";
      const data = await adminNotificationsRepository.listNotifications(limit, sort);
      // Return both flat array format and structured object for flexible client consumption
      res.json({
        success: true,
        data: data.notifications,
        notifications: data.notifications,
        unreadCount: data.unreadCount,
      });
    } catch (err) {
      next(err);
    }
  },

  async unreadCount(req, res, next) {
    try {
      const unreadCount = await adminNotificationsRepository.getUnreadCount();
      res.json({
        success: true,
        data: { unreadCount },
        unreadCount,
      });
    } catch (err) {
      next(err);
    }
  },

  async markRead(req, res, next) {
    try {
      const id = Number(req.params.notifId);
      await adminNotificationsRepository.markAsRead(id);
      const unreadCount = await adminNotificationsRepository.getUnreadCount();
      res.json({ success: true, message: "Marked as read", unreadCount });
    } catch (err) {
      next(err);
    }
  },

  async markAllRead(req, res, next) {
    try {
      await adminNotificationsRepository.markAllAsRead();
      res.json({ success: true, message: "All notifications marked as read", unreadCount: 0 });
    } catch (err) {
      next(err);
    }
  },

  async broadcast(req, res, next) {
    try {
      const { title, message, type, link, recipientType } = req.body;
      const id = await adminNotificationsRepository.createNotification({
        recipientType: recipientType || "all",
        title,
        message,
        type: type || "system",
        link,
      });
      res.status(201).json({ success: true, message: "Notification sent", id });
    } catch (err) {
      next(err);
    }
  },

  async delete(req, res, next) {
    try {
      const id = Number(req.params.notifId);
      await adminNotificationsRepository.deleteNotification(id);
      res.json({ success: true, message: "Notification deleted" });
    } catch (err) {
      next(err);
    }
  },

  async batchDelete(req, res, next) {
    try {
      const { notificationIds = [], scope = "both" } = req.body;
      const count = await adminNotificationsRepository.batchDeleteNotifications(notificationIds, scope, req.user?.email || "Admin");
      res.json({ success: true, count, message: `${count} notification(s) moved to trash bin.` });
    } catch (err) {
      next(err);
    }
  },
};
