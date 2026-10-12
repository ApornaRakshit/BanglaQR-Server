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

// Step 5: Documents
router.get("/me/documents", merchantController.getDocuments);
router.post("/me/documents", uploadDocument.single("file"), merchantController.uploadDocument);
router.post("/me/documents/:id/replace", uploadDocument.single("file"), merchantController.replaceDocument);
router.delete("/me/documents/:id", merchantController.deleteDocument);
router.get("/me/documents/:id/view", merchantController.viewDocument);

// Step 7: Application Submission
router.post("/me/submit", merchantController.submitApplication);

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

import { merchantInvoicesController } from "./invoices/merchant.invoices.controller.js";

// --- Invoices & Billing ---
router.get("/me/invoices/stats", merchantInvoicesController.getStats);
router.get("/me/invoices/next-number", merchantInvoicesController.getNextNumber);
router.get("/me/invoices", merchantInvoicesController.list);
router.get("/me/invoices/export.xlsx", merchantInvoicesController.exportExcel);
router.get("/me/invoices/:id", merchantInvoicesController.getById);
router.get("/me/invoices/:id/pdf", merchantInvoicesController.downloadPdf);
router.get("/me/invoices/:id/payment-link", merchantInvoicesController.getPaymentLink);
router.post("/me/invoices", merchantInvoicesController.create);
router.put("/me/invoices/:id", merchantInvoicesController.update);
router.post("/me/invoices/:id/send", merchantInvoicesController.send);
router.post("/me/invoices/:id/remind", merchantInvoicesController.sendReminder);
router.post("/me/invoices/:id/payments", merchantInvoicesController.recordPayment);
router.post("/me/invoices/:id/cancel", merchantInvoicesController.cancel);

// --- Invoice Customer Management ---
router.get("/me/invoice-customers", merchantInvoicesController.listCustomers);
router.post("/me/invoice-customers", merchantInvoicesController.createCustomer);
router.get("/me/invoice-customers/:customerId", merchantInvoicesController.getCustomerById);
router.put("/me/invoice-customers/:customerId", merchantInvoicesController.updateCustomer);
router.delete("/me/invoice-customers/:customerId", merchantInvoicesController.deleteCustomer);

// --- Settings ---
router.get("/me/settings", merchantController.getSettings);
router.put("/me/settings/password", merchantController.changePassword);

export default router;
