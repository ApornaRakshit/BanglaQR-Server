import { formBuilderService } from "./formBuilder.service.js";
import {
  createDraftSchema,
  saveSectionSchema,
  reorderSectionsSchema,
  saveFieldSchema,
  reorderFieldsSchema,
} from "./formBuilder.validation.js";

export const formBuilderController = {
  /**
   * Get form versions list & current published/draft states
   */
  async getVersions(req, res, next) {
    try {
      const formKey = req.query.formKey || "onboarding_company";
      const data = await formBuilderService.getVersions(formKey);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  /**
   * Get specific version details
   */
  async getVersionDetails(req, res, next) {
    try {
      const versionId = Number(req.params.versionId);
      const data = await formBuilderService.getVersionDetails(versionId);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  /**
   * Create a new draft (blank or cloned from published)
   */
  async createDraft(req, res, next) {
    try {
      const validated = createDraftSchema.parse(req.body);
      const data = await formBuilderService.createDraft(req.user.id, validated.formKey, validated.fromVersionId);
      res.status(201).json({ success: true, message: "Draft version created successfully.", data });
    } catch (err) {
      next(err);
    }
  },

  /**
   * Idempotent bootstrap of initial draft from standard onboarding form
   */
  async bootstrap(req, res, next) {
    try {
      const formKey = req.body?.formKey || "onboarding_company";
      const data = await formBuilderService.bootstrapInitialDraft(req.user.id, formKey);
      res.json({ success: true, message: "Initial form draft bootstrapped successfully.", data });
    } catch (err) {
      next(err);
    }
  },

  /**
   * Save a section inside a draft
   */
  async saveSection(req, res, next) {
    try {
      const versionId = Number(req.params.versionId);
      const sectionIdParam = req.params.sectionId ? Number(req.params.sectionId) : undefined;
      const validated = saveSectionSchema.parse({
        ...req.body,
        id: sectionIdParam || req.body.id,
      });
      const sectionId = await formBuilderService.saveSection(versionId, validated);
      res.json({ success: true, message: "Section saved successfully.", data: { sectionId } });
    } catch (err) {
      next(err);
    }
  },

  /**
   * Delete a section from a draft
   */
  async deleteSection(req, res, next) {
    try {
      const versionId = Number(req.params.versionId);
      const sectionId = Number(req.params.sectionId);
      await formBuilderService.deleteSection(versionId, sectionId);
      res.json({ success: true, message: "Section deleted successfully." });
    } catch (err) {
      next(err);
    }
  },

  /**
   * Reorder sections within a draft
   */
  async reorderSections(req, res, next) {
    try {
      const versionId = Number(req.params.versionId);
      const validated = reorderSectionsSchema.parse(req.body);
      await formBuilderService.reorderSections(versionId, validated.sectionIds);
      res.json({ success: true, message: "Sections reordered successfully." });
    } catch (err) {
      next(err);
    }
  },

  /**
   * Save a field (with options and rules) inside a draft
   */
  async saveField(req, res, next) {
    try {
      const versionId = Number(req.params.versionId);
      const fieldIdParam = req.params.fieldId ? Number(req.params.fieldId) : undefined;
      const validated = saveFieldSchema.parse({
        ...req.body,
        id: fieldIdParam || req.body.id,
      });
      const fieldId = await formBuilderService.saveField(versionId, validated);
      res.json({ success: true, message: "Field saved successfully.", data: { fieldId } });
    } catch (err) {
      next(err);
    }
  },

  /**
   * Delete a field from a draft
   */
  async deleteField(req, res, next) {
    try {
      const versionId = Number(req.params.versionId);
      const fieldId = Number(req.params.fieldId);
      await formBuilderService.deleteField(versionId, fieldId);
      res.json({ success: true, message: "Field deleted successfully." });
    } catch (err) {
      next(err);
    }
  },

  /**
   * Reorder fields in a section
   */
  async reorderFields(req, res, next) {
    try {
      const versionId = Number(req.params.versionId);
      const sectionIdParam = req.params.sectionId ? Number(req.params.sectionId) : undefined;
      const validated = reorderFieldsSchema.parse({
        ...req.body,
        sectionId: sectionIdParam || req.body.sectionId,
      });
      await formBuilderService.reorderFields(versionId, validated.sectionId, validated.fieldIds);
      res.json({ success: true, message: "Fields reordered successfully." });
    } catch (err) {
      next(err);
    }
  },

  /**
   * Preview a version by segment and channel
   */
  async previewVersion(req, res, next) {
    try {
      const versionId = Number(req.params.versionId);
      const merchantSegment = req.query.merchantSegment || "micro";
      const channel = req.query.channel || "bank";
      const data = await formBuilderService.previewVersion(versionId, { merchantSegment, channel });
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  /**
   * Publish a draft version
   */
  async publishDraft(req, res, next) {
    try {
      const versionId = Number(req.params.versionId);
      const data = await formBuilderService.publishDraft(req.user.id, versionId);
      res.json({ success: true, message: "Form version published successfully.", data });
    } catch (err) {
      next(err);
    }
  },

  /**
   * Discard an unpublished draft
   */
  async discardDraft(req, res, next) {
    try {
      const versionId = Number(req.params.versionId);
      const result = await formBuilderService.discardDraft(versionId);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
};

