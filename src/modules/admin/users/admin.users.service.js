import crypto from "crypto";
import { adminUsersRepository } from "./admin.users.repository.js";
import { db } from "../../../config/db.js";
import { logAdminAudit } from "../../../utils/auditLogger.js";
import { cmsService } from "../cms/cms.service.js";
import { hashPassword } from "../../../utils/password.js";
import { trashService } from "../trash/trash.module.js";

export const adminUsersService = {
  // ==========================================
  // 1. PLATFORM ADMIN USERS
  // ==========================================
  async listPlatformAdmins(query) {
    return adminUsersRepository.listPlatformAdmins(query);
  },

  async invitePlatformAdmin({ email, fullName, phone, roleId }, invitingUser, reqMeta = {}) {
    if (!email || !fullName || !roleId) {
      const err = new Error("Email, Full Name, and Role are required");
      err.statusCode = 400;
      throw err;
    }

    const cleanEmail = email.trim().toLowerCase();

    // Check if role exists and is platform-scoped
    const role = await adminUsersRepository.getRoleById(roleId);
    if (!role || role.scope !== "platform") {
      const err = new Error("Invalid role selected. Must be an active platform admin role.");
      err.statusCode = 400;
      throw err;
    }

    // Check if user already exists in platform_admin_users
    const [existingPau] = await db.query(
      `SELECT pau.id, pau.status FROM platform_admin_users pau JOIN users u ON u.id = pau.user_id WHERE u.email = ? LIMIT 1`,
      [cleanEmail]
    );
    if (existingPau.length > 0) {
      const err = new Error("A platform admin account already exists with this email address.");
      err.statusCode = 409;
      throw err;
    }

    // Generate secure 32-byte cryptographic invitation token
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    // Revoke previous pending invitations for this email
    await db.execute(
      `UPDATE platform_admin_invitations SET status = 'revoked', updated_at = NOW() WHERE email = ? AND status = 'pending'`,
      [cleanEmail]
    );

    const invitationId = await adminUsersRepository.createPlatformAdminInvitation({
      email: cleanEmail,
      fullName: fullName.trim(),
      phone: phone?.trim() || null,
      roleId: Number(roleId),
      tokenHash,
      expiresAt,
      invitedByUserId: invitingUser?.id || null,
    });

    // Audit Log
    await logAdminAudit({
      userId: invitingUser?.id,
      adminEmail: invitingUser?.email || "superadmin@banglaqr.com",
      action: "PLATFORM_ADMIN_INVITED",
      resourceType: "platform_admin",
      resourceId: invitationId,
      details: { email: cleanEmail, fullName, roleName: role.name, roleId },
      ip: reqMeta.ip,
      userAgent: reqMeta.userAgent,
    });

    return {
      invitationId,
      email: cleanEmail,
      rawToken, // Provided to caller (in production also sent via secure mailer)
      invitationLink: `/admin/invitations/accept?token=${rawToken}`,
      expiresAt,
    };
  },

  async listPlatformAdminInvitations(query) {
    return adminUsersRepository.listPlatformAdminInvitations(query);
  },

  async resendPlatformAdminInvitation(id, actingUser, reqMeta = {}) {
    const inv = await adminUsersRepository.getPlatformAdminInvitationById(id);
    if (!inv) {
      const err = new Error("Invitation not found");
      err.statusCode = 404;
      throw err;
    }

    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await adminUsersRepository.updatePlatformAdminInvitation(id, {
      token_hash: tokenHash,
      status: "pending",
      expires_at: expiresAt,
    });

    await logAdminAudit({
      userId: actingUser?.id,
      adminEmail: actingUser?.email,
      action: "PLATFORM_ADMIN_INVITATION_RESENT",
      resourceType: "platform_admin",
      resourceId: id,
      details: { email: inv.email },
      ip: reqMeta.ip,
      userAgent: reqMeta.userAgent,
    });

    return {
      invitationId: id,
      email: inv.email,
      rawToken,
      invitationLink: `/admin/invitations/accept?token=${rawToken}`,
      expiresAt,
    };
  },

  async revokePlatformAdminInvitation(id, actingUser, reqMeta = {}) {
    const inv = await adminUsersRepository.getPlatformAdminInvitationById(id);
    if (!inv) {
      const err = new Error("Invitation not found");
      err.statusCode = 404;
      throw err;
    }

    await adminUsersRepository.updatePlatformAdminInvitation(id, { status: "revoked" });

    await logAdminAudit({
      userId: actingUser?.id,
      adminEmail: actingUser?.email,
      action: "PLATFORM_ADMIN_INVITATION_REVOKED",
      resourceType: "platform_admin",
      resourceId: id,
      details: { email: inv.email },
      ip: reqMeta.ip,
      userAgent: reqMeta.userAgent,
    });

    return { success: true, message: "Invitation has been revoked" };
  },

  async updatePlatformAdmin(id, { fullName, email, phone, password, newPassword, roleId, status }, actingUser, reqMeta = {}) {
    const adminUser = await adminUsersRepository.getPlatformAdminById(id);
    if (!adminUser) {
      const err = new Error("Platform admin user not found");
      err.statusCode = 404;
      throw err;
    }

    // Protect last active super_admin from demotion or suspension
    if (adminUser.role_name === "super_admin" && (status === "suspended" || status === "disabled" || (roleId && Number(roleId) !== Number(adminUser.role_id)))) {
      const [superAdminCount] = await db.query(
        `SELECT COUNT(*) as count FROM platform_admin_users pau JOIN roles r ON r.id = pau.role_id WHERE r.name = 'super_admin' AND pau.status = 'active'`
      );
      if (Number(superAdminCount[0]?.count || 0) <= 1) {
        const err = new Error("Cannot suspend or change role of the sole remaining active Super Admin.");
        err.statusCode = 400;
        throw err;
      }
    }

    let roleName = adminUser.role_name;
    if (roleId && Number(roleId) !== Number(adminUser.role_id)) {
      const role = await adminUsersRepository.getRoleById(roleId);
      if (!role || role.scope !== "platform") {
        const err = new Error("Invalid platform role selected.");
        err.statusCode = 400;
        throw err;
      }
      roleName = role.name;

      // Also update user_roles mapping to ensure backwards compatibility
      await db.execute(`DELETE FROM user_roles WHERE user_id = ? AND role_id = ?`, [adminUser.user_id, adminUser.role_id]);
      await db.execute(`INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)`, [adminUser.user_id, Number(roleId)]);
    }

    // Update users table for email, phone, password, and status
    const userUpdates = [];
    const userParams = [];

    if (email && email.trim() && email.trim().toLowerCase() !== (adminUser.email || "").toLowerCase()) {
      const normalizedEmail = email.trim().toLowerCase();
      const [existing] = await db.query("SELECT id FROM users WHERE email = ? AND id != ?", [normalizedEmail, adminUser.user_id]);
      if (existing.length) {
        const err = new Error("This email is already in use by another user account.");
        err.statusCode = 409;
        throw err;
      }
      userUpdates.push("email = ?");
      userParams.push(normalizedEmail);
    }

    if (phone !== undefined) {
      const cleanPhone = phone && phone.trim().length > 0 ? phone.trim() : null;
      if (cleanPhone && cleanPhone !== (adminUser.phone || null)) {
        const [existingPhone] = await db.query(
          "SELECT id FROM users WHERE phone = ? AND id != ?",
          [cleanPhone, adminUser.user_id]
        );
        if (existingPhone.length) {
          const err = new Error("This mobile phone number is already registered to another user account.");
          err.statusCode = 409;
          throw err;
        }
        userUpdates.push("phone = ?");
        userParams.push(cleanPhone);
      } else if (cleanPhone === null && adminUser.phone) {
        userUpdates.push("phone = NULL");
      }
    }

    const nextPassword = password || newPassword;
    if (nextPassword && typeof nextPassword === "string" && nextPassword.trim().length > 0) {
      if (nextPassword.trim().length < 6) {
        const err = new Error("Password must be at least 6 characters long.");
        err.statusCode = 400;
        throw err;
      }
      const passwordHash = await hashPassword(nextPassword.trim());
      userUpdates.push("password_hash = ?");
      userParams.push(passwordHash);
      userUpdates.push("password_changed_at = NOW()");

      const isSelf = Number(adminUser.user_id) === Number(actingUser?.id);
      if (!isSelf) {
        userUpdates.push("token_version = token_version + 1");
      }
    }

    if (status) {
      userUpdates.push("status = ?");
      userParams.push(status);
    }

    if (userUpdates.length > 0) {
      userUpdates.push("updated_at = NOW()");
      userParams.push(adminUser.user_id);
      await db.query(`UPDATE users SET ${userUpdates.join(", ")} WHERE id = ?`, userParams);
    }

    // Update platform_admin_users table
    await adminUsersRepository.updatePlatformAdmin(id, { fullName, roleId, status });

    // Invalidate user active sessions when suspended or disabled by bumping token_version
    if (status === "suspended" || status === "disabled") {
      await db.execute(
        `UPDATE users SET token_version = token_version + 1, updated_at = NOW() WHERE id = ?`,
        [adminUser.user_id]
      );
    }

    await logAdminAudit({
      userId: actingUser?.id,
      adminEmail: actingUser?.email,
      action: "PLATFORM_ADMIN_UPDATED",
      resourceType: "platform_admin",
      resourceId: id,
      details: {
        userId: adminUser.user_id,
        email: email || adminUser.email,
        phone: phone !== undefined ? phone : adminUser.phone,
        passwordChanged: Boolean(nextPassword && nextPassword.trim().length > 0),
        oldRole: adminUser.role_name,
        newRole: roleName,
        oldStatus: adminUser.status,
        newStatus: status || adminUser.status,
      },
      ip: reqMeta.ip,
      userAgent: reqMeta.userAgent,
    });

    return adminUsersRepository.getPlatformAdminById(id);
  },

  async deletePlatformAdmin(id, actingUser, reqMeta = {}) {
    const adminUser = await adminUsersRepository.getPlatformAdminById(id);
    if (!adminUser) {
      const err = new Error("Platform administrator not found.");
      err.statusCode = 404;
      throw err;
    }

    // Safety: prevent self-deletion
    if (Number(adminUser.user_id) === Number(actingUser?.id)) {
      const err = new Error("You cannot delete your own platform administrator account.");
      err.statusCode = 400;
      throw err;
    }

    // Protect sole active super_admin
    if (adminUser.role_name === "super_admin") {
      const [superAdminCount] = await db.query(
        `SELECT COUNT(*) as count FROM platform_admin_users pau JOIN roles r ON r.id = pau.role_id WHERE r.name = 'super_admin' AND pau.status = 'active'`
      );
      if (Number(superAdminCount[0]?.count || 0) <= 1) {
        const err = new Error("Cannot delete the sole remaining active Super Admin.");
        err.statusCode = 400;
        throw err;
      }
    }

    // Fetch complete user record to back up into Trash Bin
    const [userRows] = await db.query("SELECT * FROM users WHERE id = ?", [adminUser.user_id]);
    const userSnapshot = userRows[0] || null;

    // Backup to trash bin before deletion
    try {
      await trashService.moveToTrash({
        section: "platform_admin",
        originalId: adminUser.id,
        title: `Platform Admin: ${adminUser.full_name || adminUser.email}`,
        description: `Role: ${adminUser.role_name || "Admin"} • Email: ${adminUser.email}`,
        scope: "admin",
        deletedBy: actingUser?.email || "Super Admin",
        payload: {
          adminUser,
          user: userSnapshot,
          deletedAt: new Date().toISOString(),
        },
      });
    } catch (trashErr) {
      console.warn("Failed to backup platform admin to trash:", trashErr.message);
    }

    // Remove from platform_admin_users
    await db.query("DELETE FROM platform_admin_users WHERE id = ?", [Number(id)]);

    // Remove role mapping
    await db.query("DELETE FROM user_roles WHERE user_id = ? AND role_id = ?", [adminUser.user_id, adminUser.role_id]);

    // Check if user has other memberships/roles. If none, deactivate user
    const [remainingRoles] = await db.query("SELECT * FROM user_roles WHERE user_id = ?", [adminUser.user_id]);
    if (!remainingRoles.length) {
      await db.query("UPDATE users SET status = 'disabled', token_version = token_version + 1, updated_at = NOW() WHERE id = ?", [adminUser.user_id]);
    }

    await logAdminAudit({
      userId: actingUser?.id,
      adminEmail: actingUser?.email,
      action: "PLATFORM_ADMIN_DELETED",
      resourceType: "platform_admin",
      resourceId: id,
      details: {
        userId: adminUser.user_id,
        email: adminUser.email,
        role: adminUser.role_name,
        name: adminUser.full_name,
      },
      ip: reqMeta.ip,
      userAgent: reqMeta.userAgent,
    });

    return { success: true, message: `Platform Admin "${adminUser.full_name || adminUser.email}" deleted successfully.` };
  },

  // ==========================================
  // 2. INSTITUTION STAFF
  // ==========================================
  async listInstitutionStaff(query) {
    return adminUsersRepository.listInstitutionStaffAcrossAll(query);
  },

  async updateStaffImage(membershipId, file, actingUser, reqMeta = {}) {
    if (!file) {
      const err = new Error("No image file uploaded");
      err.statusCode = 400;
      throw err;
    }
    const uploaded = await cmsService.uploadPublicMedia(file);
    await adminUsersRepository.updateStaffImage(membershipId, uploaded.url);

    await logAdminAudit({
      userId: actingUser?.id,
      adminEmail: actingUser?.email,
      action: "INSTITUTION_STAFF_IMAGE_UPDATED",
      resourceType: "institution_staff",
      resourceId: membershipId,
      details: { imageUrl: uploaded.url },
      ip: reqMeta.ip,
      userAgent: reqMeta.userAgent,
    });

    return { imageUrl: uploaded.url };
  },

  async updateInstitutionLogo(institutionId, file, actingUser, reqMeta = {}) {
    if (!file) {
      const err = new Error("No image file uploaded");
      err.statusCode = 400;
      throw err;
    }
    const uploaded = await cmsService.uploadPublicMedia(file);
    await adminUsersRepository.updateInstitutionLogo(institutionId, uploaded.url);

    await logAdminAudit({
      userId: actingUser?.id,
      adminEmail: actingUser?.email,
      action: "INSTITUTION_LOGO_UPDATED",
      resourceType: "institution",
      resourceId: institutionId,
      details: { logoUrl: uploaded.url },
      ip: reqMeta.ip,
      userAgent: reqMeta.userAgent,
    });

    return { logoUrl: uploaded.url };
  },

  // ==========================================
  // 3. ROLES & PERMISSIONS
  // ==========================================
  async listRoles(scope) {
    return adminUsersRepository.listRolesWithPermissions(scope);
  },

  async getAllPermissions() {
    return adminUsersRepository.getAllPermissions();
  },

  async createRole({ name, description, scope, status = "active", permissionIds }, actingUser, reqMeta = {}) {
    if (!name) {
      const err = new Error("Role name is required");
      err.statusCode = 400;
      throw err;
    }

    const cleanName = name.trim().toLowerCase().replace(/\s+/g, "_");
    const roleScope = scope || "platform";

    // Check unique within scope
    const [existing] = await db.query(
      `SELECT id FROM roles WHERE name = ? AND scope = ? LIMIT 1`,
      [cleanName, roleScope]
    );
    if (existing.length > 0) {
      const err = new Error(`Role '${cleanName}' already exists within the ${roleScope} scope.`);
      err.statusCode = 409;
      throw err;
    }

    const roleId = await adminUsersRepository.createRole({
      name: cleanName,
      description,
      scope: roleScope,
      status: status || "active",
    });

    if (Array.isArray(permissionIds) && permissionIds.length > 0) {
      await adminUsersRepository.syncRolePermissions(roleId, permissionIds);
    }

    await logAdminAudit({
      userId: actingUser?.id,
      adminEmail: actingUser?.email,
      action: "ROLE_CREATED",
      resourceType: "role",
      resourceId: roleId,
      details: { name: cleanName, scope: roleScope, permissionsCount: permissionIds?.length || 0 },
      ip: reqMeta.ip,
      userAgent: reqMeta.userAgent,
    });

    return { id: roleId, name: cleanName, description, scope: roleScope, status };
  },

  async updateRole(roleId, { name, description, scope, status, permissionIds }, actingUser, reqMeta = {}) {
    const role = await adminUsersRepository.getRoleById(roleId);
    if (!role) {
      const err = new Error("Role not found");
      err.statusCode = 404;
      throw err;
    }

    // Protect super_admin role
    if (role.name === "super_admin") {
      if (status && status !== "active") {
        const err = new Error("Cannot disable the Super Admin system role.");
        err.statusCode = 400;
        throw err;
      }
      if (scope && scope !== "platform") {
        const err = new Error("Cannot alter scope of system Super Admin role.");
        err.statusCode = 400;
        throw err;
      }
    }

    // Check duplicate name within scope if name is changing
    if (name) {
      const cleanName = name.trim().toLowerCase().replace(/\s+/g, "_");
      const targetScope = scope || role.scope;
      const [existing] = await db.query(
        `SELECT id FROM roles WHERE name = ? AND scope = ? AND id != ? LIMIT 1`,
        [cleanName, targetScope, Number(roleId)]
      );
      if (existing.length > 0) {
        const err = new Error(`Role '${cleanName}' already exists within ${targetScope} scope.`);
        err.statusCode = 409;
        throw err;
      }
    }

    await adminUsersRepository.updateRole(roleId, { name, description, scope, status });

    if (Array.isArray(permissionIds) && role.name !== "super_admin") {
      await adminUsersRepository.syncRolePermissions(roleId, permissionIds);
    }

    await logAdminAudit({
      userId: actingUser?.id,
      adminEmail: actingUser?.email,
      action: "ROLE_UPDATED",
      resourceType: "role",
      resourceId: roleId,
      details: { roleName: role.name, scope, status, permissionCount: permissionIds?.length },
      ip: reqMeta.ip,
      userAgent: reqMeta.userAgent,
    });

    return true;
  },

  async deleteRole(roleId, actingUser, reqMeta = {}) {
    const role = await adminUsersRepository.getRoleById(roleId);
    if (!role) {
      const err = new Error("Role not found");
      err.statusCode = 404;
      throw err;
    }

    // Protect system roles
    if (role.is_system || ["super_admin", "admin", "merchant", "bank_admin", "institution_admin"].includes(role.name)) {
      const err = new Error(`Cannot delete system-protected role '${role.name}'.`);
      err.statusCode = 400;
      throw err;
    }

    // Check if role is assigned to any platform admins or institution users
    const assignedCount = await adminUsersRepository.getAssignedUsersCountForRole(roleId, role.scope);
    if (assignedCount > 0) {
      const targetLabel = role.scope === "platform" ? "platform admin(s)" : "institution user(s)";
      const err = new Error(
        `Cannot delete role '${role.name}' because it is currently assigned to ${assignedCount} ${targetLabel}. Please reassign them to another role first.`
      );
      err.statusCode = 400;
      throw err;
    }

    await adminUsersRepository.deleteRole(roleId);

    await logAdminAudit({
      userId: actingUser?.id,
      adminEmail: actingUser?.email,
      action: "ROLE_DELETED",
      resourceType: "role",
      resourceId: roleId,
      details: { roleName: role.name, scope: role.scope },
      ip: reqMeta.ip,
      userAgent: reqMeta.userAgent,
    });

    return true;
  },
};
