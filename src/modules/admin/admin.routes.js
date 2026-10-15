import express from "express";
import { requireAuth } from "../../middlewares/auth.js";
import { requireAdmin, requirePermission, requireInstitutionScope } from "../../middlewares/permission.js";

// Controllers
import { adminController } from "./admin.controller.js";
import { adminMerchantsController } from "./merchants/admin.merchants.controller.js";
import { adminKycController } from "./kyc/admin.kyc.controller.js";
import { adminDocumentsController } from "./documents/admin.documents.controller.js";
import { adminGatewaysController } from "./gateways/admin.gateways.controller.js";
import { adminAddonsController } from "./addons/admin.addons.module.js";
import { adminSupportController } from "./support/admin.support.module.js";
import { adminNotificationsController } from "./notifications/admin.notifications.module.js";
import { adminInquiriesController } from "./inquiries/admin.inquiries.module.js";
import { adminAuditController } from "./audit/admin.audit.module.js";
import { adminSettingsController } from "./settings/admin.settings.module.js";
import { adminProfileController } from "./profile/admin.profile.module.js";
import { paymentsController } from "../payments/payments.controller.js";
import { adminInstitutionsController } from "./institutions/admin.institutions.controller.js";
import { uploadDocument } from "../../middlewares/upload.js";
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
router.get("/gateways/stats", requirePermission("gateway.view"), adminGatewaysController.getStats);
router.get("/gateways", requirePermission("gateway.view"), adminGatewaysController.list);
router.get("/gateways/applications", requirePermission("application.view"), adminGatewaysController.listApplications);
router.post("/gateways/applications/:applicationId/review", requirePermission("gateway.edit"), adminGatewaysController.reviewApplication);
router.put("/gateways/applications/:applicationId/review", requirePermission("gateway.edit"), adminGatewaysController.reviewApplication);
router.get("/gateways/services", requirePermission("gateway.view"), adminGatewaysController.listServices);
router.patch("/gateways/services/:serviceId/status", requirePermission("gateway.edit"), adminGatewaysController.updateServiceStatus);
router.get("/gateways/:gatewayId", requirePermission("gateway.view"), adminGatewaysController.getById);
router.post("/gateways", requirePermission("gateway.create"), adminGatewaysController.create);
router.put("/gateways/:gatewayId", requirePermission("gateway.edit"), adminGatewaysController.update);
router.patch("/gateways/:gatewayId/status", requirePermission("gateway.edit"), adminGatewaysController.updateStatus);
router.patch("/gateways/:gatewayId/publish", requirePermission("gateway.edit"), adminGatewaysController.updatePublish);
router.delete("/gateways/:gatewayId", requirePermission("gateway.delete"), adminGatewaysController.delete);

/* ==========================================================================
   5.1 BANK & FINANCIAL INSTITUTION MANAGEMENT
   ========================================================================== */
router.get("/institutions/dashboard", requirePermission("institution.dashboard.view"), adminInstitutionsController.getDashboard);
router.get("/institutions/bank-options", requirePermission("institution.service.view"), adminInstitutionsController.getBankOptions);
router.get("/institutions", requirePermission("institution.service.view"), adminInstitutionsController.list);
router.post("/institutions", requirePermission("institution.service.manage"), adminInstitutionsController.create);
router.post("/institutions/upload-logo", requirePermission("institution.service.manage"), uploadDocument.single("logo"), adminInstitutionsController.uploadLogo);

// Bangladesh Geographic Master Data (before :id wildcard)
router.get("/institutions/geo/divisions", adminInstitutionsController.getGeoDivisions);
router.get("/institutions/geo/districts", adminInstitutionsController.getGeoDistricts);
router.get("/institutions/geo/upazilas", adminInstitutionsController.getGeoUpazilas);
router.get("/geo/divisions", adminInstitutionsController.getGeoDivisions);
router.get("/geo/districts", adminInstitutionsController.getGeoDistricts);
router.get("/geo/upazilas", adminInstitutionsController.getGeoUpazilas);

// Services
router.get("/institutions/services", requirePermission("institution.service.view"), adminInstitutionsController.listServices);
router.get("/institutions/services/:gatewayId", requirePermission("institution.service.view"), adminInstitutionsController.getServiceById);
router.post("/institutions/services", requirePermission("institution.service.manage"), adminInstitutionsController.createService);
router.put("/institutions/services/:gatewayId", requirePermission("institution.service.manage"), adminInstitutionsController.updateService);
router.post("/institutions/services/:gatewayId/test-connection", requirePermission("institution.service.manage"), adminInstitutionsController.testServiceConnection);
router.post("/institutions/services/:gatewayId/associate", requirePermission("institution.service.manage"), adminInstitutionsController.associateService);
router.post("/institutions/services/:gatewayId/disassociate", requirePermission("institution.service.manage"), adminInstitutionsController.disassociateService);

// Users / Staff & Invitations
router.get("/institutions/users", requirePermission("institution.users.manage"), adminInstitutionsController.listStaff);
router.post("/institutions/users", requirePermission("institution.users.manage"), adminInstitutionsController.provisionStaff);
router.patch("/institutions/users/:membershipId", requirePermission("institution.users.manage"), adminInstitutionsController.updateStaff);
router.post("/institutions/invitations", requirePermission("institution.users.manage"), adminInstitutionsController.inviteStaff);
router.get("/institutions/invitations", requirePermission("institution.users.manage"), adminInstitutionsController.listInvitations);
router.post("/institutions/invitations/:id/resend", requirePermission("institution.users.manage"), adminInstitutionsController.resendInvitation);
router.post("/institutions/invitations/:id/revoke", requirePermission("institution.users.manage"), adminInstitutionsController.revokeInvitation);

// KYC Requirements
router.get("/institutions/kyc-requirements", requirePermission("institution.kyc.view"), adminInstitutionsController.listKycRequirements);
router.get("/institutions/kyc-requirements/related", requirePermission("institution.kyc.view"), adminInstitutionsController.getRelatedKycRequirements);
router.get("/institutions/kyc-requirements/:id", requirePermission("institution.kyc.view"), adminInstitutionsController.getKycRequirementById);
router.post("/institutions/kyc-requirements/sample-upload", requirePermission("institution.service.manage"), uploadDocument.single("file"), adminInstitutionsController.uploadSampleDocument);
router.post("/institutions/kyc-requirements", requirePermission("institution.service.manage"), adminInstitutionsController.createKycRequirement);
router.patch("/institutions/kyc-requirements/:id", requirePermission("institution.service.manage"), adminInstitutionsController.updateKycRequirement);
router.delete("/institutions/kyc-requirements/:id", requirePermission("institution.service.manage"), adminInstitutionsController.deleteKycRequirement);

// Branch Management by Branch ID
router.get("/institutions/branches/:branchId", requirePermission("institution.branch.view"), adminInstitutionsController.getBranchById);
router.put("/institutions/branches/:branchId", requirePermission("institution.branch.manage"), adminInstitutionsController.updateBranch);
router.patch("/institutions/branches/:branchId/status", requirePermission("institution.branch.manage"), adminInstitutionsController.updateBranchStatus);
router.patch("/institutions/branches/:branchId/archive", requirePermission("institution.branch.manage"), adminInstitutionsController.archiveBranch);
router.patch("/institutions/branches/:branchId/demo", requirePermission("institution.branch.manage"), adminInstitutionsController.toggleDemoBranch);
router.delete("/institutions/branches/:branchId", requirePermission("institution.branch.manage"), adminInstitutionsController.deleteBranch);

// Institution Branches & Stats (scoped by institution)
router.get("/institutions/:institutionId/branches/stats", requirePermission("institution.branch.view"), requireInstitutionScope, adminInstitutionsController.getBranchStats);
router.get("/institutions/:institutionId/branches/export.csv", requirePermission("institution.branch.view"), requireInstitutionScope, adminInstitutionsController.exportBranchesCsv);
router.get("/institutions/:institutionId/branches", requirePermission("institution.branch.view"), requireInstitutionScope, adminInstitutionsController.listBranches);
router.post("/institutions/:institutionId/branches", requirePermission("institution.branch.manage"), requireInstitutionScope, adminInstitutionsController.createBranch);

// Institution Applications & Stats (scoped by institution)
router.get("/institutions/:institutionId/applications/stats", requirePermission("institution.service.view"), requireInstitutionScope, adminInstitutionsController.getInstitutionApplicationStats);
router.get("/institutions/:institutionId/applications", requirePermission("institution.service.view"), requireInstitutionScope, adminInstitutionsController.listInstitutionApplications);

// Specific Institution Operations & Settings
router.get("/institutions/:id", requirePermission("institution.service.view"), adminInstitutionsController.getById);
router.put("/institutions/:id", requirePermission("institution.service.manage"), adminInstitutionsController.update);
router.post("/institutions/:id/register", requirePermission("institution.service.manage"), adminInstitutionsController.register);
router.patch("/institutions/:id/status", requirePermission("institution.service.manage"), adminInstitutionsController.updateStatus);
router.delete("/institutions/:id", requirePermission("institution.service.manage"), adminInstitutionsController.delete);
router.get("/institutions/:institutionId/settings", requirePermission("institution.settings.manage"), requireInstitutionScope, adminInstitutionsController.getSettings);
router.put("/institutions/:institutionId/settings", requirePermission("institution.settings.manage"), requireInstitutionScope, adminInstitutionsController.saveSettings);

// Profiles & Directory Verification
router.get("/institutions/:institutionId/bank-profile", requirePermission("institution.service.view"), adminInstitutionsController.getBankProfile);
router.put("/institutions/:institutionId/bank-profile", requirePermission("institution.service.manage"), adminInstitutionsController.saveBankProfile);
router.get("/institutions/:institutionId/mfs-profile", requirePermission("institution.service.view"), adminInstitutionsController.getMfsProfile);
router.put("/institutions/:institutionId/mfs-profile", requirePermission("institution.service.manage"), adminInstitutionsController.saveMfsProfile);
router.patch("/institutions/:institutionId/directory-verification", requirePermission("institution.service.manage"), adminInstitutionsController.updateDirectoryVerification);

// Data Imports (Staging, Preview & Publish)
router.get("/institutions/imports/all", requirePermission("institution.service.manage"), adminInstitutionsController.listDataImports);
router.post("/institutions/imports/stage", requirePermission("institution.service.manage"), adminInstitutionsController.createDataImport);
router.get("/institutions/imports/:id", requirePermission("institution.service.manage"), adminInstitutionsController.getDataImportDetails);
router.post("/institutions/imports/:id/publish", requirePermission("institution.service.manage"), adminInstitutionsController.publishDataImport);

// MFS Service Points
router.get("/institutions/service-points/all", requirePermission("institution.branch.view"), adminInstitutionsController.listServicePoints);
router.post("/institutions/service-points", requirePermission("institution.branch.manage"), adminInstitutionsController.createServicePoint);

// Partner Onboarding Applications
router.get("/institutions/partner-applications/all", requirePermission("institution.service.view"), adminInstitutionsController.listPartnerOnboardingApplications);
router.patch("/institutions/partner-applications/:id/review", requirePermission("institution.service.manage"), adminInstitutionsController.reviewPartnerOnboardingApplication);


/* ==========================================================================
   6. ADD-ONS MANAGEMENT
   ========================================================================== */
router.get("/addons/stats", requirePermission("addon.view"), adminAddonsController.getStats);
router.get("/addons/applications", requirePermission("addon.view"), adminAddonsController.listApplications);
router.post("/addons/applications/:applicationId/review", requirePermission("addon.edit"), adminAddonsController.reviewApplication);
router.get("/addons", requirePermission("addon.view"), adminAddonsController.list);
router.get("/addons/:addonId", requirePermission("addon.view"), adminAddonsController.getById);
router.post("/addons", requirePermission("addon.create"), adminAddonsController.create);
router.put("/addons/:addonId", requirePermission("addon.edit"), adminAddonsController.update);
router.patch("/addons/:addonId/status", requirePermission("addon.edit"), adminAddonsController.updateStatus);
router.patch("/addons/:addonId/publish", requirePermission("addon.edit"), adminAddonsController.updatePublish);
router.delete("/addons/:addonId", requirePermission("addon.delete"), adminAddonsController.delete);

// Add-on Orders & DGePay Payments Management
router.get("/addon-orders", requirePermission("addon.view"), paymentsController.listAdminOrders);
router.get("/addon-orders/:orderId", requirePermission("addon.view"), paymentsController.getAdminOrderById);
router.post("/addon-orders/:orderId/review", requirePermission("addon.edit"), paymentsController.reviewAdminOrder);
router.patch("/addon-orders/:orderId/archive", requirePermission("addon.edit"), paymentsController.archiveAdminOrder);
router.get("/orders", requirePermission("addon.view"), paymentsController.listAdminOrders);
router.get("/orders/:orderId", requirePermission("addon.view"), paymentsController.getAdminOrderById);
router.post("/orders/:orderId/review", requirePermission("addon.edit"), paymentsController.reviewAdminOrder);
router.patch("/orders/:orderId/archive", requirePermission("addon.edit"), paymentsController.archiveAdminOrder);

router.get("/addon-payments", requirePermission("addon.view"), paymentsController.listAdminPayments);
router.get("/addon-payments/:paymentId", requirePermission("addon.view"), paymentsController.getAdminPaymentById);
router.post("/addon-payments/:paymentId/reconcile", requirePermission("addon.edit"), paymentsController.reconcileAdminPayment);
router.patch("/addon-payments/:paymentId/archive", requirePermission("addon.edit"), paymentsController.archiveAdminPayment);
router.get("/payments", requirePermission("addon.view"), paymentsController.listAdminPayments);
router.get("/payments/:paymentId", requirePermission("addon.view"), paymentsController.getAdminPaymentById);
router.post("/payments/:paymentId/reconcile", requirePermission("addon.edit"), paymentsController.reconcileAdminPayment);
router.patch("/payments/:paymentId/archive", requirePermission("addon.edit"), paymentsController.archiveAdminPayment);

/* ==========================================================================
   7. SUPPORT TICKETS
   ========================================================================== */
router.get("/support", requirePermission("ticket.view"), adminSupportController.list);
router.get("/support/:ticketId", requirePermission("ticket.view"), adminSupportController.getById);
router.post("/support/:ticketId/reply", requirePermission("ticket.reply"), adminSupportController.reply);
router.patch("/support/:ticketId/status", requirePermission("ticket.manage"), adminSupportController.update);

/* ==========================================================================
   9. NOTIFICATIONS
   ========================================================================== */
router.get("/notifications/unread-count", requirePermission("notification.view"), adminNotificationsController.unreadCount);
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

/* ==========================================================================
   14. CONTACT INQUIRIES & LEADS
   ========================================================================== */
router.get("/contact-inquiries", adminInquiriesController.list);
router.get("/contact-inquiries/:id", adminInquiriesController.getById);
router.patch("/contact-inquiries/:id/status", adminInquiriesController.updateStatus);
router.delete("/contact-inquiries/:id", adminInquiriesController.delete);

export default router;
