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

