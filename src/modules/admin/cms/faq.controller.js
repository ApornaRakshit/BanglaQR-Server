import { faqService } from "./faq.service.js";

export const faqController = {
  // Public: GET /api/v1/public/faqs & /api/v1/faqs
  async getPublicFaqs(req, res, next) {
    try {
      res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
      res.set("Pragma", "no-cache");
      res.set("Expires", "0");

      const faqs = await faqService.getPublishedFaqs();
      res.json({
        success: true,
        count: faqs.length,
        data: faqs,
      });
    } catch (err) {
      next(err);
    }
  },

  // Admin: GET /api/v1/admin/faqs
  async listAdminFaqs(req, res, next) {
    try {
      const { search, status } = req.query;
      const faqs = await faqService.getAllFaqs({ search, status });
      res.json({
        success: true,
        count: faqs.length,
        data: faqs,
      });
    } catch (err) {
      next(err);
    }
  },

  // Admin: GET /api/v1/admin/faqs/:id
  async getById(req, res, next) {
    try {
      const faq = await faqService.getById(req.params.id);
      res.json({
        success: true,
        data: faq,
      });
    } catch (err) {
      next(err);
    }
  },

  // Admin: POST /api/v1/admin/faqs
  async create(req, res, next) {
    try {
      const created = await faqService.create(req.body);
      res.status(201).json({
        success: true,
        message: "নতুন FAQ সফলভাবে যুক্ত করা হয়েছে।",
        data: created,
      });
    } catch (err) {
      next(err);
    }
  },

  // Admin: PUT /api/v1/admin/faqs/:id
  async update(req, res, next) {
    try {
      const updated = await faqService.update(req.params.id, req.body);
      res.json({
        success: true,
        message: "FAQ সফলভাবে আপডেট করা হয়েছে।",
        data: updated,
      });
    } catch (err) {
      next(err);
    }
  },

  // Admin: DELETE /api/v1/admin/faqs/:id
  async delete(req, res, next) {
    try {
      const result = await faqService.delete(req.params.id);
      res.json({
        success: true,
        message: "FAQ সফলভাবে মুছে ফেলা হয়েছে।",
        data: result,
      });
    } catch (err) {
      next(err);
    }
  },

  // Admin: PATCH /api/v1/admin/faqs/:id/status
  async updateStatus(req, res, next) {
    try {
      const { status } = req.body;
      const updated = await faqService.updateStatus(req.params.id, status);
      res.json({
        success: true,
        message: `FAQ সফলভাবে ${status === "published" ? "প্রকাশিত (Published)" : "ড্রাফট (Draft)"} করা হয়েছে।`,
        data: updated,
      });
    } catch (err) {
      next(err);
    }
  },

  // Admin: PATCH /api/v1/admin/faqs/reorder
  async reorder(req, res, next) {
    try {
      const { items } = req.body;
      const reorderedList = await faqService.reorder(items);
      res.json({
        success: true,
        message: "FAQ প্রদর্শনের ক্রম সফলভাবে সংরক্ষণ করা হয়েছে।",
        data: reorderedList,
      });
    } catch (err) {
      next(err);
    }
  },
};

