import { adminKycRepository } from "./admin.kyc.repository.js";
import { adminMerchantsService } from "../merchants/admin.merchants.service.js";

export const adminKycService = {
  async listKyc(filters) {
    return await adminKycRepository.listKyc(filters);
  },

  async getKycDetails(merchantId) {
    const data = await adminKycRepository.getKycByMerchantId(merchantId);
    if (!data) {
      const err = new Error("KYC record not found");
      err.statusCode = 404;
      throw err;
    }
    return data;
  },

  async reviewKyc(payload) {
    return await adminMerchantsService.reviewMerchant(payload);
  },
};

