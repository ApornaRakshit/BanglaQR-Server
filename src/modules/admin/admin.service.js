import { adminRepository } from "./admin.repository.js";

export const adminService = {
  async getDashboardData({ user, timeframe = "30days" }) {
    const role = user?.role || "admin";

    // Run queries concurrently for optimal performance
    const [
      stats,
      registrationTrend,
      applicationStatus,
      pendingApplications,
      recentMerchants,
      kycQueue,
      documentQueue,
      recentActivity,
    ] = await Promise.all([
      adminRepository.getStats(),
      adminRepository.getRegistrationTrend(timeframe),
      adminRepository.getApplicationStatusDistribution(),
      adminRepository.getPendingApplications(10),
      adminRepository.getRecentMerchants(10),
      adminRepository.getKycStatusDistribution(),
      adminRepository.getDocumentStatusDistribution(),
      adminRepository.getRecentActivity(10),
    ]);

    return {
      stats,
      registrationTrend,
      applicationStatus,
      pendingApplications,
      recentMerchants,
      kycQueue,
      documentQueue,
      recentActivity,
      userRole: role,
    };
  },
};

