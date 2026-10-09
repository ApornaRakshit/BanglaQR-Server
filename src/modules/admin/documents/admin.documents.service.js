import fs from "fs";
import { adminDocumentsRepository } from "./admin.documents.repository.js";
import { secureStorage } from "../../../config/storage.js";
import { logAdminAudit } from "../../../utils/auditLogger.js";

export const adminDocumentsService = {
  async listDocuments(filters) {
    return await adminDocumentsRepository.listDocuments(filters);
  },

  async getDocumentFile(merchantId, documentId) {
    const doc = await adminDocumentsRepository.getDocumentById(merchantId, documentId);
    if (!doc) {
      const err = new Error("Document not found or does not belong to merchant");
      err.statusCode = 404;
      throw err;
    }

    try {
      const filePath = secureStorage.getFilePath(doc.storage_key, merchantId);
      if (!fs.existsSync(filePath)) {
        const err = new Error("Physical document file not found in secure storage");
        err.statusCode = 404;
        throw err;
      }
      return {
        filePath,
        mimeType: doc.mime_type || "application/octet-stream",
        documentName: doc.document_name,
        documentType: doc.document_type,
        doc,
      };
    } catch (e) {
      const err = new Error(e.message || "Cannot access document storage");
      err.statusCode = 403;
      throw err;
    }
  },

  async reviewDocument({
    merchantId,
    documentId,
    status,
    reviewComment,
    adminUser,
    ip,
    userAgent,
  }) {
    const doc = await adminDocumentsRepository.getDocumentById(merchantId, documentId);
    if (!doc) {
      const err = new Error("Document not found");
      err.statusCode = 404;
      throw err;
    }

    await adminDocumentsRepository.updateDocumentStatus(documentId, status, reviewComment);

    await logAdminAudit({
      userId: adminUser?.id,
      adminEmail: adminUser?.email,
      action: `document_${status.toLowerCase().replace(/ /g, "_")}`,
      resourceType: "document",
      resourceId: documentId,
      merchantId,
      details: {
        documentType: doc.document_type,
        documentName: doc.document_name,
        previousStatus: doc.status,
        newStatus: status,
        reviewComment,
      },
      ip,
      userAgent,
    });

    return {
      success: true,
      message: `Document status updated to '${status}'`,
      documentId,
      status,
    };
  },
};

