import jwt from "jsonwebtoken";
import { env, isDevVerificationBypass } from "../config/env.js";
import { db } from "../config/db.js";

export async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    const bearerToken = authHeader && authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    const token = req.signedCookies?.bq_access || bearerToken || req.query?.token;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const payload = jwt.verify(token, env.jwt.accessSecret);

    const [rows] = await db.execute(
      `
        SELECT
          u.id,
          u.email,
          u.phone,
          u.status,
          u.email_verified_at,
          u.phone_verified_at,
          u.two_factor_enabled,
          COALESCE(u.must_change_password, 0) AS must_change_password
        FROM users u
        WHERE u.id = ?
        LIMIT 1
      `,
      [payload.sub]
    );

    if (!rows.length) {
      return res.status(401).json({
        success: false,
        message: "User account not found",
      });
    }

    const user = rows[0];

    if (user.status === "suspended") {
      return res.status(403).json({
        success: false,
        message: "Account is suspended. Please contact support.",
      });
    }

    if (user.status !== "active" && !isDevVerificationBypass()) {
      return res.status(403).json({
        success: false,
        message: `Account is ${user.status}`,
      });
    }

    // 1. Fetch all platform roles assigned in user_roles
    const [roleRows] = await db.execute(
      `
        SELECT r.id, r.name
        FROM user_roles ur
        JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = ?
      `,
      [user.id]
    );

    user.roles = roleRows.map((r) => r.name);
    user.role = user.roles[0] || null;

    // 2. Check if user is a merchant in merchants table
    const [merchantRows] = await db.execute(
      `SELECT id FROM merchants WHERE user_id = ? LIMIT 1`,
      [user.id]
    );
    user.isMerchant = merchantRows.length > 0 || user.roles.includes("merchant");
    if (user.isMerchant && !user.roles.includes("merchant")) {
      user.roles.push("merchant");
      if (!user.role) user.role = "merchant";
    }

    // 3. Fetch platform permissions
    let platformPerms = [];
    if (user.roles.length > 0) {
      const [permRows] = await db.execute(
        `
          SELECT DISTINCT p.name
          FROM permissions p
          JOIN role_permissions rp ON rp.permission_id = p.id
          JOIN user_roles ur ON ur.role_id = rp.role_id
          WHERE ur.user_id = ?
        `,
        [user.id]
      );
      platformPerms = permRows.map((p) => p.name);
    }

    // 4. Fetch all active institution memberships from institution_users
    const [instRows] = await db.execute(
      `
        SELECT
          iu.id AS membership_id,
          iu.institution_id,
          iu.role_id AS institution_role_id,
          iu.membership_status,
          iu.staff_name,
          i.name AS institution_name,
          i.institution_code,
          i.institution_type,
          i.logo_url,
          i.status AS institution_status,
          r.name AS institution_role
        FROM institution_users iu
        JOIN institutions i ON i.id = iu.institution_id
        JOIN roles r ON r.id = iu.role_id
        WHERE iu.user_id = ? AND iu.membership_status = 'active'
        ORDER BY iu.id ASC
      `,
      [user.id]
    );

    user.institutionMemberships = instRows.map((row) => ({
      membershipId: row.membership_id,
      institutionId: row.institution_id,
      name: row.institution_name,
      code: row.institution_code,
      type: row.institution_type,
      logoUrl: row.logo_url,
      status: row.institution_status,
      role: row.institution_role,
      staffName: row.staff_name,
      assignedBranchIds: [],
    }));

    // 5. Fetch branch assignments for active memberships
    if (instRows.length > 0) {
      const membershipIds = instRows.map((r) => r.membership_id);
      const [branchRows] = await db.query(
        `SELECT membership_id, branch_id FROM institution_user_branch_assignments WHERE membership_id IN (?)`,
        [membershipIds]
      );
      const branchMap = {};
      for (const b of branchRows) {
        if (!branchMap[b.membership_id]) branchMap[b.membership_id] = [];
        branchMap[b.membership_id].push(Number(b.branch_id));
      }
      user.institutionMemberships.forEach((m) => {
        m.assignedBranchIds = branchMap[m.membershipId] || [];
      });

      // 6. Fetch permissions for institution roles
      const roleIds = [...new Set(instRows.map((r) => r.institution_role_id))];
      const [instPermRows] = await db.query(
        `SELECT DISTINCT p.name FROM permissions p JOIN role_permissions rp ON rp.permission_id = p.id WHERE rp.role_id IN (?)`,
        [roleIds]
      );
      user.institutionPermissions = instPermRows.map((p) => p.name);
    } else {
      user.institutionPermissions = [];
    }

    user.permissions = [...new Set([...platformPerms, ...user.institutionPermissions])];

    if (user.institutionMemberships.length > 0) {
      user.institution = user.institutionMemberships[0];
      user.institutionId = user.institution.institutionId;
      user.institutionRole = user.institution.role;
      user.assignedBranchIds = user.institution.assignedBranchIds || [];
      if (!user.role && user.institutionRole) {
        user.role = user.institutionRole;
        if (!user.roles.includes(user.institutionRole)) {
          user.roles.push(user.institutionRole);
        }
      }
    } else {
      user.institution = null;
      user.institutionId = null;
      user.institutionRole = null;
      user.assignedBranchIds = [];
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired session",
    });
  }
}