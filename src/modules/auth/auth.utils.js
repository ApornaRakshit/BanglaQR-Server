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
  const version = Number(user.token_version ?? 0);
  return jwt.sign(
    {
      sub: String(user.id),
      email: user.email,
      role: user.role,
      token_version: Number.isFinite(version) ? version : 0,
    },
    env.jwt.accessSecret,
    {
      expiresIn: "7d",
    }
  );
}

export function createLoginChallengeToken(user) {
  return jwt.sign(
    {
      sub: String(user.id),
      email: user.email,
      phone: user.phone,
      type: "login_otp_challenge",
    },
    env.jwt.accessSecret,
    {
      expiresIn: "10m",
    }
  );
}

export function verifyLoginChallengeToken(token) {
  try {
    const decoded = jwt.verify(token, env.jwt.accessSecret);
    if (decoded.type !== "login_otp_challenge") return null;
    return decoded;
  } catch {
    return null;
  }
}

export function generateResetToken() {
  return crypto.randomBytes(32).toString("hex");
}

export function createPasswordResetChallengeToken(user, jti = null) {
  const payload = {
    sub: String(user.id),
    phone: user.phone,
    type: "password_reset_challenge",
  };
  if (jti) {
    payload.jti = jti;
  }
  return jwt.sign(
    payload,
    env.jwt.accessSecret,
    {
      expiresIn: "10m",
    }
  );
}

export function verifyPasswordResetChallengeToken(token) {
  try {
    const decoded = jwt.verify(token, env.jwt.accessSecret);
    if (decoded.type !== "password_reset_challenge") return null;
    return decoded;
  } catch {
    return null;
  }
}

export function hashResetToken(token) {
  return crypto
    .createHmac("sha256", env.otpHashSecret)
    .update(token)
    .digest("hex");
}