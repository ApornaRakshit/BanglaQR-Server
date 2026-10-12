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

router.post("/login", login);

router.get(
  "/me",
  requireAuth,
  me
);

router.post("/logout", logout);

export default router;