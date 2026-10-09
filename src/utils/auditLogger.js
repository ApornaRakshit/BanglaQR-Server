import { db } from "../config/db.js";

export async function logAdminAudit({
  connection = db,
  userId = null,
  adminEmail = "system@banglaqr.com",
  action,
  resourceType,
  resourceId = null,
  merchantId = null,
  details = null,
  ip = null,
  userAgent = null,
}) {
  try {
    const detailsJson = details ? JSON.stringify(details) : null;
    await connection.execute(
      `
        INSERT INTO audit_logs
        (user_id, admin_email, action, resource_type, resource_id, merchant_id, details, ip_address, user_agent, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      `,
      [
        userId,
        adminEmail,
        action,
        resourceType,
        resourceId ? String(resourceId) : null,
        merchantId,
        detailsJson,
        ip,
        userAgent,
      ]
    );
  } catch (err) {
    console.error("Failed to write audit log:", err.message);
  }
}

