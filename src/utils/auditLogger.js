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
    const safeResourceId = resourceId !== undefined && resourceId !== null ? String(resourceId).slice(0, 100) : null;
    const safeResourceType = resourceType !== undefined && resourceType !== null ? String(resourceType).slice(0, 100) : "system";
    const safeAction = action !== undefined && action !== null ? String(action).slice(0, 100) : "action";

    await connection.execute(
      `
        INSERT INTO audit_logs
        (user_id, admin_email, action, resource_type, resource_id, merchant_id, details, ip_address, user_agent, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      `,
      [
        userId ?? null,
        adminEmail ?? "system@banglaqr.com",
        safeAction,
        safeResourceType,
        safeResourceId,
        merchantId ?? null,
        detailsJson ?? null,
        ip ?? null,
        userAgent ?? null,
      ]
    );
  } catch (err) {
    console.error("Failed to write audit log:", err.message);
  }
}

