import { z } from "zod";

export const SEGMENTS = ["micro", "big"];
export const CHANNELS = ["bank", "mfs"];
export const FIELD_TYPES = [
  "text",
  "textarea",
  "number",
  "email",
  "url",
  "phone",
  "date",
  "select",
  "multi_select",
  "checkbox",
  "radio",
  "file_upload",
];
export const FIELD_WIDTHS = ["100%", "66.67%", "50%", "33.33%", "25%"];
export const normalizeWidth = (w) => {
  if (w === "full" || w === "100%") return "100%";
  if (w === "half" || w === "50%") return "50%";
  if (w === "one_third" || w === "33.33%" || w === "33%") return "33.33%";
  if (w === "two_thirds" || w === "66.67%" || w === "66%") return "66.67%";
  if (w === "quarter" || w === "25%") return "25%";
  return "50%";
};
export const FIELD_ALIGNMENTS = ["left", "center", "right"];

export const createDraftSchema = z.object({
  formKey: z.string().trim().min(2).max(50).default("merchant_onboarding"),
  fromVersionId: z.number().int().positive().optional().nullable(),
});

export const saveSectionSchema = z.object({
  id: z.number().int().positive().optional().nullable(),
  sectionKey: z.string().trim().min(2).max(50).regex(/^[a-z0-9_]+$/, "Section key must be lowercase letters, numbers, or underscores"),
  titleBn: z.string().trim().min(1, "Bengali title is required").max(150),
  titleEn: z.string().trim().min(1, "English title is required").max(150),
  descriptionBn: z.string().trim().optional().nullable().default(""),
  descriptionEn: z.string().trim().optional().nullable().default(""),
  displayOrder: z.number().int().nonnegative().default(0),
  isActive: z.boolean().default(true),
});

export const reorderSectionsSchema = z.object({
  sectionIds: z.array(z.number().int().positive()).min(1),
});

export const fieldOptionSchema = z.object({
  id: z.number().int().positive().optional().nullable(),
  optionValue: z.string().trim().min(1).max(100),
  labelBn: z.string().trim().min(1).max(150),
  labelEn: z.string().trim().min(1).max(150),
  displayOrder: z.number().int().nonnegative().default(0),
  isActive: z.boolean().default(true),
});

export const fieldRuleSchema = z.object({
  merchantSegment: z.enum(["micro", "big"]),
  channel: z.enum(["bank", "mfs"]),
  isVisible: z.boolean().default(true),
  isRequired: z.boolean().default(false),
});

export const saveFieldSchema = z.object({
  id: z.number().int().positive().optional().nullable(),
  sectionId: z.number().int().positive("Valid section ID is required"),
  fieldKey: z.string().trim().min(2).max(50).regex(/^[a-z0-9_]+$/, "Field key must be lowercase letters, numbers, or underscores"),
  systemFieldKey: z.string().trim().max(50).optional().nullable(),
  labelBn: z.string().trim().min(1, "Bengali label is required").max(150),
  labelEn: z.string().trim().min(1, "English label is required").max(150),
  helpTextBn: z.string().trim().optional().nullable().default(""),
  helpTextEn: z.string().trim().optional().nullable().default(""),
  placeholderBn: z.string().trim().optional().nullable().default(""),
  placeholderEn: z.string().trim().optional().nullable().default(""),
  descriptionBn: z.string().trim().optional().nullable().default(""),
  descriptionEn: z.string().trim().optional().nullable().default(""),
  fieldType: z.enum(FIELD_TYPES),
  fieldWidth: z
    .string()
    .optional()
    .transform((val) => normalizeWidth(val))
    .default("50%"),
  alignment: z.enum(FIELD_ALIGNMENTS).default("left"),
  displayOrder: z.number().int().nonnegative().default(0),
  isVisible: z.boolean().default(true),
  isRequired: z.boolean().default(false),
  isSystemField: z.boolean().default(false),
  isActive: z.boolean().default(true),
  validationConfig: z.record(z.any()).optional().nullable().default({}),
  options: z.array(fieldOptionSchema).optional().default([]),
  rules: z.array(fieldRuleSchema).optional().default([]),
});

export const reorderFieldsSchema = z.object({
  sectionId: z.number().int().positive(),
  fieldIds: z.array(z.number().int().positive()).min(1),
});

