import { institutionService } from "./institution.service.js";
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
    return req.query?.institutionId || req.headers?.["x-institution-id"] || req.user?.institutionId || 1;
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
};

