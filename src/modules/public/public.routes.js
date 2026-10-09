import express from "express";
import { cmsController } from "../admin/cms/cms.controller.js";

const router = express.Router();

// Public CMS endpoints
router.get("/cms/homepage", cmsController.getPublicHomepage);

export default router;

