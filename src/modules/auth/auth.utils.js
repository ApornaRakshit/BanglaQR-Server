import crypto from "crypto";
import jwt from "jsonwebtoken";

import { env } from "../../config/env.js";

export function generateOtp() {
  return crypto
    .randomInt(0, 1000000)
    .toString()
    .padStart(6, "0");
}

export function hashOtp(code) {
  return crypto
    .createHmac("sha256", env.otpHashSecret)
    .update(code)
    .digest("hex");
}

export function createAccessToken(user) {
  return jwt.sign(
    {
      sub: String(user.id),
      email: user.email,
      role: user.role,
    },
    env.jwt.accessSecret,
    {
      expiresIn: "15m",
    }
  );
}