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
          COALESCE(u.must_change_password, 0) AS must_change_password,
          COALESCE(u.token_version, 0) AS token_version,
          u.password_changed_at
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

    // Database-backed token_version check for reliable JWT access token revocation.
    // Backward-compatible: If the token payload has no token_version, default to 0.
    const tokenVersion = typeof payload.token_version === "number" ? payload.token_version : 0;
    if (tokenVersion !== Number(user.token_version)) {
      return res.status(401).json({
        success: false,
        message: "Session has been invalidated. Please log in again.",
      });
    }

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

    // 1. Fetch platform admin membership and roles
    const [pauRows] = await db.execute(
      `
        SELECT pau.id AS platform_admin_id, pau.role_id, pau.status AS pau_status, pau.full_name, r.name AS role_name
        FROM platform_admin_users pau
        JOIN roles r ON r.id = pau.role_id
        WHERE pau.user_id = ?
      `,
      [user.id]
    );

    const [roleRows] = await db.execute(
      `
        SELECT r.id, r.name
        FROM user_roles ur
        JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = ?
      `,
      [user.id]
    );

    const allRoleNames = new Set(roleRows.map((r) => r.name));
    if (pauRows.length > 0 && pauRows[0].pau_status === "active") {
      allRoleNames.add(pauRows[0].role_name);
      user.platformAdmin = {
        id: pauRows[0].platform_admin_id,
        roleId: pauRows[0].role_id,
        roleName: pauRows[0].role_name,
        fullName: pauRows[0].full_name,
        status: pauRows[0].pau_status,
      };
    } else if (pauRows.length > 0 && pauRows[0].pau_status !== "active") {
      // Platform admin access is suspended or disabled
      user.platformAdminSuspended = true;
      allRoleNames.delete(pauRows[0].role_name);
    }

    user.roles = Array.from(allRoleNames);
    user.role = (pauRows[0]?.pau_status === "active" ? pauRows[0]?.role_name : null) || user.roles[0] || null;

    // 2. Check if user is a merchant in merchants table
    const [merchantRows] = await db.execute(
      `SELECT m.id, mc.name AS contact_name, mk.authorized_person_name, mk.legal_business_name, mp.company_name
       FROM merchants m
       LEFT JOIN merchant_contacts mc ON mc.merchant_id = m.id
       LEFT JOIN merchant_kyc mk ON mk.merchant_id = m.id
       LEFT JOIN merchant_profiles mp ON mp.merchant_id = m.id
       WHERE m.user_id = ? LIMIT 1`,
      [user.id]
    );
    user.isMerchant = merchantRows.length > 0 || user.roles.includes("merchant");
    if (user.isMerchant && !user.roles.includes("merchant")) {
      user.roles.push("merchant");
      if (!user.role) user.role = "merchant";
    }

    // Set user.name from platform admin, institution staff, or merchant contact/legal business name
    if (user.platformAdmin?.fullName) {
      user.name = user.platformAdmin.fullName;
    } else if (merchantRows.length > 0) {
      user.name =
        merchantRows[0].contact_name ||
        merchantRows[0].authorized_person_name ||
        merchantRows[0].legal_business_name ||
        merchantRows[0].company_name ||
        null;
    }

    // 3. Fetch platform permissions
    let platformPerms = [];
    if (user.roles.length > 0 && !user.platformAdminSuspended) {
      const [permRows] = await db.execute(
        `
          SELECT DISTINCT p.name
          FROM permissions p
          JOIN role_permissions rp ON rp.permission_id = p.id
          JOIN roles r ON r.id = rp.role_id
          WHERE r.name IN (${user.roles.map(() => "?").join(",")})
        `,
        user.roles
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
      if (!user.name && user.institution.staffName) {
        user.name = user.institution.staffName;
      }
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