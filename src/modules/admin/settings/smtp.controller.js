import { z } from "zod";
import { smtpSettingsService } from "./smtp.service.js";

const updateSmtpSchema = z.object({
  smtpHost: z.string().min(1, "SMTP Host is required").trim(),
  smtpPort: z.coerce.number().int().min(1).max(65535, "Port must be between 1 and 65535"),
  smtpSecurity: z.enum(["SSL", "TLS", "STARTTLS", "NONE"]).default("STARTTLS"),
  smtpUsername: z.string().min(1, "SMTP Username/Email is required").trim(),
  smtpPassword: z.string().optional(),
  senderName: z.string().min(1, "Sender Name is required").trim().default("BanglaQR"),
  senderEmail: z.string().email("Valid sender email is required").trim(),
  replyToEmail: z.string().email("Valid reply-to email required").optional().or(z.literal("")),
  isActive: z.boolean().default(true),
});

const testEmailSchema = z.object({
  recipientEmail: z.string().email("Valid recipient email is required").trim(),
  customConfig: z
    .object({
      smtpHost: z.string().optional(),
      smtpPort: z.coerce.number().optional(),
      smtpSecurity: z.string().optional(),
      smtpUsername: z.string().optional(),
      smtpPassword: z.string().optional(),
      senderName: z.string().optional(),
      senderEmail: z.string().optional(),
      replyToEmail: z.string().optional(),
    })
    .optional(),
});

export const smtpSettingsController = {
  /**
   * GET /api/v1/admin/settings/smtp
   * Load safe SMTP settings.
   */
  async getSettings(req, res, next) {
    try {
      const data = await smtpSettingsService.getSettings();
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  /**
   * PUT /api/v1/admin/settings/smtp
   * Save or update SMTP settings.
   */
  async updateSettings(req, res, next) {
    try {
      const validated = updateSmtpSchema.parse(req.body);
      const data = await smtpSettingsService.updateSettings(validated, req.user, {
        ip: req.ip,
        userAgent: req.get("user-agent"),
      });

      res.json({
        success: true,
        message: "SMTP configuration saved and activated successfully!",
        data,
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/v1/admin/settings/smtp/verify
   * Verify SMTP connection handshake.
   */
  async verifyConnection(req, res, next) {
    try {
      const customConfig = req.body?.customConfig || null;
      const result = await smtpSettingsService.verifyConnection(customConfig);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/v1/admin/settings/smtp/test
   * Send an actual test email.
   */
  async sendTestEmail(req, res, next) {
    try {
      const validated = testEmailSchema.parse(req.body);
      const result = await smtpSettingsService.sendTestEmail({
        recipientEmail: validated.recipientEmail,
        customConfig: validated.customConfig || null,
        adminUser: req.user,
        reqMeta: {
          ip: req.ip,
          userAgent: req.get("user-agent"),
        },
      });

      res.json(result);
    } catch (err) {
      next(err);
    }
  },
};
