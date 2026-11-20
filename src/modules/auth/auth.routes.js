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
  getVerificationChannels,
} from "./auth.controller.js";

import { requireAuth } from "../../middlewares/auth.js";
import {
  passwordResetLimiter,
  otpVerificationLimiter,
  otpResendLimiter,
} from "../../middlewares/rateLimiter.js";

const router = Router();

router.post("/register", register);

router.post("/verify", otpVerificationLimiter, verify);

router.post("/resend-otp", otpResendLimiter, resend);

router.get("/verification-status", verificationStatus);

router.get("/verification-channels", getVerificationChannels);

router.post("/forgot-password", passwordResetLimiter, forgotPassword);

router.get("/verify-reset-token", verifyResetTokenController);

router.post("/reset-password", passwordResetLimiter, resetPasswordController);

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
