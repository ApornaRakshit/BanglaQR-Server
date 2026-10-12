import crypto from "crypto";
import { env } from "../../config/env.js";

/**
 * Official DGePay v3 Integration for BanglaQR
 * Matches the official DGePay SDK specification:
 * - Deterministic JSON sorting (top-level) with decimal `.0` amount format
 * - Canonical HMAC-SHA256 signature generation with apiKey
 * - AES-128-ECB encrypted payload with UTF-8 key padded with ASCII '0' to 16 bytes
 * - Token caching and auto-refresh
 * - Webview checkout URL return
 * - Server-side transaction status check and callback decrypt
 */

function getConfig() {
  const cfg = env.dgepay;
  const secretKey =
    cfg.secretKey && !/^(YOUR_|CHANGE_ME|REPLACE_ME|<[^>]+>)/i.test(cfg.secretKey.trim())
      ? cfg.secretKey
      : cfg.clientSecret;

  return {
    ...cfg,
    resolvedSecretKey: secretKey,
  };
}

function validateConfig({ requireApiKey = true, requireSecretKey = true } = {}) {
  const cfg = getConfig();
  const missing = [];
  if (!cfg.clientId) missing.push("DGEPAY_CLIENT_ID");
  if (!cfg.clientSecret) missing.push("DGEPAY_CLIENT_SECRET");
  if (requireApiKey && !cfg.apiKey) missing.push("DGEPAY_API_KEY");
  if (requireSecretKey && !cfg.resolvedSecretKey) missing.push("DGEPAY_SECRET_KEY/CLIENT_SECRET");

  if (missing.length) {
    throw new Error(`Missing DGePay configuration: ${missing.join(", ")}`);
  }
  return cfg;
}

function getBasicAuth() {
  const cfg = validateConfig({ requireApiKey: false, requireSecretKey: false });
  return Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`, "utf8").toString("base64");
}

let tokenCache = null;

function parseExpiryToMs(expiryTime) {
  if (!expiryTime) return 0;
  const parsed = Date.parse(String(expiryTime).replace(" ", "T"));
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function authenticateDgePay() {
  const cfg = validateConfig({ requireApiKey: false, requireSecretKey: false });
  const now = Date.now();

  if (tokenCache && tokenCache.token && tokenCache.expiresAt > now + 30000) {
    return {
      accessToken: tokenCache.token,
      expiryTime: tokenCache.expiryTime,
      cached: true,
    };
  }

  const response = await fetch(`${cfg.baseUrl}${cfg.authPath}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${getBasicAuth()}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
    }),
  });

  const text = await response.text();
  let data = {};
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`DGePay returned invalid JSON (HTTP ${response.status})`);
  }

  const accessToken = data?.data?.access_token || data?.access_token;
  if (!response.ok || !accessToken) {
    const message =
      (Array.isArray(data?.error) ? data.error[0] : data?.error) ||
      data?.error_msg ||
      data?.message ||
      `Authentication failed with HTTP ${response.status}`;
    throw new Error(`DGePay Authentication Error: ${message}`);
  }

  const expiryTime = data?.data?.expiry_time || data?.expiry_time || null;
  const parsedExpiry = parseExpiryToMs(expiryTime);

  tokenCache = {
    token: accessToken,
    expiryTime,
    expiresAt: parsedExpiry || now + 10 * 60 * 1000,
  };

  return { accessToken, expiryTime, cached: false };
}

export function clearTokenCache() {
  tokenCache = null;
}

export function sortJsonTopLevel(payload) {
  const source = { ...payload };
  const keys = Object.keys(source).sort();
  const ordered = {};
  for (const key of keys) ordered[key] = source[key];

  return JSON.stringify(ordered, (key, value) => {
    return value;
  }).replace(/("amount":)(-?\d+)([,}])/g, "$1$2.0$3");
}

export function removeSignatureCharacters(jsonString) {
  return String(jsonString).replace(/[{}": ,]/g, "");
}

export function canonicalStringForSignature(payload) {
  return removeSignatureCharacters(sortJsonTopLevel(payload));
}

export function createDgePaySignature(payload) {
  const cfg = validateConfig({ requireApiKey: true, requireSecretKey: false });
  const canonical = canonicalStringForSignature(payload);

  return crypto
    .createHmac("sha256", Buffer.from(cfg.apiKey, "utf8"))
    .update(canonical, "utf8")
    .digest("base64");
}

function getAesKey() {
  const cfg = validateConfig({ requireApiKey: false, requireSecretKey: true });
  return Buffer.from(String(cfg.resolvedSecretKey).padEnd(16, "0").slice(0, 16), "utf8");
}

export function encryptDgePayPayload(payload, { preSortedJson = null } = {}) {
  const jsonString = preSortedJson || sortJsonTopLevel(payload);
  const cipher = crypto.createCipheriv("aes-128-ecb", getAesKey(), null);
  cipher.setAutoPadding(true);

  const encrypted = Buffer.concat([
    cipher.update(Buffer.from(jsonString, "utf8")),
    cipher.final(),
  ]);

  return encrypted.toString("base64");
}

export function decryptDgePayPayload(encryptedBase64) {
  if (!encryptedBase64) return null;

  try {
    const clean = String(encryptedBase64).replace(/ /g, "+");
    const decipher = crypto.createDecipheriv("aes-128-ecb", getAesKey(), null);
    decipher.setAutoPadding(true);

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(clean, "base64")),
      decipher.final(),
    ]);

    return JSON.parse(decrypted.toString("utf8"));
  } catch (error) {
    if (getConfig().debug) console.error("[DGePay] decrypt failed:", error.message);
    return null;
  }
}

export function generateUniqueTxnId() {
  return crypto.randomBytes(16).toString("hex");
}

function normalizePhone(phone) {
  const value = String(phone || "").replace(/\s+/g, "");
  if (!value) return "01618121655";
  if (value.startsWith("+880")) return value.slice(4);
  if (value.startsWith("880")) return value.slice(3);
  if (value.startsWith("+88")) return value.slice(3);
  return value;
}

function normalizeAmount(amount) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) throw new Error("Invalid payment amount");
  return Number(value.toFixed(2));
}

export const PAYMENT_METHODS = Object.freeze({
  bkash: "2002",
  nagad: "2013",
  upay: "2005",
  pubali_bank: "0175",
  dbbl_nexus: "6002",
  dbbl_master_card: "6004",
  dbbl_rocket: "2001",
  dbbl_visa_card: "6005",
  ucb_card: "6001",
  cellfin: "6006",
  meghna_pay: "6007",
});

export function normalizePaymentMethod(value) {
  if (value === null || value === undefined || value === "") return "";
  const raw = String(value).trim().toLowerCase();
  if (PAYMENT_METHODS[raw]) return PAYMENT_METHODS[raw];
  if (/^\d{4}$/.test(raw)) return raw;
  return "";
}

/**
 * Initiates payment session with DGePay Live/UAT Gateway
 */
export async function initiateDgePayPayment({
  amount,
  orderNumber,
  customer,
  note,
  redirectUrl,
  paymentMethod = null,
}) {
  const cfg = validateConfig({ requireApiKey: true, requireSecretKey: true });
  const phone = normalizePhone(customer?.phone || cfg.centerPhone);
  const numericAmount = normalizeAmount(amount);
  const uniqueTxnId = generateUniqueTxnId();
  const selectedPaymentMethod = normalizePaymentMethod(paymentMethod);

  const payload = {
    customer_token: null,
    note: String(note || `BanglaQR Addon - ${orderNumber || uniqueTxnId}`),
    amount: numericAmount,
    payment_method: selectedPaymentMethod,
    unique_txn_id: String(uniqueTxnId),
    payee_information: {
      dial_code: "+88",
      phone_number: String(phone),
    },
    redirect_url: String(redirectUrl || cfg.redirectUrl),
  };

  const sortedJson = sortJsonTopLevel(payload);
  const signature = createDgePaySignature(payload);
  const encryptedBody = encryptDgePayPayload(payload, { preSortedJson: sortedJson });
  const auth = await authenticateDgePay();

  const makeRequest = async (accessToken) => {
    const res = await fetch(`${cfg.baseUrl}${cfg.initiatePath}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        Signature: signature,
      },
      body: encryptedBody,
    });
    const text = await res.text();
    let data = {};
    try {
      data = JSON.parse(text);
    } catch {}
    return { res, data };
  };

  let { res: response, data } = await makeRequest(auth.accessToken);

  if ((response.status === 401 || response.status === 403) && auth.cached) {
    clearTokenCache();
    const freshAuth = await authenticateDgePay();
    const retry = await makeRequest(freshAuth.accessToken);
    response = retry.res;
    data = retry.data;
  }

  const isSuccess =
    data?.success === true ||
    data?.success === 1 ||
    data?.success === "1" ||
    String(data?.status_code || "") === "200";

  if (!isSuccess) {
    const message =
      (Array.isArray(data?.error) ? data.error[0] : data?.error) ||
      data?.error_msg ||
      data?.message ||
      `Payment initiation failed with HTTP ${response.status}`;
    if (cfg.debug) {
      console.error("[DGePay] initiate failed:", message, data);
    }
    throw new Error(`DGePay payment initiation failed: ${message}`);
  }

  const paymentUrl =
    data?.data?.webview_url ||
    data?.data?.payment_url ||
    data?.webview_url ||
    data?.payment_url ||
    null;

  return {
    uniqueTxnId,
    paymentUrl,
    gatewayOrderId: data?.data?.unique_txn_id || data?.data?.order_id || uniqueTxnId,
    paymentMethod: selectedPaymentMethod,
    raw: data,
  };
}

/**
 * Checks transaction status directly with DGePay server
 */
export async function checkDgePayTransaction(uniqueTxnId) {
  if (!uniqueTxnId) throw new Error("unique_txn_id is required");

  const cfg = validateConfig({ requireApiKey: true, requireSecretKey: true });
  const payload = { unique_txn_id: String(uniqueTxnId) };
  const bodyJson = sortJsonTopLevel(payload);
  const signature = createDgePaySignature(payload);
  const encryptedBody = encryptDgePayPayload(payload, { preSortedJson: bodyJson });

  const auth = await authenticateDgePay();
  const response = await fetch(`${cfg.baseUrl}${cfg.verifyPath}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      Signature: signature,
    },
    body: encryptedBody,
  });

  const text = await response.text();
  let data = {};
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`DGePay status response invalid JSON (HTTP ${response.status})`);
  }

  if (!response.ok) {
    const message =
      (Array.isArray(data?.error) ? data.error[0] : data?.error) ||
      data?.message ||
      `Transaction status request failed with HTTP ${response.status}`;
    throw new Error(`DGePay transaction status error: ${message}`);
  }

  return data;
}

export function getNestedGatewayData(data) {
  let current = data;
  const seen = new Set();
  const candidates = [];

  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    candidates.push(current);

    if (typeof current.data === "string") {
      try {
        const parsed = JSON.parse(current.data);
        current = parsed;
        continue;
      } catch (_) {}
    }

    if (current.data && typeof current.data === "object") {
      current = current.data;
      continue;
    }

    if (current.result && typeof current.result === "object") {
      current = current.result;
      continue;
    }

    if (current.response && typeof current.response === "object") {
      current = current.response;
      continue;
    }

    break;
  }

  return candidates;
}

export function findGatewayField(data, fieldNames) {
  for (const obj of getNestedGatewayData(data)) {
    for (const field of fieldNames) {
      if (obj?.[field] !== undefined && obj?.[field] !== null && obj?.[field] !== "") {
        return obj[field];
      }
    }
  }
  return null;
}

export function findGatewayStatusCode(data) {
  const candidates = getNestedGatewayData(data);
  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    for (const field of ["status_code", "statusCode"]) {
      const value = candidates[i]?.[field];
      if (value !== undefined && value !== null && value !== "") {
        return String(value).trim();
      }
    }
  }
  return "";
}

/**
 * Normalizes DGePay status:
 * 3 = approved / successful
 * 4 = failed
 * 8 = cancelled
 */
export function normalizeGatewayStatus(data) {
  const statusCode = findGatewayStatusCode(data);
  if (statusCode === "3") return "successful";
  if (statusCode === "4") return "failed";
  if (statusCode === "8") return "cancelled";

  const value = String(
    findGatewayField(data, ["status", "payment_status", "transaction_status", "trx_status"]) ?? ""
  ).toLowerCase().trim();

  if (["success", "successful", "paid", "completed", "complete", "approved", "succeeded"].includes(value)) {
    return "successful";
  }
  if (["failed", "failure", "rejected", "declined", "error"].includes(value)) {
    return "failed";
  }
  if (["cancelled", "canceled", "expired"].includes(value)) {
    return value === "expired" ? "failed" : "cancelled";
  }

  const message = String(findGatewayField(data, ["message", "error_msg", "error"]) ?? "").toLowerCase();
  if (message.includes("transaction success") || message.includes("payment success")) return "successful";
  if (message.includes("transaction failed") || message.includes("payment failed")) return "failed";
  if (message.includes("cancel")) return "cancelled";

  return "pending";
}

export function isGatewayApproved(data) {
  return normalizeGatewayStatus(data) === "successful";
}

export default {
  getConfig,
  authenticateDgePay,
  clearTokenCache,
  sortJsonTopLevel,
  createDgePaySignature,
  encryptDgePayPayload,
  decryptDgePayPayload,
  generateUniqueTxnId,
  initiateDgePayPayment,
  checkDgePayTransaction,
  findGatewayField,
  findGatewayStatusCode,
  normalizeGatewayStatus,
  isGatewayApproved,
};

