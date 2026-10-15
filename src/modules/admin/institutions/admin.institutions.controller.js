import { z } from "zod";
import { adminInstitutionsService } from "./admin.institutions.service.js";

function preprocessInstitutionPayload(val) {
  if (typeof val !== "object" || val === null) return val;
  const p = { ...val };

  // Support both 'institutionCode' and 'code'
  if (!p.institutionCode && p.code) {
    p.institutionCode = String(p.code).trim().toUpperCase();
  } else if (p.institutionCode) {
    p.institutionCode = String(p.institutionCode).trim().toUpperCase();
  }

  if (p.name) p.name = String(p.name).trim();
  if (p.nameBn !== undefined || p.name_bn !== undefined) {
    p.nameBn = (p.nameBn ?? p.name_bn ?? "").trim() || null;
  }
  if (p.legalName !== undefined || p.legal_name !== undefined) {
    p.legalName = (p.legalName ?? p.legal_name ?? "").trim() || null;
  }

  // Map institutionType from any alias (commercial_bank, specialized_bank, mfs, psp, digital_bank, etc.)
  if (p.institutionType !== undefined || p.type !== undefined) {
    const rawType = String(p.institutionType || p.type || "commercial_bank").toLowerCase();
    if (["commercial_bank", "specialized_bank", "digital_bank", "mfs", "payment_gateway", "bank", "other"].includes(rawType)) {
      p.institutionType = rawType;
    } else if (["islamic_bank", "nbfi"].includes(rawType)) {
      p.institutionType = "commercial_bank";
    } else if (["psp"].includes(rawType)) {
      p.institutionType = "payment_gateway";
    } else {
      p.institutionType = "other";
    }
  }

  // Support both 'supportEmail' and 'contactEmail'
  if (p.supportEmail === undefined && p.contactEmail !== undefined) {
    p.supportEmail = p.contactEmail ? String(p.contactEmail).trim() : null;
  } else if (p.supportEmail) {
    p.supportEmail = String(p.supportEmail).trim();
  }

  // Support both 'supportPhone' and 'contactPhone'
  if (p.supportPhone === undefined && p.contactPhone !== undefined) {
    p.supportPhone = p.contactPhone ? String(p.contactPhone).trim() : null;
  } else if (p.supportPhone) {
    p.supportPhone = String(p.supportPhone).trim();
  }

  if (p.headOfficeAddress === undefined && p.head_office_address !== undefined) {
    p.headOfficeAddress = p.head_office_address ? String(p.head_office_address).trim() : null;
  }
  if (p.postalCode === undefined && p.postal_code !== undefined) {
    p.postalCode = p.postal_code ? String(p.postal_code).trim() : null;
  }
  if (p.adminNotes === undefined && p.admin_notes !== undefined) {
    p.adminNotes = p.admin_notes ? String(p.admin_notes).trim() : null;
  }
  if (p.servicesOffered === undefined && p.services_offered !== undefined) {
    p.servicesOffered = p.services_offered ? String(p.services_offered).trim() : null;
  }

  if (p.websiteUrl) p.websiteUrl = String(p.websiteUrl).trim();
  if (p.logoUrl) p.logoUrl = String(p.logoUrl).trim();

  // Bank profile fields aliases
  if (p.swiftCode === undefined && p.swift_code !== undefined) {
    p.swiftCode = p.swift_code ? String(p.swift_code).trim() : null;
  }
  if (p.officialBankCode === undefined && p.official_bank_code !== undefined) {
    p.officialBankCode = p.official_bank_code ? String(p.official_bank_code).trim() : null;
  }
  if (p.bankCategory === undefined && p.bank_category !== undefined) {
    p.bankCategory = p.bank_category;
  }
  if (p.ownershipType === undefined && p.ownership_type !== undefined) {
    p.ownershipType = p.ownership_type;
  }
  if (p.bankingModel === undefined && p.banking_model !== undefined) {
    p.bankingModel = p.banking_model ? String(p.banking_model).trim() : null;
  }
  if (p.regulatoryReference === undefined && p.regulatory_reference !== undefined) {
    p.regulatoryReference = p.regulatory_reference ? String(p.regulatory_reference).trim() : null;
  }
  if (p.officialContactPerson === undefined && p.official_contact_person !== undefined) {
    p.officialContactPerson = p.official_contact_person ? String(p.official_contact_person).trim() : null;
  }
  if (p.contactDesignation === undefined && p.contact_designation !== undefined) {
    p.contactDesignation = p.contact_designation ? String(p.contact_designation).trim() : null;
  }

  // MFS profile fields aliases
  if (p.brandName === undefined && p.brand_name !== undefined) {
    p.brandName = p.brand_name ? String(p.brand_name).trim() : null;
  }
  if (p.legalOperatorName === undefined && p.legal_operator_name !== undefined) {
    p.legalOperatorName = p.legal_operator_name ? String(p.legal_operator_name).trim() : null;
  }
  if (p.providerCode === undefined && p.provider_code !== undefined) {
    p.providerCode = p.provider_code ? String(p.provider_code).trim() : null;
  }
  if (p.parentBankId === undefined && p.parent_bank_id !== undefined) {
    p.parentBankId = p.parent_bank_id ? Number(p.parent_bank_id) : null;
  }
  if (p.merchantApplicationSupported === undefined && p.merchant_application_supported !== undefined) {
    p.merchantApplicationSupported = Boolean(p.merchant_application_supported);
  }

  return p;
}

const institutionCreateSchema = z.preprocess(
  preprocessInstitutionPayload,
  z.object({
    name: z.string().min(2, "Institution name must be at least 2 characters"),
    institutionCode: z
      .string()
      .min(2, "Institution code must be at least 2 characters")
      .regex(/^[A-Z0-9_-]+$/i, "Institution code must contain only letters, numbers, underscores and hyphens"),
    nameBn: z.string().optional().nullable(),
    legalName: z.string().optional().nullable(),
    institutionType: z
      .enum(["bank", "commercial_bank", "specialized_bank", "digital_bank", "mfs", "payment_gateway", "other"])
      .default("commercial_bank"),
    logoUrl: z.string().optional().nullable().or(z.literal("")),
    description: z.string().optional().nullable().or(z.literal("")),
    websiteUrl: z.string().optional().nullable().or(z.literal("")),
    supportEmail: z.string().email("Invalid support email").optional().nullable().or(z.literal("")),
    supportPhone: z.string().optional().nullable().or(z.literal("")),
    headOfficeAddress: z.string().optional().nullable().or(z.literal("")),
    division: z.string().optional().nullable().or(z.literal("")),
    district: z.string().optional().nullable().or(z.literal("")),
    upazila: z.string().optional().nullable().or(z.literal("")),
    postalCode: z.string().optional().nullable().or(z.literal("")),
    adminNotes: z.string().optional().nullable().or(z.literal("")),
    servicesOffered: z.string().optional().nullable().or(z.literal("")),
    status: z.enum(["draft", "active", "inactive", "suspended"]).default("draft"),
    partnershipStatus: z.enum(["none", "in_discussion", "mou_signed", "active_partner", "partner_suspended"]).optional(),
    directoryStatus: z.enum(["unlisted", "listed", "verified", "archived"]).optional(),
    swiftCode: z.string().optional().nullable(),
    officialBankCode: z.string().optional().nullable(),
    bankCategory: z.enum(["commercial_conventional", "commercial_islamic", "specialized", "foreign_commercial", "digital_bank"]).optional().nullable(),
    ownershipType: z.enum(["state_owned", "private", "foreign", "joint_venture"]).optional().nullable(),
    bankingModel: z.string().optional().nullable().or(z.literal("")),
    regulatoryReference: z.string().optional().nullable(),
    officialContactPerson: z.string().optional().nullable(),
    contactDesignation: z.string().optional().nullable(),
    // MFS Profile
    brandName: z.string().optional().nullable(),
    legalOperatorName: z.string().optional().nullable(),
    providerCode: z.string().optional().nullable(),
    parentBankId: z.coerce.number().int().positive().optional().nullable(),
    authorizationReference: z.string().optional().nullable(),
    merchantApplicationSupported: z.union([z.boolean(), z.number()]).optional().nullable(),
  })
);

const institutionUpdateSchema = z.preprocess(
  preprocessInstitutionPayload,
  z.object({
    name: z.string().min(2, "Institution name must be at least 2 characters").optional(),
    institutionCode: z
      .string()
      .min(2, "Institution code must be at least 2 characters")
      .regex(/^[A-Z0-9_-]+$/i, "Institution code must contain only letters, numbers, underscores and hyphens")
      .optional(),
    nameBn: z.string().optional().nullable(),
    legalName: z.string().optional().nullable(),
    institutionType: z
      .enum(["bank", "commercial_bank", "specialized_bank", "digital_bank", "mfs", "payment_gateway", "other"])
      .optional(),
    logoUrl: z.string().optional().nullable().or(z.literal("")),
    description: z.string().optional().nullable().or(z.literal("")),
    websiteUrl: z.string().optional().nullable().or(z.literal("")),
    supportEmail: z.string().email("Invalid support email").optional().nullable().or(z.literal("")),
    supportPhone: z.string().optional().nullable().or(z.literal("")),
    headOfficeAddress: z.string().optional().nullable().or(z.literal("")),
    division: z.string().optional().nullable().or(z.literal("")),
    district: z.string().optional().nullable().or(z.literal("")),
    upazila: z.string().optional().nullable().or(z.literal("")),
    postalCode: z.string().optional().nullable().or(z.literal("")),
    adminNotes: z.string().optional().nullable().or(z.literal("")),
    servicesOffered: z.string().optional().nullable().or(z.literal("")),
    status: z.enum(["draft", "active", "inactive", "suspended"]).optional(),
    directoryStatus: z.enum(["unlisted", "listed", "verified", "archived"]).optional(),
    partnershipStatus: z.enum(["none", "in_discussion", "mou_signed", "active_partner", "partner_suspended"]).optional(),
    regulatoryStatus: z.enum(["scheduled_bank", "non_scheduled_bank", "licensed_mfs", "payment_system_operator", "under_review", "exempt"]).optional(),
    swiftCode: z.string().optional().nullable(),
    officialBankCode: z.string().optional().nullable(),
    bankCategory: z.enum(["commercial_conventional", "commercial_islamic", "specialized", "foreign_commercial", "digital_bank"]).optional().nullable(),
    ownershipType: z.enum(["state_owned", "private", "foreign", "joint_venture"]).optional().nullable(),
    bankingModel: z.string().optional().nullable().or(z.literal("")),
    regulatoryReference: z.string().optional().nullable(),
    officialContactPerson: z.string().optional().nullable(),
    contactDesignation: z.string().optional().nullable(),
    // MFS Profile
    brandName: z.string().optional().nullable(),
    legalOperatorName: z.string().optional().nullable(),
    providerCode: z.string().optional().nullable(),
    parentBankId: z.coerce.number().int().positive().optional().nullable(),
    authorizationReference: z.string().optional().nullable(),
    merchantApplicationSupported: z.union([z.boolean(), z.number()]).optional().nullable(),
  })
);

const staffInviteSchema = z.preprocess(
  (val) => {
    if (typeof val !== "object" || val === null) return val;
    const p = { ...val };
    if (!p.roleName && p.role) p.roleName = p.role;
    if (p.name === undefined && p.fullName !== undefined) p.name = p.fullName;
    if (typeof p.name === "string") p.name = p.name.trim();
    if (typeof p.email === "string") p.email = p.email.trim().toLowerCase();
    if (p.phone === "") p.phone = null;
    return p;
  },
  z.object({
    institutionId: z.coerce.number().int().positive("Institution ID is required"),
    name: z.string().min(2, "Full name must be at least 2 characters").optional().nullable(),
    email: z.string().email("A valid email address is required"),
    phone: z.string().max(30).optional().nullable(),
    roleName: z.enum(["bank_admin", "bank_reviewer", "bank_operations"]).default("bank_admin"),
  })
);

const staffSchema = z.preprocess(
  (value) => {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value)
    ) {
      return value;
    }

    const payload = { ...value };

    // Accept both frontend and backend field names.
    if (!payload.roleName && payload.role) {
      payload.roleName = payload.role;
    }

    if (payload.name === undefined && payload.fullName !== undefined) {
      payload.name = payload.fullName;
    }

    if (typeof payload.name === "string") {
      payload.name = payload.name.trim();
    }

    if (typeof payload.email === "string") {
      payload.email = payload.email.trim().toLowerCase();
    }

    if (payload.phone === "") {
      payload.phone = null;
    }

    return payload;
  },
  z.object({
    institutionId: z.coerce
      .number()
      .int()
      .positive("Institution ID is required"),

    name: z.string()
      .min(2, "Full name must be at least 2 characters")
      .max(150),

    email: z.string()
      .email("A valid email address is required"),

    phone: z.string()
      .max(30)
      .nullable()
      .optional(),

    password: z.string()
      .min(6, "Password must be at least 6 characters")
      .max(128),

    confirmPassword: z.string().optional(),

    roleName: z.enum([
      "bank_admin",
      "bank_reviewer",
      "bank_operations",
    ]),

    membershipStatus: z.enum([
      "active",
      "inactive",
      "suspended",
    ]).default("active"),
  }).refine((data) => {
    if (data.confirmPassword && data.password !== data.confirmPassword) {
      return false;
    }
    return true;
  }, {
    message: "Password and Confirm Password do not match",
    path: ["confirmPassword"],
  })
);

const staffUpdateSchema = z.preprocess(
  (value) => {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value)
    ) {
      return value;
    }

    const payload = { ...value };

    // Backward compatibility with older clients.
    if (
      payload.membershipStatus === undefined &&
      payload.status !== undefined
    ) {
      payload.membershipStatus = payload.status;
    }

    return payload;
  },
  z
    .object({
      roleName: z
        .enum([
          "bank_admin",
          "bank_reviewer",
          "bank_operations",
        ])
        .optional(),

      membershipStatus: z
        .enum([
          "active",
          "inactive",
          "suspended",
          "invited",
        ])
        .optional(),
    })
    .refine(
      (payload) =>
        payload.roleName !== undefined ||
        payload.membershipStatus !== undefined,
      {
        message:
          "Provide a roleName or membershipStatus to update.",
      }
    )
);
const branchSchema = z.preprocess(
  (val) => {
    if (typeof val !== "object" || val === null) return val;
    const p = { ...val };
    if (p.branchCode) p.branchCode = String(p.branchCode).trim().toUpperCase();
    if (p.branchName) p.branchName = String(p.branchName).trim();
    if (p.routingNumber) p.routingNumber = String(p.routingNumber).trim();
    if (p.email === "") p.email = null;
    if (p.phone === "") p.phone = null;
    return p;
  },
  z.object({
    institutionId: z.coerce.number().positive("Institution ID is required"),
    branchName: z.string().min(2, "Branch name must be at least 2 characters"),
    branchCode: z
      .string()
      .min(2, "Branch code must be at least 2 characters")
      .regex(/^[A-Z0-9_-]+$/i, "Branch code must contain only letters, numbers, underscores and hyphens"),
    routingNumber: z
      .string()
      .trim()
      .regex(/^\d{9}$/, "Routing number must be exactly 9 numeric digits")
      .optional()
      .nullable()
      .or(z.literal("")),
    division: z.string().min(1, "Division is required"),
    district: z.string().min(1, "District is required"),
    upazila: z.string().min(1, "Upazila is required"),
    postOffice: z.string().optional().nullable().or(z.literal("")),
    postalCode: z.string().optional().nullable().or(z.literal("")),
    address: z.string().optional().nullable().or(z.literal("")),
    phone: z.string().optional().nullable().or(z.literal("")),
    email: z.string().email("Invalid branch email").optional().nullable().or(z.literal("")),
    managerName: z.string().optional().nullable().or(z.literal("")),
    notes: z.string().optional().nullable().or(z.literal("")),
    status: z.enum(["active", "inactive", "suspended"]).default("active"),
    isDemo: z.boolean().or(z.number()).optional().default(false),
  })
);

const kycRequirementSchema = z.preprocess(
  (val) => {
    if (typeof val !== "object" || val === null) return val;
    const p = { ...val };

    // Support both name and title
    if (!p.name && p.title) p.name = String(p.title).trim();
    if (p.name) p.name = String(p.name).trim();

    // Support both requirementCode and code
    if (!p.requirementCode && p.code) p.requirementCode = String(p.code).trim().toUpperCase();
    if (p.requirementCode) p.requirementCode = String(p.requirementCode).trim().toUpperCase();
    if (!p.requirementCode && p.name) {
      p.requirementCode = String(p.name).toUpperCase().replace(/[^A-Z0-9]+/g, "_").slice(0, 50);
    }

    // Support instructions and merchantInstructions
    if (!p.instructions && p.merchantInstructions) p.instructions = String(p.merchantInstructions).trim();
    if (p.instructions) p.instructions = String(p.instructions).trim();

    // Support adminNotes and reviewInstructions
    if (!p.adminNotes && p.reviewInstructions) p.adminNotes = String(p.reviewInstructions).trim();
    if (p.adminNotes) p.adminNotes = String(p.adminNotes).trim();
    if (!p.reviewInstructions && p.adminNotes) p.reviewInstructions = p.adminNotes;

    // Support allowedFormats array or string
    if (Array.isArray(p.allowedFormats)) {
      p.allowedExtensions = p.allowedFormats.join(",");
    } else if (p.allowedFormats && typeof p.allowedFormats === "string") {
      p.allowedExtensions = p.allowedFormats;
    }

    // Handle applicableServiceId empty or "all"
    if (p.applicableServiceId === "" || p.applicableServiceId === "all" || p.applicableServiceId === 0 || p.applicableServiceId === "0") {
      p.applicableServiceId = null;
    }

    // Map documentSides aliases
    if (p.documentSides === "Both Sides" || p.documentSides === "both_sides") p.documentSides = "both";
    if (p.documentSides === "Single Side" || p.documentSides === "single_side") p.documentSides = "single";
    if (p.documentSides === "Multiple Pages" || p.documentSides === "multiple_pages") p.documentSides = "multiple";

    return p;
  },
  z.object({
    institutionId: z.coerce.number().positive("Banking Partner is required"),
    applicableServiceId: z.coerce.number().positive().optional().nullable(),
    name: z.string().min(2, "Requirement Title is required"),
    requirementCode: z
      .string()
      .min(2, "Requirement Code is required")
      .regex(/^[A-Z0-9_-]+$/i, "Requirement Code must be alphanumeric with hyphens or underscores"),
    requirementCategory: z
      .enum([
        "business_identity",
        "legal_entity",
        "financial_standing",
        "signatory_identity",
        "tax_regulatory",
        "financial_bank",
        "signatory_ownership",
        "operational",
        "operational_proof",
        "other",
      ])
      .default("business_identity"),
    requirementType: z
      .enum(["document_upload", "text_input", "number_input", "boolean_check", "bank_account_verification"])
      .default("document_upload"),
    applicableBusinessTypes: z.any().optional().nullable(),
    documentType: z.string().min(1, "Document Type is required").default("other"),
    description: z.string().optional().nullable().or(z.literal("")),
    instructions: z.string().min(3, "Instructions for Merchant is required"),
    allowedExtensions: z.string().default("pdf,jpg,jpeg,png,webp"),
    maxFileSizeMb: z.coerce.number().min(1).max(100).default(5),
    maxPdfPages: z.coerce.number().min(1).max(50).default(5),
    maxFilesCount: z.coerce.number().min(1).max(10).default(1),
    documentSides: z.enum(["single", "both", "multiple", "not_applicable"]).default("single"),
    isMandatory: z.coerce.boolean().default(true),
    requiresApproval: z.coerce.boolean().default(true),
    reviewInstructions: z.string().optional().nullable().or(z.literal("")),
    adminNotes: z.string().optional().nullable().or(z.literal("")),
    autoVerifyOcr: z.coerce.boolean().default(false),
    checkExpiry: z.coerce.boolean().default(false),
    requireMatchingName: z.coerce.boolean().default(false),
    expiryFieldName: z.string().optional().nullable().default("expiry_date"),
    minValidityDays: z.coerce.number().min(0).max(3650).default(30),
    referenceApiUrl: z.string().url("Reference API must be a valid URL").optional().nullable().or(z.literal("")),
    sampleDocumentUrl: z.string().optional().nullable().or(z.literal("")),
    sampleDocumentUrls: z.any().optional().nullable(),
    status: z.enum(["active", "inactive"]).default("active"),
    displayOrder: z.coerce.number().default(0),
  })
);

const institutionSettingsSchema = z.preprocess(
  (val) => {
    if (typeof val !== "object" || val === null) return {};
    const p = { ...val };
    if (p.sla_hours === undefined && p.kyc_review_sla_hours !== undefined) {
      p.sla_hours = p.kyc_review_sla_hours;
    }
    if (p.branch_policy === undefined && p.branch_routing_policy !== undefined) {
      p.branch_policy = p.branch_routing_policy;
    }
    if (p.escalation_email === undefined && p.escalationEmail !== undefined) {
      p.escalation_email = p.escalationEmail;
    }
    if (p.escalation_email === undefined && p.operations_escalation_email !== undefined) {
      p.escalation_email = p.operations_escalation_email;
    }
    return p;
  },
  z.object({
    sla_hours: z
      .union([z.number(), z.string()])
      .optional()
      .transform((val) => {
        if (val === undefined || val === null || val === "") return 48;
        return Number(val);
      })
      .refine((n) => Number.isInteger(n) && n >= 1 && n <= 720, {
        message: "KYC Review Target SLA must be a positive integer between 1 and 720 hours",
      }),
    branch_policy: z
      .enum([
        "merchant_selects_branch",
        "auto_assign_nearest_branch",
        "manual_assignment",
        "optional",
        "mandatory",
        "disabled",
      ])
      .optional()
      .transform((val) => {
        if (!val || val === "optional") return "merchant_selects_branch";
        if (val === "mandatory") return "auto_assign_nearest_branch";
        if (val === "disabled") return "manual_assignment";
        return val;
      }),
    escalation_email: z
      .string()
      .optional()
      .nullable()
      .transform((val) => (val ? String(val).trim() : ""))
      .refine((val) => !val || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val), {
        message: "Operations Contact / Escalation Email must be a valid email address",
      }),
  }).passthrough()
);

export const adminInstitutionsController = {
  async getDashboard(req, res, next) {
    try {
      const data = await adminInstitutionsService.getDashboard();
      res.json({
        success: true,
        data,
      });
    } catch (err) {
      next(err);
    }
  },

  async list(req, res, next) {
    try {
      const { search, type, category, status, tab = "registered", page = 1, limit = 15 } = req.query;
      const data = await adminInstitutionsService.list({
        search,
        type,
        category,
        status,
        tab,
        page: Number(page),
        limit: Number(limit),
      });

      res.json({
        success: true,
        count: data.institutions.length,
        data: data.institutions,
        institutions: data.institutions,
        pagination: data.pagination,
      });
    } catch (err) {
      next(err);
    }
  },

  async getBankOptions(req, res, next) {
    try {
      const { search, unregisteredOnly, category, limit } = req.query;
      const options = await adminInstitutionsService.getBankOptions({
        search,
        unregisteredOnly: unregisteredOnly === "true" || unregisteredOnly === true,
        category,
        limit: limit ? Number(limit) : 100,
      });

      res.json({
        success: true,
        count: options.length,
        data: options,
      });
    } catch (err) {
      next(err);
    }
  },

  async register(req, res, next) {
    try {
      const id = Number(req.params.id);
      if (!id || isNaN(id) || id <= 0) {
        return res.status(400).json({ success: false, message: "Invalid institution ID" });
      }

      const validated = institutionUpdateSchema.parse(req.body);
      const registered = await adminInstitutionsService.registerBank(id, validated, req.user, {
        ip: req.ip,
        userAgent: req.get("user-agent"),
      });

      res.json({
        success: true,
        message: `Institution "${registered.name}" registered successfully`,
        data: registered,
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        const errorDetails = err.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ");
        return res.status(400).json({
          success: false,
          message: `Validation failed: ${errorDetails}`,
          errors: err.errors,
        });
      }
      next(err);
    }
  },

  async getById(req, res, next) {
    try {
      const id = Number(req.params.id);
      const data = await adminInstitutionsService.getById(id);
      res.json({
        success: true,
        data,
      });
    } catch (err) {
      next(err);
    }
  },

  async create(req, res, next) {
    try {
      const validated = institutionCreateSchema.parse(req.body);
      const created = await adminInstitutionsService.create(validated, req.user, {
        ip: req.ip,
        userAgent: req.get("user-agent"),
      });

      res.status(201).json({
        success: true,
        message: "Institution created successfully",
        data: created,
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        const errorDetails = err.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ");
        return res.status(400).json({
          success: false,
          message: `Validation failed: ${errorDetails}`,
          errors: err.errors,
        });
      }
      next(err);
    }
  },

  async update(req, res, next) {
    try {
      const id = Number(req.params.id);
      if (!id || isNaN(id) || id <= 0) {
        return res.status(400).json({ success: false, message: "Invalid institution ID" });
      }
      const validated = institutionUpdateSchema.parse(req.body);

      const updated = await adminInstitutionsService.update(id, validated, req.user, {
        ip: req.ip,
        userAgent: req.get("user-agent"),
      });

      res.json({
        success: true,
        message: "Institution updated successfully",
        data: updated,
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        const errorDetails = err.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ");
        return res.status(400).json({
          success: false,
          message: `Validation failed: ${errorDetails}`,
          errors: err.errors,
        });
      }
      next(err);
    }
  },

  async updateStatus(req, res, next) {
    try {
      const id = Number(req.params.id);
      if (!id || isNaN(id) || id <= 0) {
        return res.status(400).json({ success: false, message: "Invalid institution ID" });
      }

      let status = req.body?.status;
      if (!status && typeof req.body === "string") {
        try {
          const parsed = JSON.parse(req.body);
          status = parsed?.status || parsed;
        } catch (_) {
          status = req.body;
        }
      }

      if (!status) {
        return res.status(400).json({ success: false, message: "Status is required in request body" });
      }

      const validStatuses = ["active", "draft", "inactive", "suspended"];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message: `Invalid institution status: '${status}'. Allowed values are: ${validStatuses.join(", ")}`,
        });
      }

      const updated = await adminInstitutionsService.updateStatus(id, status, req.user, {
        ip: req.ip,
        userAgent: req.get("user-agent"),
      });

      res.json({
        success: true,
        message: `Institution status updated to ${status}`,
        data: updated,
      });
    } catch (err) {
      next(err);
    }
  },

  async delete(req, res, next) {
    try {
      const id = Number(req.params.id);
      const result = await adminInstitutionsService.delete(id, req.user, {
        ip: req.ip,
        userAgent: req.get("user-agent"),
      });

      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async uploadLogo(req, res, next) {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "No image file uploaded or file format not supported.",
        });
      }
      const result = await adminInstitutionsService.uploadLogo(req.file);
      res.json({
        success: true,
        message: "Logo uploaded successfully",
        data: {
          url: result.url,
          logoUrl: result.url,
          filename: result.filename,
        },
        url: result.url,
        logoUrl: result.url,
        filename: result.filename,
      });
    } catch (err) {
      next(err);
    }
  },

  /* ========================================================================
     SERVICES HANDLERS
     ======================================================================== */

  async listServices(req, res, next) {
    try {
      const { institutionId, category, connectionStatus, status, search, page = 1, limit = 50 } = req.query;
      const validInstId =
        institutionId && institutionId !== "all" && !isNaN(Number(institutionId)) && Number(institutionId) > 0
          ? Math.floor(Number(institutionId))
          : null;

      const data = await adminInstitutionsService.listServices({
        institutionId: validInstId,
        category,
        connectionStatus,
        status,
        search,
        page: Number(page),
        limit: Number(limit),
      });

      res.json({
        success: true,
        data: data.services,
        services: data.services,
        pagination: data.pagination,
      });
    } catch (err) {
      next(err);
    }
  },

  async getServiceById(req, res, next) {
    try {
      const gatewayId = Number(req.params.gatewayId);
      const service = await adminInstitutionsService.getServiceById(gatewayId);
      res.json({
        success: true,
        data: service,
      });
    } catch (err) {
      next(err);
    }
  },

  async createService(req, res, next) {
    try {
      const result = await adminInstitutionsService.createService(req.body, req.user, {
        ip: req.ip,
        userAgent: req.get("user-agent"),
      });

      res.status(201).json({
        success: true,
        message: "Service created successfully",
        data: result,
      });
    } catch (err) {
      next(err);
    }
  },

  async updateService(req, res, next) {
    try {
      const gatewayId = Number(req.params.gatewayId);
      const result = await adminInstitutionsService.updateService(gatewayId, req.body, req.user, {
        ip: req.ip,
        userAgent: req.get("user-agent"),
      });

      res.json({
        success: true,
        message: "Service updated successfully",
        data: result,
      });
    } catch (err) {
      next(err);
    }
  },

  async testServiceConnection(req, res, next) {
    try {
      const gatewayId = Number(req.params.gatewayId);
      const result = await adminInstitutionsService.testServiceConnection(gatewayId, req.user, {
        ip: req.ip,
        userAgent: req.get("user-agent"),
      });

      res.json({
        success: true,
        message: result.message || "Connection test completed",
        data: result,
      });
    } catch (err) {
      next(err);
    }
  },

  async associateService(req, res, next) {
    try {
      const gatewayId = Number(req.params.gatewayId);
      const { institutionId } = req.body;
      if (!institutionId) {
        return res.status(400).json({ success: false, message: "institutionId is required" });
      }

      const result = await adminInstitutionsService.associateService(
        gatewayId,
        Number(institutionId),
        req.user,
        { ip: req.ip, userAgent: req.get("user-agent") }
      );

      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async disassociateService(req, res, next) {
    try {
      const gatewayId = Number(req.params.gatewayId);
      const result = await adminInstitutionsService.disassociateService(gatewayId, req.user, {
        ip: req.ip,
        userAgent: req.get("user-agent"),
      });

      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  /* ========================================================================
     STAFF HANDLERS
     ======================================================================== */

  async listStaff(req, res, next) {
    try {
      const { institutionId, status, search, page = 1, limit = 20 } = req.query;
      const validInstId =
        institutionId && institutionId !== "all" && !isNaN(Number(institutionId)) && Number(institutionId) > 0
          ? Math.floor(Number(institutionId))
          : null;

      const data = await adminInstitutionsService.listStaff({
        institutionId: validInstId,
        status,
        search,
        page: Number(page),
        limit: Number(limit),
      });

      res.json({
        success: true,
        data: data.staff,
        staff: data.staff,
        pagination: data.pagination,
      });
    } catch (err) {
      next(err);
    }
  },

  async provisionStaff(req, res, next) {
    try {
      const validated = staffSchema.parse(req.body);
      const result = await adminInstitutionsService.provisionStaff(validated, req.user, {
        ip: req.ip,
        userAgent: req.get("user-agent"),
      });

      res.status(201).json({
        success: true,
        message: "Institution staff provisioned successfully",
        data: result,
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        const issues = err.issues || err.errors || [];
        const errorDetails = issues.map((e) => `${(e.path || []).join(".")}: ${e.message}`).join(", ");
        return res.status(400).json({
          success: false,
          message: `Validation failed: ${errorDetails}`,
          errors: issues,
        });
      }
      next(err);
    }
  },

  async updateStaff(req, res, next) {
    try {
      const membershipId = Number(req.params.membershipId);
  
      if (
        !Number.isSafeInteger(membershipId) ||
        membershipId <= 0
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid staff membership ID.",
        });
      }
  
      const payload = staffUpdateSchema.parse(req.body);
  
      const result =
        await adminInstitutionsService.updateStaffMembership(
          membershipId,
          payload,
          req.user,
          {
            ip: req.ip,
            userAgent: req.get("user-agent"),
          }
        );
  
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async inviteStaff(req, res, next) {
    try {
      const validated = staffInviteSchema.parse(req.body);
      const result = await adminInstitutionsService.inviteStaff(validated, req.user, {
        ip: req.ip,
        userAgent: req.get("user-agent"),
      });

      res.status(201).json({
        success: true,
        message: result.message,
        data: result,
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        const errorDetails = err.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ");
        return res.status(400).json({
          success: false,
          message: `Validation failed: ${errorDetails}`,
          errors: err.errors,
        });
      }
      next(err);
    }
  },

  async listInvitations(req, res, next) {
    try {
      const { institutionId, status } = req.query;
      const data = await adminInstitutionsService.listInvitations({
        institutionId: institutionId && institutionId !== "all" ? Number(institutionId) : null,
        status: status || "all",
      });
      res.json({
        success: true,
        data,
      });
    } catch (err) {
      next(err);
    }
  },

  async resendInvitation(req, res, next) {
    try {
      const id = Number(req.params.id);
      if (!id || isNaN(id) || id <= 0) {
        return res.status(400).json({ success: false, message: "Invalid invitation ID" });
      }
      const result = await adminInstitutionsService.resendInvitation(id, req.user, {
        ip: req.ip,
        userAgent: req.get("user-agent"),
      });
      res.json({
        success: true,
        message: "Invitation resent successfully",
        data: result,
      });
    } catch (err) {
      next(err);
    }
  },

  async revokeInvitation(req, res, next) {
    try {
      const id = Number(req.params.id);
      if (!id || isNaN(id) || id <= 0) {
        return res.status(400).json({ success: false, message: "Invalid invitation ID" });
      }
      const result = await adminInstitutionsService.revokeInvitation(id, req.user, {
        ip: req.ip,
        userAgent: req.get("user-agent"),
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  /* ========================================================================
     KYC REQUIREMENTS HANDLERS
     ======================================================================== */

  async listKycRequirements(req, res, next) {
    try {
      const { institutionId, serviceId, category, status } = req.query;
      const validInstId =
        institutionId && institutionId !== "all" && !isNaN(Number(institutionId)) && Number(institutionId) > 0
          ? Math.floor(Number(institutionId))
          : null;

      const validServiceId =
        serviceId && serviceId !== "all" && !isNaN(Number(serviceId)) && Number(serviceId) > 0
          ? Math.floor(Number(serviceId))
          : null;

      const data = await adminInstitutionsService.listKycRequirements({
        institutionId: validInstId,
        serviceId: validServiceId,
        category,
        status,
      });

      res.json({
        success: true,
        data,
      });
    } catch (err) {
      next(err);
    }
  },

  async getKycRequirementById(req, res, next) {
    try {
      const id = Number(req.params.id);
      const data = await adminInstitutionsService.getKycRequirementById(id);
      res.json({
        success: true,
        data,
      });
    } catch (err) {
      next(err);
    }
  },

  async getRelatedKycRequirements(req, res, next) {
    try {
      const { institutionId, serviceId, excludeId } = req.query;
      const data = await adminInstitutionsService.getRelatedKycRequirements({
        institutionId: institutionId ? Number(institutionId) : null,
        serviceId: serviceId && serviceId !== "all" ? Number(serviceId) : null,
        excludeId: excludeId ? Number(excludeId) : null,
      });

      res.json({
        success: true,
        data,
      });
    } catch (err) {
      next(err);
    }
  },

  async uploadSampleDocument(req, res, next) {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "No sample document or image uploaded.",
        });
      }
      const result = await adminInstitutionsService.uploadSampleDocument(req.file);
      res.json({
        success: true,
        message: "Sample document uploaded successfully",
        data: result,
      });
    } catch (err) {
      next(err);
    }
  },

  async createKycRequirement(req, res, next) {
    try {
      const validated = kycRequirementSchema.parse(req.body);
      const created = await adminInstitutionsService.createKycRequirement(validated, req.user, {
        ip: req.ip,
        userAgent: req.get("user-agent"),
      });

      res.status(201).json({
        success: true,
        message: "KYC requirement configured successfully",
        data: created,
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        const errorDetails = err.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ");
        return res.status(400).json({
          success: false,
          message: `Validation failed: ${errorDetails}`,
          errors: err.errors,
        });
      }
      next(err);
    }
  },

  async updateKycRequirement(req, res, next) {
    try {
      const id = Number(req.params.id);
      const partial = kycRequirementSchema.partial().parse(req.body);
      await adminInstitutionsService.updateKycRequirement(id, partial, req.user, {
        ip: req.ip,
        userAgent: req.get("user-agent"),
      });

      res.json({
        success: true,
        message: "KYC requirement updated successfully",
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        const errorDetails = err.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ");
        return res.status(400).json({
          success: false,
          message: `Validation failed: ${errorDetails}`,
          errors: err.errors,
        });
      }
      next(err);
    }
  },

  async deleteKycRequirement(req, res, next) {
    try {
      const id = Number(req.params.id);
      const result = await adminInstitutionsService.deleteKycRequirement(id, req.user, {
        ip: req.ip,
        userAgent: req.get("user-agent"),
      });

      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  /* ========================================================================
     SETTINGS HANDLERS
     ======================================================================== */

  async getSettings(req, res, next) {
    try {
      const institutionId = Number(req.params.institutionId);
      const data = await adminInstitutionsService.getSettings(institutionId);
      res.json({
        success: true,
        data,
      });
    } catch (err) {
      next(err);
    }
  },

  async saveSettings(req, res, next) {
    try {
      const institutionId = Number(req.params.institutionId);
      if (!institutionId || isNaN(institutionId)) {
        return res.status(400).json({ success: false, message: "Valid institution ID is required" });
      }

      const validated = institutionSettingsSchema.parse(req.body);

      const result = await adminInstitutionsService.saveSettings(
        institutionId,
        validated,
        req.user,
        { ip: req.ip, userAgent: req.get("user-agent") }
      );

      res.json(result);
    } catch (err) {
      if (err instanceof z.ZodError) {
        const issues = err.issues || err.errors || [];
        const errorDetails = issues.map((e) => `${(e.path || []).join(".")}: ${e.message}`).join(", ");
        return res.status(400).json({
          success: false,
          message: `Validation failed: ${errorDetails}`,
          errors: issues,
        });
      }
      next(err);
    }
  },

  /* ========================================================================
     BRANCHES & LOCATIONS HANDLERS
     ======================================================================== */

  async getBranchStats(req, res, next) {
    try {
      const institutionId = Number(req.params.institutionId);
      const data = await adminInstitutionsService.getBranchStats(institutionId);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  async listBranches(req, res, next) {
    try {
      const institutionId = Number(req.params.institutionId);
      const {
        division,
        district,
        upazila,
        status,
        demoFilter,
        includeArchived,
        search,
        page = 1,
        limit = 15,
      } = req.query;

      const data = await adminInstitutionsService.listBranches(institutionId, {
        division,
        district,
        upazila,
        status,
        demoFilter,
        includeArchived: includeArchived === "true",
        search,
        page: Number(page),
        limit: Number(limit),
      });

      res.json({
        success: true,
        data: data.branches,
        branches: data.branches,
        pagination: data.pagination,
      });
    } catch (err) {
      next(err);
    }
  },

  async getBranchById(req, res, next) {
    try {
      const branchId = Number(req.params.branchId);
      const branch = await adminInstitutionsService.getBranchById(branchId);
      res.json({ success: true, data: branch });
    } catch (err) {
      next(err);
    }
  },

  async createBranch(req, res, next) {
    try {
      const institutionId = Number(req.params.institutionId);
      const payload = { ...req.body, institutionId };
      const validated = branchSchema.parse(payload);

      const created = await adminInstitutionsService.createBranch(validated, req.user, {
        ip: req.ip,
        userAgent: req.get("user-agent"),
      });

      res.status(201).json({
        success: true,
        message: "Branch created successfully",
        data: created,
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        const errorDetails = err.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ");
        return res.status(400).json({
          success: false,
          message: `Validation failed: ${errorDetails}`,
          errors: err.errors,
        });
      }
      next(err);
    }
  },

  async updateBranch(req, res, next) {
    try {
      const branchId = Number(req.params.branchId);
      const partial = branchSchema.partial().parse(req.body);

      const updated = await adminInstitutionsService.updateBranch(branchId, partial, req.user, {
        ip: req.ip,
        userAgent: req.get("user-agent"),
      });

      res.json({
        success: true,
        message: "Branch updated successfully",
        data: updated,
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        const errorDetails = err.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ");
        return res.status(400).json({
          success: false,
          message: `Validation failed: ${errorDetails}`,
          errors: err.errors,
        });
      }
      next(err);
    }
  },

  async updateBranchStatus(req, res, next) {
    try {
      const branchId = Number(req.params.branchId);
      const { status } = req.body;
      if (!["active", "inactive", "suspended"].includes(status)) {
        return res.status(400).json({ success: false, message: "Status must be active, inactive, or suspended" });
      }

      const result = await adminInstitutionsService.updateBranchStatus(branchId, status, req.user, {
        ip: req.ip,
        userAgent: req.get("user-agent"),
      });

      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async archiveBranch(req, res, next) {
    try {
      const branchId = Number(req.params.branchId);
      const result = await adminInstitutionsService.archiveBranch(branchId, req.user, {
        ip: req.ip,
        userAgent: req.get("user-agent"),
      });

      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async toggleDemoBranch(req, res, next) {
    try {
      const branchId = Number(req.params.branchId);
      const isDemo = Boolean(req.body.isDemo !== undefined ? req.body.isDemo : true);
      const result = await adminInstitutionsService.toggleDemoBranch(branchId, isDemo, req.user, {
        ip: req.ip,
        userAgent: req.get("user-agent"),
      });

      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async deleteBranch(req, res, next) {
    try {
      const branchId = Number(req.params.branchId);
      const result = await adminInstitutionsService.deleteBranch(branchId, req.user, {
        ip: req.ip,
        userAgent: req.get("user-agent"),
      });

      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async getActiveInstitutions(req, res, next) {
    try {
      const data = await adminInstitutionsService.getActiveInstitutions();
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  async getActiveBranchesForInstitution(req, res, next) {
    try {
      const institutionId = Number(req.params.institutionId);
      const data = await adminInstitutionsService.getActiveBranchesForInstitution(institutionId);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  async exportBranchesCsv(req, res, next) {
    try {
      const institutionId = Number(req.params.institutionId);
      const csvData = await adminInstitutionsService.exportBranchesCsv(institutionId);

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename=institution_${institutionId}_branches.csv`);
      res.status(200).send(csvData);
    } catch (err) {
      next(err);
    }
  },

  /* ========================================================================
     BANGLADESH GEOGRAPHIC MASTER DATA HANDLERS
     ======================================================================== */

  async getGeoDivisions(req, res, next) {
    try {
      const data = await adminInstitutionsService.getGeoDivisions();
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  async getGeoDistricts(req, res, next) {
    try {
      const { divisionId, division } = req.query;
      const data = await adminInstitutionsService.getGeoDistricts(divisionId || division || null);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  async getGeoUpazilas(req, res, next) {
    try {
      const { districtId, district } = req.query;
      const data = await adminInstitutionsService.getGeoUpazilas(districtId || district || null);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  /* ========================================================================
     INSTITUTION APPLICATIONS HANDLERS
     ======================================================================== */

  async listInstitutionApplications(req, res, next) {
    try {
      const institutionId = Number(req.params.institutionId);
      const { status, search, page = 1, limit = 15 } = req.query;
      const data = await adminInstitutionsService.listInstitutionApplications(institutionId, {
        status,
        search,
        page: Number(page),
        limit: Number(limit),
      });

      res.json({
        success: true,
        data: data.applications,
        applications: data.applications,
        pagination: data.pagination,
      });
    } catch (err) {
      next(err);
    }
  },

  async getInstitutionApplicationStats(req, res, next) {
    try {
      const institutionId = Number(req.params.institutionId);
      const data = await adminInstitutionsService.getInstitutionApplicationStats(institutionId);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  /* ========================================================================
     PROFILES, DIRECTORY & SOURCE VERIFICATION
     ======================================================================== */

  async getBankProfile(req, res, next) {
    try {
      const institutionId = Number(req.params.institutionId);
      const data = await adminInstitutionsService.getBankProfile(institutionId);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  async saveBankProfile(req, res, next) {
    try {
      const institutionId = Number(req.params.institutionId);
      const data = await adminInstitutionsService.saveBankProfile(
        institutionId,
        req.body,
        req.user,
        { ip: req.ip, userAgent: req.get("user-agent") }
      );
      res.json({ success: true, data, message: "Bank profile updated successfully" });
    } catch (err) {
      next(err);
    }
  },

  async getMfsProfile(req, res, next) {
    try {
      const institutionId = Number(req.params.institutionId);
      const data = await adminInstitutionsService.getMfsProfile(institutionId);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  async saveMfsProfile(req, res, next) {
    try {
      const institutionId = Number(req.params.institutionId);
      const data = await adminInstitutionsService.saveMfsProfile(
        institutionId,
        req.body,
        req.user,
        { ip: req.ip, userAgent: req.get("user-agent") }
      );
      res.json({ success: true, data, message: "MFS profile updated successfully" });
    } catch (err) {
      next(err);
    }
  },

  async updateDirectoryVerification(req, res, next) {
    try {
      const institutionId = Number(req.params.institutionId);
      const result = await adminInstitutionsService.updateDirectoryVerification(
        institutionId,
        req.body,
        req.user,
        { ip: req.ip, userAgent: req.get("user-agent") }
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  /* ========================================================================
     DATA IMPORTS
     ======================================================================== */

  async createDataImport(req, res, next) {
    try {
      const result = await adminInstitutionsService.createDataImport(
        req.body,
        req.user,
        { ip: req.ip, userAgent: req.get("user-agent") }
      );
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },

  async listDataImports(req, res, next) {
    try {
      const data = await adminInstitutionsService.listDataImports();
      res.json({ success: true, imports: data });
    } catch (err) {
      next(err);
    }
  },

  async getDataImportDetails(req, res, next) {
    try {
      const { id } = req.params;
      const data = await adminInstitutionsService.getDataImportDetails(id);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  async publishDataImport(req, res, next) {
    try {
      const { id } = req.params;
      const result = await adminInstitutionsService.publishDataImport(
        id,
        req.user,
        { ip: req.ip, userAgent: req.get("user-agent") }
      );
      res.json({ success: true, ...result, message: "Import published successfully" });
    } catch (err) {
      next(err);
    }
  },

  /* ========================================================================
     SERVICE POINTS (MFS)
     ======================================================================== */

  async listServicePoints(req, res, next) {
    try {
      const data = await adminInstitutionsService.listServicePoints(req.query);
      res.json({ success: true, ...data });
    } catch (err) {
      next(err);
    }
  },

  async createServicePoint(req, res, next) {
    try {
      const result = await adminInstitutionsService.createServicePoint(
        req.body,
        req.user,
        { ip: req.ip, userAgent: req.get("user-agent") }
      );
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },

  /* ========================================================================
     PARTNER ONBOARDING
     ======================================================================== */

  async listPartnerOnboardingApplications(req, res, next) {
    try {
      const data = await adminInstitutionsService.listPartnerOnboardingApplications(req.query);
      res.json({ success: true, ...data });
    } catch (err) {
      next(err);
    }
  },

  async reviewPartnerOnboardingApplication(req, res, next) {
    try {
      const { id } = req.params;
      const result = await adminInstitutionsService.reviewPartnerOnboardingApplication(
        { applicationId: id, ...req.body },
        req.user,
        { ip: req.ip, userAgent: req.get("user-agent") }
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
};


