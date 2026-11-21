import { adminMerchantsService } from "./admin.merchants.service.js";
import { z } from "zod";

const listMerchantsSchema = z.object({
  search: z.string().optional().default(""),
  status: z.string().optional().default(""),
  kycStatus: z.string().optional().default(""),
  businessType: z.string().optional().default(""),
  channel: z.string().optional().default(""),
  dateFrom: z.string().optional().default(""),
  dateTo: z.string().optional().default(""),
  sort: z.string().optional().default("desc"),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(15),
});

const reviewMerchantSchema = z.object({
  action: z.enum([
    "start_review",
    "approve",
    "reject",
    "request_information",
    "request_info",
    "suspend",
    "activate",
  ]),
  reason: z.string().optional(),
  comment: z.string().optional(),
  requiredItems: z.array(z.any()).optional(),
});

const createMerchantSchema = z.object({
  fullName: z.string().min(2, "Full Name is required"),
  companyName: z.string().min(2, "Company Name is required"),
  email: z.string().email("Valid email is required"),
  phone: z.string().min(10, "Valid phone number is required"),
  password: z.string().min(6, "Password must be at least 6 characters").optional(),
  businessType: z.string().optional(),
  institutionId: z.coerce.number().optional().nullable(),
});

export const adminMerchantsController = {
  async list(req, res, next) {
    try {
      const filters = listMerchantsSchema.parse(req.query);
      const data = await adminMerchantsService.listMerchants(filters);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  async exportAllExcel(req, res, next) {
    try {
      const filters = listMerchantsSchema.parse(req.query);
      const { buffer, filename } = await adminMerchantsService.exportAllMerchantsExcel(filters);

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(buffer);
    } catch (err) {
      next(err);
    }
  },

  async getDetails(req, res, next) {
    try {
      const merchantId = Number(req.params.merchantId);
      const data = await adminMerchantsService.getMerchantDetails(merchantId);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  async getHistory(req, res, next) {
    try {
      const merchantId = Number(req.params.merchantId);
      const data = await adminMerchantsService.getMerchantHistory(merchantId);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  async review(req, res, next) {
    try {
      const merchantId = Number(req.params.merchantId);
      const payload = reviewMerchantSchema.parse(req.body);

      const result = await adminMerchantsService.reviewMerchant({
        merchantId,
        ...payload,
        adminUser: req.user,
        ip: req.ip,
        userAgent: req.get("user-agent"),
      });

      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async resolveIssue(req, res, next) {
    try {
      const merchantId = Number(req.params.merchantId);
      const issueId = Number(req.params.issueId);
      const { note = "Approved by compliance" } = req.body;

      const result = await adminMerchantsService.resolveKycIssue({
        merchantId,
        issueId,
        note,
        adminUser: req.user,
      });

      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async deleteIssue(req, res, next) {
    try {
      const merchantId = Number(req.params.merchantId);
      const issueId = Number(req.params.issueId);

      const result = await adminMerchantsService.deleteKycIssue({
        merchantId,
        issueId,
        adminUser: req.user,
      });

      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async create(req, res, next) {
    try {
      const payload = createMerchantSchema.parse(req.body);
      const files = req.files || (req.file ? [req.file] : []);
      const result = await adminMerchantsService.createMerchant({
        ...payload,
        files,
        adminUser: req.user,
        ip: req.ip,
        userAgent: req.get("user-agent"),
      });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },

  async delete(req, res, next) {
    try {
      const merchantId = Number(req.params.merchantId);
      const result = await adminMerchantsService.deleteMerchant({
        merchantId,
        adminUser: req.user,
        ip: req.ip,
        userAgent: req.get("user-agent"),
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async batchDelete(req, res, next) {
    try {
      const { merchantIds = [], scope = "both" } = req.body;
      const result = await adminMerchantsService.batchDeleteMerchants({
        merchantIds,
        scope,
        adminUser: req.user,
        ip: req.ip,
        userAgent: req.get("user-agent"),
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async resetPassword(req, res, next) {
    try {
      const merchantId = Number(req.params.merchantId);
      const result = await adminMerchantsService.resetMerchantPassword({
        merchantId,
        adminUser: req.user,
        ip: req.ip,
        userAgent: req.get("user-agent"),
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async exportPdf(req, res, next) {
    try {
      const merchantId = Number(req.params.merchantId);
      const includeDocuments = req.query.includeDocuments === undefined || req.query.includeDocuments === "true";
      const institutionId = req.query.institutionId ? Number(req.query.institutionId) : undefined;
      const { buffer, filename } = await adminMerchantsService.exportMerchantPdf(merchantId, { includeDocuments, institutionId });

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(buffer);
    } catch (err) {
      next(err);
    }
  },

  async exportExcel(req, res, next) {
    try {
      const merchantId = Number(req.params.merchantId);
      const { buffer, filename } = await adminMerchantsService.exportMerchantExcel(merchantId);

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(buffer);
    } catch (err) {
      next(err);
    }
  },
};

