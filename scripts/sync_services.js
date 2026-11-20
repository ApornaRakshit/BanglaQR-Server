import { db } from "../src/config/db.js";

async function syncServices() {
  const [gateways] = await db.query("SELECT * FROM gateways");
  for (const gw of gateways) {
    // Check if institution_service exists
    const [existing] = await db.query(
      "SELECT id FROM institution_services WHERE legacy_gateway_id = ? OR service_code = ?",
      [gw.id, gw.code]
    );

    let serviceId;
    const sType =
      gw.service_type === "MFS Gateway" || gw.service_type === "Bank MFS"
        ? "mfs"
        : gw.service_type === "Card Network"
        ? "card_network"
        : "payment_gateway";

    if (existing.length > 0) {
      serviceId = existing[0].id;
      await db.execute(
        "UPDATE institution_services SET institution_id = ?, legacy_gateway_id = ?, service_name = ?, service_type = ?, updated_at = NOW() WHERE id = ?",
        [gw.institution_id, gw.id, gw.name, sType, serviceId]
      );
    } else {
      const [res] = await db.execute(
        "INSERT INTO institution_services (institution_id, service_code, service_name, service_type, legacy_gateway_id, integration_mode, availability_status, application_required, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())",
        [gw.institution_id, gw.code, gw.name, sType, gw.id, "api", gw.status === "active" ? "available" : "disabled", 1]
      );
      serviceId = res.insertId;
    }

    // Check if connection exists
    const [existingConn] = await db.query(
      "SELECT id FROM institution_service_connections WHERE institution_service_id = ?",
      [serviceId]
    );

    const defaultStatus = gw.institution_id
      ? gw.code === "BRAC_BANK_QR" || gw.code === "BKASH_DIRECT"
        ? "testing"
        : "setup_pending"
      : "not_connected";
    const notes = gw.institution_id
      ? `${gw.name} technical connection registered in sandbox environment.`
      : "Unassigned service rail.";

    if (existingConn.length === 0) {
      await db.execute(
        "INSERT INTO institution_service_connections (institution_service_id, connection_mode, status, environment, last_tested_at, connection_notes, created_at, updated_at) VALUES (?, ?, ?, ?, NOW(), ?, NOW(), NOW())",
        [serviceId, "direct_api", defaultStatus, "sandbox", notes]
      );
    }
  }
  console.log("Successfully synced institution_services & connections with gateways");
  process.exit(0);
}

syncServices().catch((e) => {
  console.error(e);
  process.exit(1);
});

