import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.js";
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

// Merchant Applications & KYC Correction Workflow
router.get("/applications", requireInstitutionPermission("institution.application.view"), institutionController.listApplications);
router.get("/applications/:id", requireInstitutionPermission("institution.application.view"), institutionController.getApplication);
router.get("/applications/:id/documents/:docId/view", requireInstitutionPermission("institution.application.view"), institutionController.viewDocument);
router.post("/applications/:id/correction", requireInstitutionPermission("institution.application.request_info"), institutionController.requestCorrection);
router.patch("/applications/corrections/:issueId/resolve", requireInstitutionPermission("institution.application.request_info"), institutionController.resolveCorrection);
router.post("/applications/:id/review", requireInstitutionPermission("institution.application.review"), institutionController.reviewApplication);

// Branches & Official Update Requests
router.get("/branches", requireInstitutionPermission("institution.dashboard.view"), institutionController.listBranches);
router.post("/branches/change-request", requireInstitutionPermission("institution.settings.manage"), institutionController.requestBranchCorrection);

// Staff & Branch Scope Assignments
router.get("/staff", requireInstitutionPermission("institution.users.manage"), institutionController.listStaff);
router.post("/staff/:membershipId/branches", requireInstitutionPermission("institution.users.manage"), institutionController.assignStaffBranches);

// Services & Integrations
router.get("/services", requireInstitutionPermission("institution.service.view"), institutionController.listServices);
router.post("/services", requireInstitutionPermission("institution.service.manage"), institutionController.saveService);

// Connections & Testing
router.get("/connections", requireInstitutionPermission("institution.service.view"), institutionController.listConnections);
router.post("/connections/:serviceId/test", requireInstitutionPermission("institution.service.manage"), institutionController.testConnection);

// Reports
router.get("/reports", requireInstitutionPermission("institution.reports.view"), institutionController.getReports);

export default router;

