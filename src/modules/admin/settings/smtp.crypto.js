import crypto from "crypto";
import { env } from "../../../config/env.js";

function getSmtpEncryptionKey() {
  const secret = process.env.SMTP_ENCRYPTION_KEY || env.otpHashSecret || env.jwt?.accessSecret || "banglaqr_smtp_encryption_secure_key_32";
  return crypto.createHash("sha256").update(String(secret)).digest();
}

/**
 * Encrypt plaintext SMTP password using AES-256-GCM.
 */
export function encryptSmtpPassword(password) {
  if (!password) return null;
  const key = getSmtpEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  let encrypted = cipher.update(String(password), "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag();

  return {
    encrypted,
    iv: iv.toString("hex"),
    tag: authTag.toString("hex"),
  };
}

/**
 * Decrypt AES-256-GCM encrypted SMTP password.
 */
export function decryptSmtpPassword(encryptedHex, ivHex, tagHex) {
  if (!encryptedHex || !ivHex || !tagHex) return "";
  try {
    const key = getSmtpEncryptionKey();
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(tagHex, "hex");

    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedHex, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (err) {
    console.error("Failed to decrypt SMTP password:", err.message);
    return "";
  }
}
