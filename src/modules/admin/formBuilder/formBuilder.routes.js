import express from "express";
import { formBuilderController } from "./formBuilder.controller.js";
import { requirePermission } from "../../../middlewares/permission.js";

const router = express.Router();

// Form versions
router.get("/versions", requirePermission("merchant.view"), formBuilderController.getVersions);
router.post("/draft", requirePermission("merchant.create"), formBuilderController.createDraft);
router.post("/versions/draft", requirePermission("merchant.create"), formBuilderController.createDraft);
router.post("/bootstrap", requirePermission("merchant.create"), formBuilderController.bootstrap);
router.get("/versions/:versionId", requirePermission("merchant.view"), formBuilderController.getVersionDetails);
router.post("/versions/:versionId/publish", requirePermission("merchant.approve"), formBuilderController.publishDraft);
router.delete("/versions/:versionId/discard", requirePermission("merchant.edit"), formBuilderController.discardDraft);
router.delete("/versions/:versionId/draft", requirePermission("merchant.edit"), formBuilderController.discardDraft);
router.get("/versions/:versionId/preview", requirePermission("merchant.view"), formBuilderController.previewVersion);

// Sections inside draft
router.patch("/versions/:versionId/sections/reorder", requirePermission("merchant.edit"), formBuilderController.reorderSections);
router.put("/versions/:versionId/sections/reorder", requirePermission("merchant.edit"), formBuilderController.reorderSections);
router.post("/versions/:versionId/sections", requirePermission("merchant.edit"), formBuilderController.saveSection);
router.put("/versions/:versionId/sections/:sectionId", requirePermission("merchant.edit"), formBuilderController.saveSection);
router.delete("/versions/:versionId/sections/:sectionId", requirePermission("merchant.edit"), formBuilderController.deleteSection);

// Fields inside draft
router.patch("/versions/:versionId/fields/reorder", requirePermission("merchant.edit"), formBuilderController.reorderFields);
router.put("/versions/:versionId/sections/:sectionId/fields/reorder", requirePermission("merchant.edit"), formBuilderController.reorderFields);
router.put("/versions/:versionId/fields/reorder", requirePermission("merchant.edit"), formBuilderController.reorderFields);
router.post("/versions/:versionId/fields", requirePermission("merchant.edit"), formBuilderController.saveField);
router.put("/versions/:versionId/fields/:fieldId", requirePermission("merchant.edit"), formBuilderController.saveField);
router.delete("/versions/:versionId/fields/:fieldId", requirePermission("merchant.edit"), formBuilderController.deleteField);

export default router;

