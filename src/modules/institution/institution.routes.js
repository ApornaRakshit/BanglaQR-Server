import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.js";
import { uploadDocument, uploadDocumentArray } from "../../middlewares/upload.js";
import {
  requireInstitutionStaff,
  requireInstitutionScope,
  requireInstitutionPermission,
} from "../../middlewares/permission.js";
import { institutionController } from "./institution.controller.js";

const router = Router();

// All routes require authentication and valid institution staff/admin membership
router.use(requireAuth);
router.use(requireInstitutionStaff);
router.use(requireInstitutionScope);

// Profile & Dashboard
router.get("/me", institutionController.getMe);
router.get("/dashboard", requireInstitutionPermission("institution.dashboard.view"), institutionController.getDashboard);
router.get("/dashboard/export-excel", requireInstitutionPermission("institution.dashboard.view"), institutionController.exportDashboardExcel);

// Merchant Applications & KYC Correction Workflow
router.get("/applications", requireInstitutionPermission("institution.application.view"), institutionController.listApplications);
router.get("/applications/export-excel", requireInstitutionPermission("institution.application.view"), institutionController.exportAllApplicationsExcel);
router.post(
  "/merchants",
  requireInstitutionPermission("institution.application.review"),
  uploadDocumentArray.array("documents", 20),
  institutionController.createMerchant
);
router.delete("/merchants/:merchantId", requireInstitutionPermission("institution.application.review"), institutionController.deleteMerchant);
router.get("/applications/:id", requireInstitutionPermission("institution.application.view"), institutionController.getApplication);
router.delete("/applications/:id/merchant", requireInstitutionPermission("institution.application.review"), institutionController.deleteMerchant);
router.get("/applications/:id/history", requireInstitutionPermission("institution.application.view"), institutionController.getApplicationHistory);
router.get("/applications/:id/summary", requireInstitutionPermission("institution.application.view"), institutionController.downloadApplicationSummary);
router.get("/applications/:id/export-excel", requireInstitutionPermission("institution.application.view"), institutionController.downloadApplicationExcel);
router.get("/applications/:id/documents/:docId/view", requireInstitutionPermission("institution.application.view"), institutionController.viewDocument);
router.post("/applications/:id/correction", requireInstitutionPermission("institution.application.request_info"), institutionController.requestCorrection);
router.patch("/applications/corrections/:issueId/resolve", requireInstitutionPermission("institution.application.request_info"), institutionController.resolveCorrection);
router.post("/applications/:id/review", requireInstitutionPermission("institution.application.review"), institutionController.reviewApplication);

// Merchant QR Management
router.get("/merchant-qr", requireInstitutionPermission("institution.application.view"), institutionController.listApprovedMerchantsForQr);
router.post(
  "/merchants/:merchantId/qr-code",
  requireInstitutionPermission("institution.application.review"),
  uploadDocument.single("file"),
  institutionController.uploadMerchantQrCode
);

// Branches & Official Update Requests
router.get("/branches", requireInstitutionPermission("institution.dashboard.view"), institutionController.listBranches);
router.post("/branches/change-request", requireInstitutionPermission("institution.settings.manage"), institutionController.requestBranchCorrection);

// Staff & Branch Scope Assignments
router.get("/staff", requireInstitutionPermission("institution.users.manage"), institutionController.listStaff);
router.post("/staff", requireInstitutionPermission("institution.users.manage"), institutionController.createStaff);
router.patch("/staff/:membershipId", requireInstitutionPermission("institution.users.manage"), institutionController.updateStaff);
router.delete("/staff/:membershipId", requireInstitutionPermission("institution.users.manage"), institutionController.deleteStaff);
router.post("/staff/batch-delete", requireInstitutionPermission("institution.users.manage"), institutionController.batchDeleteStaff);
router.post("/staff/:membershipId/branches", requireInstitutionPermission("institution.users.manage"), institutionController.assignStaffBranches);

// Services & Integrations
router.get("/services", requireInstitutionPermission("institution.service.view"), institutionController.listServices);
router.post("/services", requireInstitutionPermission("institution.service.manage"), institutionController.saveService);

// Connections & Testing
router.get("/connections", requireInstitutionPermission("institution.service.view"), institutionController.listConnections);
router.post("/connections/:serviceId/test", requireInstitutionPermission("institution.service.manage"), institutionController.testConnection);

// Reports
router.get("/reports", requireInstitutionPermission("institution.reports.view"), institutionController.getReports);

// Notifications
router.get("/notifications", institutionController.getNotifications);
router.patch("/notifications/read-all", institutionController.markAllNotificationsRead);
router.patch("/notifications/:id/read", institutionController.markNotificationRead);

// Support Helpdesk (Tickets)
router.get("/support", institutionController.listSupportTickets);
router.get("/support/:id", institutionController.getSupportTicket);
router.post("/support/:id/reply", institutionController.replySupportTicket);
router.patch("/support/:id/status", institutionController.updateSupportTicketStatus);

export default router;

