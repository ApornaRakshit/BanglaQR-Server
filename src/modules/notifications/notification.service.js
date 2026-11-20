import { db } from "../../config/db.js";

export const notificationService = {
  /**
   * Dispatches in-app notification to all admins
   */
  async notifyAdmin({ title, message, type = "payment", link = "/admin/addons" }) {
    try {
      const [res] = await db.execute(
        `INSERT INTO notifications (recipient_type, recipient_id, title, message, type, link, is_read, created_at)
         VALUES ('admin', NULL, ?, ?, ?, ?, 0, NOW())`,
        [title, message, type, link]
      );
      return res.insertId;
    } catch (err) {
      console.error("[Notification] Failed to notify admin:", err.message);
      return null;
    }
  },

  /**
   * Dispatches in-app notification to specific merchant
   */
  async notifyMerchant(merchantId, { title, message, type = "payment", link = "/merchant/addons" }) {
    try {
      // Find merchant's user_id
      const [merchants] = await db.query(
        "SELECT user_id FROM merchants WHERE id = ? LIMIT 1",
        [merchantId]
      );
      const userId = merchants[0]?.user_id || null;

      const [res] = await db.execute(
        `INSERT INTO notifications (recipient_type, recipient_id, title, message, type, link, is_read, created_at)
         VALUES ('merchant', ?, ?, ?, ?, ?, 0, NOW())`,
        [userId, title, message, type, link]
      );
      return res.insertId;
    } catch (err) {
      console.error("[Notification] Failed to notify merchant:", err.message);
      return null;
    }
  },
};

