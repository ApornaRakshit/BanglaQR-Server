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
      res.setHeader("Content-Type", mimeType);
      res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(documentName)}"`);
      res.sendFile(filePath);
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
};

