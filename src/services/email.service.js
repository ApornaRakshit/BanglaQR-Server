import nodemailer from "nodemailer";
import { env } from "../config/env.js";

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = process.env.SMTP_SECURE === "true" || port === 465;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    return null;
  }

  transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user,
      pass,
    },
  });

  return transporter;
}

export const emailService = {
  isConfigured() {
    return Boolean(
      process.env.SMTP_HOST &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASS
    );
  },

  async sendOtpEmail({ to, otp, purpose = "email_verification", expiresMinutes = 5 }) {
    const isEmailConfigured = this.isConfigured();

    if (!isEmailConfigured) {
      if (env.nodeEnv === "development") {
        console.warn(
          `[EmailService:DEV] SMTP is not configured in .env. OTP for ${to} is: ${otp}`
        );
        return {
          success: true,
          devSimulated: true,
          message: "SMTP not configured - simulated in development",
        };
      }

      const error = new Error(
        "Email verification service is currently unconfigured. Please contact support."
      );
      error.statusCode = 503;
      throw error;
    }

    const mailer = getTransporter();
    const fromAddress =
      process.env.SMTP_FROM || `"BanglaQR Security" <noreply@banglaqr.com>`;

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
      <p>Need help? Contact our support at <a href="mailto:support@banglaqr.com">support@banglaqr.com</a></p>
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
    const isEmailConfigured = this.isConfigured();

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
        "Email delivery service is not configured on the server. Please contact support."
      );
      error.statusCode = 503;
      throw error;
    }

    const mailer = getTransporter();
    const fromAddress =
      process.env.SMTP_FROM || `"BanglaQR Security" <noreply@banglaqr.com>`;
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
      <p>Need help? Contact our support at <a href="mailto:support@banglaqr.com">support@banglaqr.com</a></p>
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
};

