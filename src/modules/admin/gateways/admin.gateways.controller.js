import { adminGatewaysService } from "./admin.gateways.service.js";
import { z } from "zod";

const gatewaySchema = z.object({
  name: z.string().min(2),
  code: z.string().min(2),
  logoUrl: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  shortDescription: z.string().optional().nullable(),
  category: z.string().optional().default("gateway"),
  isPublished: z.boolean().optional().default(true),
  acceptsApplications: z.boolean().optional().default(true),
  displayOrder: z.coerce.number().optional().default(0),
  eligibility: z.string().optional().nullable(),
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

function normalizeGatewayPayload(body) {
  const payload = { ...body };
  if (payload.fee_percentage !== undefined && payload.serviceFee === undefined) {
    payload.serviceFee = Number(payload.fee_percentage);
  }
  if (payload.fee_fixed !== undefined && payload.setupFee === undefined) {
    payload.setupFee = Number(payload.fee_fixed);
  }
  if (payload.type !== undefined && payload.serviceType === undefined) {
    payload.serviceType = payload.type;
  }
  if (payload.logo_url !== undefined && payload.logoUrl === undefined) {
    payload.logoUrl = payload.logo_url;
  }
  if (payload.qr_supported !== undefined && payload.qrSupported === undefined) {
    payload.qrSupported = Boolean(payload.qr_supported);
  }
  if (payload.card_supported !== undefined && payload.cardSupported === undefined) {
    payload.cardSupported = Boolean(payload.card_supported);
  }
  if (payload.mobile_supported !== undefined && payload.mobileSupported === undefined) {
    payload.mobileSupported = Boolean(payload.mobile_supported);
  }
  if (payload.api_supported !== undefined && payload.apiSupported === undefined) {
    payload.apiSupported = Boolean(payload.api_supported);
  }
  if (payload.is_published !== undefined && payload.isPublished === undefined) {
    payload.isPublished = Boolean(payload.is_published);
  }
  if (payload.accepts_applications !== undefined && payload.acceptsApplications === undefined) {
    payload.acceptsApplications = Boolean(payload.accepts_applications);
  }
  if (payload.short_description !== undefined && payload.shortDescription === undefined) {
    payload.shortDescription = payload.short_description;
  }
  if (payload.display_order !== undefined && payload.displayOrder === undefined) {
    payload.displayOrder = Number(payload.display_order);
  }
  return payload;
}

export const adminGatewaysController = {
  async getStats(req, res, next) {
    try {
      const data = await adminGatewaysService.getGatewayStats();
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  async list(req, res, next) {
    try {
      const data = await adminGatewaysService.listGateways(req.query);
      res.json({ success: true, data, gateways: data });
    } catch (err) {
      next(err);
    }
  },

  async getById(req, res, next) {
    try {
      const id = Number(req.params.gatewayId);
      const data = await adminGatewaysService.getGateway(id);
      res.json({ success: true, data, gateway: data });
    } catch (err) {
      next(err);
    }
  },

  async create(req, res, next) {
    try {
      const normalized = normalizeGatewayPayload(req.body);
      const payload = gatewaySchema.parse(normalized);
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
      const normalized = normalizeGatewayPayload(req.body);
      const payload = gatewaySchema.parse(normalized);
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

  async updateStatus(req, res, next) {
    try {
      const id = Number(req.params.gatewayId);
      const status = req.body.status;
      if (!["active", "inactive", "draft"].includes(status)) {
        return res.status(400).json({ success: false, message: "Invalid status value." });
      }
      const result = await adminGatewaysService.updateGatewayStatus(
        id,
        status,
        req.user,
        req.ip,
        req.get("user-agent")
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async updatePublish(req, res, next) {
    try {
      const id = Number(req.params.gatewayId);
      const { isPublished, acceptsApplications } = req.body;
      const result = await adminGatewaysService.updateGatewayPublish(
        id,
        { isPublished, acceptsApplications },
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
      res.json({ success: true, data, applications: data });
    } catch (err) {
      next(err);
    }
  },

  async listServices(req, res, next) {
    try {
      const data = await adminGatewaysService.listServices(req.query);
      res.json({ success: true, data, services: data });
    } catch (err) {
      next(err);
    }
  },

  async reviewApplication(req, res, next) {
    try {
      const applicationId = Number(req.params.applicationId);
      const action = req.body.action || req.body.status;
      const reviewNote = req.body.reviewNote || req.body.review_note || req.body.notes || req.body.note;
      const result = await adminGatewaysService.reviewApplication({
        applicationId,
        action,
        reviewNote,
        adminUser: req.user,
        ip: req.ip,
        userAgent: req.get("user-agent"),
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async updateServiceStatus(req, res, next) {
    try {
      const serviceId = Number(req.params.serviceId);
      const { status } = req.body;
      const result = await adminGatewaysService.updateServiceStatus(
        serviceId,
        status,
        req.user,
        req.ip,
        req.get("user-agent")
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
};
