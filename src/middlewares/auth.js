import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { db } from "../config/db.js";

export async function requireAuth(req, res, next) {
  try {
    const token = req.signedCookies?.bq_access;

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
          r.name AS role,
          r.id AS role_id
        FROM users u
        LEFT JOIN user_roles ur
          ON ur.user_id = u.id
        LEFT JOIN roles r
          ON r.id = ur.role_id
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

    if (user.status !== "active") {
      return res.status(403).json({
        success: false,
        message: `Account is ${user.status}`,
      });
    }

    // Fetch user permissions
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

    user.permissions = permRows.map((p) => p.name);

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired session",
    });
  }
}