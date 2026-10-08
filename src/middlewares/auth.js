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

    const payload = jwt.verify(
      token,
      env.jwt.accessSecret
    );

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
          r.name AS role
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

    req.user = user;

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired session",
    });
  }
}