import { z } from "zod";

export const applicationReviewSchema = z.object({
  status: z.enum(["under_review", "approved", "rejected", "additional_information_required"]),
  reviewComment: z.string().optional().nullable(),
  rejectionReason: z.string().optional().nullable(),
});

export const fieldCorrectionSchema = z.object({
  fieldKey: z.string().min(1, "Field key is required"),
  issueType: z.enum([
    "incorrect_value",
    "illegible_scan",
    "expired_document",
    "mismatch",
    "missing_supporting_info",
    "other",
  ]).default("incorrect_value"),
  issueReason: z.string().min(5, "Issue reason must be at least 5 characters"),
});

export const branchCorrectionRequestSchema = z.object({
  branchId: z.number().int().positive("Valid branch ID required"),
  branchName: z.string().optional(),
  routingNumber: z.string().regex(/^\d{9}$/, "Routing number must be exactly 9 digits").optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email("Invalid email format").optional().nullable(),
  sourceUrl: z.string().url("Official source URL required").optional(),
  reason: z.string().min(10, "Please provide an explanation for the requested update"),
});

export const staffBranchAssignmentSchema = z.object({
  branchIds: z.array(z.number().int().positive()),
});

export const institutionServiceSchema = z.object({
  serviceCode: z.string().min(2).max(50).regex(/^[A-Z0-9_-]+$/i, "Service code must be alphanumeric"),
  serviceName: z.string().min(2).max(150),
  serviceType: z.string().default("payment_gateway"),
  integrationMode: z.enum(["api", "hosted_checkout", "qr_offline", "manual", "hybrid"]).default("api"),
  availabilityStatus: z.enum(["available", "testing_only", "unavailable", "deprecated"]).default("available"),
  applicationRequired: z.boolean().default(true),
  serviceRequirements: z.record(z.any()).optional().nullable(),
});

export const serviceConnectionSchema = z.object({
  connectionMode: z.enum(["direct_api", "aggregator", "sftp_batch", "manual_portal"]).default("direct_api"),
  environment: z.enum(["sandbox", "staging", "production"]).default("sandbox"),
  status: z.enum(["not_connected", "setup_pending", "testing", "connected", "error", "suspended"]).default("setup_pending"),
  connectionNotes: z.string().optional().nullable(),
});

