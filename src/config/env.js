
import dotenv from "dotenv";

dotenv.config();

// Required environment variables
const requiredEnv = [
  "JWT_ACCESS_SECRET",
  "JWT_REFRESH_SECRET",
  "COOKIE_SECRET",
  "OTP_HASH_SECRET",
];

for (const key of requiredEnv) {
  if (!process.env[key]) {
    throw new Error(
      `Missing required environment variable: ${key}`
    );
  }
}

// Application environment
const nodeEnv = process.env.NODE_ENV || "development";

/**
 * Normalize a frontend URL to its origin.
 * Examples:
 * https://banglaqr.online/ -> https://banglaqr.online
 * http://localhost:5173   -> http://localhost:5173
 */
function normalizeOrigin(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  try {
    const url = new URL(value.trim());

    if (!["http:", "https:"].includes(url.protocol)) {
      return null;
    }

    return url.origin;
  } catch {
    return null;
  }
}

// Default frontend URL for existing code that expects one URL.
const defaultFrontendUrl =
  nodeEnv === "production"
    ? "https://banglaqr.online"
    : "http://localhost:5173";

const rawFrontendUrl = process.env.FRONTEND_URL?.trim();

const frontendUrl = rawFrontendUrl
  ? normalizeOrigin(rawFrontendUrl)
  : defaultFrontendUrl;

if (!frontendUrl) {
  throw new Error(
    "FRONTEND_URL must be a valid HTTP or HTTPS URL."
  );
}

// Support multiple comma-separated frontend origins.
const configuredFrontendOrigins = (
  process.env.FRONTEND_URLS || ""
)
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean)
  .map((value) => {
    const origin = normalizeOrigin(value);

    if (!origin) {
      throw new Error(
        `Invalid frontend origin in FRONTEND_URLS: ${value}`
      );
    }

    return origin;
  });

// Local development origins are enabled only outside production.
const developmentOrigins =
  nodeEnv === "production"
    ? []
    : [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
      ];

// Deduplicate all allowed frontend origins.
const frontendUrls = [
  ...new Set([
    frontendUrl,
    ...configuredFrontendOrigins,
    ...developmentOrigins,
  ]),
];

export const env = {
  nodeEnv,

  port: Number(process.env.PORT || 5000),

  // Retained for code that expects a single frontend URL.
  frontendUrl,

  // Use this array for CORS validation.
  frontendUrls,

  db: {
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 3306),
    name: process.env.DB_NAME || "banglaqr_db",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
  },

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
  },

  cookieSecret: process.env.COOKIE_SECRET,

  otpHashSecret: process.env.OTP_HASH_SECRET,

  smtp: {
    host: process.env.SMTP_HOST || "",
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    from:
      process.env.SMTP_FROM ||
      '"BanglaQR Security" <noreply@banglaqr.com>',
  },

  sms: {
    provider: process.env.SMS_PROVIDER || "bulksmsbd",
    apiUrl: process.env.SMS_API_URL || "",
    apiKey: process.env.SMS_API_KEY || "",
    senderId: process.env.SMS_SENDER_ID || "BanglaQR",
  },

  authVerificationMode:
    process.env.AUTH_VERIFICATION_MODE || "",

  dgepay: {
    env: process.env.DGEPAY_ENV || "uat",
    baseUrl: (process.env.DGEPAY_BASE_URL || "https://api-uat.dgepay.net/dipon/v3").replace(/\/$/, ""),
    clientId: process.env.DGEPAY_CLIENT_ID || "",
    clientSecret: process.env.DGEPAY_CLIENT_SECRET || "",
    apiKey: process.env.DGEPAY_API_KEY || "",
    secretKey: process.env.DGEPAY_SECRET_KEY || "",
    centerPhone: process.env.DGEPAY_CENTER_PHONE || "01618121655",
    authPath: process.env.DGEPAY_AUTH_PATH || "/payment_gateway/authenticate",
    initiatePath: process.env.DGEPAY_INITIATE_PATH || "/payment_gateway/initiate_payment",
    verifyPath: process.env.DGEPAY_VERIFY_PATH || "/payment_gateway/check_transaction_status",
    redirectUrl: process.env.DGEPAY_REDIRECT_URL || "http://localhost:5000/api/v1/payments/dgepay/callback",
    callbackUrl: process.env.DGEPAY_CALLBACK_URL || "http://localhost:5000/api/v1/payments/dgepay/callback",
    frontendResultUrl: process.env.DGEPAY_FRONTEND_RESULT_URL || "http://localhost:5173/merchant/addons?payment=result",
    debug: process.env.DGEPAY_DEBUG === "true",
  },
};

/**
 * Verification bypass is permitted only in local development
 * when AUTH_VERIFICATION_MODE is development_bypass.
 * It is never enabled in production.
 */
export function isDevVerificationBypass() {
  return (
    env.nodeEnv === "development" &&
    env.authVerificationMode === "development_bypass"
  );
}
