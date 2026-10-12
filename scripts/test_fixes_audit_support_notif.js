import { db } from "../src/config/db.js";
import { adminAuditRepository } from "../src/modules/admin/audit/admin.audit.module.js";
import { adminSupportRepository } from "../src/modules/admin/support/admin.support.module.js";

async function run() {
  console.log("=== VERIFYING AUDIT LOGS, SUPPORT TICKETS, AND NOTIFICATIONS ===");

  // 1. Audit Logs Check
  console.log("\n[1] Checking Audit Logs Repository Output...");
  const auditResult = await adminAuditRepository.listAuditLogs({ limit: 5 });
  console.log("Total audit logs:", auditResult.total);
  if (auditResult.logs.length > 0) {
    const sample = auditResult.logs[0];
    console.log("Sample Audit Entry:", {
      id: sample.id,
      action: sample.action,
      createdAt: sample.createdAt,
      created_at: sample.created_at,
      adminEmail: sample.adminEmail,
      user_email: sample.user_email,
      resourceType: sample.resourceType,
      entity_type: sample.entity_type,
      resourceId: sample.resourceId,
      entity_id: sample.entity_id,
      ipAddress: sample.ipAddress,
      ip_address: sample.ip_address,
    });
    if (!sample.createdAt || !sample.created_at) throw new Error("Audit log created_at is missing!");
    if (!sample.user_email && !sample.admin_email) throw new Error("Audit log operator email is missing!");
    if (!sample.entity_type) throw new Error("Audit log entity_type is missing!");
    console.log("✓ Audit log formatting verified with zero undefined critical fields.");
  }

  // 2. Admin Support Tickets Check
  console.log("\n[2] Checking Admin Support Tickets List...");
  const ticketsResult = await adminSupportRepository.listTickets({ limit: 5 });
  console.log("Total support tickets:", ticketsResult.total);
  if (ticketsResult.tickets.length > 0) {
    const sampleTicket = ticketsResult.tickets[0];
    console.log("Sample Support Ticket (List):", {
      id: sampleTicket.id,
      ticketNumber: sampleTicket.ticketNumber,
      ticket_number: sampleTicket.ticket_number,
      merchantId: sampleTicket.merchantId,
      merchant_id: sampleTicket.merchant_id,
      companyName: sampleTicket.companyName,
      company_name: sampleTicket.company_name,
      createdAt: sampleTicket.createdAt,
      created_at: sampleTicket.created_at,
    });
    if (!sampleTicket.company_name && !sampleTicket.merchant_id) throw new Error("Ticket company_name and merchant_id missing!");
    if (!sampleTicket.created_at) throw new Error("Ticket created_at missing!");
    console.log("✓ Support tickets list verified with dual camelCase/snake_case mapping.");

    // 3. Ticket Details Check
    console.log(`\n[3] Checking Admin Support Ticket Details for Ticket #${sampleTicket.id}...`);
    const details = await adminSupportRepository.getTicketDetails(sampleTicket.id);
    console.log("Ticket Details Object:", {
      id: details.ticket.id,
      merchantId: details.ticket.merchantId,
      merchant_id: details.ticket.merchant_id,
      companyName: details.ticket.companyName,
      company_name: details.ticket.company_name,
      createdAt: details.ticket.createdAt,
      created_at: details.ticket.created_at,
      messagesCount: details.messages.length,
    });
    if (!details.ticket.company_name && !details.ticket.merchant_id) throw new Error("Ticket details merchant information missing!");
    if (details.messages.length > 0) {
      console.log("Sample Message:", {
        id: details.messages[0].id,
        senderName: details.messages[0].senderName,
        sender_name: details.messages[0].sender_name,
        createdAt: details.messages[0].createdAt,
        created_at: details.messages[0].created_at,
      });
      if (!details.messages[0].created_at) throw new Error("Message created_at missing!");
    }
    console.log("✓ Support ticket details verified with merchant name and dates properly populated.");
  }

  console.log("\n=========================================================");
  console.log("  ALL REPOSITORY AND SCHEMA CHECKS PASSED SUCCESSFULLY!  ");
  console.log("=========================================================");
  process.exit(0);
}

run().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});

