import { adminGatewaysService } from "./admin.gateways.service.js";
import { z } from "zod";

const gatewaySchema = z.object({
  name: z.string().min(2),
  code: z.string().min(2),
  logoUrl: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  supportedMethods: z.array(z.string()).optional(),
  serviceType: z.string().optional().default("Payment Gateway"),
  qrSupported: z.boolean().optional().default(true),
  cardSupported: z.boolean().optional().default(false),
  mobileSupported: z.boolean().optional().default(true),
  apiSupported: z.boolean().optional().default(true),
  requiredDocuments: z.array(z.string()).optional(),
  serviceFee: z.coerce.number().min(0).max(100).default(1.5),
  setupFee: z.coerce.number().min(0).default(0),
  status: z.enum(["active", "inactive", "draft"]).default("active"),
});

export const adminGatewaysController = {
  async list(req, res, next) {
    try {
      const data = await adminGatewaysService.listGateways();
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  async getById(req, res, next) {
    try {
      const id = Number(req.params.gatewayId);
      const data = await adminGatewaysService.getGateway(id);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  async create(req, res, next) {
    try {
      const payload = gatewaySchema.parse(req.body);
      const result = await adminGatewaysService.createGateway(
        payload,
        req.user,
        req.ip,
        req.get("user-agent")
      );
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },

  async update(req, res, next) {
    try {
      const id = Number(req.params.gatewayId);
      const payload = gatewaySchema.parse(req.body);
      const result = await adminGatewaysService.updateGateway(
        id,
        payload,
        req.user,
        req.ip,
        req.get("user-agent")
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async delete(req, res, next) {
    try {
      const id = Number(req.params.gatewayId);
      const result = await adminGatewaysService.deleteGateway(
        id,
        req.user,
        req.ip,
        req.get("user-agent")
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async listApplications(req, res, next) {
    try {
      const data = await adminGatewaysService.listApplications(req.query);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  async listServices(req, res, next) {
    try {
      const data = await adminGatewaysService.listServices(req.query);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },
};

