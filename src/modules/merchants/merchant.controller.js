import fs from "fs";
import { merchantService } from "./merchant.service.js";
import {
  companySchema,
  contactSchema,
  commercialSchema,
  kycSchema,
  documentUploadSchema,
} from "./merchant.validation.js";

export const merchantController = {
  async getMe(req, res, next) {
    try {
      const data = await merchantService.getMerchantMe(req.user.id);
      res.json({
        success: true,
        data,
      });
    } catch (error) {
      next(error);
    }
  },

  async updateCompany(req, res, next) {
    try {
      const validated = companySchema.parse(req.body);
      const data = await merchantService.updateCompany(req.user.id, validated);
      res.json({
        success: true,
        message: "Company information saved successfully",
        data,
      });
    } catch (error) {
      next(error);
    }
  },

  async updateContact(req, res, next) {
    try {
      const validated = contactSchema.parse(req.body);
      const data = await merchantService.updateContact(req.user.id, validated);
      res.json({
        success: true,
        message: "Contact information saved successfully",
        data,
      });
    } catch (error) {
      next(error);
    }
  },

  async updateCommercial(req, res, next) {
    try {
      const validated = commercialSchema.parse(req.body);
      const data = await merchantService.updateCommercial(req.user.id, validated);
      res.json({
        success: true,
        message: "Commercial details saved successfully",
        data,
      });
    } catch (error) {
      next(error);
    }
  },

  async getKyc(req, res, next) {
    try {
      const data = await merchantService.getKyc(req.user.id);
      res.json({
        success: true,
        data,
      });
    } catch (error) {
      next(error);
    }
  },

  async updateKyc(req, res, next) {
    try {
      const validated = kycSchema.parse(req.body);
      const data = await merchantService.updateKyc(req.user.id, validated);
      res.json({
        success: true,
        message: "KYC information saved successfully",
        data,
      });
    } catch (error) {
      next(error);
    }
  },

  async getDocuments(req, res, next) {
    try {
      const data = await merchantService.getDocuments(req.user.id);
      res.json({
        success: true,
        data,
      });
    } catch (error) {
      next(error);
    }
  },

  async uploadDocument(req, res, next) {
    try {
      const validated = documentUploadSchema.parse(req.body);
      const doc = await merchantService.uploadDocument(req.user.id, req.file, validated);
      res.status(201).json({
        success: true,
        message: "Document uploaded successfully",
        data: doc,
      });
    } catch (error) {
      next(error);
    }
  },

  async replaceDocument(req, res, next) {
    try {
      const docId = Number(req.params.id);
      const validated = documentUploadSchema.partial().parse(req.body);
      const doc = await merchantService.replaceDocument(req.user.id, docId, req.file, validated);
      res.json({
        success: true,
        message: "Document replaced successfully",
        data: doc,
      });
    } catch (error) {
      next(error);
    }
  },

  async deleteDocument(req, res, next) {
    try {
      const docId = Number(req.params.id);
      const result = await merchantService.deleteDocument(req.user.id, docId);
      res.json(result);
    } catch (error) {
      next(error);
    }
  },

  async viewDocument(req, res, next) {
    try {
      const docId = Number(req.params.id);
      const { filePath, mimeType, documentName } = await merchantService.getDocumentFile(req.user.id, docId);

      if (!fs.existsSync(filePath)) {
        const err = new Error("Physical document file not found in secure storage");
        err.statusCode = 404;
        throw err;
      }

      res.setHeader("Content-Type", mimeType || "application/octet-stream");
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${encodeURIComponent(documentName)}"`
      );
      res.setHeader("Cache-Control", "private, no-cache, no-store, must-revalidate");
      res.setHeader("X-Content-Type-Options", "nosniff");

      const fileStream = fs.createReadStream(filePath);
      fileStream.pipe(res);
    } catch (error) {
      next(error);
    }
  },

  async getOnboarding(req, res, next) {
    try {
      const data = await merchantService.getOnboardingStatus(req.user.id);
      res.json({
        success: true,
        data,
      });
    } catch (error) {
      next(error);
    }
  },

  async submitApplication(req, res, next) {
    try {
      const result = await merchantService.submitApplication(req.user.id);
      res.json(result);
    } catch (error) {
      next(error);
    }
  },

  // --- Gateways ---
  async getGateways(req, res, next) {
    try {
      const data = await merchantService.getGateways(req.user.id, req.query);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async getGatewayById(req, res, next) {
    try {
      const gatewayId = Number(req.params.gatewayId);
      const data = await merchantService.getGatewayById(req.user.id, gatewayId);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async applyGateway(req, res, next) {
    try {
      const gatewayId = Number(req.params.gatewayId);
      const result = await merchantService.applyGateway(req.user.id, gatewayId, req.body);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  },

  // --- Applications ---
  async getApplications(req, res, next) {
    try {
      const data = await merchantService.getApplications(req.user.id, req.query);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async getApplicationById(req, res, next) {
    try {
      const id = Number(req.params.id);
      const data = await merchantService.getApplicationById(req.user.id, id);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  // --- Services ---
  async getMyServices(req, res, next) {
    try {
      const data = await merchantService.getMyServices(req.user.id, req.query);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async getMyServiceById(req, res, next) {
    try {
      const id = Number(req.params.id);
      const data = await merchantService.getMyServiceById(req.user.id, id);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async updateServiceConfiguration(req, res, next) {
    try {
      const id = Number(req.params.id);
      const result = await merchantService.updateServiceConfiguration(req.user.id, id, req.body);
      res.json(result);
    } catch (error) {
      next(error);
    }
  },

  // --- Addons ---
  async getAddons(req, res, next) {
    try {
      const data = await merchantService.getAddons(req.user.id, req.query);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async applyAddon(req, res, next) {
    try {
      const addonId = Number(req.params.addonId);
      const result = await merchantService.applyAddon(req.user.id, addonId, req.body);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  },

  // --- Integration ---
  async getIntegrationDetails(req, res, next) {
    try {
      const data = await merchantService.getIntegrationDetails(req.user.id);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  // --- Notifications ---
  async getNotifications(req, res, next) {
    try {
      const data = await merchantService.getNotifications(req.user.id);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async getUnreadNotificationCount(req, res, next) {
    try {
      const data = await merchantService.getUnreadNotificationCount(req.user.id);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async markNotificationRead(req, res, next) {
    try {
      const id = Number(req.params.id);
      const result = await merchantService.markNotificationRead(req.user.id, id);
      res.json(result);
    } catch (error) {
      next(error);
    }
  },

  async markAllNotificationsRead(req, res, next) {
    try {
      const result = await merchantService.markAllNotificationsRead(req.user.id);
      res.json(result);
    } catch (error) {
      next(error);
    }
  },

  // --- Support Tickets ---
  async getSupportTickets(req, res, next) {
    try {
      const data = await merchantService.getSupportTickets(req.user.id, req.query);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async getSupportTicketById(req, res, next) {
    try {
      const id = Number(req.params.id);
      const data = await merchantService.getSupportTicketById(req.user.id, id);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async createSupportTicket(req, res, next) {
    try {
      const result = await merchantService.createSupportTicket(req.user.id, req.body);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  },

  async replySupportTicket(req, res, next) {
    try {
      const id = Number(req.params.id);
      const result = await merchantService.replySupportTicket(req.user.id, id, req.body);
      res.json(result);
    } catch (error) {
      next(error);
    }
  },

  // --- Invoices ---
  async getInvoices(req, res, next) {
    try {
      const data = await merchantService.getInvoices(req.user.id, req.query);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async getInvoiceById(req, res, next) {
    try {
      const id = Number(req.params.id);
      const data = await merchantService.getInvoiceById(req.user.id, id);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async createInvoice(req, res, next) {
    try {
      const result = await merchantService.createInvoice(req.user.id, req.body);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  },

  async updateInvoice(req, res, next) {
    try {
      const id = Number(req.params.id);
      const result = await merchantService.updateInvoice(req.user.id, id, req.body);
      res.json(result);
    } catch (error) {
      next(error);
    }
  },

  async deleteInvoice(req, res, next) {
    try {
      const id = Number(req.params.id);
      const result = await merchantService.deleteInvoice(req.user.id, id);
      res.json(result);
    } catch (error) {
      next(error);
    }
  },

  // --- Settings ---
  async getSettings(req, res, next) {
    try {
      const data = await merchantService.getSettings(req.user.id);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async changePassword(req, res, next) {
    try {
      const result = await merchantService.changePassword(req.user.id, req.body);
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
};

