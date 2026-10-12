import { Router } from "express";
import { paymentsController } from "./payments.controller.js";

const router = Router();

// Gateway Callback / Webhook / Return URL
router.all("/dgepay/callback", paymentsController.dgepayCallback);

export default router;

