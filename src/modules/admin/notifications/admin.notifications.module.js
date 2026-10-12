import { db } from "../../../config/db.js";

export const adminNotificationsRepository = {
  async listNotifications(limit = 100) {
    const numLimit = Math.max(1, parseInt(limit, 10) || 100);
    const [rows] = await db.query(
      `
        SELECT *
        FROM notifications
        WHERE recipient_type IN ('admin', 'all')
        ORDER BY created_at DESC
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
};

export const adminNotificationsController = {
  async list(req, res, next) {
    try {
      const limit = Number(req.query.limit) || 100;
      const data = await adminNotificationsRepository.listNotifications(limit);
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
};
