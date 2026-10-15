import { Router } from "express";

import {
  register,
  verify,
  resend,
  verificationStatus,
  login,
  me,
  logout,
  forgotPassword,
  verifyResetTokenController,
  resetPasswordController,
  verifyInstitutionInvitationController,
  acceptInstitutionInvitationController,
  changePassword,
} from "./auth.controller.js";

import { requireAuth } from "../../middlewares/auth.js";

const router = Router();

router.post("/register", register);

router.post("/verify", verify);

router.post("/resend-otp", resend);

router.get("/verification-status", verificationStatus);

router.post("/forgot-password", forgotPassword);

router.get("/verify-reset-token", verifyResetTokenController);

router.post("/reset-password", resetPasswordController);

// Institution invitation activation routes
router.get("/institution-invitations/verify", verifyInstitutionInvitationController);
router.post("/institution-invitations/accept", acceptInstitutionInvitationController);

router.post("/login", login);

router.get(
  "/me",
  requireAuth,
  me
);

router.post("/change-password", requireAuth, changePassword);

router.post("/logout", logout);

export default router;