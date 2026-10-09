import { cmsService } from "./cms.service.js";

export const cmsController = {
  async getHomepage(req, res, next) {
    try {
      const data = await cmsService.getHomepageForAdmin();
      res.json({
        success: true,
        data,
      });
    } catch (err) {
      next(err);
    }
  },

  async saveDraft(req, res, next) {
    try {
      const draftContent = req.body;
      const updated = await cmsService.saveDraft(draftContent, req.user.id);
      res.json({
        success: true,
        message: "CMS Homepage draft saved successfully",
        data: updated,
      });
    } catch (err) {
      next(err);
    }
  },

  async publishDraft(req, res, next) {
    try {
      const contentToPublish = req.body && Object.keys(req.body).length > 0 ? req.body : null;
      const updated = await cmsService.publishDraft(contentToPublish, req.user.id);
      res.json({
        success: true,
        message: "CMS Homepage published successfully",
        data: updated,
      });
    } catch (err) {
      next(err);
    }
  },

  async uploadMedia(req, res, next) {
    try {
      const uploaded = await cmsService.uploadPublicMedia(req.file);
      res.json({
        success: true,
        message: "Media uploaded successfully",
        data: uploaded,
      });
    } catch (err) {
      next(err);
    }
  },

  async getPublicHomepage(req, res, next) {
    try {
      const data = await cmsService.getPublicHomepage();
      res.json({
        success: true,
        data: data.content,
        isPublished: data.isPublished,
        publishedAt: data.publishedAt,
      });
    } catch (err) {
      next(err);
    }
  },
};

