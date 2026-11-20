import express from "express";
import { cmsController } from "./cms.controller.js";
import { requirePermission } from "../../../middlewares/permission.js";
import { uploadDocument } from "../../../middlewares/upload.js";

const router = express.Router();

router.get("/homepage", requirePermission("cms.view"), cmsController.getHomepage);
router.put("/homepage", requirePermission("cms.manage"), cmsController.saveDraft);
router.post("/homepage/publish", requirePermission("cms.manage"), cmsController.publishDraft);
router.post("/upload", requirePermission("cms.manage"), uploadDocument.single("file"), cmsController.uploadMedia);

export default router;

