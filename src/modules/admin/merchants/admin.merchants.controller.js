import { adminMerchantsService } from "./admin.merchants.service.js";
import { z } from "zod";

const listMerchantsSchema = z.object({
  search: z.string().optional().default(""),
  status: z.string().optional().default(""),
  kycStatus: z.string().optional().default(""),
  businessType: z.string().optional().default(""),
  dateFrom: z.string().optional().default(""),
  dateTo: z.string().optional().default(""),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(15),
});

const reviewMerchantSchema = z.object({
  action: z.enum([
    "start_review",
    "approve",
    "reject",
    "request_information",
    "suspend",
    "activate",
  ]),
  reason: z.string().optional(),
  comment: z.string().optional(),
  requiredItems: z.array(z.string()).optional(),
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
};

