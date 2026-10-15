import { db } from "../config/db.js";

export function requirePermission(permissionName) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    // Super admin bypasses specific permission checks
    if (req.user.role === "super_admin") {
      return next();
    }

    const permissions = req.user.permissions || [];
    if (!permissions.includes(permissionName)) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: You do not have permission to perform this action",
      });
    }

    next();
  };
}

export function requireRole(allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: Insufficient role privileges",
      });
    }

    next();
  };
}

export const ADMIN_ROLES = ["super_admin", "admin", "reviewer", "support_agent"];

export function requireAdmin(req, res, next) {
  return requireRole(ADMIN_ROLES)(req, res, next);
}

export const INSTITUTION_ROLES = [
  "bank_admin",
  "bank_reviewer",
  "bank_operations",
];

/**
 * Enforce that the user is an authorized institution staff member.
 * Validates that an active membership in `institution_users` exists.
 * Does NOT authorize solely because a global role in user_roles contains a bank role.
 * Validates that the requested institution matches the membership.
 * Validates that the institution is permitted to operate (status = 'active').
 */
export async function requireInstitutionStaff(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ success: false, message: "Authentication required" });
  }

  const isPlatformAdmin =
    ["super_admin", "admin"].includes(req.user.role) ||
    (Array.isArray(req.user.roles) && req.user.roles.some((r) => ["super_admin", "admin"].includes(r)));

  // Super admin and admin can access for platform monitoring
  if (isPlatformAdmin) {
    const requestedId =
      req.query?.institutionId ||
      req.headers?.["x-institution-id"] ||
      req.params?.institutionId ||
      req.body?.institutionId;

    if (requestedId && !isNaN(Number(requestedId)) && Number(requestedId) > 0) {
      req.targetInstitutionId = Number(requestedId);
    } else {
      req.targetInstitutionId = Number(req.user.institutionId) || 1;
    }
    return next();
  }

  // Regular users / bank staff: NEVER authorize solely based on a global role in user_roles.
  // Must have an active membership in institution_users.
  const memberships = Array.isArray(req.user.institutionMemberships)
    ? req.user.institutionMemberships.filter((m) => m.status !== "suspended" && m.status !== "inactive")
    : [];

  if (!memberships.length) {
    const [suspendedCheck] = await db.query(
      "SELECT membership_status FROM institution_users WHERE user_id = ? LIMIT 1",
      [req.user.id]
    );
    if (suspendedCheck.length > 0 && suspendedCheck[0].membership_status === "suspended") {
      return res.status(403).json({
        success: false,
        message: "Forbidden: Your staff access for this institution is currently suspended.",
      });
    }

    return res.status(403).json({
      success: false,
      message: "Forbidden: No active institution membership associated with this user account.",
    });
  }

  // Determine requested institution ID if provided by client
  const requestedId =
    req.query?.institutionId ||
    req.headers?.["x-institution-id"] ||
    req.params?.institutionId ||
    req.body?.institutionId;

  let activeMembership = null;

  if (requestedId && !isNaN(Number(requestedId))) {
    activeMembership = memberships.find((m) => Number(m.institutionId) === Number(requestedId));
    if (!activeMembership) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: You are not an authorized staff member for the requested banking institution.",
      });
    }
  } else {
    activeMembership = memberships[0];
  }

  // Verify that the institution itself is permitted to operate (active status)
  const [instRows] = await db.query(
    "SELECT id, name, status, institution_code FROM institutions WHERE id = ? LIMIT 1",
    [activeMembership.institutionId]
  );

  if (!instRows.length || instRows[0].status !== "active") {
    return res.status(403).json({
      success: false,
      message: "Forbidden: This banking institution is currently inactive or suspended and not permitted to operate.",
    });
  }

  req.targetInstitutionId = Number(activeMembership.institutionId);
  req.targetInstitution = instRows[0];
  req.activeMembership = activeMembership;
  req.user.institutionId = req.targetInstitutionId;
  req.user.institutionRole = activeMembership.role;
  req.user.assignedBranchIds = activeMembership.assignedBranchIds || [];

  next();
}

/**
 * Enforce that bank staff can only access data belonging to their assigned institution.
 * Also enforces branch-level access restrictions if target branch is specified.
 */
export async function requireInstitutionScope(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ success: false, message: "Authentication required" });
  }

  const isPlatformAdmin =
    ["super_admin", "admin"].includes(req.user.role) ||
    (Array.isArray(req.user.roles) && req.user.roles.some((r) => ["super_admin", "admin"].includes(r)));

  if (isPlatformAdmin) {
    return next();
  }

  const targetInstitutionId =
    req.params?.institutionId ||
    req.body?.institutionId ||
    req.query?.institutionId ||
    req.headers?.["x-institution-id"];

  const userInstId = req.targetInstitutionId || req.user.institutionId;

  if (!userInstId) {
    return res.status(403).json({
      success: false,
      message: "Forbidden: No active institution membership found",
    });
  }

  if (targetInstitutionId && !isNaN(Number(targetInstitutionId)) && Number(userInstId) !== Number(targetInstitutionId)) {
    return res.status(403).json({
      success: false,
      message: "Forbidden: You are only authorized to access records for your assigned banking institution.",
    });
  }

  // Branch-level access verification
  const targetBranchId = req.params?.branchId || req.query?.branchId || req.body?.branchId;
  if (targetBranchId && req.user.assignedBranchIds && req.user.assignedBranchIds.length > 0) {
    if (!req.user.assignedBranchIds.includes(Number(targetBranchId))) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: You are not authorized to access records outside your assigned branch(es).",
      });
    }
  }

  next();
}

/**
 * Enforce that bank staff has the required permission for a specific institution operation.
 */
export function requireInstitutionPermission(permissionName) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }

    const isPlatformAdmin =
      ["super_admin", "admin"].includes(req.user.role) ||
      (Array.isArray(req.user.roles) && req.user.roles.some((r) => ["super_admin", "admin"].includes(r)));

    if (isPlatformAdmin) {
      return next();
    }

    const perms = req.user.permissions || [];
    if (!perms.includes(permissionName)) {
      return res.status(403).json({
        success: false,
        message: `Forbidden: You do not have permission '${permissionName}' to perform this action`,
      });
    }

    next();
  };
}



