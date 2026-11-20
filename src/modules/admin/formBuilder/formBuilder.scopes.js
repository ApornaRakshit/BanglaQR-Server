import { db } from "../../../config/db.js";

// Allowed form keys for dynamic customization (All 7 merchant onboarding steps)
export const DYNAMIC_CONTROLLED_SCOPES = new Set([
  "onboarding_company",
  "onboarding_contact",
  "onboarding_commercial",
  "onboarding_kyc",
  "onboarding_documents",
  "onboarding_verification",
  "onboarding_review",
  "merchant_onboarding", // legacy alias
]);

export function assertDynamicScopeAllowed(formKey) {
  if (formKey && !DYNAMIC_CONTROLLED_SCOPES.has(formKey)) {
    const err = new Error(
      `Form scope '${formKey}' is system-managed and cannot be altered, published, or discarded via generic Form Builder APIs.`
    );
    err.statusCode = 400;
    throw err;
  }
}

// System protected fields that cannot be made optional, hidden, deleted, or altered in core compliance
export const PROTECTED_SYSTEM_FIELDS = new Set([
  // Entry & Setup
  "merchant_segment",
  "business_entity_type",
  "business_category",
  "primary_business_activity_id",
  "additional_business_activities",
  // Company
  "company_name",
  "company_name_bangla",
  "trade_license_number",
  "trade_license_date",
  "trade_license_expiry_date",
  "trade_license_document",
  "business_type",
  "industry",
  "legal_business_name",
  "address",
  "city",
  "state",
  "postal_code",
  "country",
  // Contact
  "name",
  "phone",
  "email",
  "nid_no",
  // Commercial
  "settlement_type",
  "channel",
  // Banking & KYC Core
  "bank_id",
  "mfs_id",
  "institution_id",
  "bank_account_number",
  "bank_account_name",
  "routing_number",
  "nid_number",
  "tin",
  "bin",
  "authorized_person_name",
]);

