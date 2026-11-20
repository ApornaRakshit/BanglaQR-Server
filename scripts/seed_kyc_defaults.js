import { db } from "../src/config/db.js";

async function seed() {
  const defaults = [
    {
      scope: 'global',
      channel_type: 'all',
      institution_id: null,
      name: 'National ID (Front)',
      requirement_code: 'NID_FRONT',
      requirement_category: 'identity',
      requirement_type: 'document_upload',
      applicable_business_types: 'both',
      document_type: 'nid_front',
      description: 'Clear colored scan or photo of the front side of National ID card',
      instructions: 'Ensure full card edges are visible and texts/numbers are sharp and readable.',
      allowed_extensions: 'pdf,jpg,jpeg,png,webp',
      max_file_size_mb: 5,
      max_pdf_pages: 2,
      is_mandatory: 1,
      display_order: 10
    },
    {
      scope: 'global',
      channel_type: 'all',
      institution_id: null,
      name: 'National ID (Back)',
      requirement_code: 'NID_BACK',
      requirement_category: 'identity',
      requirement_type: 'document_upload',
      applicable_business_types: 'both',
      document_type: 'nid_back',
      description: 'Clear colored scan or photo of the back side of National ID card',
      instructions: 'Ensure barcode and address are clearly legible.',
      allowed_extensions: 'pdf,jpg,jpeg,png,webp',
      max_file_size_mb: 5,
      max_pdf_pages: 2,
      is_mandatory: 1,
      display_order: 20
    },
    {
      scope: 'global',
      channel_type: 'all',
      institution_id: null,
      name: 'Merchant Signature',
      requirement_code: 'MERCHANT_SIGNATURE',
      requirement_category: 'identity',
      requirement_type: 'document_upload',
      applicable_business_types: 'both',
      document_type: 'signature',
      description: 'Specimen signature of authorized merchant signatory on plain white paper',
      instructions: 'Sign with a dark blue or black pen on blank paper and capture clear image.',
      allowed_extensions: 'jpg,jpeg,png,webp',
      max_file_size_mb: 3,
      max_pdf_pages: 1,
      is_mandatory: 1,
      display_order: 30
    },
    {
      scope: 'global',
      channel_type: 'all',
      institution_id: null,
      name: 'Utility Bill',
      requirement_code: 'UTILITY_BILL',
      requirement_category: 'address_verification',
      requirement_type: 'document_upload',
      applicable_business_types: 'both',
      document_type: 'utility_bill',
      description: 'Recent electricity, gas, water, or telephone bill showing business/residence address',
      instructions: 'Must not be older than 3 months.',
      allowed_extensions: 'pdf,jpg,jpeg,png,webp',
      max_file_size_mb: 5,
      max_pdf_pages: 3,
      is_mandatory: 1,
      display_order: 40
    },
    {
      scope: 'global',
      channel_type: 'all',
      institution_id: null,
      name: 'e-TIN Certificate',
      requirement_code: 'TIN_CERTIFICATE',
      requirement_category: 'business_identity',
      requirement_type: 'document_upload',
      applicable_business_types: 'both',
      document_type: 'tin_certificate',
      description: 'Government 12-digit Tax Identification Number (e-TIN) certificate',
      instructions: 'Official PDF or scan issued by the National Board of Revenue (NBR).',
      allowed_extensions: 'pdf,jpg,jpeg,png,webp',
      max_file_size_mb: 5,
      max_pdf_pages: 2,
      is_mandatory: 1,
      display_order: 50
    },
    {
      scope: 'global',
      channel_type: 'all',
      institution_id: null,
      name: 'Nominee Passport Size Photo',
      requirement_code: 'NOMINEE_PHOTO',
      requirement_category: 'nominee',
      requirement_type: 'document_upload',
      applicable_business_types: 'both',
      document_type: 'passport_photo',
      description: 'Recent formal passport-size colored photograph of legal nominee',
      instructions: 'Clear front-facing portrait with light background.',
      allowed_extensions: 'jpg,jpeg,png,webp',
      max_file_size_mb: 3,
      max_pdf_pages: 1,
      is_mandatory: 1,
      display_order: 60
    },
    {
      scope: 'global',
      channel_type: 'all',
      institution_id: null,
      name: 'Nominee National ID',
      requirement_code: 'NOMINEE_NID',
      requirement_category: 'nominee',
      requirement_type: 'document_upload',
      applicable_business_types: 'both',
      document_type: 'nid',
      description: 'Valid National ID card copy of nominated beneficiary',
      instructions: 'Both sides legible or combined into a single scan.',
      allowed_extensions: 'pdf,jpg,jpeg,png,webp',
      max_file_size_mb: 5,
      max_pdf_pages: 2,
      is_mandatory: 1,
      display_order: 70
    },
    {
      scope: 'global',
      channel_type: 'all',
      institution_id: null,
      name: 'Nominee Signature',
      requirement_code: 'NOMINEE_SIGNATURE',
      requirement_category: 'nominee',
      requirement_type: 'document_upload',
      applicable_business_types: 'both',
      document_type: 'signature',
      description: 'Specimen signature of the legal nominee on plain paper',
      instructions: 'Signature must match nominee official identity.',
      allowed_extensions: 'jpg,jpeg,png,webp',
      max_file_size_mb: 3,
      max_pdf_pages: 1,
      is_mandatory: 1,
      display_order: 80
    },
    {
      scope: 'channel',
      channel_type: 'bank',
      institution_id: null,
      name: 'Cancelled Bank Cheque Leaf / Statement',
      requirement_code: 'CANCELLED_BANK_CHEQUE',
      requirement_category: 'financial_settlement',
      requirement_type: 'document_upload',
      applicable_business_types: 'big_merchant',
      document_type: 'bank_statement',
      description: 'Cancelled cheque leaf or official bank account statement showing account title and routing number for settlement via Partner Bank',
      instructions: "Write 'CANCELLED' across the cheque leaf without obscuring the account title, MICR band, or routing number.",
      allowed_extensions: 'pdf,jpg,jpeg,png,webp',
      max_file_size_mb: 5,
      max_pdf_pages: 2,
      is_mandatory: 1,
      display_order: 90
    },
    {
      scope: 'channel',
      channel_type: 'mfs',
      institution_id: null,
      name: 'MFS Merchant Wallet Statement / SIM Ownership',
      requirement_code: 'MFS_WALLET_STATEMENT',
      requirement_category: 'financial_settlement',
      requirement_type: 'document_upload',
      applicable_business_types: 'both',
      document_type: 'mfs_statement',
      description: 'Verification document showing merchant registration or SIM ownership for settlement via MFS Provider',
      instructions: 'Upload confirmation screenshot or account statement.',
      allowed_extensions: 'pdf,jpg,jpeg,png,webp',
      max_file_size_mb: 5,
      max_pdf_pages: 3,
      is_mandatory: 0,
      display_order: 90
    }
  ];

  for (const d of defaults) {
    const [existing] = await db.query(
      'SELECT id FROM institution_kyc_requirements WHERE requirement_code = ? AND scope = ? AND (channel_type = ? OR channel_type IS NULL) LIMIT 1',
      [d.requirement_code, d.scope, d.channel_type]
    );
    if (existing.length === 0) {
      await db.query(
        `INSERT INTO institution_kyc_requirements 
        (scope, channel_type, institution_id, name, requirement_code, requirement_category, requirement_type, applicable_business_types, document_type, description, instructions, allowed_extensions, max_file_size_mb, max_pdf_pages, is_mandatory, display_order, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
        [
          d.scope, d.channel_type, d.institution_id, d.name, d.requirement_code, d.requirement_category, d.requirement_type, d.applicable_business_types, d.document_type, d.description, d.instructions, d.allowed_extensions, d.max_file_size_mb, d.max_pdf_pages, d.is_mandatory, d.display_order
        ]
      );
    }
  }
  console.log('Seeded baseline global & channel records in DB');
  const [allReqs] = await db.query('SELECT id, scope, channel_type, requirement_code, name FROM institution_kyc_requirements');
  console.log('All DB Requirements count:', allReqs.length);
  await db.end();
}

seed().catch(console.error);

