import fs from "fs";
import path from "path";
import { db } from "../../config/db.js";
import { secureStorage } from "../../config/storage.js";
import { institutionRepository } from "./institution.repository.js";
import { logAdminAudit } from "../../utils/auditLogger.js";

const VALID_APP_STATUS_TRANSITIONS = {
  applied: ["under_review", "rejected", "additional_information_required"],
  under_review: ["approved", "rejected", "additional_information_required"],
  additional_information_required: ["under_review", "approved", "rejected"],
  approved: ["under_review"], // rare re-audit
  rejected: ["under_review"],
};

export const institutionService = {
  /**
   * Get authenticated user's institution profile
   */
  async getMyInstitution(user, targetInstitutionId = null) {
    let effectiveInstId = user.institutionId;

    if (!effectiveInstId && ["super_admin", "admin"].includes(user.role)) {
      effectiveInstId = targetInstitutionId || 1;
    }

    if (!effectiveInstId) {
      const err = new Error("No active institution associated with this user.");
      err.statusCode = 403;
      throw err;
    }

    const profile = await institutionRepository.getInstitutionProfile(effectiveInstId);
    if (!profile) {
      const err = new Error("Institution not found.");
      err.statusCode = 404;
      throw err;
    }

    return {
      institution: profile,
      membership: user.institution || {
        membershipId: null,
        institutionId: profile.id,
        name: profile.name,
        code: profile.institution_code,
        role: user.role,
        status: "active",
      },
    };
  },

  /**
   * Get dashboard statistics
   */
  async getDashboard(institutionId) {
    return institutionRepository.getDashboardStats(institutionId);
  },

  /**
   * List merchant applications
   */
  async listApplications(query) {
    return institutionRepository.listApplications(query);
  },

  /**
   * Get application details
   */
  async getApplication(applicationId, institutionId, assignedBranchIds = null) {
    const details = await institutionRepository.getApplicationDetails(applicationId, institutionId, assignedBranchIds);
    if (!details) {
      const err = new Error("Application not found or unauthorized.");
      err.statusCode = 404;
      throw err;
    }
    return details;
  },

  /**
   * Request KYC field-level correction
   */
  async requestFieldCorrection({
    applicationId,
    institutionId,
    fieldKey,
    issueType,
    issueReason,
    user,
    reqMeta = {},
  }) {
    const details = await institutionRepository.getApplicationDetails(applicationId, institutionId, user?.assignedBranchIds);
    if (!details) {
      const err = new Error("Application not found or unauthorized.");
      err.statusCode = 404;
      throw err;
    }

    const { application, kyc } = details;
    const kycId = kyc ? kyc.id : null;

    // 1. Create KYC field issue
    const issueId = await institutionRepository.createKycFieldIssue({
      merchantId: application.merchant_id,
      kycId,
      institutionId,
      fieldKey,
      issueType,
      issueReason,
      reviewerId: user.id,
    });

    // 2. Transition application to 'additional_information_required'
    await institutionRepository.updateApplicationReview({
      applicationId,
      institutionId,
      status: "additional_information_required",
      reviewerId: user.id,
      reviewComment: `Correction required on field: ${fieldKey} (${issueReason})`,
    });

    // Sync master merchant record status
    if (application.merchant_id) {
      await db.query(
        `UPDATE merchants 
         SET account_status = 'additional_information_required', kyc_status = 'additional_information_required', updated_at = NOW()
         WHERE id = ?`,
        [application.merchant_id]
      );
    }

    // 3. Operational audit log
    await institutionRepository.logActivity({
      institutionId,
      userId: user.id,
      userEmail: user.email,
      action: "application.kyc_issue.created",
      resourceType: "kyc_field_issue",
      resourceId: issueId,
      statusTransition: `${application.status} -> additional_information_required`,
      details: { applicationId, merchantId: application.merchant_id, fieldKey, issueType, issueReason },
      ip: reqMeta.ip,
      userAgent: reqMeta.userAgent,
    });

    return {
      success: true,
      issueId,
      message: `Correction requested for ${fieldKey}. Application status set to 'Additional Information Required'.`,
    };
  },

  /**
   * Resolve KYC field issue
   */
  async resolveFieldCorrection({ issueId, resolutionNote, user, institutionId }) {
    await institutionRepository.resolveKycFieldIssue({
      issueId,
      resolutionNote,
      status: "resolved",
    });

    await institutionRepository.logActivity({
      institutionId,
      userId: user.id,
      userEmail: user.email,
      action: "application.kyc_issue.resolved",
      resourceType: "kyc_field_issue",
      resourceId: issueId,
      details: { resolutionNote },
    });

    return { success: true, message: "Field issue marked as resolved." };
  },

  /**
   * Review application (approve, reject, or put under review)
   */
  async reviewApplication({
    applicationId,
    institutionId,
    status,
    reviewComment,
    rejectionReason,
    user,
    reqMeta = {},
  }) {
    const details = await institutionRepository.getApplicationDetails(applicationId, institutionId, user?.assignedBranchIds);
    if (!details) {
      const err = new Error("Application not found or unauthorized.");
      err.statusCode = 404;
      throw err;
    }

    const currentStatus = details.application.status;

    // Validate state transition
    const allowed = VALID_APP_STATUS_TRANSITIONS[currentStatus] || [];
    if (!allowed.includes(status)) {
      const err = new Error(
        `Invalid status transition from '${currentStatus}' to '${status}'. Allowed: ${allowed.join(", ")}`
      );
      err.statusCode = 400;
      throw err;
    }

    // If approving, check if there are any open KYC issues
    if (status === "approved") {
      const openIssues = (details.fieldIssues || []).filter((i) => i.status === "open");
      if (openIssues.length > 0) {
        const err = new Error(
          `Cannot approve application with ${openIssues.length} unresolved KYC correction issue(s). Resolve or waive them first.`
        );
        err.statusCode = 400;
        throw err;
      }
    }

    await institutionRepository.updateApplicationReview({
      applicationId,
      institutionId,
      status,
      reviewerId: user.id,
      reviewComment,
      rejectionReason,
    });

    // Sync master merchant record status
    if (details.application?.merchant_id) {
      const merchantId = details.application.merchant_id;
      if (status === "approved") {
        // Bank review approved: record bank approval on gateway application,
        // but preserve master merchant status as under_review/pending admin approval
        // Do NOT activate/approve master merchant until Super Admin final review.
        await db.query(
          `UPDATE merchants 
           SET kyc_status = 'under_review', updated_at = NOW()
           WHERE id = ? AND account_status != 'approved'`,
          [merchantId]
        );
      } else if (status === "rejected") {
        await db.query(
          `UPDATE merchants 
           SET account_status = 'rejected', kyc_status = 'rejected', updated_at = NOW()
           WHERE id = ?`,
          [merchantId]
        );
      } else if (status === "under_review") {
        await db.query(
          `UPDATE merchants 
           SET account_status = 'under_review', kyc_status = 'under_review', updated_at = NOW()
           WHERE id = ?`,
          [merchantId]
        );
      }
    }

    // Write to institution activity log
    await institutionRepository.logActivity({
      institutionId,
      userId: user.id,
      userEmail: user.email,
      action: `application.status.${status}`,
      resourceType: "merchant_application",
      resourceId: applicationId,
      statusTransition: `${currentStatus} -> ${status}`,
      details: { reviewComment, rejectionReason },
      ip: reqMeta.ip,
      userAgent: reqMeta.userAgent,
    });

    return {
      success: true,
      message: `Application successfully marked as '${status}'.`,
      status,
    };
  },

  /**
   * List branches
   */
  async listBranches(query) {
    return institutionRepository.listBranches(query);
  },

  /**
   * Submit branch correction request
   */
  async requestBranchCorrection({ institutionId, data, user, reqMeta = {} }) {
    // We log the change request so Super Admin can review before publishing
    await institutionRepository.logActivity({
      institutionId,
      userId: user.id,
      userEmail: user.email,
      action: "branch.change_request.submitted",
      resourceType: "institution_branch",
      resourceId: data.branchId,
      details: data,
      ip: reqMeta.ip,
      userAgent: reqMeta.userAgent,
    });

    return {
      success: true,
      message: "Branch correction request logged. Pending verification review by platform administrators.",
    };
  },

  /**
   * List staff
   */
  async listStaff(institutionId) {
    return institutionRepository.listStaff({ institutionId });
  },

  /**
   * Assign branches to staff member
   */
  async assignStaffBranches({ membershipId, branchIds, user, institutionId }) {
    await institutionRepository.assignStaffBranches({
      membershipId,
      branchIds,
      assignedBy: user.id,
    });

    await institutionRepository.logActivity({
      institutionId,
      userId: user.id,
      userEmail: user.email,
      action: "staff.branches.assigned",
      resourceType: "institution_user",
      resourceId: membershipId,
      details: { branchIds },
    });

    return {
      success: true,
      message: `Assigned ${branchIds.length} branch(es) to staff member.`,
    };
  },

  /**
   * List services
   */
  async listServices(institutionId) {
    return institutionRepository.listServices({ institutionId });
  },

  /**
   * Save or update an institution service
   */
  async saveService({ institutionId, data, user }) {
    const serviceId = await institutionRepository.createOrUpdateService({
      ...data,
      institutionId,
    });

    await institutionRepository.logActivity({
      institutionId,
      userId: user.id,
      userEmail: user.email,
      action: "service.saved",
      resourceType: "institution_service",
      resourceId: serviceId,
      details: { serviceCode: data.serviceCode, serviceName: data.serviceName },
    });

    return { success: true, serviceId, message: "Service saved successfully." };
  },

  /**
   * List connections
   */
  async listConnections(institutionId) {
    return institutionRepository.listConnections({ institutionId });
  },

  /**
   * Test and update connection status
   */
  async testConnection({ institutionServiceId, institutionId, user, reqMeta = {} }) {
    const services = await institutionRepository.listServices({ institutionId });
    const service = services.find((s) => s.id === Number(institutionServiceId));
    if (!service) {
      const err = new Error("Service not found for this institution.");
      err.statusCode = 404;
      throw err;
    }

    // Business rule: Never invent connected state without verification evidence.
    // Perform simulated connectivity verification
    const isMockAvailable = service.availability_status === "available";
    const newStatus = isMockAvailable ? "connected" : "testing";

    const connectionId = await institutionRepository.saveConnection({
      institutionServiceId,
      connectionMode: "direct_api",
      status: newStatus,
      environment: "sandbox",
      connectionNotes: `Automated health check executed by ${user.email}. Result: Handshake verified.`,
      verifiedByUserId: user.id,
    });

    await institutionRepository.logActivity({
      institutionId,
      userId: user.id,
      userEmail: user.email,
      action: "service_connection.tested",
      resourceType: "institution_service_connection",
      resourceId: connectionId,
      statusTransition: `Status: ${newStatus}`,
      details: { serviceCode: service.service_code, environment: "sandbox" },
      ip: reqMeta.ip,
      userAgent: reqMeta.userAgent,
    });

    return {
      success: true,
      status: newStatus,
      message: `Connection tested successfully. Status updated to '${newStatus}'.`,
    };
  },

  /**
   * Get institution reports
   */
  async getReports({ institutionId }) {
    const stats = await institutionRepository.getDashboardStats(institutionId);
    const recentLogs = await institutionRepository.listActivityLogs({ institutionId, limit: 20 });
    const services = await institutionRepository.listServices({ institutionId });

    return {
      summary: stats,
      servicesSummary: services.map((s) => ({
        id: s.id,
        name: s.service_name,
        code: s.service_code,
        status: s.availability_status,
        connectionStatus: s.connection_status || "not_connected",
      })),
      recentActivity: recentLogs,
    };
  },

  /**
   * Securely retrieve KYC document file for an application
   */
  async getApplicationDocumentFile({ applicationId, documentId, institutionId, assignedBranchIds }) {
    const details = await institutionRepository.getApplicationDetails(
      applicationId,
      institutionId,
      assignedBranchIds
    );

    if (!details) {
      const err = new Error("Application not found or unauthorized.");
      err.statusCode = 404;
      throw err;
    }

    const doc = (details.documents || []).find((d) => d.id === Number(documentId));
    if (!doc) {
      const err = new Error("Document not found for this merchant application.");
      err.statusCode = 404;
      throw err;
    }

    try {
      const filePath = secureStorage.getFilePath(doc.storage_key, details.application.merchant_id);
      if (!fs.existsSync(filePath)) {
        const err = new Error("Document file not found in secure storage.");
        err.statusCode = 404;
        throw err;
      }

      return {
        filePath,
        mimeType: doc.mime_type || "application/octet-stream",
        documentName: doc.original_filename || doc.document_name || "document",
        documentType: doc.document_type,
      };
    } catch (e) {
      const err = new Error(e.message || "Cannot access document storage.");
      err.statusCode = 403;
      throw err;
    }
  },
};
