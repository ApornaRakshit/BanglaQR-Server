import { db } from "../src/config/db.js";
import { loginUser } from "../src/modules/auth/auth.service.js";
import { adminMerchantsService } from "../src/modules/admin/merchants/admin.merchants.service.js";
import { adminKycService } from "../src/modules/admin/kyc/admin.kyc.service.js";
import { adminDocumentsService } from "../src/modules/admin/documents/admin.documents.service.js";
import { adminGatewaysService } from "../src/modules/admin/gateways/admin.gateways.service.js";
import { adminAddonsService } from "../src/modules/admin/addons/admin.addons.module.js";
import { adminInvoicesService } from "../src/modules/admin/invoices/admin.invoices.module.js";
import { adminSupportService } from "../src/modules/admin/support/admin.support.module.js";
import { adminNotificationsRepository } from "../src/modules/admin/notifications/admin.notifications.module.js";
import { adminAuditRepository } from "../src/modules/admin/audit/admin.audit.module.js";
import { adminSettingsRepository } from "../src/modules/admin/settings/admin.settings.module.js";

async function testAll() {
  console.log("==================================================");
  console.log("TESTING ALL BACKEND ADMIN MODULES & SERVICES");
  console.log("==================================================");

  let passed = 0;
  function pass(msg) {
    console.log(`✅ PASS: ${msg}`);
    passed++;
  }

  const admin = await loginUser({ email: "admin@banglaqr.com", password: "Admin@123456" });
  pass(`Admin authenticated: ${admin.user.email}`);

  // 1. Merchants
  const merchantsList = await adminMerchantsService.listMerchants({ page: 1, limit: 10 });
  pass(`Merchants list returned ${merchantsList.merchants.length} items (Total: ${merchantsList.total})`);

  if (merchantsList.merchants.length > 0) {
    const firstId = merchantsList.merchants[0].id;
    const details = await adminMerchantsService.getMerchantDetails(firstId);
    pass(`Merchant details retrieved for ID ${firstId} (${details.profile?.companyName || "N/A"})`);
    const history = await adminMerchantsService.getMerchantHistory(firstId);
    pass(`Merchant history retrieved (${history.onboardingHistory.length} onboarding events)`);
  }

  // 2. KYC
  const kycList = await adminKycService.listKyc({ page: 1, limit: 10 });
  pass(`KYC list returned ${kycList.items.length} items (Total: ${kycList.total})`);

  // 3. Documents
  const docsList = await adminDocumentsService.listDocuments({ page: 1, limit: 10 });
  pass(`Documents list returned ${docsList.documents.length} items (Total: ${docsList.total})`);

  // 4. Gateways
  const gateways = await adminGatewaysService.listGateways();
  pass(`Gateways list returned ${gateways.length} gateways`);
  const mga = await adminGatewaysService.listApplications({});
  pass(`Gateway applications list returned ${mga.length} applications`);
  const mgs = await adminGatewaysService.listServices({});
  pass(`Gateway services list returned ${mgs.length} active services`);

  // 5. Addons
  const addons = await adminAddonsService.listAddons();
  pass(`Addons list returned ${addons.length} items`);

  // 6. Invoices
  const invoices = await adminInvoicesService.listInvoices({});
  pass(`Invoices list returned (Total: ${invoices.total})`);

  // 7. Support Tickets
  const tickets = await adminSupportService.listTickets({});
  pass(`Support tickets list returned (Total: ${tickets.total})`);

  // 8. Notifications
  const notifs = await adminNotificationsRepository.listNotifications();
  pass(`Notifications returned ${notifs.length} items`);

  // 9. Audit Logs
  const audit = await adminAuditRepository.listAuditLogs({});
  pass(`Audit logs list returned ${audit.logs.length} logs (Total: ${audit.total})`);

  // 10. Settings
  const settings = await adminSettingsRepository.getSettings();
  pass(`Settings keys retrieved: ${Object.keys(settings).join(", ")}`);

  console.log("\n==================================================");
  console.log(`ALL MODULE TESTS PASSED: ${passed}/10`);
  console.log("==================================================");
  process.exit(0);
}

testAll().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});

