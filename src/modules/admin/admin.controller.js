import { adminService } from "./admin.service.js";
import { getDashboardSchema } from "./admin.validation.js";

export const adminController = {
  async getDashboard(req, res, next) {
    try {
      const { timeframe } = getDashboardSchema.parse(req.query);

      const data = await adminService.getDashboardData({
        user: req.user,
        timeframe,
      });

      res.json({
        success: true,
        data,
      });
    } catch (error) {
      next(error);
    }
  },

  async globalSearch(req, res, next) {
    try {
      const { q } = req.query;
      const results = await adminService.globalSearch(q || "");
      res.json({
        success: true,
        data: results,
      });
    } catch (error) {
      next(error);
    }
  },
};

