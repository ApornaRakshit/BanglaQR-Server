import { db } from "../../../config/db.js";
import { hashPassword } from "../../../utils/password.js";
import { logAdminAudit } from "../../../utils/auditLogger.js";
import { trashService } from "../trash/trash.module.js";

export const merchantUsersService = {
  /**
   * List all registered merchant users with verification & profile status
   */
  async listUsers({ search = "", status = "all", verification = "all", sort = "desc", page = 1, limit = 20 } = {}) {
    const conditions = [];
    const params = [];

    // Filter to merchant role users
    conditions.push("r.name = 'merchant'");

    if (search && search.trim()) {
      const term = `%${search.trim()}%`;
      conditions.push("(u.email LIKE ? OR u.phone LIKE ? OR c.name LIKE ? OR p.company_name LIKE ? OR m.merchant_code LIKE ?)");
      params.push(term, term, term, term, term);
    }

    if (status && status !== "all") {
      conditions.push("u.status = ?");
      params.push(status);
    }

    if (verification === "verified") {
      conditions.push("(u.email_verified_at IS NOT NULL OR u.phone_verified_at IS NOT NULL)");
    } else if (verification === "unverified") {
      conditions.push("(u.email_verified_at IS NULL AND u.phone_verified_at IS NULL)");
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const sortOrder = String(sort).toLowerCase() === "asc" ? "ASC" : "DESC";
    const offset = (Math.max(1, page) - 1) * limit;

    // Count
    const [countRows] = await db.query(
      `
      SELECT COUNT(DISTINCT u.id) AS total
      FROM users u
      JOIN user_roles ur ON u.id = ur.user_id
      JOIN roles r ON ur.role_id = r.id
      LEFT JOIN merchants m ON m.user_id = u.id
      LEFT JOIN merchant_profiles p ON p.merchant_id = m.id
      LEFT JOIN merchant_contacts c ON c.merchant_id = m.id
      ${where}
      `,
      params
    );
    const total = Number(countRows[0]?.total || 0);

    // Rows
    const [rows] = await db.query(
      `
      SELECT
        u.id,
        u.email,
        u.phone,
        u.email_verified_at,
        u.phone_verified_at,
        u.status,
        u.last_login_at,
        u.created_at,
        u.updated_at,
        m.id AS merchant_id,
        m.merchant_code,
        m.account_status,
        COALESCE(c.name, p.company_name, 'Registered User') AS name,
        p.company_name,
        p.business_type
      FROM users u
      JOIN user_roles ur ON u.id = ur.user_id
      JOIN roles r ON ur.role_id = r.id
      LEFT JOIN merchants m ON m.user_id = u.id
      LEFT JOIN merchant_profiles p ON p.merchant_id = m.id
      LEFT JOIN merchant_contacts c ON c.merchant_id = m.id
      ${where}
      GROUP BY u.id
      ORDER BY u.created_at ${sortOrder}
      LIMIT ? OFFSET ?
      `,
      [...params, Number(limit), Number(offset)]
    );

    return {
      users: rows.map((r) => ({
        id: r.id,
        name: r.name,
        email: r.email,
        phone: r.phone,
        isEmailVerified: Boolean(r.email_verified_at),
        emailVerifiedAt: r.email_verified_at,
        isPhoneVerified: Boolean(r.phone_verified_at),
        phoneVerifiedAt: r.phone_verified_at,
        status: r.status,
        lastLoginAt: r.last_login_at,
        createdAt: r.created_at,
        merchantId: r.merchant_id,
        merchantCode: r.merchant_code,
        accountStatus: r.account_status,
        companyName: r.company_name,
        businessType: r.business_type,
      })),
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  },

  /**
   * Update user details (Name, Email, Phone, Status, Verification)
   */
  async updateUserDetails(userId, payload, adminUser, reqMeta = {}) {
    const { name, email, phone, status, isEmailVerified, isPhoneVerified } = payload;

    // 1. Check user exists
    const [users] = await db.query("SELECT * FROM users WHERE id = ?", [userId]);
    if (!users.length) {
      const err = new Error("User not found");
      err.statusCode = 404;
      throw err;
    }
    const user = users[0];

    // 2. Update users table
    const updates = [];
    const params = [];

    if (email !== undefined) {
      updates.push("email = ?");
      params.push(email.trim().toLowerCase());
    }
    if (phone !== undefined) {
      updates.push("phone = ?");
      params.push(phone.trim());
    }
    if (status !== undefined) {
      updates.push("status = ?");
      params.push(status);
    }
    if (isEmailVerified !== undefined) {
      updates.push("email_verified_at = ?");
      params.push(isEmailVerified ? (user.email_verified_at || new Date()) : null);
    }
    if (isPhoneVerified !== undefined) {
      updates.push("phone_verified_at = ?");
      params.push(isPhoneVerified ? (user.phone_verified_at || new Date()) : null);
    }

    if (updates.length) {
      updates.push("updated_at = NOW()");
      params.push(userId);
      await db.query(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`, params);
    }

    // 3. Update merchant contact name if name is provided
    if (name) {
      const [merchants] = await db.query("SELECT id FROM merchants WHERE user_id = ?", [userId]);
      if (merchants.length) {
        const mId = merchants[0].id;
        await db.query(
          `
          INSERT INTO merchant_contacts (merchant_id, name, email, phone, created_at, updated_at)
          VALUES (?, ?, ?, ?, NOW(), NOW())
          ON DUPLICATE KEY UPDATE name = VALUES(name), email = VALUES(email), phone = VALUES(phone), updated_at = NOW()
          `,
          [mId, name.trim(), email || user.email, phone || user.phone]
        );
      }
    }

    // 4. Audit Log
    await logAdminAudit({
      userId: adminUser?.id,
      adminEmail: adminUser?.email,
      action: "MERCHANT_USER_UPDATED",
      resourceType: "user",
      resourceId: userId,
      details: { previous: { email: user.email, phone: user.phone, status: user.status }, updated: payload },
      ip: reqMeta.ip,
      userAgent: reqMeta.userAgent,
    });

    return { success: true, message: "User information updated successfully." };
  },

  /**
   * Reset / Change User Password
   */
  async changeUserPassword(userId, newPassword, adminUser, reqMeta = {}) {
    if (!newPassword || newPassword.length < 6) {
      const err = new Error("Password must be at least 6 characters long.");
      err.statusCode = 400;
      throw err;
    }

    const hashed = await hashPassword(newPassword);
    await db.query("UPDATE users SET password_hash = ?, password_changed_at = NOW(), updated_at = NOW() WHERE id = ?", [hashed, userId]);

    // Invalidate old sessions
    try {
      await db.query("DELETE FROM sessions WHERE user_id = ?", [userId]);
    } catch (_) {}

    await logAdminAudit({
      userId: adminUser?.id,
      adminEmail: adminUser?.email,
      action: "MERCHANT_USER_PASSWORD_CHANGED",
      resourceType: "user",
      resourceId: userId,
      details: { changedBy: adminUser?.email || "Admin" },
      ip: reqMeta.ip,
      userAgent: reqMeta.userAgent,
    });

    return { success: true, message: "Password successfully updated." };
  },

  /**
   * Batch Delete Users (Moves to trash for 30-day retention or cascades based on scope)
   */
  async batchDeleteUsers({ userIds = [], scope = "both", adminUser, ip, userAgent }) {
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return { success: true, count: 0, message: "No users selected" };
    }

    let deletedCount = 0;
    for (const rawId of userIds) {
      const uId = Number(rawId);
      if (!Number.isInteger(uId) || uId <= 0) continue;

      // Fetch user and linked merchant info
      const [userRows] = await db.query(
        `
        SELECT u.*, m.id AS merchant_id, m.merchant_code, m.account_status,
               COALESCE(c.name, p.company_name, 'Registered User') AS display_name,
               p.company_name
        FROM users u
        LEFT JOIN merchants m ON m.user_id = u.id
        LEFT JOIN merchant_profiles p ON p.merchant_id = m.id
        LEFT JOIN merchant_contacts c ON c.merchant_id = m.id
        WHERE u.id = ?
        LIMIT 1
        `,
        [uId]
      );

      if (!userRows.length) continue;
      const targetUser = userRows[0];

      // Get user role ids
      const [roleRows] = await db.query("SELECT role_id FROM user_roles WHERE user_id = ?", [uId]);
      const roleIds = roleRows.map((r) => r.role_id);

      // Move to Trash Bin with 30-day retention
      try {
        await trashService.moveToTrash({
          section: "user",
          originalId: uId,
          title: targetUser.display_name || targetUser.email || `User #${uId}`,
          description: `${targetUser.email || targetUser.phone || ""} • ${targetUser.merchant_code || "No Merchant"} (${targetUser.status || "active"})`,
          scope,
          deletedBy: adminUser?.email || "Admin",
          payload: {
            user: {
              id: targetUser.id,
              email: targetUser.email,
              phone: targetUser.phone,
              password_hash: targetUser.password_hash,
              email_verified_at: targetUser.email_verified_at,
              phone_verified_at: targetUser.phone_verified_at,
              status: targetUser.status,
              created_at: targetUser.created_at,
            },
            roles: roleIds,
            merchantId: targetUser.merchant_id,
            previousStatus: targetUser.status,
          },
        });
      } catch (trashErr) {
        console.warn(`Trash backup skipped for user ${uId}:`, trashErr.message);
      }

      // If scope is both or admin, delete or suspend user record
      try {
        // Clear active sessions
        await db.query("DELETE FROM sessions WHERE user_id = ?", [uId]);

        if (scope === "admin") {
          // Soft disable
          await db.query("UPDATE users SET status = 'suspended', updated_at = NOW() WHERE id = ?", [uId]);
        } else {
          // Delete user (cascades to user_roles, sessions, merchants, etc.)
          await db.query("DELETE FROM users WHERE id = ?", [uId]);
        }

        deletedCount++;

        // Audit log
        await logAdminAudit({
          userId: adminUser?.id,
          adminEmail: adminUser?.email,
          action: "MERCHANT_USER_DELETED",
          resourceType: "user",
          resourceId: uId,
          details: { email: targetUser.email, phone: targetUser.phone, scope },
          ip,
          userAgent,
        });
      } catch (delErr) {
        console.error(`Failed to delete user ${uId}:`, delErr.message);
      }
    }

    return {
      success: true,
      count: deletedCount,
      scope,
      message: `${deletedCount} user(s) processed for ${scope} deletion`,
    };
  },
};

export const merchantUsersController = {
  async list(req, res, next) {
    try {
      const data = await merchantUsersService.listUsers(req.query);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  async update(req, res, next) {
    try {
      const userId = Number(req.params.userId);
      const result = await merchantUsersService.updateUserDetails(userId, req.body, req.user, {
        ip: req.ip,
        userAgent: req.get("user-agent"),
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async changePassword(req, res, next) {
    try {
      const userId = Number(req.params.userId);
      const { password } = req.body;
      const result = await merchantUsersService.changeUserPassword(userId, password, req.user, {
        ip: req.ip,
        userAgent: req.get("user-agent"),
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async batchDelete(req, res, next) {
    try {
      const { userIds, scope } = req.body;
      const result = await merchantUsersService.batchDeleteUsers({
        userIds,
        scope,
        adminUser: req.user,
        ip: req.ip,
        userAgent: req.get("user-agent"),
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
};
