import express from "express";
import { merchantController } from "./merchant.controller.js";
import { paymentsController } from "../payments/payments.controller.js";
import { requireAuth } from "../../middlewares/auth.js";
import { uploadDocument } from "../../middlewares/upload.js";

const router = express.Router();

// All merchant routes require authentication
router.use(requireAuth);

// --- Overview & Onboarding ---
router.get("/me", merchantController.getMe);
router.get("/me/onboarding", merchantController.getOnboarding);

// Step 1: Company Information
router.put("/me/company", merchantController.updateCompany);

// Step 2: Contact Information
router.put("/me/contact", merchantController.updateContact);

// Step 3: Commercial Details
router.put("/me/commercial", merchantController.updateCommercial);

// Step 4: KYC Information
router.get("/me/kyc", merchantController.getKyc);
router.put("/me/kyc", merchantController.updateKyc);

// Banking Institutions & Branches for Settlement & KYC
router.get("/institutions", merchantController.getInstitutions);
router.get("/institutions/:institutionId/branches", merchantController.getInstitutionBranches);
router.get("/institutions/:institutionId/kyc-requirements", merchantController.getInstitutionKycRequirements);
router.get("/geo/divisions", merchantController.getGeoDivisions);
router.get("/geo/districts", merchantController.getGeoDistricts);
router.get("/geo/upazilas", merchantController.getGeoUpazilas);

// Step 5: Documents
router.get("/me/documents", merchantController.getDocuments);
router.post("/me/documents", uploadDocument.single("file"), merchantController.uploadDocument);
router.post("/me/documents/:id/replace", uploadDocument.single("file"), merchantController.replaceDocument);
router.delete("/me/documents/:id", merchantController.deleteDocument);
router.get("/me/documents/:id/view", merchantController.viewDocument);

// Step 7: Application Submission & Corrections
router.post("/me/submit", merchantController.submitApplication);
router.post("/me/corrections/resubmit", merchantController.submitCorrection);

// --- Payment Services: Gateway Catalogue & Applications ---
router.get("/me/gateways", merchantController.getGateways);
router.get("/me/gateways/:gatewayId", merchantController.getGatewayById);
router.post("/me/gateways/:gatewayId/apply", merchantController.applyGateway);

router.get("/me/applications", merchantController.getApplications);
router.get("/me/applications/:id", merchantController.getApplicationById);

// --- Payment Services: My Services ---
router.get("/me/services", merchantController.getMyServices);
router.get("/me/services/:id", merchantController.getMyServiceById);
router.put("/me/services/:id/configuration", merchantController.updateServiceConfiguration);

// --- Payment Services: Add-ons & Orders ---
router.get("/me/addons", merchantController.getAddons);
router.post("/me/addons/:addonId/apply", paymentsController.createAddonOrder);
router.post("/me/addons/:addonId/order", paymentsController.createAddonOrder);

// Orders
router.get("/me/addon-orders", paymentsController.listMerchantOrders);
router.get("/me/addon-orders/:orderId", paymentsController.getMerchantOrderById);
router.post("/me/addon-orders/:orderId/checkout", paymentsController.resumeMerchantOrderCheckout);
router.get("/me/orders", paymentsController.listMerchantOrders);
router.get("/me/orders/:orderId", paymentsController.getMerchantOrderById);
router.post("/me/orders/:orderId/checkout", paymentsController.resumeMerchantOrderCheckout);

// Payments
router.get("/me/addon-payments", paymentsController.listMerchantPayments);
router.get("/me/addon-payments/:paymentReference/status", paymentsController.getMerchantPaymentStatus);
router.get("/me/addon-payments/id/:paymentId", paymentsController.getMerchantPaymentById);
router.post("/me/addon-payments/id/:paymentId/refresh", paymentsController.refreshMerchantPayment);
router.get("/me/payments", paymentsController.listMerchantPayments);
router.get("/me/payments/:paymentReference/status", paymentsController.getMerchantPaymentStatus);
router.get("/me/payments/id/:paymentId", paymentsController.getMerchantPaymentById);
router.post("/me/payments/id/:paymentId/refresh", paymentsController.refreshMerchantPayment);

// --- Notifications ---
router.get("/me/notifications", merchantController.getNotifications);
router.get("/me/notifications/unread-count", merchantController.getUnreadNotificationCount);
router.patch("/me/notifications/:id/read", merchantController.markNotificationRead);
router.patch("/me/notifications/read-all", merchantController.markAllNotificationsRead);

// --- Support Tickets ---
router.get("/me/support", merchantController.getSupportTickets);
router.get("/me/support/:id", merchantController.getSupportTicketById);
router.post("/me/support", merchantController.createSupportTicket);
router.post("/me/support/:id/reply", merchantController.replySupportTicket);

// --- Settings ---
router.get("/me/settings", merchantController.getSettings);
router.put("/me/settings/password", merchantController.changePassword);

export default router;
