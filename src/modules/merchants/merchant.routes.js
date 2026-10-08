import express from "express";
import { merchantController } from "./merchant.controller.js";
import { requireAuth } from "../../middlewares/auth.js";
import { uploadDocument } from "../../middlewares/upload.js";

const router = express.Router();

// All merchant routes require authentication
router.use(requireAuth);

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

export default router;

