import nodemailer from "nodemailer";
import { smtpSettingsRepository } from "./smtp.repository.js";
import { logAdminAudit } from "../../../utils/auditLogger.js";

/**
 * Creates a standalone nodemailer transporter from any provided or saved config.
 */
function createTransporterFromConfig(config) {
  const isSecure = config.isSecure || config.security === "SSL" || config.port === 465;
  const isStarttls = config.security === "STARTTLS";

  return nodemailer.createTransport({
    host: config.host,
    port: Number(config.port),
    secure: isSecure,
    auth: {
      user: config.username,
      pass: config.password,
    },
    tls: {
      rejectUnauthorized: false,
      ciphers: "SSLv3",
    },
    requireTLS: isStarttls,
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
  });
}

export const smtpSettingsService = {
  /**
   * Get safe settings for Admin UI.
   */
  async getSettings() {
    return smtpSettingsRepository.getSafeSettings();
  },

  /**
   * Save or update SMTP settings.
   */
  async updateSettings(data, adminUser, reqMeta = {}) {
    const updated = await smtpSettingsRepository.saveSettings(data, adminUser.email);

    await logAdminAudit({
      userId: adminUser.id,
      adminEmail: adminUser.email,
      action: "smtp_settings_update",
      resourceType: "settings",
      resourceId: "smtp",
      details: {
        host: updated.smtpHost,
        port: updated.smtpPort,
        security: updated.smtpSecurity,
        senderEmail: updated.senderEmail,
        isActive: updated.isActive,
      },
      ip: reqMeta.ip,
      userAgent: reqMeta.userAgent,
    });

    return updated;
  },

  /**
   * Verify SMTP connection using verify() method.
   */
  async verifyConnection(customConfig = null) {
    let config = null;

    if (customConfig && customConfig.smtpHost) {
      // If client sent testing parameters on the fly
      let password = customConfig.smtpPassword;
      if (!password) {
        // Use currently saved password if blank
        const saved = await smtpSettingsRepository.getDecryptedConfig(true);
        password = saved?.password || "";
      }
      config = {
        host: customConfig.smtpHost,
        port: Number(customConfig.smtpPort || 587),
        security: (customConfig.smtpSecurity || "STARTTLS").toUpperCase(),
        username: customConfig.smtpUsername,
        password,
      };
    } else {
      config = await smtpSettingsRepository.getDecryptedConfig(true);
    }

    if (!config || !config.host || !config.username || !config.password) {
      const err = new Error("Incomplete SMTP configuration. Host, username, and password are required.");
      err.statusCode = 400;
      throw err;
    }

    const transporter = createTransporterFromConfig(config);

    try {
      await transporter.verify();
      return {
        success: true,
        message: `SMTP connection established successfully to ${config.host}:${config.port}`,
      };
    } catch (err) {
      console.error("[SMTP Verify Connection Error]:", err.message);
      const error = new Error(`SMTP Connection Failed: ${err.message}`);
      error.statusCode = 400;
      throw error;
    }
  },

  /**
   * Send test email to verify end-to-end delivery.
   */
  async sendTestEmail({ recipientEmail, customConfig = null, adminUser, reqMeta = {} }) {
    if (!recipientEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail.trim())) {
      const err = new Error("Please provide a valid recipient email address for testing.");
      err.statusCode = 400;
      throw err;
    }

    let config = null;
    if (customConfig && customConfig.smtpHost) {
      let password = customConfig.smtpPassword;
      if (!password) {
        const saved = await smtpSettingsRepository.getDecryptedConfig(true);
        password = saved?.password || "";
      }
      config = {
        host: customConfig.smtpHost,
        port: Number(customConfig.smtpPort || 587),
        security: (customConfig.smtpSecurity || "STARTTLS").toUpperCase(),
        username: customConfig.smtpUsername,
        password,
        senderName: customConfig.senderName || "BanglaQR",
        senderEmail: customConfig.senderEmail || customConfig.smtpUsername,
        replyToEmail: customConfig.replyToEmail,
      };
    } else {
      config = await smtpSettingsRepository.getDecryptedConfig(true);
    }

    if (!config || !config.host || !config.username || !config.password) {
      const err = new Error("SMTP configuration is incomplete. Please verify host, username, and password.");
      err.statusCode = 400;
      throw err;
    }

    const transporter = createTransporterFromConfig(config);
    const from = `"${config.senderName || 'BanglaQR'}" <${config.senderEmail || config.username}>`;
    const targetEmail = recipientEmail.trim();

    const subject = `BanglaQR SMTP Test Email - ${new Date().toLocaleTimeString("en-GB")}`;
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f1f5f9; margin: 0; padding: 24px; color: #0f172a; }
    .box { max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #cbd5e1; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
    .header { background: #00875a; padding: 24px; text-align: center; color: #ffffff; }
    .header h2 { margin: 0; font-size: 22px; font-weight: 800; }
    .body { padding: 28px; line-height: 1.6; }
    .status { background: #ecfdf5; border: 1px solid #10b981; border-radius: 8px; padding: 14px 18px; margin: 18px 0; color: #065f46; font-size: 14px; font-weight: 600; }
    .meta { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 18px 0; font-size: 13px; font-family: monospace; }
    .footer { text-align: center; padding: 16px; font-size: 12px; color: #64748b; background: #f8fafc; border-top: 1px solid #f1f5f9; }
  </style>
</head>
<body>
  <div class="box">
    <div class="header">
      <h2>BanglaQR Platform</h2>
      <p style="margin: 4px 0 0; font-size: 13px; opacity: 0.9;">SMTP Test Notification</p>
    </div>
    <div class="body">
      <div class="status">
        ✓ SMTP Configuration Verified Successfully!
      </div>
      <p style="font-size: 14px; color: #334155;">
        This test email was initiated from the <strong>BanglaQR Admin Panel</strong> to verify your outgoing mail server settings.
      </p>
      <div class="meta">
        <strong>Host:</strong> ${config.host}:${config.port}<br>
        <strong>Security:</strong> ${config.security || "STARTTLS"}<br>
        <strong>Sender:</strong> ${from}<br>
        <strong>Recipient:</strong> ${targetEmail}<br>
        <strong>Timestamp:</strong> ${new Date().toISOString()}
      </div>
      <p style="font-size: 13px; color: #64748b; margin-top: 20px;">
        All automated notifications (Merchant applications, approvals, password credentials, and system alerts) will be delivered using these SMTP credentials.
      </p>
    </div>
    <div class="footer">
      &copy; ${new Date().getFullYear()} BanglaQR Platform. All rights reserved.
    </div>
  </div>
</body>
</html>
    `;

    const text = `BanglaQR SMTP Test Email\n\nYour SMTP server (${config.host}:${config.port}) successfully delivered this test message to ${targetEmail} on ${new Date().toISOString()}.`;

    try {
      const info = await transporter.sendMail({
        from,
        to: targetEmail,
        replyTo: config.replyToEmail || undefined,
        subject,
        text,
        html,
      });

      if (adminUser) {
        await logAdminAudit({
          userId: adminUser.id,
          adminEmail: adminUser.email,
          action: "smtp_test_email_sent",
          resourceType: "settings",
          resourceId: "smtp",
          details: { recipient: targetEmail, messageId: info.messageId },
          ip: reqMeta.ip,
          userAgent: reqMeta.userAgent,
        });
      }

      return {
        success: true,
        message: `Test email successfully sent to ${targetEmail}! Message ID: ${info.messageId}`,
        messageId: info.messageId,
      };
    } catch (err) {
      console.error("[SMTP Test Email Send Error]:", err);
      const error = new Error(`Failed to send test email: ${err.message}`);
      error.statusCode = 400;
      throw error;
    }
  },
};
