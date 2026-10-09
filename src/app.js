import path from "path";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";

import authRoutes from "./modules/auth/auth.routes.js";
import merchantRoutes from "./modules/merchants/merchant.routes.js";
import adminRoutes from "./modules/admin/admin.routes.js";
import publicRoutes from "./modules/public/public.routes.js";
import { errorHandler } from "./middlewares/errorHandler.js";

import { env } from "./config/env.js";

const app = express();

app.disable("x-powered-by");

app.use(
  cors({
    origin: env.frontendUrl,
    credentials: true,
  })
);

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

// Serve public CMS uploaded media assets
app.use(
  "/uploads/cms",
  express.static(path.join(process.cwd(), "storage", "public_cms"))
);

app.use(
  express.json({
    limit: "1mb",
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: "1mb",
  })
);

app.use(cookieParser(env.cookieSecret));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/api", apiLimiter);

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "BanglaQR API is running",
    environment: env.nodeEnv,
    timestamp: new Date().toISOString(),
  });
});

app.use(
  "/api/v1/auth",
  authRoutes
);

app.use(
  "/api/v1/merchants",
  merchantRoutes
);

app.use(
  "/api/v1/admin",
  adminRoutes
);

app.use(
  "/api/v1/public",
  publicRoutes
);

app.use(errorHandler);

export default app;