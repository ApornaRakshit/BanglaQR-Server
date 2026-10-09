import argon2 from "argon2";
import { db } from "../../../config/db.js";
import { logAdminAudit } from "../../../utils/auditLogger.js";

export const adminProfileController = {
  async getProfile(req, res, next) {
    try {
      const [userRows] = await db.execute(
        `
          SELECT u.id, u.email, u.phone, u.status, u.last_login_at, u.last_login_ip, u.created_at, r.name AS role, r.description AS role_description
          FROM users u
          LEFT JOIN user_roles ur ON ur.user_id = u.id
          LEFT JOIN roles r ON r.id = ur.role_id
          WHERE u.id = ?
          LIMIT 1
        `,
        [req.user.id]
      );

      if (!userRows.length) {
        return res.status(404).json({ success: false, message: "User not found" });
      }

      const u = userRows[0];
      const permissions = req.user.permissions || [];

      res.json({
        success: true,
        data: {
          id: u.id,
          email: u.email,
          phone: u.phone,
          status: u.status,
          role: u.role,
          roleDescription: u.role_description,
          lastLoginAt: u.last_login_at,
          lastLoginIp: u.last_login_ip,
          createdAt: u.created_at,
          permissions,
        },
      });
    } catch (err) {
      next(err);
    }
  },

  async updateProfile(req, res, next) {
    try {
      const { phone } = req.body;
      await db.execute(
        "UPDATE users SET phone = COALESCE(?, phone), updated_at = NOW() WHERE id = ?",
        [phone || null, req.user.id]
      );

      await logAdminAudit({
        userId: req.user.id,
        adminEmail: req.user.email,
        action: "profile_update",
        resourceType: "user",
        resourceId: req.user.id,
        details: { phone },
        ip: req.ip,
        userAgent: req.get("user-agent"),
      });

      res.json({ success: true, message: "Profile updated successfully" });
    } catch (err) {
      next(err);
    }
  },

  async changePassword(req, res, next) {
    try {
      const { currentPassword, newPassword } = req.body;
      if (!currentPassword || !newPassword) {
        return res.status(400).json({ success: false, message: "Current password and new password are required" });
      }
      if (newPassword.length < 8) {
        return res.status(400).json({ success: false, message: "New password must be at least 8 characters" });
      }

      const [rows] = await db.execute("SELECT password_hash FROM users WHERE id = ? LIMIT 1", [req.user.id]);
      if (!rows.length) {
        return res.status(404).json({ success: false, message: "User not found" });
      }

      const valid = await argon2.verify(rows[0].password_hash, currentPassword);
      if (!valid) {
        return res.status(400).json({ success: false, message: "Current password does not match" });
      }

      const newHash = await argon2.hash(newPassword);
      await db.execute("UPDATE users SET password_hash = ?, updated_at = NOW() WHERE id = ?", [newHash, req.user.id]);

      await logAdminAudit({
        userId: req.user.id,
        adminEmail: req.user.email,
        action: "password_change",
        resourceType: "user",
        resourceId: req.user.id,
        details: null,
        ip: req.ip,
        userAgent: req.get("user-agent"),
      });

      res.json({ success: true, message: "Password changed successfully" });
    } catch (err) {
      next(err);
    }
  },
};

