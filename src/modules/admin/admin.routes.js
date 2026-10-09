import express from "express";
import { requireAuth } from "../../middlewares/auth.js";
import { requireAdmin, requirePermission } from "../../middlewares/permission.js";

// Controllers
import { adminController } from "./admin.controller.js";
import { adminMerchantsController } from "./merchants/admin.merchants.controller.js";
import { adminKycController } from "./kyc/admin.kyc.controller.js";
import { adminDocumentsController } from "./documents/admin.documents.controller.js";
import { adminGatewaysController } from "./gateways/admin.gateways.controller.js";
import { adminAddonsController } from "./addons/admin.addons.module.js";
import { adminInvoicesController } from "./invoices/admin.invoices.module.js";
import { adminSupportController } from "./support/admin.support.module.js";
import { adminNotificationsController } from "./notifications/admin.notifications.module.js";
import { adminAuditController } from "./audit/admin.audit.module.js";
import { adminSettingsController } from "./settings/admin.settings.module.js";
import { adminProfileController } from "./profile/admin.profile.module.js";
import cmsRoutes from "./cms/cms.routes.js";

const router = express.Router();

// Base protection: All admin endpoints require authentication and an active admin role
router.use(requireAuth);
router.use(requireAdmin);

/* ==========================================================================
   1. DASHBOARD
   ========================================================================== */
router.get("/dashboard", requirePermission("dashboard.view"), adminController.getDashboard);

/* ==========================================================================
   2. MERCHANT MANAGEMENT
   ========================================================================== */
router.get("/merchants", requirePermission("merchant.view"), adminMerchantsController.list);
router.get("/merchants/:merchantId", requirePermission("merchant.view"), adminMerchantsController.getDetails);
router.get("/merchants/:merchantId/history", requirePermission("merchant.view"), adminMerchantsController.getHistory);
router.post("/merchants/:merchantId/review", requirePermission("merchant.approve"), adminMerchantsController.review);

/* ==========================================================================
   3. KYC REVIEW
   ========================================================================== */
router.get("/kyc", requirePermission("kyc.view"), adminKycController.list);
router.get("/kyc/:merchantId", requirePermission("kyc.view"), adminKycController.getDetails);
router.post("/kyc/:merchantId/review", requirePermission("kyc.review"), adminKycController.review);

/* ==========================================================================
   4. DOCUMENT REVIEW & SECURE VIEWER
   ========================================================================== */
router.get("/documents", requirePermission("document.view"), adminDocumentsController.list);
router.get(
  "/merchants/:merchantId/documents/:documentId/view",
  requirePermission("document.view"),
  adminDocumentsController.view
);
router.patch(
  "/merchants/:merchantId/documents/:documentId/review",
  requirePermission("document.review"),
  adminDocumentsController.review
);

/* ==========================================================================
   5. GATEWAYS, APPLICATIONS & SERVICES
   ========================================================================== */
router.get("/gateways", requirePermission("gateway.view"), adminGatewaysController.list);
router.get("/gateways/applications", requirePermission("application.view"), adminGatewaysController.listApplications);
router.get("/gateways/services", requirePermission("gateway.view"), adminGatewaysController.listServices);
router.get("/gateways/:gatewayId", requirePermission("gateway.view"), adminGatewaysController.getById);
router.post("/gateways", requirePermission("gateway.create"), adminGatewaysController.create);
router.put("/gateways/:gatewayId", requirePermission("gateway.edit"), adminGatewaysController.update);
router.delete("/gateways/:gatewayId", requirePermission("gateway.delete"), adminGatewaysController.delete);

/* ==========================================================================
   6. ADD-ONS MANAGEMENT
   ========================================================================== */
router.get("/addons", requirePermission("addon.view"), adminAddonsController.list);
router.get("/addons/:addonId", requirePermission("addon.view"), adminAddonsController.getById);
router.post("/addons", requirePermission("addon.create"), adminAddonsController.create);
router.put("/addons/:addonId", requirePermission("addon.edit"), adminAddonsController.update);
router.delete("/addons/:addonId", requirePermission("addon.delete"), adminAddonsController.delete);

/* ==========================================================================
   7. INVOICE MANAGEMENT
   ========================================================================== */
router.get("/invoices", requirePermission("invoice.view"), adminInvoicesController.list);
router.get("/invoices/:invoiceId", requirePermission("invoice.view"), adminInvoicesController.getById);
router.patch("/invoices/:invoiceId/status", requirePermission("invoice.manage"), adminInvoicesController.updateStatus);

/* ==========================================================================
   8. SUPPORT TICKETS
   ========================================================================== */
router.get("/support", requirePermission("ticket.view"), adminSupportController.list);
router.get("/support/:ticketId", requirePermission("ticket.view"), adminSupportController.getById);
router.post("/support/:ticketId/reply", requirePermission("ticket.reply"), adminSupportController.reply);
router.patch("/support/:ticketId/status", requirePermission("ticket.manage"), adminSupportController.update);

/* ==========================================================================
   9. NOTIFICATIONS
   ========================================================================== */
router.get("/notifications", requirePermission("notification.view"), adminNotificationsController.list);
router.patch("/notifications/read-all", requirePermission("notification.view"), adminNotificationsController.markAllRead);
router.patch("/notifications/:notifId/read", requirePermission("notification.view"), adminNotificationsController.markRead);
router.post("/notifications/broadcast", requirePermission("notification.manage"), adminNotificationsController.broadcast);
router.delete("/notifications/:notifId", requirePermission("notification.manage"), adminNotificationsController.delete);

/* ==========================================================================
   10. AUDIT LOGS
   ========================================================================== */
router.get("/audit", requirePermission("audit.view"), adminAuditController.list);

/* ==========================================================================
   11. SETTINGS
   ========================================================================== */
router.get("/settings", requirePermission("settings.manage"), adminSettingsController.get);
router.put("/settings/:settingKey", requirePermission("settings.manage"), adminSettingsController.update);

/* ==========================================================================
   12. ADMIN PROFILE & SECURITY
   ========================================================================== */
router.get("/profile", adminProfileController.getProfile);
router.put("/profile", adminProfileController.updateProfile);
router.put("/profile/password", adminProfileController.changePassword);

/* ==========================================================================
   13. CMS HOMEPAGE & CONTENT MANAGEMENT
   ========================================================================== */
router.use("/cms", cmsRoutes);

export default router;
