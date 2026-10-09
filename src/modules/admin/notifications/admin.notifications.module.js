import { db } from "../../../config/db.js";

export const adminNotificationsRepository = {
  async listNotifications() {
    const [rows] = await db.execute(
      `
        SELECT *
        FROM notifications
        WHERE recipient_type IN ('admin', 'all')
        ORDER BY created_at DESC
        LIMIT 100
      `
    );

    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      message: r.message,
      type: r.type,
      link: r.link,
      isRead: Boolean(r.is_read),
      createdAt: r.created_at,
    }));
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
      const data = await adminNotificationsRepository.listNotifications();
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  async markRead(req, res, next) {
    try {
      const id = Number(req.params.notifId);
      await adminNotificationsRepository.markAsRead(id);
      res.json({ success: true, message: "Marked as read" });
    } catch (err) {
      next(err);
    }
  },

  async markAllRead(req, res, next) {
    try {
      await adminNotificationsRepository.markAllAsRead();
      res.json({ success: true, message: "All notifications marked as read" });
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

