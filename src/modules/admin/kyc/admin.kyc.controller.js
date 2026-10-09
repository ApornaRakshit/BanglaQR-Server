import { adminKycService } from "./admin.kyc.service.js";
import { z } from "zod";

const listKycSchema = z.object({
  search: z.string().optional().default(""),
  status: z.string().optional().default(""),
  businessType: z.string().optional().default(""),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(15),
});

export const adminKycController = {
  async list(req, res, next) {
    try {
      const filters = listKycSchema.parse(req.query);
      const data = await adminKycService.listKyc(filters);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  async getDetails(req, res, next) {
    try {
      const merchantId = Number(req.params.merchantId);
      const data = await adminKycService.getKycDetails(merchantId);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  async review(req, res, next) {
    try {
      const merchantId = Number(req.params.merchantId);
      const result = await adminKycService.reviewKyc({
        merchantId,
        ...req.body,
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

