import { adminUsersService } from "./admin.users.service.js";

export const adminUsersController = {
  // ==========================================
  // 1. PLATFORM ADMIN USERS
  // ==========================================
  async listPlatformAdmins(req, res, next) {
    try {
      const result = await adminUsersService.listPlatformAdmins({
        search: req.query.search || "",
        roleId: req.query.roleId || "all",
        status: req.query.status || "all",
        page: Number(req.query.page) || 1,
        limit: Number(req.query.limit) || 20,
      });
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },

  async invitePlatformAdmin(req, res, next) {
    try {
      const result = await adminUsersService.invitePlatformAdmin(
        req.body,
        req.user,
        { ip: req.ip, userAgent: req.get("user-agent") }
      );
      res.status(201).json({
        success: true,
        message: "Platform administrator invitation created successfully.",
        data: result,
      });
    } catch (err) {
      next(err);
    }
  },

  async listPlatformAdminInvitations(req, res, next) {
    try {
      const result = await adminUsersService.listPlatformAdminInvitations({
        status: req.query.status || "all",
      });
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },

  async resendPlatformAdminInvitation(req, res, next) {
    try {
      const result = await adminUsersService.resendPlatformAdminInvitation(
        req.params.id,
        req.user,
        { ip: req.ip, userAgent: req.get("user-agent") }
      );
      res.json({
        success: true,
        message: "Platform admin invitation resent successfully.",
        data: result,
      });
    } catch (err) {
      next(err);
    }
  },

  async revokePlatformAdminInvitation(req, res, next) {
    try {
      const result = await adminUsersService.revokePlatformAdminInvitation(
        req.params.id,
        req.user,
        { ip: req.ip, userAgent: req.get("user-agent") }
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async updatePlatformAdmin(req, res, next) {
    try {
      const result = await adminUsersService.updatePlatformAdmin(
        req.params.id,
        req.body,
        req.user,
        { ip: req.ip, userAgent: req.get("user-agent") }
      );
      res.json({
        success: true,
        message: "Platform administrator updated successfully.",
        data: result,
      });
    } catch (err) {
      next(err);
    }
  },

  async deletePlatformAdmin(req, res, next) {
    try {
      const result = await adminUsersService.deletePlatformAdmin(
        req.params.id,
        req.user,
        { ip: req.ip, userAgent: req.get("user-agent") }
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  // ==========================================
  // 2. INSTITUTION STAFF
  // ==========================================
  async listInstitutionStaff(req, res, next) {
    try {
      const result = await adminUsersService.listInstitutionStaff({
        institutionId: req.query.institutionId || "all",
        roleId: req.query.roleId || "all",
        status: req.query.status || "all",
        search: req.query.search || "",
        page: Number(req.query.page) || 1,
        limit: Number(req.query.limit) || 20,
      });
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },

  async uploadStaffImage(req, res, next) {
    try {
      const result = await adminUsersService.updateStaffImage(
        req.params.membershipId,
        req.file,
        req.user,
        { ip: req.ip, userAgent: req.get("user-agent") }
      );
      res.json({
        success: true,
        message: "Staff profile image uploaded successfully",
        data: result,
      });
    } catch (err) {
      next(err);
    }
  },

  async uploadInstitutionLogo(req, res, next) {
    try {
      const result = await adminUsersService.updateInstitutionLogo(
        req.params.institutionId,
        req.file,
        req.user,
        { ip: req.ip, userAgent: req.get("user-agent") }
      );
      res.json({
        success: true,
        message: "Institution logo uploaded successfully",
        data: result,
      });
    } catch (err) {
      next(err);
    }
  },

  // ==========================================
  // 3. ROLES & PERMISSIONS
  // ==========================================
  async listRoles(req, res, next) {
    try {
      const result = await adminUsersService.listRoles(req.query.scope || "all");
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },

  async getAllPermissions(req, res, next) {
    try {
      const result = await adminUsersService.getAllPermissions();
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },

  async createRole(req, res, next) {
    try {
      const result = await adminUsersService.createRole(
        req.body,
        req.user,
        { ip: req.ip, userAgent: req.get("user-agent") }
      );
      res.status(201).json({
        success: true,
        message: "Role created successfully.",
        data: result,
      });
    } catch (err) {
      next(err);
    }
  },

  async updateRole(req, res, next) {
    try {
      await adminUsersService.updateRole(
        req.params.id,
        req.body,
        req.user,
        { ip: req.ip, userAgent: req.get("user-agent") }
      );
      res.json({
        success: true,
        message: "Role and permissions updated successfully.",
      });
    } catch (err) {
      next(err);
    }
  },

  async deleteRole(req, res, next) {
    try {
      await adminUsersService.deleteRole(
        req.params.id,
        req.user,
        { ip: req.ip, userAgent: req.get("user-agent") }
      );
      res.json({
        success: true,
        message: "Role deleted successfully.",
      });
    } catch (err) {
      next(err);
    }
  },
};
