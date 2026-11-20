import { hashPassword, verifyPassword } from "../../../utils/password.js";
import crypto from "crypto";
import { db } from "../../../config/db.js";
import { logAdminAudit } from "../../../utils/auditLogger.js";
import { normalizeBdPhone, smsService } from "../../../services/sms.service.js";
import { generateOtp, hashOtp } from "../../auth/auth.utils.js";
import { cmsService } from "../cms/cms.service.js";
import { isDevVerificationBypass } from "../../../config/env.js";

const OTP_LIFETIME_MS = 5 * 60 * 1000; // 5 minutes

export const adminProfileController = {
  /**
   * 1. GET /api/admin/profile
   * Returns current admin's full profile, role, account status, permissions, and phone verification state
   */
  async getProfile(req, res, next) {
    try {
      const [userRows] = await db.execute(
        `
          SELECT 
            u.id, 
            u.email, 
            u.phone, 
            u.status, 
            u.email_verified_at,
            u.phone_verified_at,
            u.last_login_at, 
            u.last_login_ip, 
            u.created_at,
            pau.full_name,
            pau.avatar_url,
            pau.status AS pau_status,
            r.id AS role_id,
            r.name AS role, 
            r.description AS role_description
          FROM users u
          LEFT JOIN platform_admin_users pau ON pau.user_id = u.id
          LEFT JOIN roles r ON r.id = pau.role_id
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
          fullName: u.full_name || req.user.name || "Admin User",
          email: u.email,
          phone: u.phone,
          status: u.pau_status || u.status || "active",
          emailVerified: Boolean(u.email_verified_at),
          phoneVerified: Boolean(u.phone_verified_at),
          roleId: u.role_id,
          role: u.role || req.user.role || "super_admin",
          roleDescription: u.role_description,
          avatarUrl: u.avatar_url || null,
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

  /**
   * 2. PUT /api/admin/profile
   * Updates basic information (Full Name, Avatar)
   */
  async updateProfile(req, res, next) {
    try {
      const { fullName, avatarUrl } = req.body;
      if (fullName && typeof fullName === "string" && fullName.trim()) {
        await db.execute(
          `UPDATE platform_admin_users SET full_name = ?, updated_at = NOW() WHERE user_id = ?`,
          [fullName.trim(), req.user.id]
        );
      }

      if (avatarUrl !== undefined) {
        await db.execute(
          `UPDATE platform_admin_users SET avatar_url = ?, updated_at = NOW() WHERE user_id = ?`,
          [avatarUrl || null, req.user.id]
        );
      }

      await logAdminAudit({
        userId: req.user.id,
        adminEmail: req.user.email,
        action: "ADMIN_PROFILE_UPDATED",
        resourceType: "platform_admin",
        resourceId: req.user.id,
        details: { fullName, avatarUrl: Boolean(avatarUrl) },
        ip: req.ip,
        userAgent: req.get("user-agent"),
      });

      res.json({ success: true, message: "Profile information updated successfully." });
    } catch (err) {
      next(err);
    }
  },

  /**
   * 3. POST /api/admin/profile/avatar
   * Uploads personal profile avatar image
   */
  async uploadAvatar(req, res, next) {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: "No image file provided." });
      }
      const uploaded = await cmsService.uploadPublicMedia(req.file);
      await db.execute(
        `UPDATE platform_admin_users SET avatar_url = ?, updated_at = NOW() WHERE user_id = ?`,
        [uploaded.url, req.user.id]
      );

      res.json({
        success: true,
        message: "Avatar photo updated successfully.",
        data: { avatarUrl: uploaded.url },
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * 4. PUT /api/admin/profile/password
   * Securely changes current admin's password after verifying existing password
   * Invalidates all active tokens & sessions by bumping token_version
   */
  async changePassword(req, res, next) {
    try {
      const { currentPassword, newPassword, confirmPassword } = req.body;

      if (!currentPassword || !newPassword) {
        return res.status(400).json({
          success: false,
          message: "Current password and new password are required.",
        });
      }

      if (newPassword.length < 8) {
        return res.status(400).json({
          success: false,
          message: "New password must be at least 8 characters long and sufficiently complex.",
        });
      }

      if (confirmPassword && newPassword !== confirmPassword) {
        return res.status(400).json({
          success: false,
          message: "New password and confirmation password do not match.",
        });
      }

      const [rows] = await db.execute("SELECT password_hash FROM users WHERE id = ? LIMIT 1", [req.user.id]);
      if (!rows.length) {
        return res.status(404).json({ success: false, message: "User not found." });
      }

      const valid = await verifyPassword(rows[0].password_hash, currentPassword);
      if (!valid) {
        return res.status(400).json({
          success: false,
          message: "The current password provided is incorrect.",
        });
      }

      // Hash with bcryptjs
      const newHash = await hashPassword(newPassword);

      // Invalidate all tokens & sessions across all devices
      await db.execute(
        `UPDATE users 
         SET password_hash = ?, 
             password_changed_at = NOW(), 
             token_version = token_version + 1, 
             updated_at = NOW() 
         WHERE id = ?`,
        [newHash, req.user.id]
      );

      try {
        await db.execute("DELETE FROM sessions WHERE user_id = ?", [req.user.id]);
      } catch (_) {}

      // Clear cookie
      res.clearCookie("bq_access", { httpOnly: true, sameSite: "lax" });

      await logAdminAudit({
        userId: req.user.id,
        adminEmail: req.user.email,
        action: "ADMIN_PASSWORD_CHANGED",
        resourceType: "platform_admin",
        resourceId: req.user.id,
        details: { sessionsRevoked: true },
        ip: req.ip,
        userAgent: req.get("user-agent"),
      });

      res.json({
        success: true,
        message: "Password changed successfully. Active sessions revoked; please log in again.",
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * 5. POST /api/admin/profile/phone/request-change
   * Sends an OTP to the proposed new phone number using GenNet SMS gateway
   */
  async requestPhoneChangeOtp(req, res, next) {
    try {
      const { newPhone } = req.body;
      if (!newPhone) {
        return res.status(400).json({ success: false, message: "New mobile number is required." });
      }

      const norm = normalizeBdPhone(newPhone);
      if (!norm) {
        return res.status(400).json({
          success: false,
          message: "Invalid Bangladeshi mobile number format (e.g. 017XXXXXXXX).",
        });
      }

      // Check if another user is already registered with this phone
      const [existing] = await db.query(
        "SELECT id FROM users WHERE phone = ? AND id != ? LIMIT 1",
        [norm.local, req.user.id]
      );
      if (existing.length > 0) {
        return res.status(409).json({
          success: false,
          message: "This mobile number is already registered to another account.",
        });
      }

      const otp = generateOtp();
      const codeHash = hashOtp(otp);
      const expiresAt = new Date(Date.now() + OTP_LIFETIME_MS);

      // Invalidate previous phone_change OTPs for this user
      await db.execute(
        `UPDATE otp_codes SET expires_at = NOW() WHERE user_id = ? AND purpose = 'phone_change'`,
        [req.user.id]
      );

      await db.execute(
        `INSERT INTO otp_codes (user_id, destination, purpose, code_hash, expires_at, created_at, attempts) 
         VALUES (?, ?, 'phone_change', ?, ?, NOW(), 0)`,
        [req.user.id, norm.local, codeHash, expiresAt]
      );

      // Send SMS via GenNet Gateway
      try {
        await smsService.sendOtpSms({
          to: norm.local,
          otp,
          purpose: "phone_change",
          expiresMinutes: 5,
        });
        console.log(`[Admin Profile] SMS OTP sent successfully to ${norm.local}`);
      } catch (smsErr) {
        console.warn("[Admin Profile] SMS send warning:", smsErr.message);
      }

      res.json({
        success: true,
        message: `Verification code sent to ${norm.local}.`,
        data: {
          destination: norm.local,
          devCode: isDevVerificationBypass() ? otp : undefined,
        },
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * 6. POST /api/admin/profile/phone/verify-change
   * Verifies OTP and commits verified phone number to database
   */
  async verifyPhoneChange(req, res, next) {
    try {
      const { newPhone, code } = req.body;
      if (!newPhone || !code) {
        return res.status(400).json({
          success: false,
          message: "Mobile number and 6-digit OTP code are required.",
        });
      }

      const norm = normalizeBdPhone(newPhone);
      if (!norm) {
        return res.status(400).json({ success: false, message: "Invalid mobile number format." });
      }

      const [otpRows] = await db.query(
        `SELECT * FROM otp_codes 
         WHERE user_id = ? 
           AND destination = ? 
           AND purpose = 'phone_change' 
           AND verified_at IS NULL 
           AND expires_at > NOW() 
         ORDER BY id DESC LIMIT 1`,
        [req.user.id, norm.local]
      );

      if (!otpRows.length) {
        return res.status(400).json({
          success: false,
          message: "Invalid or expired verification code. Please request a new code.",
        });
      }

      const record = otpRows[0];
      const match = hashOtp(code.trim()) === record.code_hash;

      if (!match) {
        await db.execute("UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?", [record.id]);
        return res.status(400).json({
          success: false,
          message: "Incorrect verification code.",
        });
      }

      // Mark OTP as verified
      await db.execute("UPDATE otp_codes SET verified_at = NOW() WHERE id = ?", [record.id]);

      // Atomically update phone and mark verified in users table
      await db.execute(
        `UPDATE users 
         SET phone = ?, phone_verified_at = NOW(), updated_at = NOW() 
         WHERE id = ?`,
        [norm.local, req.user.id]
      );

      await logAdminAudit({
        userId: req.user.id,
        adminEmail: req.user.email,
        action: "ADMIN_PHONE_CHANGED",
        resourceType: "platform_admin",
        resourceId: req.user.id,
        details: { newPhone: norm.local },
        ip: req.ip,
        userAgent: req.get("user-agent"),
      });

      res.json({
        success: true,
        message: "Mobile number updated and verified successfully.",
        data: { phone: norm.local },
      });
    } catch (err) {
      next(err);
    }
  },
};
