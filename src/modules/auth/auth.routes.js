import { Router } from "express";

import {
  register,
  verify,
  resend,
  login,
  me,
  logout,
} from "./auth.controller.js";

import { requireAuth } from "../../middlewares/auth.js";

const router = Router();

router.post("/register", register);

router.post("/verify", verify);

router.post("/resend-otp", resend);

router.post("/login", login);

router.get(
  "/me",
  requireAuth,
  me
);

router.post("/logout", logout);

export default router;