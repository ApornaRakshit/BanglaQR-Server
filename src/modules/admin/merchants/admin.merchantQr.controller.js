import { adminMerchantQrRepository } from "./admin.merchantQr.repository.js";

export const adminMerchantQrController = {
  async listApprovedMerchantsForQr(req, res, next) {
    try {
      const search = req.query.search;
      const data = await adminMerchantQrRepository.listApprovedMerchantsForQr({ search });
      res.json({
        success: true,
        data,
      });
    } catch (err) {
      next(err);
    }
  },

  async uploadMerchantQrCode(req, res, next) {
    try {
      const { merchantId } = req.params;
      const file = req.file;

      if (!file) {
        return res.status(400).json({
          success: false,
          message: "Please attach a valid QR image or PDF file.",
        });
      }

      const result = await adminMerchantQrRepository.saveMerchantQrCode({
        merchantId,
        file,
        user: req.user,
        reqMeta: {
          ip: req.ip,
          userAgent: req.get("User-Agent"),
        },
      });

      res.json(result);
    } catch (err) {
      next(err);
    }
  },
};
