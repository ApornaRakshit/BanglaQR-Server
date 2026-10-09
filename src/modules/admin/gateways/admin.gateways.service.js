import { adminGatewaysRepository } from "./admin.gateways.repository.js";
import { logAdminAudit } from "../../../utils/auditLogger.js";

export const adminGatewaysService = {
  async listGateways() {
    return await adminGatewaysRepository.listGateways();
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

  async deleteGateway(id, adminUser, ip, userAgent) {
    await adminGatewaysRepository.deleteGateway(id);
    await logAdminAudit({
      userId: adminUser?.id,
      adminEmail: adminUser?.email,
      action: "gateway_delete",
      resourceType: "gateway",
      resourceId: id,
      details: null,
      ip,
      userAgent,
    });
    return { success: true, message: "Gateway deleted successfully" };
  },

  async listApplications(filters) {
    return await adminGatewaysRepository.listApplications(filters);
  },

  async listServices(filters) {
    return await adminGatewaysRepository.listServices(filters);
  },
};

