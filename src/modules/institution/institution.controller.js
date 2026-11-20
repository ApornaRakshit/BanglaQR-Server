import fs from "fs";
import { institutionService } from "./institution.service.js";
import { adminInstitutionsService } from "../admin/institutions/admin.institutions.service.js";
import { trashService } from "../admin/trash/trash.module.js";
import {
  applicationReviewSchema,
  fieldCorrectionSchema,
  branchCorrectionRequestSchema,
  staffBranchAssignmentSchema,
  institutionServiceSchema,
} from "./institution.validation.js";

function getTargetInstitutionId(req) {
  if (req.targetInstitutionId) {
    return req.targetInstitutionId;
  }
  const isPlatformAdmin =
    ["super_admin", "admin"].includes(req.user?.role) ||
    (Array.isArray(req.user?.roles) && req.user.roles.some((r) => ["super_admin", "admin"].includes(r)));

  if (isPlatformAdmin) {
    return req.query?.institutionId || req.headers?.["x-institution-id"] || req.user?.institutionId || null;
  }
  return req.user?.institutionId;
}

export const institutionController = {
  async getMe(req, res, next) {
    try {
      const targetInstId = getTargetInstitutionId(req);
      const data = await institutionService.getMyInstitution(req.user, targetInstId);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  async getDashboard(req, res, next) {
    try {
      const institutionId = getTargetInstitutionId(req);
      const data = await institutionService.getDashboard(institutionId);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  async exportDashboardExcel(req, res, next) {
    try {
      const institutionId = getTargetInstitutionId(req);
      const { buffer, filename } = await institutionService.exportDashboardExcel(institutionId);

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(buffer);
    } catch (err) {
      next(err);
    }
  },

  async listApplications(req, res, next) {
    try {
      const institutionId = getTargetInstitutionId(req);
      const { status, search, page, limit } = req.query;
      const data = await institutionService.listApplications({
        institutionId,
        status,
        search,
        page,
        limit,
        assignedBranchIds: req.user.assignedBranchIds,
      });
      res.json({ success: true, ...data });
    } catch (err) {
      next(err);
    }
  },

  async getApplication(req, res, next) {
    try {
      const institutionId = getTargetInstitutionId(req);
      const { id } = req.params;
      const data = await institutionService.getApplication(id, institutionId, req.user.assignedBranchIds);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  async getApplicationHistory(req, res, next) {
    try {
      const institutionId = getTargetInstitutionId(req);
      const { id } = req.params;
      const history = await institutionService.getApplicationHistory(id, institutionId, req.user.assignedBranchIds);
      res.json({ success: true, history });
    } catch (err) {
      next(err);
    }
  },

  async downloadApplicationSummary(req, res, next) {
    try {
      const institutionId = getTargetInstitutionId(req);
      const { id } = req.params;
      const includeDocuments = req.query.includeDocuments === undefined || req.query.includeDocuments === "true";
      const { buffer, filename } = await institutionService.generateApplicationSummaryPdf(
        id,
        institutionId,
        req.user.assignedBranchIds,
        { includeDocuments }
      );

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(buffer);
    } catch (err) {
      next(err);
    }
  },

  async downloadApplicationExcel(req, res, next) {
    try {
      const institutionId = getTargetInstitutionId(req);
      const { id } = req.params;
      const { buffer, filename } = await institutionService.generateApplicationSummaryExcel(id, institutionId, req.user.assignedBranchIds);

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(buffer);
    } catch (err) {
      next(err);
    }
  },

  async exportAllApplicationsExcel(req, res, next) {
    try {
      const institutionId = getTargetInstitutionId(req);
      const { status, search } = req.query;
      const { buffer, filename } = await institutionService.exportAllApplicationsExcel({
        institutionId,
        status,
        search,
        assignedBranchIds: req.user.assignedBranchIds,
      });

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(buffer);
    } catch (err) {
      next(err);
    }
  },

  async requestCorrection(req, res, next) {
    try {
      const institutionId = getTargetInstitutionId(req);
      const { id } = req.params;
      const parsed = fieldCorrectionSchema.parse(req.body);

      const result = await institutionService.requestFieldCorrection({
        applicationId: id,
        institutionId,
        fieldKey: parsed.fieldKey,
        issueType: parsed.issueType,
        issueReason: parsed.issueReason,
        user: req.user,
        reqMeta: { ip: req.ip, userAgent: req.get("user-agent") },
      });

      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },

  async resolveCorrection(req, res, next) {
    try {
      const institutionId = getTargetInstitutionId(req);
      const { issueId } = req.params;
      const { resolutionNote } = req.body;

      const result = await institutionService.resolveFieldCorrection({
        issueId,
        resolutionNote,
        user: req.user,
        institutionId,
      });

      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async reviewApplication(req, res, next) {
    try {
      const institutionId = getTargetInstitutionId(req);
      const { id } = req.params;
      const parsed = applicationReviewSchema.parse(req.body);

      const result = await institutionService.reviewApplication({
        applicationId: id,
        institutionId,
        status: parsed.status,
        reviewComment: parsed.reviewComment,
        rejectionReason: parsed.rejectionReason,
        user: req.user,
        reqMeta: { ip: req.ip, userAgent: req.get("user-agent") },
      });

      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async viewDocument(req, res, next) {
    try {
      const institutionId = getTargetInstitutionId(req);
      const { id, docId } = req.params;

      const fileInfo = await institutionService.getApplicationDocumentFile({
        applicationId: id,
        documentId: docId,
        institutionId,
        assignedBranchIds: req.user.assignedBranchIds,
      });

      res.setHeader("Content-Type", fileInfo.mimeType);
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${encodeURIComponent(fileInfo.documentName)}"`
      );
      res.setHeader("Cache-Control", "private, no-cache, no-store, must-revalidate");
      res.setHeader("X-Content-Type-Options", "nosniff");

      const stream = fs.createReadStream(fileInfo.filePath);
      stream.pipe(res);
    } catch (err) {
      next(err);
    }
  },

  async listBranches(req, res, next) {
    try {
      const institutionId = getTargetInstitutionId(req);
      const { search, status, districtId, upazilaId, page, limit } = req.query;

      const data = await institutionService.listBranches({
        institutionId,
        search,
        status,
        districtId,
        upazilaId,
        page,
        limit,
      });

      res.json({ success: true, ...data });
    } catch (err) {
      next(err);
    }
  },

  async requestBranchCorrection(req, res, next) {
    try {
      const institutionId = getTargetInstitutionId(req);
      const parsed = branchCorrectionRequestSchema.parse(req.body);

      const result = await institutionService.requestBranchCorrection({
        institutionId,
        data: parsed,
        user: req.user,
        reqMeta: { ip: req.ip, userAgent: req.get("user-agent") },
      });

      res.status(202).json(result);
    } catch (err) {
      next(err);
    }
  },

  async listStaff(req, res, next) {
    try {
      const institutionId = getTargetInstitutionId(req);
      const data = await institutionService.listStaff(institutionId);
      res.json({ success: true, staff: data });
    } catch (err) {
      next(err);
    }
  },

  async assignStaffBranches(req, res, next) {
    try {
      const institutionId = getTargetInstitutionId(req);
      const { membershipId } = req.params;
      const parsed = staffBranchAssignmentSchema.parse(req.body);

      const result = await institutionService.assignStaffBranches({
        membershipId,
        branchIds: parsed.branchIds,
        user: req.user,
        institutionId,
      });

      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async createStaff(req, res, next) {
    try {
      const institutionId = getTargetInstitutionId(req);
      if (!institutionId) {
        return res.status(400).json({ success: false, message: "Institution ID is required." });
      }
      const payload = { ...req.body, institutionId: Number(institutionId) };
      const result = await adminInstitutionsService.provisionStaff(payload, req.user, {
        ip: req.ip,
        userAgent: req.get("user-agent"),
      });
      res.status(201).json({ success: true, message: "Staff user created successfully.", data: result });
    } catch (err) {
      next(err);
    }
  },

  async updateStaff(req, res, next) {
    try {
      const { membershipId } = req.params;
      const result = await adminInstitutionsService.updateStaffMembership(
        membershipId,
        req.body,
        req.user,
        { ip: req.ip, userAgent: req.get("user-agent") }
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async deleteStaff(req, res, next) {
    try {
      const membershipId = Number(req.params.membershipId);
      const staff = await adminInstitutionsService.getStaffMembership(membershipId);
      if (staff) {
        await trashService.moveToTrash({
          section: "staff",
          originalId: membershipId,
          title: staff.staff_name || staff.email || `Staff #${membershipId}`,
          description: `${staff.email || ""} • ${staff.institution_name || "Institution"} (${staff.role_name || "Staff"})`,
          scope: "both",
          deletedBy: req.user?.email || "Staff Admin",
          payload: staff,
        });
      }
      const result = await adminInstitutionsService.deleteStaffMembership(
        membershipId,
        req.user,
        { ip: req.ip, userAgent: req.get("user-agent") }
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async batchDeleteStaff(req, res, next) {
    try {
      const { membershipIds = [], scope = "both" } = req.body;
      let count = 0;
      for (const mId of membershipIds) {
        try {
          const staff = await adminInstitutionsService.getStaffMembership(Number(mId));
          if (staff) {
            await trashService.moveToTrash({
              section: "staff",
              originalId: mId,
              title: staff.staff_name || staff.email || `Staff #${mId}`,
              description: `${staff.email || ""} • ${staff.institution_name || "Institution"} (${staff.role_name || "Staff"})`,
              scope,
              deletedBy: req.user?.email || "Staff Admin",
              payload: staff,
            });
          }
          await adminInstitutionsService.deleteStaffMembership(Number(mId), req.user, {
            ip: req.ip,
            userAgent: req.get("user-agent"),
          });
          count++;
        } catch (_) {}
      }
      res.json({ success: true, count, message: `${count} staff member(s) moved to trash.` });
    } catch (err) {
      next(err);
    }
  },

  async listServices(req, res, next) {
    try {
      const institutionId = getTargetInstitutionId(req);
      const data = await institutionService.listServices(institutionId);
      res.json({ success: true, services: data });
    } catch (err) {
      next(err);
    }
  },

  async saveService(req, res, next) {
    try {
      const institutionId = getTargetInstitutionId(req);
      const parsed = institutionServiceSchema.parse(req.body);

      const result = await institutionService.saveService({
        institutionId,
        data: parsed,
        user: req.user,
      });

      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },

  async listConnections(req, res, next) {
    try {
      const institutionId = getTargetInstitutionId(req);
      const data = await institutionService.listConnections(institutionId);
      res.json({ success: true, connections: data });
    } catch (err) {
      next(err);
    }
  },

  async testConnection(req, res, next) {
    try {
      const institutionId = getTargetInstitutionId(req);
      const { serviceId } = req.params;

      const result = await institutionService.testConnection({
        institutionServiceId: serviceId,
        institutionId,
        user: req.user,
        reqMeta: { ip: req.ip, userAgent: req.get("user-agent") },
      });

      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async getReports(req, res, next) {
    try {
      const institutionId = getTargetInstitutionId(req);
      const data = await institutionService.getReports({ institutionId });
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  async getNotifications(req, res, next) {
    try {
      const institutionId = getTargetInstitutionId(req);
      const data = await institutionService.getNotifications(institutionId);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  async markNotificationRead(req, res, next) {
    try {
      const institutionId = getTargetInstitutionId(req);
      const { id } = req.params;
      const data = await institutionService.markNotificationRead(id, institutionId);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  async markAllNotificationsRead(req, res, next) {
    try {
      const institutionId = getTargetInstitutionId(req);
      const data = await institutionService.markAllNotificationsRead(institutionId);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  async createMerchant(req, res, next) {
    try {
      const institutionId = getTargetInstitutionId(req);
      const { fullName, companyName, email, phone, password, businessType } = req.body;
      if (!fullName || !companyName || !email || !phone) {
        return res.status(400).json({
          success: false,
          message: "Full name, company name, email and phone number are required.",
        });
      }

      const files = req.files || (req.file ? [req.file] : []);

      const result = await institutionService.createMerchant({
        institutionId,
        fullName,
        companyName,
        email,
        phone,
        password,
        businessType,
        files,
        user: req.user,
        reqMeta: { ip: req.ip, userAgent: req.get("user-agent") },
      });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },

  async deleteMerchant(req, res, next) {
    try {
      const institutionId = getTargetInstitutionId(req);
      const { id, merchantId } = req.params;
      // id could be application id (if on /applications/:id/merchant) or merchant id
      const result = await institutionService.deleteMerchant({
        merchantId: merchantId ? Number(merchantId) : undefined,
        applicationId: id ? Number(id) : undefined,
        institutionId,
        user: req.user,
        reqMeta: { ip: req.ip, userAgent: req.get("user-agent") },
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async listApprovedMerchantsForQr(req, res, next) {
    try {
      const institutionId = getTargetInstitutionId(req);
      const { search } = req.query;
      const data = await institutionService.listApprovedMerchantsForQr({
        institutionId,
        search,
        assignedBranchIds: req.user.assignedBranchIds,
      });
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  async uploadMerchantQrCode(req, res, next) {
    try {
      const institutionId = getTargetInstitutionId(req);
      const { merchantId } = req.params;
      const file = req.file;

      const result = await institutionService.uploadMerchantQrCode({
        merchantId: Number(merchantId),
        institutionId,
        file,
        user: req.user,
        reqMeta: { ip: req.ip, userAgent: req.get("user-agent") },
      });

      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },

  // ==========================================
  // SUPPORT TICKETS (INSTITUTION / BANK)
  // ==========================================
  async listSupportTickets(req, res, next) {
    try {
      const institutionId = getTargetInstitutionId(req);
      const { status, priority, search, page, limit } = req.query;
      const data = await institutionService.listSupportTickets({
        institutionId,
        status,
        priority,
        search,
        page,
        limit,
      });
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  async getSupportTicket(req, res, next) {
    try {
      const institutionId = getTargetInstitutionId(req);
      const { id } = req.params;
      const data = await institutionService.getSupportTicketById(id, institutionId);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  async replySupportTicket(req, res, next) {
    try {
      const institutionId = getTargetInstitutionId(req);
      const { id } = req.params;
      const { message, status } = req.body;

      if (!message || !message.trim()) {
        return res.status(400).json({ success: false, message: "Reply message is required" });
      }

      const result = await institutionService.replySupportTicket({
        ticketId: id,
        institutionId,
        user: req.user,
        message,
        status,
        reqMeta: { ip: req.ip, userAgent: req.get("user-agent") },
      });

      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },

  async updateSupportTicketStatus(req, res, next) {
    try {
      const institutionId = getTargetInstitutionId(req);
      const { id } = req.params;
      const { status } = req.body;

      const result = await institutionService.updateSupportTicketStatus(id, institutionId, status);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
};

