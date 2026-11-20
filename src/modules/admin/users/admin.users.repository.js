import crypto from "crypto";
import { db } from "../../../config/db.js";

export const adminUsersRepository = {
  // ==========================================
  // 1. PLATFORM ADMIN USERS
  // ==========================================
  async listPlatformAdmins({ search = "", roleId = "all", status = "all", page = 1, limit = 20 }) {
    const conditions = [];
    const params = [];

    if (search) {
      conditions.push("(pau.full_name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)");
      const s = `%${search}%`;
      params.push(s, s, s);
    }

    if (roleId && roleId !== "all") {
      conditions.push("pau.role_id = ?");
      params.push(Number(roleId));
    }

    if (status && status !== "all") {
      conditions.push("pau.status = ?");
      params.push(status);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const offset = (Number(page) - 1) * Number(limit);

    const [countRows] = await db.query(
      `
      SELECT COUNT(pau.id) AS total
      FROM platform_admin_users pau
      JOIN users u ON u.id = pau.user_id
      JOIN roles r ON r.id = pau.role_id
      ${where}
      `,
      params
    );
    const total = Number(countRows[0]?.total || 0);

    const [rows] = await db.query(
      `
      SELECT 
        pau.id,
        pau.user_id,
        pau.full_name,
        pau.role_id,
        pau.status,
        pau.created_at,
        pau.updated_at,
        u.email,
        u.phone,
        u.last_login_at,
        u.last_login_ip,
        r.name AS role_name,
        r.description AS role_description,
        creator.email AS created_by_email
      FROM platform_admin_users pau
      JOIN users u ON u.id = pau.user_id
      JOIN roles r ON r.id = pau.role_id
      LEFT JOIN users creator ON creator.id = pau.created_by_user_id
      ${where}
      ORDER BY pau.id DESC
      LIMIT ? OFFSET ?
      `,
      [...params, Number(limit), Number(offset)]
    );

    return { total, page: Number(page), limit: Number(limit), users: rows };
  },

  async getPlatformAdminById(id) {
    const [rows] = await db.query(
      `
      SELECT 
        pau.*,
        u.email,
        u.phone,
        u.last_login_at,
        u.last_login_ip,
        u.token_version,
        r.name AS role_name,
        r.description AS role_description
      FROM platform_admin_users pau
      JOIN users u ON u.id = pau.user_id
      JOIN roles r ON r.id = pau.role_id
      WHERE pau.id = ?
      LIMIT 1
      `,
      [Number(id)]
    );
    return rows[0] || null;
  },

  async getPlatformAdminByUserId(userId) {
    const [rows] = await db.query(
      `SELECT * FROM platform_admin_users WHERE user_id = ? LIMIT 1`,
      [Number(userId)]
    );
    return rows[0] || null;
  },

  async updatePlatformAdmin(id, { fullName, roleId, status }) {
    const updates = [];
    const params = [];

    if (fullName !== undefined) {
      updates.push("full_name = ?");
      params.push(fullName.trim());
    }
    if (roleId !== undefined) {
      updates.push("role_id = ?");
      params.push(Number(roleId));
    }
    if (status !== undefined) {
      updates.push("status = ?");
      params.push(status);
    }

    if (!updates.length) return false;

    params.push(Number(id));
    await db.execute(
      `UPDATE platform_admin_users SET ${updates.join(", ")}, updated_at = NOW() WHERE id = ?`,
      params
    );
    return true;
  },

  async createPlatformAdminInvitation({ email, fullName, phone, roleId, tokenHash, expiresAt, invitedByUserId }) {
    const [res] = await db.execute(
      `
      INSERT INTO platform_admin_invitations
        (email, full_name, phone, role_id, token_hash, status, expires_at, invited_by_user_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, NOW(), NOW())
      `,
      [email.trim().toLowerCase(), fullName.trim(), phone?.trim() || null, Number(roleId), tokenHash, expiresAt, invitedByUserId]
    );
    return res.insertId;
  },

  async listPlatformAdminInvitations({ status = "all" }) {
    const conditions = [];
    const params = [];

    if (status && status !== "all") {
      conditions.push("pai.status = ?");
      params.push(status);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const [rows] = await db.query(
      `
      SELECT 
        pai.*,
        r.name AS role_name,
        r.description AS role_description,
        u.email AS invited_by_email
      FROM platform_admin_invitations pai
      JOIN roles r ON r.id = pai.role_id
      LEFT JOIN users u ON u.id = pai.invited_by_user_id
      ${where}
      ORDER BY pai.id DESC
      `,
      params
    );
    return rows;
  },

  async getPlatformAdminInvitationById(id) {
    const [rows] = await db.query(
      `
      SELECT pai.*, r.name AS role_name 
      FROM platform_admin_invitations pai 
      JOIN roles r ON r.id = pai.role_id 
      WHERE pai.id = ? LIMIT 1
      `,
      [Number(id)]
    );
    return rows[0] || null;
  },

  async updatePlatformAdminInvitation(id, updates) {
    const sets = [];
    const params = [];
    for (const [k, v] of Object.entries(updates)) {
      sets.push(`\`${k}\` = ?`);
      params.push(v);
    }
    if (!sets.length) return false;
    params.push(Number(id));
    await db.execute(`UPDATE platform_admin_invitations SET ${sets.join(", ")}, updated_at = NOW() WHERE id = ?`, params);
    return true;
  },

  // ==========================================
  // 2. INSTITUTION STAFF REPOSITORY HELPERS
  // ==========================================
  async listInstitutionStaffAcrossAll({ institutionId = "all", roleId = "all", status = "all", search = "", page = 1, limit = 20 }) {
    const conditions = [];
    const params = [];

    if (institutionId && institutionId !== "all") {
      conditions.push("iu.institution_id = ?");
      params.push(Number(institutionId));
    }

    if (roleId && roleId !== "all") {
      conditions.push("iu.role_id = ?");
      params.push(Number(roleId));
    }

    if (status && status !== "all") {
      conditions.push("iu.membership_status = ?");
      params.push(status);
    }

    if (search) {
      conditions.push("(iu.staff_name LIKE ? OR u.email LIKE ? OR u.phone LIKE ? OR i.name LIKE ?)");
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const offset = (Number(page) - 1) * Number(limit);

    const [countRows] = await db.query(
      `
      SELECT COUNT(iu.id) AS total
      FROM institution_users iu
      JOIN users u ON u.id = iu.user_id
      JOIN institutions i ON i.id = iu.institution_id
      JOIN roles r ON r.id = iu.role_id
      ${where}
      `,
      params
    );
    const total = Number(countRows[0]?.total || 0);

    const [rows] = await db.query(
      `
      SELECT 
        iu.id AS membership_id,
        iu.id,
        iu.institution_id,
        iu.user_id,
        iu.staff_name,
        iu.designation,
        iu.image_url AS staff_image,
        iu.membership_status,
        iu.created_at,
        iu.updated_at,
        u.email,
        u.phone,
        u.last_login_at,
        i.name AS institution_name,
        i.institution_code,
        i.institution_type,
        i.logo_url AS institution_logo,
        i.status AS institution_status,
        r.id AS role_id,
        r.name AS role_name,
        r.description AS role_description
      FROM institution_users iu
      JOIN users u ON u.id = iu.user_id
      JOIN institutions i ON i.id = iu.institution_id
      JOIN roles r ON r.id = iu.role_id
      ${where}
      ORDER BY iu.id DESC
      LIMIT ? OFFSET ?
      `,
      [...params, Number(limit), Number(offset)]
    );

    return { total, page: Number(page), limit: Number(limit), staff: rows };
  },

  // ==========================================
  // 3. ROLES & PERMISSIONS REPOSITORY
  // ==========================================
  async listRolesWithPermissions(scope = "all") {
    const conditions = [];
    const params = [];
    if (scope && scope !== "all") {
      conditions.push("r.scope = ?");
      params.push(scope);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const [roles] = await db.query(
      `
      SELECT r.id, r.name, r.description, r.scope, r.status, r.is_system, r.created_at,
             (
               SELECT COUNT(DISTINCT pau.id) 
               FROM platform_admin_users pau 
               WHERE pau.role_id = r.id
             ) AS platform_admins_count,
             (
               SELECT COUNT(DISTINCT iu.id) 
               FROM institution_users iu 
               WHERE iu.role_id = r.id
             ) AS institution_staff_count,
             COUNT(DISTINCT ur.user_id) AS active_users_count
      FROM roles r
      LEFT JOIN user_roles ur ON ur.role_id = r.id
      ${where}
      GROUP BY r.id, r.name, r.description, r.scope, r.status, r.is_system, r.created_at
      ORDER BY r.scope ASC, r.id ASC
      `,
      params
    );

    // Fetch permissions for each role
    const [rolePerms] = await db.query(`
      SELECT rp.role_id, p.id AS permission_id, p.name, p.module, p.description
      FROM role_permissions rp
      JOIN permissions p ON p.id = rp.permission_id
    `);

    const permMap = {};
    for (const rp of rolePerms) {
      if (!permMap[rp.role_id]) permMap[rp.role_id] = [];
      permMap[rp.role_id].push({
        id: rp.permission_id,
        name: rp.name,
        module: rp.module,
        description: rp.description,
      });
    }

    return roles.map((r) => {
      const assignedCount =
        r.scope === "platform"
          ? Number(r.platform_admins_count || 0)
          : r.scope === "institution"
          ? Number(r.institution_staff_count || 0)
          : Number(r.active_users_count || 0);

      return {
        ...r,
        assigned_users_count: assignedCount,
        permissions: permMap[r.id] || [],
      };
    });
  },

  async getAllPermissions() {
    const [rows] = await db.query(`
      SELECT id, name, description, module
      FROM permissions
      ORDER BY module ASC, name ASC
    `);
    return rows;
  },

  async getRoleById(roleId) {
    const [rows] = await db.query(`SELECT * FROM roles WHERE id = ? LIMIT 1`, [Number(roleId)]);
    return rows[0] || null;
  },

  async getAssignedUsersCountForRole(roleId, scope = "platform") {
    if (scope === "platform") {
      const [rows] = await db.query(
        `SELECT COUNT(*) AS total FROM platform_admin_users WHERE role_id = ?`,
        [Number(roleId)]
      );
      return Number(rows[0]?.total || 0);
    } else if (scope === "institution") {
      const [rows] = await db.query(
        `SELECT COUNT(*) AS total FROM institution_users WHERE role_id = ?`,
        [Number(roleId)]
      );
      return Number(rows[0]?.total || 0);
    } else {
      const [rows] = await db.query(
        `SELECT COUNT(*) AS total FROM user_roles WHERE role_id = ?`,
        [Number(roleId)]
      );
      return Number(rows[0]?.total || 0);
    }
  },

  async createRole({ name, description, scope = "platform", status = "active" }) {
    const [res] = await db.execute(
      `INSERT INTO roles (name, description, scope, status, is_system, created_at) VALUES (?, ?, ?, ?, 0, NOW())`,
      [name.trim().toLowerCase().replace(/\s+/g, "_"), description?.trim() || null, scope, status]
    );
    return res.insertId;
  },

  async updateStaffImage(membershipId, imageUrl) {
    await db.execute(`UPDATE institution_users SET image_url = ?, updated_at = NOW() WHERE id = ?`, [
      imageUrl || null,
      Number(membershipId),
    ]);
    return true;
  },

  async updateInstitutionLogo(institutionId, logoUrl) {
    await db.execute(`UPDATE institutions SET logo_url = ?, updated_at = NOW() WHERE id = ?`, [
      logoUrl || null,
      Number(institutionId),
    ]);
    return true;
  },

  async updateRole(roleId, { name, description, scope, status }) {
    const updates = [];
    const params = [];
    if (name !== undefined) {
      updates.push("name = ?");
      params.push(name.trim().toLowerCase().replace(/\s+/g, "_"));
    }
    if (description !== undefined) {
      updates.push("description = ?");
      params.push(description);
    }
    if (scope !== undefined) {
      updates.push("scope = ?");
      params.push(scope);
    }
    if (status !== undefined) {
      updates.push("status = ?");
      params.push(status);
    }
    if (!updates.length) return false;
    params.push(Number(roleId));
    await db.execute(`UPDATE roles SET ${updates.join(", ")} WHERE id = ?`, params);
    return true;
  },

  async deleteRole(roleId) {
    await db.execute(`DELETE FROM role_permissions WHERE role_id = ?`, [Number(roleId)]);
    await db.execute(`DELETE FROM roles WHERE id = ?`, [Number(roleId)]);
    return true;
  },

  async syncRolePermissions(roleId, permissionIds = []) {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute(`DELETE FROM role_permissions WHERE role_id = ?`, [Number(roleId)]);

      if (Array.isArray(permissionIds) && permissionIds.length > 0) {
        const values = permissionIds.map((pid) => [Number(roleId), Number(pid)]);
        await conn.query(`INSERT INTO role_permissions (role_id, permission_id) VALUES ?`, [values]);
      }

      await conn.commit();
      return true;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },
};
