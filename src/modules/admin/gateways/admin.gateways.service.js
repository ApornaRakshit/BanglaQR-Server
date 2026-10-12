import { db } from "../../../config/db.js";
import { adminGatewaysRepository } from "./admin.gateways.repository.js";
import { logAdminAudit } from "../../../utils/auditLogger.js";

export const adminGatewaysService = {
  async getGatewayStats() {
    return await adminGatewaysRepository.getGatewayStats();
  },

  async listGateways(filters = {}) {
    return await adminGatewaysRepository.listGateways(filters);
  },

  async getGateway(id) {
    const g = await adminGatewaysRepository.getGatewayById(id);
    if (!g) {
      const err = new Error("Gateway not found");
      err.statusCode = 404;
      throw err;
    }
    return g;
  },

  async createGateway(data, adminUser, ip, userAgent) {
    const id = await adminGatewaysRepository.createGateway(data);
    await logAdminAudit({
      userId: adminUser?.id,
      adminEmail: adminUser?.email,
      action: "gateway_create",
      resourceType: "gateway",
      resourceId: id,
      details: { name: data.name, code: data.code, serviceFee: data.serviceFee },
      ip,
      userAgent,
    });
    return { success: true, message: "Gateway created successfully", id };
  },

  async updateGateway(id, data, adminUser, ip, userAgent) {
    await adminGatewaysRepository.updateGateway(id, data);
    await logAdminAudit({
      userId: adminUser?.id,
      adminEmail: adminUser?.email,
      action: "gateway_update",
      resourceType: "gateway",
      resourceId: id,
      details: { name: data.name, code: data.code, status: data.status },
      ip,
      userAgent,
    });
    return { success: true, message: "Gateway updated successfully" };
  },

  async updateGatewayStatus(id, status, adminUser, ip, userAgent) {
    await adminGatewaysRepository.updateGatewayStatus(id, status);
    await logAdminAudit({
      userId: adminUser?.id,
      adminEmail: adminUser?.email,
      action: "gateway_status_update",
      resourceType: "gateway",
      resourceId: id,
      details: { status },
      ip,
      userAgent,
    });
    return { success: true, message: `Gateway status updated to ${status}.` };
  },

  async updateGatewayPublish(id, publishData, adminUser, ip, userAgent) {
    await adminGatewaysRepository.updateGatewayPublish(id, publishData.isPublished, publishData.acceptsApplications);
    await logAdminAudit({
      userId: adminUser?.id,
      adminEmail: adminUser?.email,
      action: "gateway_publish_update",
      resourceType: "gateway",
      resourceId: id,
      details: publishData,
      ip,
      userAgent,
    });
    return { success: true, message: "Gateway publish settings updated." };
  },

  async deleteGateway(id, adminUser, ip, userAgent) {
    const result = await adminGatewaysRepository.deleteGateway(id);
    await logAdminAudit({
      userId: adminUser?.id,
      adminEmail: adminUser?.email,
      action: "gateway_delete",
      resourceType: "gateway",
      resourceId: id,
      details: result,
      ip,
      userAgent,
    });
    return { success: true, message: result.message, softDeleted: false, deleted: true };
  },

  async listApplications(filters = {}) {
    return await adminGatewaysRepository.listApplications(filters);
  },

  async reviewApplication({
    applicationId,
    action,
    reviewNote,
    adminUser,
    ip,
    userAgent,
  }) {
    const app = await adminGatewaysRepository.getApplicationById(applicationId);
    if (!app) {
      const err = new Error("Gateway application not found");
      err.statusCode = 404;
      throw err;
    }

    let normalizedAction = action;
    if (action === "approved") normalizedAction = "approve";
    if (action === "rejected") normalizedAction = "reject";
    if (action === "additional_information_required" || action === "request_info") normalizedAction = "request_information";

    let newStatus = app.status;
    if (normalizedAction === "approve") {
      newStatus = "approved";
      await adminGatewaysRepository.updateApplicationStatus(applicationId, "approved", reviewNote);
      await adminGatewaysRepository.provisionGatewayService(app.merchantId, app.gatewayId, app.serviceType);

      // Notify merchant
      try {
        await db.execute(
          `INSERT INTO notifications (recipient_type, recipient_id, title, message, type, link, is_read, created_at)
           VALUES ('merchant', ?, ?, ?, 'gateway', '/merchant/services', 0, NOW())`,
          [
            app.userId,
            `Gateway Application Approved: ${app.gatewayName}`,
            `Your application for ${app.gatewayName} has been approved. You can now configure and integrate this service.`
          ]
        );
      } catch {}
    } else if (normalizedAction === "reject") {
      newStatus = "rejected";
      await adminGatewaysRepository.updateApplicationStatus(applicationId, "rejected", reviewNote);

      // Notify merchant
      try {
        await db.execute(
          `INSERT INTO notifications (recipient_type, recipient_id, title, message, type, link, is_read, created_at)
           VALUES ('merchant', ?, ?, ?, 'gateway', '/merchant/applications', 0, NOW())`,
          [
            app.userId,
            `Gateway Application Update: ${app.gatewayName}`,
            reviewNote ? `Your application for ${app.gatewayName} was not approved: ${reviewNote}` : `Your application for ${app.gatewayName} was not approved.`
          ]
        );
      } catch {}
    } else if (normalizedAction === "request_information") {
      newStatus = "additional_information_required";
      await adminGatewaysRepository.updateApplicationStatus(applicationId, "additional_information_required", reviewNote);

      // Notify merchant
      try {
        await db.execute(
          `INSERT INTO notifications (recipient_type, recipient_id, title, message, type, link, is_read, created_at)
           VALUES ('merchant', ?, ?, ?, 'gateway', '/merchant/applications', 0, NOW())`,
          [
            app.userId,
            `Additional Information Needed: ${app.gatewayName}`,
            reviewNote || `Please provide additional details regarding your application for ${app.gatewayName}.`
          ]
        );
      } catch {}
    } else if (normalizedAction === "under_review") {
      newStatus = "under_review";
      await adminGatewaysRepository.updateApplicationStatus(applicationId, "under_review", reviewNote);
    } else {
      const err = new Error(`Unsupported application review action: ${action}`);
      err.statusCode = 400;
      throw err;
    }

    await logAdminAudit({
      userId: adminUser?.id,
      adminEmail: adminUser?.email,
      action: `gateway_application_${normalizedAction}`,
      resourceType: "gateway_application",
      resourceId: applicationId,
      merchantId: app.merchantId,
      details: { previousStatus: app.status, newStatus, reviewNote },
      ip,
      userAgent,
    });

    return {
      success: true,
      message: `Gateway application ${normalizedAction} successfully`,
      applicationId,
      status: newStatus,
    };
  },

  async listServices(filters = {}) {
    return await adminGatewaysRepository.listServices(filters);
  },

  async updateServiceStatus(serviceId, status, adminUser, ip, userAgent) {
    await adminGatewaysRepository.updateServiceStatus(serviceId, status);
    await logAdminAudit({
      userId: adminUser?.id,
      adminEmail: adminUser?.email,
      action: `gateway_service_status_${status}`,
      resourceType: "gateway_service",
      resourceId: serviceId,
      details: { status },
      ip,
      userAgent,
    });
    return { success: true, message: `Service status updated to ${status}` };
  },
};
