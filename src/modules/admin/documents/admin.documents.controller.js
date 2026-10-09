import { adminDocumentsService } from "./admin.documents.service.js";
import { z } from "zod";
import fs from "fs";

const listDocsSchema = z.object({
  search: z.string().optional().default(""),
  status: z.string().optional().default(""),
  documentType: z.string().optional().default(""),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(15),
});

const reviewDocSchema = z.object({
  status: z.enum([
    "Approved",
    "Rejected",
    "Under Review",
    "Additional Document Required",
    "Uploaded",
  ]),
  reviewComment: z.string().optional().default(""),
});

export const adminDocumentsController = {
  async list(req, res, next) {
    try {
      const filters = listDocsSchema.parse(req.query);
      const data = await adminDocumentsService.listDocuments(filters);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  async view(req, res, next) {
    try {
      const merchantId = Number(req.params.merchantId);
      const documentId = Number(req.params.documentId);

      const fileInfo = await adminDocumentsService.getDocumentFile(merchantId, documentId);

      res.setHeader("Content-Type", fileInfo.mimeType);
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${encodeURIComponent(fileInfo.documentName)}"`
      );
      res.setHeader("Cache-Control", "private, no-cache, no-store, must-revalidate");

      const fileStream = fs.createReadStream(fileInfo.filePath);
      fileStream.pipe(res);
    } catch (err) {
      next(err);
    }
  },

  async review(req, res, next) {
    try {
      const merchantId = Number(req.params.merchantId);
      const documentId = Number(req.params.documentId);
      const payload = reviewDocSchema.parse(req.body);

      const result = await adminDocumentsService.reviewDocument({
        merchantId,
        documentId,
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

