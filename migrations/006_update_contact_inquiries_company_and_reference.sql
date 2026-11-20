-- Migration 006: Add company_name, inquiry_reference, and admin_notes to contact_inquiries
ALTER TABLE contact_inquiries
  ADD COLUMN company_name VARCHAR(150) NULL AFTER email,
  ADD COLUMN inquiry_reference VARCHAR(60) NULL AFTER company_name,
  ADD COLUMN admin_notes TEXT NULL AFTER message;

ALTER TABLE contact_inquiries ADD UNIQUE INDEX uq_contact_inquiries_ref (inquiry_reference);

