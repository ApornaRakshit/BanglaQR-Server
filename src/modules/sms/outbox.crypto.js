import crypto from "crypto";
import { env } from "../../config/env.js";

// Derive 256-bit encryption key from dedicated secret or fallback to OTP_HASH_SECRET
function getEncryptionKey() {
  const secret = process.env.OUTBOX_ENCRYPTION_KEY || env.otpHashSecret || "banglaqr_sms_outbox_secret_key_32";
  return crypto.createHash("sha256").update(String(secret)).digest();
}

/**
 * Encrypt arbitrary payload object using AES-256-GCM.
 * Never leaks plaintext in database.
 */
export function encryptPayload(data) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12); // 96-bit IV recommended for GCM
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  const jsonStr = JSON.stringify(data);
  let encrypted = cipher.update(jsonStr, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag();

  return {
    encryptedPayload: encrypted,
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
  };
}

/**
 * Decrypt AES-256-GCM encrypted payload.
 */
export function decryptPayload(encryptedHex, ivHex, authTagHex) {
  if (!encryptedHex || !ivHex || !authTagHex) return null;
  try {
    const key = getEncryptionKey();
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");

    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedHex, "hex", "utf8");
    decrypted += decipher.final("utf8");

    return JSON.parse(decrypted);
  } catch (err) {
    return null;
  }
}

