import nodemailer from "nodemailer";
import { env } from "../config/env.js";
import { smtpSettingsRepository } from "../modules/admin/settings/smtp.repository.js";

let transporter = null;
let cachedConfigKey = null;

async function getTransporter() {
  // First check database-persisted dynamic configuration from Admin Settings
  let config = null;
  try {
    const dbConfig = await smtpSettingsRepository.getDecryptedConfig();
    if (dbConfig && dbConfig.isActive && dbConfig.host && dbConfig.username && dbConfig.password) {
      config = dbConfig;
    }
  } catch (err) {
    console.warn("[EmailService] Failed to read database SMTP config, checking .env:", err.message);
  }

  // Fallback to .env if database config is not set or inactive
  if (!config) {
    const host = (process.env.SMTP_HOST || '').trim();
    const port = Number(process.env.SMTP_PORT || 587);
    const isSecure = process.env.SMTP_SECURE === 'true' || String(process.env.SMTP_SECURE) === '1' || port === 465;
    const user = (process.env.SMTP_USER || '').trim();
    const pass = (process.env.SMTP_PASS || '').trim();

    if (!host || !user || !pass) {
      return null;
    }

    config = {
      host,
      port,
      isSecure,
      security: isSecure ? "SSL" : "STARTTLS",
      username: user,
      password: pass,
      senderName: "BanglaQR Security",
      senderEmail: user,
      replyToEmail: undefined,
    };
  }

  const configKey = [
    config.host,
    config.port,
    config.isSecure,
    config.security,
    config.username,
    config.password,
    config.senderEmail,
  ].join(':');

  if (transporter && cachedConfigKey === configKey) {
    return { transporter, config };
  }

  cachedConfigKey = configKey;
  transporter = nodemailer.createTransport({
    host: config.host,
    port: Number(config.port),
    secure: config.isSecure || config.security === "SSL" || config.port === 465,
    auth: {
      user: config.username,
      pass: config.password,
    },
    tls: {
      rejectUnauthorized: false,
      ciphers: "SSLv3",
    },
    requireTLS: config.security === "STARTTLS",
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
  });

  return { transporter, config };
}

export const emailService = {
  async isConfigured() {
    try {
      const dbConfig = await smtpSettingsRepository.getDecryptedConfig();
      if (dbConfig && dbConfig.isActive && dbConfig.host && dbConfig.username && dbConfig.password) {
        return true;
      }
    } catch (_) {}

    return Boolean(
      process.env.SMTP_HOST &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASS
    );
  },

  /**
   * Generic unified email sender using dynamic admin-configured SMTP.
   */
  async sendMail({ to, subject, html, text, replyTo = null }) {
    const isEmailConfigured = await this.isConfigured();
    if (!isEmailConfigured) {
      if (env.nodeEnv === "development") {
        console.warn(`[EmailService:DEV] SMTP disabled or not configured. Email to ${to} subject: "${subject}" simulated.`);
        return { success: true, devSimulated: true, message: "Simulated in development" };
      }
      const error = new Error("Email service is currently disabled or unconfigured in Admin Settings.");
      error.statusCode = 503;
      throw error;
    }

    const client = await getTransporter();
    if (!client || !client.transporter) {
      const error = new Error("SMTP transporter unavailable. Please check Admin Settings > Email/SMTP.");
      error.statusCode = 503;
      throw error;
    }

    const { transporter: mailer, config } = client;
    const from = `"${config.senderName || 'BanglaQR'}" <${config.senderEmail || config.username}>`;

    const info = await mailer.sendMail({
      from,
      to,
      replyTo: replyTo || config.replyToEmail || undefined,
      subject,
      html,
      text: text || html?.replace(/<[^>]+>/g, " ").trim(),
    });

    return {
      success: true,
      delivered: true,
      messageId: info.messageId,
    };
  },

  async sendOtpEmail({ to, otp, purpose = "email_verification", expiresMinutes = 5 }) {
    const isEmailConfigured = await this.isConfigured();

    if (!isEmailConfigured) {
      if (env.nodeEnv === "development") {
        console.warn(
          `[EmailService:DEV] SMTP is not configured or active. OTP for ${to} is: ${otp}`
        );
        return {
          success: true,
          devSimulated: true,
          message: "SMTP not configured - simulated in development",
        };
      }

      const error = new Error(
        "Email verification service is currently unconfigured or disabled. Please contact support."
      );
      error.statusCode = 503;
      throw error;
    }

    const client = await getTransporter();
    const mailer = client?.transporter;
    const config = client?.config;
    const fromAddress = config?.senderEmail
      ? `"${config.senderName || 'BanglaQR Security'}" <${config.senderEmail}>`
      : (process.env.SMTP_FROM || `"BanglaQR Security" <noreply@banglaqr.com>`);

    const isRegistration = purpose === "email_verification";
    const subject = isRegistration
      ? `${otp} is your BanglaQR Verification Code`
      : `${otp} is your BanglaQR Security Code`;

    const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>BanglaQR Verification Code</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 0; color: #0f172a; }
    .container { max-width: 540px; margin: 30px auto; background: #ffffff; border-radius: 20px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05); }
    .header { background: linear-gradient(135deg, #008744 0%, #005a2d 100%); padding: 32px 24px; text-align: center; color: #ffffff; }
    .header h1 { margin: 0; font-size: 26px; font-weight: 900; letter-spacing: -0.5px; }
    .header p { margin: 6px 0 0; font-size: 13px; color: #d1fae5; font-weight: 500; }
    .content { padding: 36px 32px; text-align: center; }
    .title { font-size: 20px; font-weight: 800; color: #0f172a; margin: 0 0 10px; }
    .subtitle { font-size: 14px; color: #64748b; line-height: 1.6; margin: 0 0 28px; }
    .otp-box { background: #f0fdf4; border: 2px dashed #00a86b; border-radius: 16px; padding: 20px 24px; margin: 0 auto 28px; display: inline-block; }
    .otp-code { font-size: 38px; font-weight: 900; letter-spacing: 8px; color: #008744; font-family: monospace; }
    .expiry { font-size: 13px; color: #e11d48; font-weight: 700; margin: 0 0 20px; }
    .warning { background: #fffbeb; border: 1px solid #fef3c7; border-radius: 12px; padding: 14px 18px; text-align: left; font-size: 12px; color: #92400e; line-height: 1.5; margin-bottom: 24px; }
    .warning strong { color: #78350f; }
    .footer { background: #f8fafc; border-top: 1px solid #f1f5f9; padding: 20px 24px; text-align: center; font-size: 12px; color: #94a3b8; line-height: 1.5; }
    .footer a { color: #008744; text-decoration: none; font-weight: 600; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>BanglaQR</h1>
      <p>Digital Payment Service Management Platform</p>
    </div>
    <div class="content">
      <h2 class="title">Verify Your Account</h2>
      <p class="subtitle">
        Please use the following 6-digit One-Time Password (OTP) to complete your verification on the BanglaQR platform.
      </p>
      <div class="otp-box">
        <div class="otp-code">${otp}</div>
      </div>
      <p class="expiry">⏱ Valid for ${expiresMinutes} minutes only</p>
      <div class="warning">
        <strong>Security Notice:</strong> Never share this code with anyone, including BanglaQR representatives. BanglaQR staff will never ask for your verification code.
      </div>
    </div>
    <div class="footer">
      <p>&copy; ${new Date().getFullYear()} BanglaQR. All rights reserved.</p>
      <p>Need help? Contact our support at <a href="mailto:support@banglaqr.com.bd">support@banglaqr.com.bd</a></p>
    </div>
  </div>
</body>
</html>
    `;

    const textContent = `
BanglaQR Account Verification

Your 6-digit verification code is: ${otp}

This code is valid for ${expiresMinutes} minutes.

Security Notice: Never share this OTP with anyone. BanglaQR staff will never ask for your code.

© ${new Date().getFullYear()} BanglaQR Digital Payment Services.
    `.trim();

    try {
      const info = await mailer.sendMail({
        from: fromAddress,
        to,
        subject,
        text: textContent,
        html: htmlContent,
      });

      return {
        success: true,
        messageId: info.messageId,
      };
    } catch (err) {
      console.error("[EmailService Error]", err.message);

      if (env.nodeEnv === "development") {
        console.log(`\n==================================================`);
        console.log(`[DEV OTP EMAIL FALLBACK] To: ${to}`);
        console.log(`Code: ${otp}`);
        console.log(`(Expires in ${expiresMinutes} minutes)`);
        console.log(`==================================================\n`);
        return {
          success: true,
          devSimulated: true,
          error: err.message,
        };
      }

      const error = new Error(
        "Failed to deliver verification email. Please check your email address or try again."
      );
      error.statusCode = 502;
      throw error;
    }
  },

  async sendPasswordResetEmail({ to, resetUrl, expiresMinutes = 15 }) {
    const isEmailConfigured = await this.isConfigured();

    if (!isEmailConfigured) {
      if (env.nodeEnv === "development") {
        console.log(`\n==================================================`);
        console.log(`[DEV PASSWORD RESET URL] For: ${to}`);
        console.log(`Link: ${resetUrl}`);
        console.log(`(Expires in ${expiresMinutes} minutes)`);
        console.log(`==================================================\n`);
        return {
          success: true,
          devSimulated: true,
          message: "SMTP not configured - link logged in development terminal",
        };
      }

      const error = new Error(
        "Email delivery service is not configured or disabled on the server. Please contact support."
      );
      error.statusCode = 503;
      throw error;
    }

    const client = await getTransporter();
    const mailer = client?.transporter;
    const config = client?.config;
    const fromAddress = config?.senderEmail
      ? `"${config.senderName || 'BanglaQR Security'}" <${config.senderEmail}>`
      : (process.env.SMTP_FROM || `"BanglaQR Security" <noreply@banglaqr.com>`);
    const subject = "Reset Your BanglaQR Account Password";

    const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your BanglaQR Password</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 0; color: #0f172a; }
    .container { max-width: 540px; margin: 30px auto; background: #ffffff; border-radius: 20px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05); }
    .header { background: linear-gradient(135deg, #008744 0%, #005a2d 100%); padding: 32px 24px; text-align: center; color: #ffffff; }
    .header h1 { margin: 0; font-size: 26px; font-weight: 900; letter-spacing: -0.5px; }
    .header p { margin: 6px 0 0; font-size: 13px; color: #d1fae5; font-weight: 500; }
    .content { padding: 36px 32px; text-align: center; }
    .title { font-size: 20px; font-weight: 800; color: #0f172a; margin: 0 0 10px; }
    .subtitle { font-size: 14px; color: #64748b; line-height: 1.6; margin: 0 0 28px; }
    .btn-container { margin: 0 auto 28px; }
    .btn { display: inline-block; background-color: #008744; color: #ffffff !important; font-weight: 800; font-size: 15px; padding: 14px 32px; text-decoration: none; border-radius: 12px; box-shadow: 0 4px 12px rgba(0, 135, 68, 0.25); }
    .btn:hover { background-color: #007038; }
    .link-fallback { background: #f1f5f9; padding: 12px 16px; border-radius: 10px; font-size: 12px; word-break: break-all; color: #475569; margin-bottom: 24px; text-align: left; }
    .expiry { font-size: 13px; color: #e11d48; font-weight: 700; margin: 0 0 20px; }
    .warning { background: #fffbeb; border: 1px solid #fef3c7; border-radius: 12px; padding: 14px 18px; text-align: left; font-size: 12px; color: #92400e; line-height: 1.5; margin-bottom: 24px; }
    .warning strong { color: #78350f; }
    .footer { background: #f8fafc; border-top: 1px solid #f1f5f9; padding: 20px 24px; text-align: center; font-size: 12px; color: #94a3b8; line-height: 1.5; }
    .footer a { color: #008744; text-decoration: none; font-weight: 600; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>BanglaQR</h1>
      <p>Digital Payment Service Management Platform</p>
    </div>
    <div class="content">
      <h2 class="title">Reset Your Password</h2>
      <p class="subtitle">
        We received a request to reset the password for your BanglaQR account. Click the button below to proceed with setting a new password.
      </p>
      <div class="btn-container">
        <a href="${resetUrl}" target="_blank" class="btn">Reset Password</a>
      </div>
      <p class="expiry">⏱ Link expires in ${expiresMinutes} minutes</p>
      <div class="link-fallback">
        If the button does not work, copy and paste this link into your browser:<br/>
        <a href="${resetUrl}" style="color: #008744;">${resetUrl}</a>
      </div>
      <div class="warning">
        <strong>Security Alert:</strong> If you did not request a password reset, please ignore this email. Your password will remain unchanged and your account is secure.
      </div>
    </div>
    <div class="footer">
      <p>&copy; ${new Date().getFullYear()} BanglaQR. All rights reserved.</p>
      <p>Need help? Contact our support at <a href="mailto:support@banglaqr.com.bd">support@banglaqr.com.bd</a></p>
    </div>
  </div>
</body>
</html>
    `;

    const textContent = `
BanglaQR Password Reset Request

We received a request to reset your password. Use the link below to set a new password:

${resetUrl}

This link is valid for ${expiresMinutes} minutes.

Security Notice: If you did not request this, please ignore this email.

© ${new Date().getFullYear()} BanglaQR Digital Payment Services.
    `.trim();

    try {
      const info = await mailer.sendMail({
        from: fromAddress,
        to,
        subject,
        text: textContent,
        html: htmlContent,
      });

      return {
        success: true,
        messageId: info.messageId,
      };
    } catch (err) {
      console.error("[EmailService Error]", err.message);

      if (env.nodeEnv === "development") {
        console.log(`\n==================================================`);
        console.log(`[DEV PASSWORD RESET FALLBACK URL] For: ${to}`);
        console.log(`Link: ${resetUrl}`);
        console.log(`(Expires in ${expiresMinutes} minutes)`);
        console.log(`==================================================\n`);
        return {
          success: true,
          devSimulated: true,
          error: err.message,
        };
      }

      const error = new Error(
        "Failed to deliver password reset email. Please try again later."
      );
      error.statusCode = 502;
      throw error;
    }
  },

  async sendInstitutionInvitationEmail({
    to,
    name,
    institutionName,
    roleName,
    invitationUrl,
    expiresDays = 7,
  }) {
    const isEmailConfigured = await this.isConfigured();

    if (!isEmailConfigured) {
      if (env.nodeEnv === "development") {
        console.log(`\n==================================================`);
        console.log(`[EmailService:DEV] SMTP is not configured or disabled.`);
        console.log(`Invitation for: ${to} (${name || "Bank Administrator"})`);
        console.log(`Institution: ${institutionName} | Role: ${roleName}`);
        console.log(`Activation Link: ${invitationUrl}`);
        console.log(`==================================================\n`);
        return {
          success: false,
          delivered: false,
          devSimulated: true,
          message: "SMTP not configured - activation link generated for development",
        };
      }

      return {
        success: false,
        delivered: false,
        message: "Email service unconfigured. Unable to send invitation email.",
      };
    }

    const client = await getTransporter();
    const mailer = client?.transporter;
    const config = client?.config;
    const fromAddress = config?.senderEmail
      ? `"${config.senderName || 'BanglaQR Platform Security'}" <${config.senderEmail}>`
      : (process.env.SMTP_FROM || `"BanglaQR Platform Security" <noreply@banglaqr.com>`);

    const roleLabel =
      roleName === "bank_admin"
        ? "Bank Administrator (Full Control)"
        : roleName === "bank_reviewer"
        ? "Bank KYC Reviewer"
        : "Bank Operations Officer";

    const subject = `You are invited to join ${institutionName} on BanglaQR`;

    const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Invitation to ${institutionName}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 0; color: #0f172a; }
    .container { max-width: 560px; margin: 30px auto; background: #ffffff; border-radius: 20px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05); }
    .header { background: linear-gradient(135deg, #008744 0%, #005a2d 100%); padding: 32px 24px; text-align: center; color: #ffffff; }
    .header h1 { margin: 0; font-size: 24px; font-weight: 900; letter-spacing: -0.5px; }
    .header p { margin: 6px 0 0; font-size: 13px; color: #d1fae5; font-weight: 500; }
    .content { padding: 36px 32px; text-align: left; }
    .title { font-size: 18px; font-weight: 800; color: #0f172a; margin: 0 0 12px; }
    .subtitle { font-size: 14px; color: #475569; line-height: 1.6; margin: 0 0 24px; }
    .role-badge { display: inline-block; background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 8px; padding: 6px 12px; color: #065f46; font-size: 12px; font-weight: 700; margin-bottom: 24px; }
    .btn-container { text-align: center; margin: 28px 0; }
    .btn { display: inline-block; background-color: #008744; color: #ffffff !important; font-weight: 800; font-size: 15px; padding: 14px 32px; text-decoration: none; border-radius: 12px; box-shadow: 0 4px 12px rgba(0, 135, 68, 0.25); }
    .btn:hover { background-color: #007038; }
    .link-fallback { background: #f1f5f9; padding: 12px 16px; border-radius: 10px; font-size: 11px; word-break: break-all; color: #475569; margin: 24px 0; }
    .expiry { font-size: 12px; color: #e11d48; font-weight: 700; text-align: center; margin-bottom: 20px; }
    .notice { background: #f8fafc; border-left: 3px solid #008744; padding: 12px 16px; border-radius: 4px; font-size: 12px; color: #475569; line-height: 1.5; }
    .footer { background: #f8fafc; border-top: 1px solid #f1f5f9; padding: 20px 24px; text-align: center; font-size: 12px; color: #94a3b8; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>BanglaQR Institution Portal</h1>
      <p>Secure Banking & Merchant Operation Service</p>
    </div>
    <div class="content">
      <h2 class="title">Hello ${name ? name : "Administrator"},</h2>
      <p class="subtitle">
        You have been invited by the BanglaQR Platform Administrator to join <strong>${institutionName}</strong> as an authorized staff member.
      </p>
      <div>
        <span class="role-badge">Assigned Role: ${roleLabel}</span>
      </div>
      <p class="subtitle">
        Please click the button below to set up your password and activate your account access to the Institution Portal.
      </p>
      <div class="btn-container">
        <a href="${invitationUrl}" target="_blank" class="btn">Set Password & Activate Account</a>
      </div>
      <p class="expiry">⏱ Link expires in ${expiresDays} days (Single-use)</p>
      <div class="link-fallback">
        If the button does not work, copy and paste this secure link into your browser:<br/>
        <a href="${invitationUrl}" style="color: #008744;">${invitationUrl}</a>
      </div>
      <div class="notice">
        <strong>Security Tip:</strong> Never share this invitation link with anyone. Once you set your password, this link will automatically expire.
      </div>
    </div>
    <div class="footer">
      <p>&copy; ${new Date().getFullYear()} BanglaQR Digital Payment Platform. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
    `;

    const textContent = `
Hello ${name ? name : "Administrator"},

You have been invited by the BanglaQR Platform Administrator to join ${institutionName} as ${roleLabel}.

Set up your secure password and activate your staff access here:
${invitationUrl}

This link is valid for ${expiresDays} days and can only be used once.

© ${new Date().getFullYear()} BanglaQR Digital Payment Platform.
    `.trim();

    try {
      const info = await mailer.sendMail({
        from: fromAddress,
        to,
        subject,
        text: textContent,
        html: htmlContent,
      });

      return {
        success: true,
        delivered: true,
        messageId: info.messageId,
      };
    } catch (err) {
      console.error("[EmailService Error: Invitation]", err.message);
      return {
        success: false,
        delivered: false,
        error: err.message,
        message: "Failed to deliver email through SMTP server.",
      };
    }
  },

  async sendMerchantCredentialsEmail({ to, merchantName, email, password, loginUrl }) {
    const client = await getTransporter();
    const mailer = client?.transporter;
    const config = client?.config;
    const fromAddress = config?.senderEmail
      ? `"${config.senderName || 'BanglaQR Security'}" <${config.senderEmail}>`
      : (process.env.SMTP_FROM || `"BanglaQR Security" <noreply@banglaqr.com>`);
    const subject = "Your BanglaQR Merchant Portal Login Credentials";
    const siteUrl = loginUrl || "https://banglaqr.com.bd/login";

    const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your BanglaQR Login Credentials</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 0; color: #0f172a; }
    .container { max-width: 540px; margin: 25px auto; background: #ffffff; border-radius: 18px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05); }
    .header { background: linear-gradient(135deg, #008744 0%, #005a2d 100%); padding: 28px 24px; text-align: center; color: #ffffff; }
    .header h1 { margin: 0; font-size: 24px; font-weight: 900; letter-spacing: -0.5px; }
    .header p { margin: 4px 0 0; font-size: 13px; color: #d1fae5; font-weight: 500; }
    .content { padding: 32px 28px; }
    .title { font-size: 18px; font-weight: 800; color: #0f172a; margin: 0 0 10px; }
    .subtitle { font-size: 14px; color: #475569; line-height: 1.6; margin: 0 0 20px; }
    .cred-card { background: #f0fdf4; border: 1.5px solid #86efac; border-radius: 12px; padding: 18px 20px; margin-bottom: 22px; }
    .cred-item { margin-bottom: 12px; }
    .cred-item:last-child { margin-bottom: 0; }
    .cred-label { font-size: 11px; font-weight: 700; color: #166534; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 2px; }
    .cred-val { font-size: 15px; font-weight: 800; color: #0f172a; font-family: monospace; }
    .btn-wrap { text-align: center; margin: 24px 0; }
    .btn { display: inline-block; background-color: #008744; color: #ffffff !important; font-weight: 800; font-size: 14px; padding: 12px 30px; text-decoration: none; border-radius: 10px; }
    .warning { background: #fffbeb; border: 1px solid #fef3c7; border-radius: 10px; padding: 12px 16px; font-size: 12px; color: #92400e; line-height: 1.5; }
    .footer { background: #f8fafc; border-top: 1px solid #f1f5f9; padding: 18px 24px; text-align: center; font-size: 12px; color: #94a3b8; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>BanglaQR</h1>
      <p>Merchant Digital Payment Platform</p>
    </div>
    <div class="content">
      <h2 class="title">Hello ${merchantName || "Merchant"},</h2>
      <p class="subtitle">
        Your merchant account password has been reset by the platform administrator. You can now access your Merchant Portal with the new credentials below:
      </p>
      <div class="cred-card">
        <div class="cred-item">
          <span class="cred-label">Login Email:</span>
          <span class="cred-val">${email}</span>
        </div>
        <div class="cred-item">
          <span class="cred-label">New Password:</span>
          <span class="cred-val" style="color: #008744;">${password}</span>
        </div>
      </div>
      <div class="btn-wrap">
        <a href="${siteUrl}" target="_blank" class="btn">Sign In to Merchant Portal</a>
      </div>
      <div class="warning">
        <strong>Security Tip:</strong> For your security, please update this temporary password upon signing in by going to <strong>Settings &gt; Change Password</strong>.
      </div>
    </div>
    <div class="footer">
      <p>&copy; ${new Date().getFullYear()} BanglaQR. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
    `;

    const textContent = `
Hello ${merchantName || "Merchant"},

Your BanglaQR Merchant Portal password has been reset by the platform administrator.

Updated Credentials:
Email: ${email}
New Password: ${password}
Login URL: ${siteUrl}

Security Notice: Please update your password immediately after logging in.

© ${new Date().getFullYear()} BanglaQR.
    `.trim();

    if (!mailer) {
      console.log(`[DEV CREDENTIALS EMAIL] To: ${to} | Password: ${password}`);
      return { success: true, devSimulated: true };
    }

    try {
      const info = await mailer.sendMail({
        from: fromAddress,
        to,
        subject,
        text: textContent,
        html: htmlContent,
      });
      return { success: true, delivered: true, messageId: info.messageId };
    } catch (err) {
      console.error("[EmailService Error: Reset Password Delivery]", err.message);
      return { success: false, delivered: false, error: err.message };
    }
  },

  /**
   * Send notification to merchant when onboarding application is successfully submitted
   */
  async sendMerchantApplicationSubmittedEmail({ to, merchantName, companyName, merchantCode, submittedDate }) {
    const client = await getTransporter();
    const mailer = client?.transporter;
    const config = client?.config;
    const fromAddress = config?.senderEmail
      ? `"${config.senderName || 'BanglaQR'}" <${config.senderEmail}>`
      : (process.env.SMTP_FROM || `"BanglaQR" <noreply@banglaqr.com>`);

    const dateFormatted = submittedDate || new Date().toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });

    const subject = `Your Merchant Onboarding Application was Submitted - BanglaQR (${merchantCode || "Submitted"})`;

    const htmlContent = `
<!DOCTYPE html>
<html lang="bn">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Application Submitted</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 0; color: #0f172a; }
    .container { max-width: 580px; margin: 30px auto; background: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05); }
    .header { background: linear-gradient(135deg, #059669 0%, #047857 100%); padding: 32px 24px; text-align: center; color: #ffffff; }
    .header h1 { margin: 0; font-size: 22px; font-weight: 800; letter-spacing: -0.5px; }
    .header p { margin: 6px 0 0; font-size: 13px; color: #a7f3d0; }
    .content { padding: 32px 28px; line-height: 1.6; }
    .status-badge { display: inline-block; padding: 6px 14px; background: #ecfdf5; border: 1px solid #a7f3d0; color: #047857; font-size: 12px; font-weight: 700; border-radius: 9999px; margin-bottom: 20px; }
    .lead { font-size: 15px; color: #334155; margin-bottom: 20px; }
    .info-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin-bottom: 24px; }
    .info-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px dashed #e2e8f0; font-size: 13px; }
    .info-row:last-child { border-bottom: none; }
    .info-label { color: #64748b; font-weight: 600; }
    .info-val { color: #0f172a; font-weight: 700; }
    .notice-box { background: #eff6ff; border-left: 4px solid #3b82f6; padding: 16px; border-radius: 6px; margin-bottom: 24px; }
    .notice-box p { margin: 0; font-size: 13px; color: #1e40af; line-height: 1.5; }
    .footer { background: #f1f5f9; padding: 20px; text-align: center; font-size: 12px; color: #64748b; border-top: 1px solid #e2e8f0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>BanglaQR Merchant Portal</h1>
      <p>Digital Payment Service Management</p>
    </div>
    <div class="content">
      <span class="status-badge">Application Under Review</span>
      <p class="lead">
        Hello <strong>${merchantName || companyName || "Merchant"}</strong>,
      </p>
      <p style="font-size: 14px; color: #334155;">
        Your merchant onboarding application was submitted on <strong>${dateFormatted}</strong> successfully.
      </p>

      <div class="info-card">
        <div class="info-row">
          <span class="info-label">Company / Business Name:</span>
          <span class="info-val">${companyName || "N/A"}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Merchant Code:</span>
          <span class="info-val" style="font-family: monospace; color: #047857;">${merchantCode || "Pending"}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Submission Date:</span>
          <span class="info-val">${dateFormatted}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Current Status:</span>
          <span class="info-val" style="color: #059669;">Under Review (পর্যালোচনায় রয়েছে)</span>
        </div>
      </div>

      <div class="notice-box">
        <p>
          <strong>পরবর্তী নির্দেশনা:</strong><br>
          আমাদের কমপ্লায়েন্স টিম এবং আপনার সংশ্লিষ্ট ব্যাংক/MFS পার্টনার আপনার দাখিলকৃত সকল তথ্য ও ডকুমেন্টস যাচাই-বাছাই করছেন। যাচাই প্রক্রিয়া সম্পন্ন হওয়ার সাথে সাথে পরবর্তী নির্দেশনা ও অ্যাকাউন্টের অ্যাক্টিভেশন আপডেট আপনাকে ইমেইল ও এসএমএস এর মাধ্যমে জানিয়ে দেওয়া হবে।
        </p>
      </div>

      <p style="font-size: 13px; color: #64748b;">
        যেকোনো তথ্যের জন্য আমাদের সাপোর্ট সেন্টারে যোগাযোগ করতে পারেন অথবা মার্চেন্ট পোর্টাল থেকে সরাসরি আপনার আবেদনের লাইভ স্ট্যাটাস দেখতে পারেন।
      </p>
    </div>
    <div class="footer">
      <p>&copy; ${new Date().getFullYear()} BanglaQR. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
    `;

    const textContent = `
Hello ${merchantName || companyName || "Merchant"},

Your merchant onboarding application was submitted on ${dateFormatted} successfully.

Business Name: ${companyName || "N/A"}
Merchant Code: ${merchantCode || "Pending"}
Status: Under Review (পর্যালোচনায় রয়েছে)

পরবর্তী নির্দেশনা:
আমাদের কমপ্লায়েন্স টিম এবং আপনার সংশ্লিষ্ট ব্যাংক/MFS পার্টনার আপনার দাখিলকৃত সকল তথ্য ও ডকুমেন্টস যাচাই-বাছাই করছেন। যাচাই প্রক্রিয়া সম্পন্ন হওয়ার সাথে সাথে পরবর্তী নির্দেশনা ও অ্যাকাউন্টের অ্যাক্টিভেশন আপডেট আপনাকে ইমেইল ও এসএমএস এর মাধ্যমে জানিয়ে দেওয়া হবে।

© ${new Date().getFullYear()} BanglaQR. All rights reserved.
    `.trim();

    if (!mailer) {
      console.log(`[DEV APPLICATION SUBMITTED EMAIL] To: ${to} | Code: ${merchantCode}`);
      return { success: true, devSimulated: true };
    }

    try {
      const info = await mailer.sendMail({
        from: fromAddress,
        to,
        subject,
        text: textContent,
        html: htmlContent,
      });
      console.log(`[EmailService] Merchant application submitted email sent to: ${to} (MessageId: ${info.messageId})`);
      return { success: true, delivered: true, messageId: info.messageId };
    } catch (err) {
      console.error("[EmailService Error: Merchant Application Submitted]", err.message);
      return { success: false, delivered: false, error: err.message };
    }
  },

  /**
   * Send notification email to merchant when admin replies to support ticket
   */
  async sendSupportTicketReplyEmail({
    to,
    merchantName,
    ticketNumber,
    subject: ticketSubject,
    replyMessage,
    ticketId,
  }) {
    const isEmailConfigured = await this.isConfigured();
    const client = await getTransporter();
    const mailer = isEmailConfigured && client ? client.transporter : null;
    const fromAddress = client?.config
      ? `"${client.config.senderName || 'BanglaQR Support'}" <${client.config.senderEmail || client.config.username}>`
      : '"BanglaQR Support" <support@banglaqr.com.bd>';

    const subject = `[BanglaQR Support] আপনার টিকিটে নতুন উত্তর (${ticketNumber}) - ${ticketSubject}`;

    const clientUrl = env.clientUrl || "http://localhost:5173";
    const ticketUrl = `${clientUrl}/merchant/support/${ticketId}`;

    const htmlContent = `
<!DOCTYPE html>
<html lang="bn">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Support Ticket Reply</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #1e293b; margin: 0; padding: 20px; }
    .card { max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
    .header { background: #00a86b; padding: 24px 28px; text-align: center; }
    .header h1 { color: #ffffff; font-size: 20px; margin: 0; font-weight: 700; }
    .body { padding: 28px; }
    .greeting { font-size: 15px; font-weight: 600; margin-bottom: 12px; }
    .meta-box { background: #f1f5f9; border-radius: 6px; padding: 14px 16px; margin: 16px 0; font-size: 13px; }
    .meta-row { display: flex; justify-content: space-between; margin-bottom: 6px; }
    .reply-box { background: #f0fdf4; border-left: 4px solid #00a86b; padding: 16px; border-radius: 4px; margin: 18px 0; font-size: 14px; line-height: 1.6; color: #0f172a; white-space: pre-wrap; }
    .btn-container { text-align: center; margin-top: 24px; margin-bottom: 10px; }
    .btn { display: inline-block; background: #00a86b; color: #ffffff !important; text-decoration: none; padding: 12px 28px; font-size: 14px; font-weight: 600; border-radius: 6px; }
    .footer { background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 16px 28px; text-align: center; font-size: 12px; color: #64748b; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h1>BanglaQR সাপোর্ট হেল্পডেস্ক</h1>
    </div>
    <div class="body">
      <div class="greeting">প্রিয় ${merchantName || "মার্চেন্ট"},</div>
      <p style="font-size: 14px; line-height: 1.5; color: #334155;">
        আপনার সাপোর্ট টিকিট <strong>${ticketNumber}</strong> এ সাপোর্ট এডমিন একটি নতুন উত্তর প্রদান করেছেন।
      </p>

      <div class="meta-box">
        <div><strong>টিকিট নম্বর:</strong> ${ticketNumber}</div>
        <div style="margin-top: 4px;"><strong>বিষয়:</strong> ${ticketSubject}</div>
        <div style="margin-top: 4px;"><strong>স্ট্যাটাস:</strong> অপেক্ষমাণ (Waiting for your reply)</div>
      </div>

      <div style="font-size: 13px; font-weight: 600; color: #475569; margin-top: 16px;">এডমিন বার্তা:</div>
      <div class="reply-box">${replyMessage}</div>

      <div class="btn-container">
        <a href="${ticketUrl}" class="btn" target="_blank">টিকিট দেখুন ও উত্তর দিন</a>
      </div>
    </div>
    <div class="footer">
      © ${new Date().getFullYear()} BanglaQR Support System. সর্বস্বত্ব সংরক্ষিত।
    </div>
  </div>
</body>
</html>
    `.trim();

    const textContent = `
প্রিয় ${merchantName || "মার্চেন্ট"},

আপনার সাপোর্ট টিকিট ${ticketNumber} (${ticketSubject}) এ নতুন উত্তর দেওয়া হয়েছে।

এডমিন বার্তা:
${replyMessage}

টিকিট বিস্তারিত দেখতে এবং উত্তর দিতে ভিজিট করুন:
${ticketUrl}

ধন্যবাদ,
BanglaQR Support Team
    `.trim();

    if (!mailer) {
      console.log(`[DEV TICKET REPLY EMAIL] To: ${to} | Ticket: ${ticketNumber}`);
      return { success: true, devSimulated: true };
    }

    try {
      const info = await mailer.sendMail({
        from: fromAddress,
        to,
        subject,
        text: textContent,
        html: htmlContent,
      });
      console.log(`[EmailService] Support ticket reply email sent to: ${to} (MessageId: ${info.messageId})`);
      return { success: true, delivered: true, messageId: info.messageId };
    } catch (err) {
      console.error("[EmailService Error: Support Ticket Reply]", err.message);
      return { success: false, delivered: false, error: err.message };
    }
  },

  /**
   * Send notification email when a requested institution's merchant onboarding becomes active
   */
  async sendInstitutionOnboardingAvailableEmail(to, merchantName, institutionName, actionUrl) {
    const isEmailConfigured = await this.isConfigured();
    const client = await getTransporter();
    const mailer = isEmailConfigured && client ? client.transporter : null;
    const fromAddress = client?.config
      ? `"${client.config.senderName || 'BanglaQR'}" <${client.config.senderEmail || client.config.username}>`
      : '"BanglaQR" <notifications@banglaqr.com>';

    const subject = `শুভ সংবাদ! ${institutionName}-এর মার্চেন্ট অনবোর্ডিং এখন চালু হয়েছে - BanglaQR`;
    const targetUrl = actionUrl || `${env.FRONTEND_URL || "http://localhost:5173"}/merchant/onboarding`;

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f1f5f9; margin: 0; padding: 20px; color: #1e293b; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
    .header { background: linear-gradient(135deg, #059669 0%, #10b981 100%); color: white; padding: 28px 24px; text-align: center; }
    .header h1 { margin: 0; font-size: 24px; font-weight: 700; }
    .content { padding: 32px 24px; line-height: 1.6; }
    .badge { display: inline-block; background-color: #ecfdf5; color: #047857; font-weight: 600; font-size: 13px; padding: 4px 12px; border-radius: 9999px; border: 1px solid #a7f3d0; margin-bottom: 16px; }
    .info-box { background: #f8fafc; border: 1px solid #e2e8f0; border-left: 4px solid #10b981; border-radius: 8px; padding: 16px; margin: 20px 0; font-size: 14px; }
    .btn-container { text-align: center; margin-top: 32px; margin-bottom: 16px; }
    .btn { display: inline-block; background-color: #059669; color: #ffffff !important; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 15px; box-shadow: 0 2px 4px rgba(5, 150, 105, 0.2); }
    .footer { text-align: center; padding: 20px; font-size: 12px; color: #64748b; background-color: #f8fafc; border-top: 1px solid #e2e8f0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>BanglaQR Onboarding Notification</h1>
    </div>
    <div class="content">
      <div class="badge">অনবোর্ডিং এখন সক্রিয় (Onboarding Now Live)</div>
      
      <p style="font-size: 16px;">প্রিয় <strong>${merchantName || "সম্মানিত মার্চেন্ট"}</strong>,</p>
      
      <p style="font-size: 15px; color: #334155;">
        শুভ সংবাদ! আপনার অপেক্ষমাণ <strong>${institutionName}</strong>-এর মার্চেন্ট অনবোর্ডিং সেবা এখন চালু করা হয়েছে।
      </p>

      <div class="info-box">
        <div style="font-weight: 600; color: #0f172a; margin-bottom: 6px;">ব্যাংক / প্রতিষ্ঠান: ${institutionName}</div>
        <div style="color: #475569;">স্ট্যাটাস: <strong style="color: #059669;">অনবোর্ডিং সক্রিয় (Available Now)</strong></div>
        <div style="color: #64748b; margin-top: 8px; font-size: 13px;">
          আপনি পূর্বে এই ব্যাংকের অনবোর্ডিং শুরু হলে জানানোর জন্য অনুরোধ করেছিলেন। আপনি চাইলে এখন সরাসরি আপনার অ্যাপ্লিকেশন সম্পন্ন করে বাংলা কিউআর পেমেন্ট সেবা গ্রহণ করতে পারেন।
        </div>
      </div>

      <div class="btn-container">
        <a href="${targetUrl}" class="btn" target="_blank">অনবোর্ডিং শুরু করুন (Start Onboarding)</a>
      </div>

      <p style="font-size: 13px; color: #64748b; margin-top: 24px;">
        লিঙ্কটি কাজ না করলে নিচের URL-টি ব্রাউজারে কপি-পেস্ট করুন:<br>
        <a href="${targetUrl}" style="color: #059669; word-break: break-all;">${targetUrl}</a>
      </p>
    </div>
    <div class="footer">
      © ${new Date().getFullYear()} BanglaQR Payment System. সর্বস্বত্ব সংরক্ষিত।
    </div>
  </div>
</body>
</html>
    `.trim();

    const textContent = `
প্রিয় ${merchantName || "মার্চেন্ট"},

শুভ সংবাদ! আপনার অপেক্ষমাণ ${institutionName}-এর মার্চেন্ট অনবোর্ডিং সেবা এখন চালু হয়েছে।
আপনি চাইলে এখন আপনার মার্চেন্ট অ্যাকাউন্টটি এই ব্যাংকের অধীনে সম্পন্ন করতে পারেন।

অনবোর্ডিং শুরু করতে নিচের লিঙ্কে প্রবেশ করুন:
${targetUrl}

ধন্যবাদ,
BanglaQR Team
    `.trim();

    if (!mailer) {
      console.log(`[DEV ONBOARDING AVAILABLE EMAIL] To: ${to} | Merchant: ${merchantName} | Institution: ${institutionName}`);
      return { success: true, devSimulated: true };
    }

    try {
      const info = await mailer.sendMail({
        from: fromAddress,
        to,
        subject,
        text: textContent,
        html: htmlContent,
      });
      console.log(`[EmailService] Institution onboarding availability email sent to: ${to} (MessageId: ${info.messageId})`);
      return { success: true, delivered: true, messageId: info.messageId };
    } catch (err) {
      console.error("[EmailService Error: Institution Onboarding Available]", err.message);
      return { success: false, delivered: false, error: err.message };
    }
  },

  /**
   * Send immediate confirmation email when a merchant requests availability notification for a coming-soon institution
   */
  async sendInstitutionRequestConfirmationEmail(to, merchantName, institutionName) {
    const isEmailConfigured = await this.isConfigured();
    const client = await getTransporter();
    const mailer = isEmailConfigured && client ? client.transporter : null;
    const fromAddress = client?.config
      ? `"${client.config.senderName || 'BanglaQR'}" <${client.config.senderEmail || client.config.username}>`
      : '"BanglaQR" <notifications@banglaqr.com>';

    const subject = `অনুরোধ গৃহীত হয়েছে: ${institutionName}-এর মার্চেন্ট অনবোর্ডিং নোটিফিকেশন - BanglaQR`;
    const targetUrl = `${env.FRONTEND_URL || "http://localhost:5173"}/merchant/onboarding`;

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f1f5f9; margin: 0; padding: 20px; color: #1e293b; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
    .header { background: linear-gradient(135deg, #0d9488 0%, #14b8a6 100%); color: white; padding: 28px 24px; text-align: center; }
    .header h1 { margin: 0; font-size: 24px; font-weight: 700; }
    .content { padding: 32px 24px; line-height: 1.6; }
    .badge { display: inline-block; background-color: #f0fdfa; color: #0f766e; font-weight: 600; font-size: 13px; padding: 4px 12px; border-radius: 9999px; border: 1px solid #99f6e4; margin-bottom: 16px; }
    .info-box { background: #f8fafc; border: 1px solid #e2e8f0; border-left: 4px solid #0d9488; border-radius: 8px; padding: 16px; margin: 20px 0; font-size: 14px; }
    .btn-container { text-align: center; margin-top: 32px; margin-bottom: 16px; }
    .btn { display: inline-block; background-color: #0d9488; color: #ffffff !important; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 15px; box-shadow: 0 2px 4px rgba(13, 148, 136, 0.2); }
    .footer { text-align: center; padding: 20px; font-size: 12px; color: #64748b; background-color: #f8fafc; border-top: 1px solid #e2e8f0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>BanglaQR Onboarding Request Confirmation</h1>
    </div>
    <div class="content">
      <div class="badge">অনুরোধ গৃহীত হয়েছে (Request Registered)</div>
      
      <p style="font-size: 16px;">প্রিয় <strong>${merchantName || "সম্মানিত মার্চেন্ট"}</strong>,</p>
      
      <p style="font-size: 15px; color: #334155;">
        <strong>${institutionName}</strong>-এর মার্চেন্ট অনবোর্ডিং চালু হওয়ার নোটিফিকেশন পেতে আপনার অনুরোধটি সিস্টেমে সফলভাবে সংরক্ষিত হয়েছে।
      </p>

      <div class="info-box">
        <div style="font-weight: 600; color: #0f172a; margin-bottom: 6px;">ব্যাংক / প্রতিষ্ঠান: ${institutionName}</div>
        <div style="color: #d97706; font-weight: 600;">বর্তমান স্ট্যাটাস: অনবোর্ডিং এখনো শুরু হয়নি (Coming Soon)</div>
        <div style="color: #64748b; margin-top: 8px; font-size: 13px;">
          এই প্রতিষ্ঠানে অনবোর্ডিং প্রক্রিয়া সক্রিয় হওয়ার সাথে সাথে আপনাকে আপনার রেজিস্টার্ড ইমেইল এবং মার্চেন্ট ড্যাশবোর্ড নোটিফিকেশনের মাধ্যমে অবহিত করা হবে।
        </div>
      </div>

      <p style="font-size: 14px; color: #475569;">
        আপনি চাইলে অপেক্ষাকালে অন্য যেকোনো সচল (Available) ব্যাংক বা এমএফএস বেছে নিয়ে আপনার অনবোর্ডিং আবেদন সম্পন্ন করতে পারেন। অন্য প্রতিষ্ঠানে আবেদন করলেও আপনার এই নোটিফিকেশন অনুরোধ বহাল থাকবে।
      </p>

      <div class="btn-container">
        <a href="${targetUrl}" class="btn" target="_blank">মার্চেন্ট পোর্টালে যান (Visit Portal)</a>
      </div>
    </div>
    <div class="footer">
      © ${new Date().getFullYear()} BanglaQR Payment System. সর্বস্বত্ব সংরক্ষিত।
    </div>
  </div>
</body>
</html>
    `.trim();

    const textContent = `
প্রিয় ${merchantName || "মার্চেন্ট"},

${institutionName}-এর মার্চেন্ট অনবোর্ডিং চালু হওয়ার নোটিফিকেশন পেতে আপনার অনুরোধটি সফলভাবে গৃহীত হয়েছে।
এই প্রতিষ্ঠানের অনবোর্ডিং প্রক্রিয়া এখনো শুরু হয়নি। অনবোর্ডিং চালু হওয়ার সঙ্গে সঙ্গে আপনাকে ইমেইল ও মার্চেন্ট ড্যাশবোর্ড নোটিফিকেশনের মাধ্যমে জানানো হবে।

পোর্টাল লিংক:
${targetUrl}

ধন্যবাদ,
BanglaQR Team
    `.trim();

    if (!mailer) {
      console.log(`[DEV CONFIRMATION EMAIL] To: ${to} | Merchant: ${merchantName} | Institution: ${institutionName}`);
      return { success: true, devSimulated: true };
    }

    try {
      const info = await mailer.sendMail({
        from: fromAddress,
        to,
        subject,
        text: textContent,
        html: htmlContent,
      });
      console.log(`[EmailService] Request confirmation email sent to: ${to} (MessageId: ${info.messageId})`);
      return { success: true, delivered: true, messageId: info.messageId };
    } catch (err) {
      console.error("[EmailService Error: Request Confirmation Email]", err.message);
      return { success: false, delivered: false, error: err.message };
    }
  },
};

