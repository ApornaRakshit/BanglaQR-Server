import { z } from "zod";

export const companySchema = z.object({
  merchantSegment: z.enum(["micro", "big"]).optional().nullable(),
  companyName: z.string().trim().min(2, "Company name must be at least 2 characters").or(z.literal("")),
  businessType: z.string().trim().optional().default(""),
  industry: z.string().trim().optional().default(""),
  website: z.string().trim().optional().refine(
    (val) => !val || /^https?:\/\/.+\..+/.test(val),
    "Please enter a valid website URL starting with http:// or https://"
  ).default(""),
  address: z.string().trim().optional().default(""),
  city: z.string().trim().optional().default(""),
  state: z.string().trim().optional().default(""),
  postalCode: z.string().trim().optional().refine(
    (val) => !val || /^\d{4}$/.test(val),
    "Postal code must be a 4-digit code (e.g. 1209)"
  ).default(""),
  country: z.string().trim().optional().default("Bangladesh"),
  institutionId: z.coerce.number().positive().optional().nullable().default(null),
  channel: z.string().trim().optional().nullable().default(null),
  bankName: z.string().trim().optional().nullable().default(null),
  branchId: z.coerce.number().positive().optional().nullable().default(null),
  branchName: z.string().trim().optional().nullable().default(null),
  routingNumber: z.string().trim().regex(/^\d{9}$/, "রাউটিং নম্বর অবশ্যই ৯ ডিজিটের সংখ্যা হতে হবে (Routing number must be exactly 9 digits)").optional().nullable().or(z.literal("")),
  hasExistingAccount: z.boolean().optional().default(true),
  applyNewAccount: z.boolean().optional().default(false),
  accountOpeningStatus: z.string().optional().nullable().default(null),
}).passthrough();

// Draft endpoints deliberately accept incomplete values. Full business requirements
// are enforced by submitApplication; an autosave must not reject a field mid-entry.
export const companyDraftSchema = z.object({
  merchantSegment: z.preprocess((v) => {
    if (v === "" || v === undefined) return null;
    return v;
  }, z.enum(["micro", "big"]).nullable().optional()),
  companyName: z.string().trim().optional(),
  businessType: z.string().trim().optional(),
  industry: z.string().trim().optional(),
  website: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().optional(),
  institutionId: z.preprocess((v) => v === "" ? null : v, z.coerce.number().positive().nullable().optional()),
  channel: z.string().optional().nullable(),
  bankName: z.string().optional().nullable(),
  branchId: z.preprocess((v) => v === "" ? null : v, z.coerce.number().positive().nullable().optional()),
  branchName: z.string().optional().nullable(),
  routingNumber: z.string().optional().nullable(),
  hasExistingAccount: z.boolean().optional(),
  applyNewAccount: z.boolean().optional(),
  accountOpeningStatus: z.string().optional().nullable(),
  clearFields: z.array(z.string()).optional(),
}).passthrough();

const normalizeGender = (val) => {
  if (val === "" || val === undefined || val === null) return null;
  const s = String(val).trim().toLowerCase();
  if (s.includes("female") || s.includes("নারী") || s.includes("মহিলা")) return "Female";
  if (s.includes("male") || s.includes("পুরুষ") || s.includes("ছেলে")) return "Male";
  if (s.includes("other") || s.includes("অন্যান্য") || s.includes("তৃতীয়")) return "Other";
  return val;
};

const normalizeMaritalStatus = (val) => {
  if (val === "" || val === undefined || val === null) return null;
  const s = String(val).trim().toLowerCase();
  if (s.includes("married") || s.includes("বিবাহিত")) return "Married";
  if (s.includes("single") || s.includes("অবিবাহিত")) return "Single";
  if (s.includes("divorced") || s.includes("তালাকপ্রাপ্ত")) return "Divorced";
  if (s.includes("separated") || s.includes("বিচ্ছিন্ন")) return "Separated";
  return val;
};

export const contactSchema = z.object({
  name: z.string().trim()
    .min(3, "Contact person name must be at least 3 characters")
    .regex(/^[a-zA-Z\s.-]+$/, "Contact person name can only contain alphabetic characters")
    .optional().nullable().or(z.literal("")),
  nameBn: z.string().trim().min(3, "নাম বাংলায় কমপক্ষে ৩ অক্ষরের হতে হবে").optional().nullable().or(z.literal("")),
  designation: z.string().trim().optional().nullable().default(""),
  email: z.preprocess(
    (val) => (val === null || val === undefined ? "" : String(val).trim()),
    z.string().email("Please provide a valid email address (e.g. name@company.com)").optional().nullable().or(z.literal(""))
  ),
  phone: z.preprocess(
    (val) => (typeof val === "string" ? val.replace(/[\s-]/g, "") : (val ?? "")),
    z.string().regex(
      /^(?:\+?880|0)?1[3-9]\d{8}$/,
      "Please enter a valid 11-digit Bangladeshi mobile number (e.g. 017XXXXXXXX)"
    ).optional().nullable().or(z.literal(""))
  ),
  nidNo: z.string().trim().optional().nullable().default(""),
  division: z.string().trim().optional().nullable().default(""),
  country: z.string().trim().optional().nullable().default("Bangladesh"),
  dob: z.preprocess((val) => (val === "" || val === undefined ? null : val), z.string().optional().nullable().default(null)),
  fatherName: z.string().trim().optional().nullable().default(""),
  motherName: z.string().trim().optional().nullable().default(""),
  gender: z.preprocess(normalizeGender, z.enum(["Male", "Female", "Other"]).optional().nullable().default(null)),
  permanentAddress: z.string().trim().optional().nullable().default(""),
  presentAddress: z.string().trim().optional().nullable().default(""),
  isSameAddress: z.preprocess((val) => Boolean(val), z.boolean().optional().default(false)),
  maritalStatus: z.preprocess(normalizeMaritalStatus, z.enum(["Single", "Married", "Separated", "Divorced"]).optional().nullable().default(null)),
  spouseName: z.string().trim().optional().nullable().default(""),
  passportNo: z.string().trim().optional().nullable().default(""),
  otherId: z.string().trim().optional().nullable().default(""),
  nomineeName: z.string().trim().optional().nullable().default(""),
  nomineeRelation: z.string().trim().optional().nullable().default(""),
  nomineeCustomRelation: z.string().trim().optional().nullable().default(""),
  nomineeMobile: z.preprocess((val) => (typeof val === "string" ? val.replace(/[\s-]/g, "") : (val ?? "")), z.string().optional().nullable().default("")),
  nomineeNid: z.string().trim().optional().nullable().default(""),
}).passthrough();

export const contactDraftSchema = z.object({
  name: z.string().trim().optional().nullable().default(""),
  nameBn: z.string().trim().optional().nullable().default(""),
  designation: z.string().trim().optional().nullable().default(""),
  email: z.preprocess((val) => (val === null || val === undefined ? "" : String(val).trim()), z.string().optional().nullable().default("")),
  phone: z.preprocess((val) => (typeof val === "string" ? val.replace(/[\s-]/g, "") : (val ?? "")), z.string().optional().nullable().default("")),
  nidNo: z.string().trim().optional().nullable().default(""),
  division: z.string().trim().optional().nullable().default(""),
  country: z.string().trim().optional().nullable().default("Bangladesh"),
  dob: z.preprocess((val) => (val === "" || val === undefined ? null : val), z.string().optional().nullable().default(null)),
  fatherName: z.string().trim().optional().nullable().default(""),
  motherName: z.string().trim().optional().nullable().default(""),
  gender: z.preprocess(normalizeGender, z.enum(["Male", "Female", "Other"]).optional().nullable().default(null)),
  permanentAddress: z.string().trim().optional().nullable().default(""),
  presentAddress: z.string().trim().optional().nullable().default(""),
  isSameAddress: z.preprocess((val) => Boolean(val), z.boolean().optional().default(false)),
  maritalStatus: z.preprocess(normalizeMaritalStatus, z.enum(["Single", "Married", "Separated", "Divorced"]).optional().nullable().default(null)),
  spouseName: z.string().trim().optional().nullable().default(""),
  passportNo: z.string().trim().optional().nullable().default(""),
  otherId: z.string().trim().optional().nullable().default(""),
  nomineeName: z.string().trim().optional().nullable().default(""),
  nomineeRelation: z.string().trim().optional().nullable().default(""),
  nomineeCustomRelation: z.string().trim().optional().nullable().default(""),
  nomineeMobile: z.preprocess((val) => (typeof val === "string" ? val.replace(/[\s-]/g, "") : (val ?? "")), z.string().optional().nullable().default("")),
  nomineeNid: z.string().trim().optional().nullable().default(""),
  institutionId: z.preprocess((v) => v === "" ? null : v, z.coerce.number().positive().nullable().optional()),
  clearFields: z.array(z.string()).optional(),
}).passthrough();

export const commercialSchema = z.object({
  transactionsPerDay: z.coerce.number().min(0, "Transactions per day cannot be negative").default(0),
  transactionsPerMonth: z.coerce.number().min(0, "Transactions per month cannot be negative").default(0),
  volumePerDay: z.coerce.number().min(0, "Volume per day cannot be negative").default(0),
  volumePerMonth: z.coerce.number().min(0, "Volume per month cannot be negative").default(0),
  maximumTicketSize: z.coerce.number().min(0, "Maximum ticket size cannot be negative").default(0),
  returnUrl: z.string().trim().optional().refine(
    (val) => !val || /^https?:\/\/.+/.test(val),
    "Return URL must start with http:// or https://"
  ).default(""),
  merchantDomain: z.string().trim().optional().default(""),
  merchantIpAddress: z.string().trim().optional().refine(
    (val) => !val || /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(val),
    "Please enter a valid IPv4 address (e.g. 103.145.12.4)"
  ).default(""),
}).passthrough();

export const kycSchema = z.object({
  legalBusinessName: z.string().trim().min(2, "Legal entity business name must be at least 2 characters"),
  businessEntityType: z.string().trim().optional().default(""),
  tradeLicenseNumber: z.string().trim().optional().default(""),
  registrationNumber: z.string().trim().optional().default(""),
  tin: z.string().trim().optional().refine(
    (val) => !val || /^\d{10,12}$/.test(val),
    "Tax Identification Number (TIN) must be 10 to 12 numeric digits"
  ).default(""),
  bin: z.string().trim().optional().refine(
    (val) => !val || /^\d{9,13}$/.test(val.replace(/[-\s]/g, "")),
    "BIN / VAT registration number must be 9 to 13 digits"
  ).default(""),
  authorizedPersonName: z.string().trim()
    .min(3, "Authorized person name must be at least 3 characters")
    .regex(/^[a-zA-Z\s.-]+$/, "Authorized person name can only contain letters, spaces, dots, and hyphens"),
  designation: z.string().trim().min(2, "Designation must be at least 2 characters"),
  nidNumber: z.string().trim().refine(
    (val) => /^\d{10}$|^\d{13}$|^\d{17}$/.test(val.replace(/\s/g, "")),
    "National ID (NID) must be exactly 10 digits (Smart Card), 13 digits, or 17 digits (numbers only)"
  ),
  nidIssueDate: z.string().trim().optional().nullable().default(null),
  nidExpiryDate: z.string().trim().optional().nullable().default(null),
  institutionId: z.coerce.number().positive().optional().nullable().default(null),
  branchId: z.coerce.number().positive().optional().nullable().default(null),
  bankName: z.string().trim().min(2, "Please select or provide a valid bank or MFS provider name"),
  branchName: z.string().trim().optional().nullable().default("").or(z.literal("")),
  branchCode: z.string().trim().optional().nullable().default(null),
  division: z.string().trim().optional().nullable().default(null),
  district: z.string().trim().optional().nullable().default(null),
  upazila: z.string().trim().optional().nullable().default(null),
  branchAddress: z.string().trim().optional().nullable().default(null),
  accountHolderName: z.string().trim().optional().default(""),
  accountNumber: z.string().trim().optional().default(""),
  routingNumber: z.string().trim().regex(
    /^\d{9}$/,
    "Routing number must be exactly 9 numeric digits (e.g. 060271234)"
  ).optional().nullable().or(z.literal("")),
  hasExistingAccount: z.boolean().optional().default(true),
  applyNewAccount: z.boolean().optional().default(false),
  accountOpeningStatus: z.string().optional().nullable().default(null),
  accountType: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? "Current" : String(v)),
    z.string().min(1).default("Current")
  ),
  transactionsPerDay: z.coerce.number().min(0).optional().default(0),
  transactionsPerMonth: z.coerce.number().min(0).optional().default(0),
  volumePerDay: z.coerce.number().min(0).optional().default(0),
  volumePerMonth: z.coerce.number().min(0).optional().default(0),
  maximumTicketSize: z.coerce.number().min(0).optional().default(0),
  commercialData: z.record(z.any()).optional().nullable().default(null),
  kycFormData: z.record(z.any()).optional().nullable().default(null),
});

// KYC draft payload: format/required-field validation is deferred until final submission.
// This allows a merchant to save an incomplete form while typing NID/TIN/account details.
export const kycDraftSchema = z.object({
  legalBusinessName: z.string().nullable().optional(),
  businessEntityType: z.string().nullable().optional(),
  tradeLicenseNumber: z.string().nullable().optional(),
  registrationNumber: z.string().nullable().optional(),
  tin: z.string().nullable().optional(),
  bin: z.string().nullable().optional(),
  authorizedPersonName: z.string().nullable().optional(),
  designation: z.string().nullable().optional(),
  nidNumber: z.string().nullable().optional(),
  nidIssueDate: z.string().nullable().optional(),
  nidExpiryDate: z.string().nullable().optional(),
  institutionId: z.preprocess((v) => v === "" ? null : v, z.coerce.number().positive().nullable().optional()),
  branchId: z.preprocess((v) => v === "" ? null : v, z.coerce.number().positive().nullable().optional()),
  bankName: z.string().optional().nullable(),
  branchName: z.string().optional().nullable(),
  branchCode: z.string().optional().nullable(),
  division: z.string().optional().nullable(),
  district: z.string().optional().nullable(),
  upazila: z.string().optional().nullable(),
  branchAddress: z.string().optional().nullable(),
  accountHolderName: z.string().nullable().optional(),
  accountNumber: z.string().nullable().optional(),
  routingNumber: z.string().optional().nullable(),
  accountType: z.preprocess((v) => (v === "" || v === null ? undefined : String(v)), z.string().optional()),
  hasExistingAccount: z.boolean().optional(),
  applyNewAccount: z.boolean().optional(),
  accountOpeningStatus: z.string().optional().nullable(),
  transactionsPerDay: z.union([z.string(), z.number()]).optional(),
  transactionsPerMonth: z.union([z.string(), z.number()]).optional(),
  volumePerDay: z.union([z.string(), z.number()]).optional(),
  volumePerMonth: z.union([z.string(), z.number()]).optional(),
  maximumTicketSize: z.union([z.string(), z.number()]).optional(),
  commercialData: z.record(z.any()).optional().nullable(),
  kycFormData: z.record(z.any()).optional().nullable(),
  clearFields: z.array(z.string()).optional(),
}).passthrough();

export const ALLOWED_DOC_TYPES = [
  "NID_FRONT",
  "NID_BACK",
  "MERCHANT_SIGNATURE",
  "MERCHANT_NID_SIGNATURE",
  "PASSPORT_PHOTO",
  "UTILITY_BILL",
  "NOMINEE_PHOTO",
  "NOMINEE_PASSPORT_PHOTO",
  "NOMINEE_NID",
  "NOMINEE_UTILITY_BILL",
  "NOMINEE_SIGNATURE",
  "NOMINEE_NID_SIGNATURE",
  "INCOME_SOURCE_DOC",
  "TIN_CERTIFICATE",
  "BIN_CERTIFICATE",
  "BANK_STATEMENT",
  "CANCELLED_BANK_CHEQUE",
  "TRADE_LICENSE",
  "COMPANY_REGISTRATION",
  "BUSINESS_OUTLET_PHOTO",
  "OTHER",
];

export const documentUploadSchema = z.object({
  documentType: z.string().trim().refine(
    (val) => ALLOWED_DOC_TYPES.includes(val.toUpperCase()),
    {
      message: `Invalid document type. Allowed types: ${ALLOWED_DOC_TYPES.join(", ")}`,
    }
  ).transform((val) => val.toUpperCase()),
  documentName: z.string().trim().optional(),
  customLabel: z.string().trim().optional(),
  institutionId: z.preprocess((v) => v === "" ? null : v, z.coerce.number().positive().nullable().optional()),
});

export const updateActivitiesSchema = z.object({
  primaryActivityId: z.union([
    z.number().int().positive("Primary activity ID must be a positive integer"),
    z.string().regex(/^\d+$/, "Primary activity ID must be a numeric integer").transform(Number),
    z.null()
  ]).optional().nullable(),
  additionalActivityIds: z.array(
    z.union([
      z.number().int().positive("Additional activity ID must be a positive integer"),
      z.string().regex(/^\d+$/, "Additional activity ID must be a numeric integer").transform(Number)
    ])
  ).optional().default([]),
});
