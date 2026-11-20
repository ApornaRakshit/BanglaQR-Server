import { db } from "../../../config/db.js";
import { encryptSmtpPassword, decryptSmtpPassword } from "./smtp.crypto.js";

let cachedSmtpConfig = null;
let lastCacheTime = 0;
const CACHE_TTL_MS = 15000; // 15 seconds

export const smtpSettingsRepository = {
  /**
   * Fetch active SMTP settings from MySQL database.
   * If not yet seeded in database, falls back to .env variables and creates the initial row.
   */
  async getSettings() {
    const [rows] = await db.execute(
      `SELECT * FROM smtp_settings ORDER BY id ASC LIMIT 1`
    );

    if (rows.length === 0) {
      // Seed from .env on first access
      const defaultHost = (process.env.SMTP_HOST || "smtp.gmail.com").trim();
      const defaultPort = Number(process.env.SMTP_PORT || 587);
      const isSecure = process.env.SMTP_SECURE === "true" || String(process.env.SMTP_SECURE) === "1" || defaultPort === 465;
      const defaultSecurity = isSecure ? "SSL" : "STARTTLS";
      const defaultUser = (process.env.SMTP_USER || "info@banglaqr.online").trim();
      const defaultPass = (process.env.SMTP_PASS || "").trim();
      const defaultSenderName = "BanglaQR";
      const defaultSenderEmail = defaultUser || "info@banglaqr.online";

      const enc = encryptSmtpPassword(defaultPass);

      await db.execute(
        `INSERT INTO smtp_settings 
          (smtp_host, smtp_port, smtp_security, smtp_username, smtp_password_encrypted, smtp_password_iv, smtp_password_tag, sender_name, sender_email, reply_to_email, is_active, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          defaultHost,
          defaultPort,
          defaultSecurity,
          defaultUser,
          enc?.encrypted || "",
          enc?.iv || "",
          enc?.tag || "",
          defaultSenderName,
          defaultSenderEmail,
          defaultSenderEmail,
          1,
          "System Seed",
        ]
      );

      const [seededRows] = await db.execute(`SELECT * FROM smtp_settings ORDER BY id ASC LIMIT 1`);
      return seededRows[0];
    }

    return rows[0];
  },

  /**
   * Return safe settings for Admin API response (never leak password).
   */
  async getSafeSettings() {
    const row = await this.getSettings();
    if (!row) return null;

    return {
      id: row.id,
      smtpHost: row.smtp_host,
      smtpPort: row.smtp_port,
      smtpSecurity: row.smtp_security,
      smtpUsername: row.smtp_username,
      hasPassword: Boolean(row.smtp_password_encrypted && row.smtp_password_encrypted.length > 0),
      senderName: row.sender_name,
      senderEmail: row.sender_email,
      replyToEmail: row.reply_to_email || "",
      isActive: Boolean(row.is_active),
      updatedBy: row.updated_by,
      updatedAt: row.updated_at,
    };
  },

  /**
   * Return full decrypted configuration for nodemailer sending.
   */
  async getDecryptedConfig(skipCache = false) {
    if (!skipCache && cachedSmtpConfig && Date.now() - lastCacheTime < CACHE_TTL_MS) {
      return cachedSmtpConfig;
    }

    const row = await this.getSettings();
    if (!row) return null;

    const decryptedPassword = decryptSmtpPassword(
      row.smtp_password_encrypted,
      row.smtp_password_iv,
      row.smtp_password_tag
    );

    const config = {
      id: row.id,
      host: row.smtp_host,
      port: Number(row.smtp_port),
      security: row.smtp_security,
      isSecure: row.smtp_security === "SSL" || row.smtp_port === 465,
      requireTls: row.smtp_security === "STARTTLS",
      username: row.smtp_username,
      password: decryptedPassword,
      senderName: row.sender_name || "BanglaQR",
      senderEmail: row.sender_email || row.smtp_username,
      replyToEmail: row.reply_to_email || undefined,
      isActive: Boolean(row.is_active),
      updatedBy: row.updated_by,
      updatedAt: row.updated_at,
    };

    cachedSmtpConfig = config;
    lastCacheTime = Date.now();
    return config;
  },

  /**
   * Save or update SMTP settings.
   * If new password is blank, retain the existing encrypted password.
   */
  async saveSettings(data, adminEmail) {
    const existing = await this.getSettings();

    let passwordEnc = existing?.smtp_password_encrypted || "";
    let passwordIv = existing?.smtp_password_iv || "";
    let passwordTag = existing?.smtp_password_tag || "";

    if (data.smtpPassword && String(data.smtpPassword).trim() !== "") {
      const enc = encryptSmtpPassword(String(data.smtpPassword).trim());
      if (enc) {
        passwordEnc = enc.encrypted;
        passwordIv = enc.iv;
        passwordTag = enc.tag;
      }
    }

    const security = (data.smtpSecurity || "STARTTLS").toUpperCase();
    const isActive = data.isActive !== undefined ? (data.isActive ? 1 : 0) : (data.is_active !== undefined ? (data.is_active ? 1 : 0) : 1);

    if (existing?.id) {
      await db.execute(
        `UPDATE smtp_settings
         SET smtp_host = ?,
             smtp_port = ?,
             smtp_security = ?,
             smtp_username = ?,
             smtp_password_encrypted = ?,
             smtp_password_iv = ?,
             smtp_password_tag = ?,
             sender_name = ?,
             sender_email = ?,
             reply_to_email = ?,
             is_active = ?,
             updated_by = ?,
             updated_at = NOW()
         WHERE id = ?`,
        [
          data.smtpHost || existing.smtp_host,
          Number(data.smtpPort || existing.smtp_port),
          security,
          data.smtpUsername || existing.smtp_username,
          passwordEnc,
          passwordIv,
          passwordTag,
          data.senderName || existing.sender_name || "BanglaQR",
          data.senderEmail || existing.sender_email,
          data.replyToEmail !== undefined ? data.replyToEmail : existing.reply_to_email,
          isActive,
          adminEmail,
          existing.id,
        ]
      );
    } else {
      await db.execute(
        `INSERT INTO smtp_settings
          (smtp_host, smtp_port, smtp_security, smtp_username, smtp_password_encrypted, smtp_password_iv, smtp_password_tag, sender_name, sender_email, reply_to_email, is_active, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          data.smtpHost,
          Number(data.smtpPort || 587),
          security,
          data.smtpUsername,
          passwordEnc,
          passwordIv,
          passwordTag,
          data.senderName || "BanglaQR",
          data.senderEmail,
          data.replyToEmail || null,
          isActive,
          adminEmail,
        ]
      );
    }

    cachedSmtpConfig = null; // Clear cache
    return this.getSafeSettings();
  },

  clearCache() {
    cachedSmtpConfig = null;
  },
};
