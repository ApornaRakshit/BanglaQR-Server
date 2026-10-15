import { z } from "zod";

export const companySchema = z.object({
  companyName: z.string().trim().min(2, "Company name must be at least 2 characters"),
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
});

export const contactSchema = z.object({
  name: z.string().trim()
    .min(3, "Contact person name must be at least 3 characters")
    .regex(/^[a-zA-Z\s.-]+$/, "Contact person name can only contain alphabetic characters"),
  designation: z.string().trim().min(2, "Designation must be at least 2 characters").optional().default(""),
  email: z.string().trim().email("Please provide a valid email address (e.g. name@company.com)"),
  phone: z.string().trim().regex(
    /^(?:\+?880|0)?1[3-9]\d{8}$/,
    "Please enter a valid 11-digit Bangladeshi mobile number (e.g. 017XXXXXXXX)"
  ),
});

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
});

export const kycSchema = z.object({
  legalBusinessName: z.string().trim().min(2, "Legal entity business name must be at least 2 characters"),
  businessEntityType: z.string().trim().min(1, "Please select a valid business entity type"),
  tradeLicenseNumber: z.string().trim().min(3, "Trade license number must be at least 3 characters"),
  registrationNumber: z.string().trim().optional().default(""),
  tin: z.string().trim().regex(
    /^\d{12}$/,
    "Tax Identification Number (TIN) must be exactly 12 numeric digits"
  ),
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
  bankName: z.string().trim().min(2, "Please select or provide a valid bank name"),
  branchName: z.string().trim().min(2, "Branch name must be at least 2 characters"),
  branchCode: z.string().trim().optional().nullable().default(null),
  division: z.string().trim().optional().nullable().default(null),
  district: z.string().trim().optional().nullable().default(null),
  upazila: z.string().trim().optional().nullable().default(null),
  branchAddress: z.string().trim().optional().nullable().default(null),
  accountHolderName: z.string().trim().min(2, "Account holder name must be at least 2 characters"),
  accountNumber: z.string().trim()
    .min(8, "Bank account number must be at least 8 digits")
    .max(25, "Bank account number cannot exceed 25 characters")
    .regex(/^[0-9A-Za-z-]+$/, "Account number can only contain numbers, letters, or hyphens"),
  routingNumber: z.string().trim().regex(
    /^\d{9}$/,
    "Routing number must be exactly 9 numeric digits (e.g. 060271234)"
  ),
  accountType: z.enum(["Current", "Savings", "Business"]).default("Current"),
});

export const ALLOWED_DOC_TYPES = [
  "NID_FRONT",
  "NID_BACK",
  "TIN_CERTIFICATE",
  "BIN_CERTIFICATE",
  "CANCELLED_BANK_CHEQUE",
  "TRADE_LICENSE",
  "COMPANY_REGISTRATION",
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
});
