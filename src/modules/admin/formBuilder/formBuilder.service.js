import { db } from "../../../config/db.js";
import {
  DYNAMIC_CONTROLLED_SCOPES,
  assertDynamicScopeAllowed,
  PROTECTED_SYSTEM_FIELDS,
} from "./formBuilder.scopes.js";
import { STEP_SEEDS } from "./formBuilder.seeds.js";

export { DYNAMIC_CONTROLLED_SCOPES, assertDynamicScopeAllowed, PROTECTED_SYSTEM_FIELDS };

export const formBuilderService = {
  /**
   * Get all versions for a given form scope (e.g. 'onboarding_company', 'onboarding_contact', etc.)
   */
  async getVersions(formKey = "onboarding_company") {
    assertDynamicScopeAllowed(formKey);

    const [versions] = await db.query(
      `SELECT mfv.id, mfv.form_key, mfv.version_number, mfv.status,
              mfv.published_at, mfv.published_by, mfv.created_by,
              mfv.created_at, mfv.updated_at,
              u_pub.email AS published_by_email,
              u_create.email AS created_by_email,
              (SELECT COUNT(*) FROM merchant_form_sections WHERE form_version_id = mfv.id) AS section_count,
              (SELECT COUNT(*) FROM merchant_form_fields WHERE form_version_id = mfv.id) AS field_count
       FROM merchant_form_versions mfv
       LEFT JOIN users u_pub ON u_pub.id = mfv.published_by
       LEFT JOIN users u_create ON u_create.id = mfv.created_by
       WHERE mfv.form_key = ?
       ORDER BY mfv.version_number DESC`,
      [formKey]
    );

    const published = versions.find((v) => v.status === "published") || null;
    const draft = versions.find((v) => v.status === "draft") || null;

    return {
      formKey,
      versions,
      publishedVersion: published,
      draftVersion: draft,
    };
  },

  /**
   * Get full version details with sections, fields, options, and rules
   */
  async getVersionDetails(versionId) {
    const [[version]] = await db.query(
      `SELECT mfv.*,
              u_pub.email AS published_by_email,
              u_create.email AS created_by_email
       FROM merchant_form_versions mfv
       LEFT JOIN users u_pub ON u_pub.id = mfv.published_by
       LEFT JOIN users u_create ON u_create.id = mfv.created_by
       WHERE mfv.id = ? LIMIT 1`,
      [versionId]
    );

    if (!version) {
      const err = new Error("Form version not found.");
      err.statusCode = 404;
      throw err;
    }

    // 1. Get sections
    const [sections] = await db.query(
      `SELECT * FROM merchant_form_sections
       WHERE form_version_id = ?
       ORDER BY display_order ASC, id ASC`,
      [versionId]
    );

    // 2. Get fields
    const [fields] = await db.query(
      `SELECT * FROM merchant_form_fields
       WHERE form_version_id = ?
       ORDER BY display_order ASC, id ASC`,
      [versionId]
    );

    // 3. Get options for choice fields
    const fieldIds = fields.map((f) => f.id);
    let options = [];
    let rules = [];

    if (fieldIds.length > 0) {
      const [optRows] = await db.query(
        `SELECT * FROM merchant_form_field_options
         WHERE field_id IN (?)
         ORDER BY display_order ASC, id ASC`,
        [fieldIds]
      );
      options = optRows;

      const [ruleRows] = await db.query(
        `SELECT * FROM merchant_form_field_rules
         WHERE field_id IN (?)`,
        [fieldIds]
      );
      rules = ruleRows;
    }

    // Map children into fields
    const fieldsWithChildren = fields.map((f) => ({
      ...f,
      options: options.filter((o) => o.field_id === f.id),
      rules: rules.filter((r) => r.field_id === f.id),
    }));

    // Map fields into sections
    const sectionsWithFields = sections.map((s) => ({
      ...s,
      fields: fieldsWithChildren.filter((f) => f.section_id === s.id),
    }));

    return {
      version,
      sections: sectionsWithFields,
    };
  },

  /**
   * Create a new draft form version (either blank or by cloning an existing published version)
   */
  async createDraft(userId, formKey = "onboarding_company", fromVersionId = null) {
    assertDynamicScopeAllowed(formKey);
    const conn = await db.getConnection();
    await conn.beginTransaction();

    try {
      // Check if draft already exists for this form_key
      const [existingDraft] = await conn.query(
        `SELECT id FROM merchant_form_versions WHERE form_key = ? AND status = 'draft' LIMIT 1`,
        [formKey]
      );
      if (existingDraft.length > 0) {
        const err = new Error("An active Draft Version already exists for this step. Please save, publish, or discard it first.");
        err.statusCode = 400;
        throw err;
      }

      // Determine next version number
      const [[maxRow]] = await conn.query(
        `SELECT COALESCE(MAX(version_number), 0) AS max_v FROM merchant_form_versions WHERE form_key = ?`,
        [formKey]
      );
      const nextVersionNumber = Number(maxRow.max_v) + 1;

      // 1. Create the draft version
      const [vResult] = await conn.query(
        `INSERT INTO merchant_form_versions (form_key, version_number, status, created_by, created_at, updated_at)
         VALUES (?, ?, 'draft', ?, NOW(), NOW())`,
        [formKey, nextVersionNumber, userId]
      );
      const newVersionId = vResult.insertId;

      // 2. Clone from existing version if requested
      if (fromVersionId) {
        const [[sourceVersion]] = await conn.query(
          `SELECT id, form_key FROM merchant_form_versions WHERE id = ? LIMIT 1`,
          [fromVersionId]
        );
        if (!sourceVersion) {
          const err = new Error("Source form version to clone from was not found.");
          err.statusCode = 404;
          throw err;
        }

        // Fetch source sections
        const [sections] = await conn.query(
          `SELECT * FROM merchant_form_sections WHERE form_version_id = ? ORDER BY display_order ASC`,
          [fromVersionId]
        );

        for (const sec of sections) {
          const [sRes] = await conn.query(
            `INSERT INTO merchant_form_sections
             (form_version_id, section_key, title_bn, title_en, description_bn, description_en, display_order, is_active, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
            [
              newVersionId,
              sec.section_key,
              sec.title_bn,
              sec.title_en,
              sec.description_bn,
              sec.description_en,
              sec.display_order,
              sec.is_active,
            ]
          );
          const newSectionId = sRes.insertId;

          // Fetch fields for this section
          const [fields] = await conn.query(
            `SELECT * FROM merchant_form_fields WHERE section_id = ? AND form_version_id = ? ORDER BY display_order ASC`,
            [sec.id, fromVersionId]
          );

          for (const f of fields) {
            const [fRes] = await conn.query(
              `INSERT INTO merchant_form_fields
               (form_version_id, section_id, field_key, system_field_key, label_bn, label_en, help_text_bn, help_text_en, placeholder_bn, placeholder_en, description_bn, description_en, field_type, field_width, alignment, display_order, is_visible, is_required, is_system_field, is_active, validation_config, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
              [
                newVersionId,
                newSectionId,
                f.field_key,
                f.system_field_key,
                f.label_bn,
                f.label_en,
                f.help_text_bn,
                f.help_text_en,
                f.placeholder_bn,
                f.placeholder_en,
                f.description_bn,
                f.description_en,
                f.field_type,
                f.field_width || "50%",
                f.alignment || "left",
                f.display_order,
                f.is_visible,
                f.is_required,
                f.is_system_field,
                f.is_active,
                f.validation_config ? JSON.stringify(f.validation_config) : null,
              ]
            );
            const newFieldId = fRes.insertId;

            // Clone options
            const [options] = await conn.query(
              `SELECT * FROM merchant_form_field_options WHERE field_id = ? ORDER BY display_order ASC`,
              [f.id]
            );
            for (const opt of options) {
              await conn.query(
                `INSERT INTO merchant_form_field_options
                 (field_id, option_value, label_bn, label_en, display_order, is_active, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`,
                [
                  newFieldId,
                  opt.option_value,
                  opt.label_bn,
                  opt.label_en,
                  opt.display_order,
                  opt.is_active,
                ]
              );
            }

            // Clone rules
            const [rules] = await conn.query(
              `SELECT * FROM merchant_form_field_rules WHERE field_id = ?`,
              [f.id]
            );
            for (const r of rules) {
              await conn.query(
                `INSERT INTO merchant_form_field_rules
                 (field_id, merchant_segment, channel, is_visible, is_required, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, NOW(), NOW())`,
                [
                  newFieldId,
                  r.merchant_segment,
                  r.channel,
                  r.is_visible,
                  r.is_required,
                ]
              );
            }
          }
        }
      }

      await conn.commit();
      return await this.getVersionDetails(newVersionId);
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  /**
   * Save or update section in a draft form
   */
  async saveSection(versionId, sectionData) {
    const [[version]] = await db.query(
      `SELECT status, form_key FROM merchant_form_versions WHERE id = ? LIMIT 1`,
      [versionId]
    );

    if (!version) {
      const err = new Error("Form version not found.");
      err.statusCode = 404;
      throw err;
    }

    assertDynamicScopeAllowed(version.form_key);
    if (version.status !== "draft") {
      const err = new Error("Cannot edit a section in a published or archived form version. Create a draft version instead.");
      err.statusCode = 400;
      throw err;
    }

    if (sectionData.id) {
      await db.query(
        `UPDATE merchant_form_sections
         SET section_key = ?, title_bn = ?, title_en = ?, description_bn = ?, description_en = ?, display_order = ?, is_active = ?, updated_at = NOW()
         WHERE id = ? AND form_version_id = ?`,
        [
          sectionData.sectionKey,
          sectionData.titleBn,
          sectionData.titleEn,
          sectionData.descriptionBn || "",
          sectionData.descriptionEn || "",
          sectionData.displayOrder || 0,
          sectionData.isActive !== false ? 1 : 0,
          sectionData.id,
          versionId,
        ]
      );
      return sectionData.id;
    } else {
      const [res] = await db.query(
        `INSERT INTO merchant_form_sections
         (form_version_id, section_key, title_bn, title_en, description_bn, description_en, display_order, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [
          versionId,
          sectionData.sectionKey,
          sectionData.titleBn,
          sectionData.titleEn,
          sectionData.descriptionBn || "",
          sectionData.descriptionEn || "",
          sectionData.displayOrder || 0,
          sectionData.isActive !== false ? 1 : 0,
        ]
      );
      return res.insertId;
    }
  },

  /**
   * Delete section and child fields in a draft
   */
  async deleteSection(versionId, sectionId) {
    const [[version]] = await db.query(
      `SELECT status, form_key FROM merchant_form_versions WHERE id = ? LIMIT 1`,
      [versionId]
    );
    if (!version || version.status !== "draft") {
      const err = new Error("Sections can only be deleted in a draft form version.");
      err.statusCode = 400;
      throw err;
    }
    assertDynamicScopeAllowed(version.form_key);

    const conn = await db.getConnection();
    await conn.beginTransaction();

    try {
      const [fields] = await conn.query(
        `SELECT id FROM merchant_form_fields WHERE section_id = ? AND form_version_id = ?`,
        [sectionId, versionId]
      );
      const fieldIds = fields.map((f) => f.id);

      if (fieldIds.length > 0) {
        await conn.query(`DELETE FROM merchant_form_field_rules WHERE field_id IN (?)`, [fieldIds]);
        await conn.query(`DELETE FROM merchant_form_field_options WHERE field_id IN (?)`, [fieldIds]);
        await conn.query(`DELETE FROM merchant_form_fields WHERE id IN (?)`, [fieldIds]);
      }

      await conn.query(`DELETE FROM merchant_form_sections WHERE id = ? AND form_version_id = ?`, [
        sectionId,
        versionId,
      ]);

      await conn.commit();
      return true;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  /**
   * Reorder sections within a draft
   */
  async reorderSections(versionId, sectionIds) {
    const [[version]] = await db.query(
      `SELECT status, form_key FROM merchant_form_versions WHERE id = ? LIMIT 1`,
      [versionId]
    );
    if (!version || version.status !== "draft") {
      const err = new Error("Sections can only be reordered in a draft form version.");
      err.statusCode = 400;
      throw err;
    }
    assertDynamicScopeAllowed(version.form_key);

    const conn = await db.getConnection();
    await conn.beginTransaction();
    try {
      for (let i = 0; i < sectionIds.length; i++) {
        await conn.query(
          `UPDATE merchant_form_sections SET display_order = ?, updated_at = NOW() WHERE id = ? AND form_version_id = ?`,
          [i + 1, sectionIds[i], versionId]
        );
      }
      await conn.commit();
      return true;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  /**
   * Save or update field in a draft
   */
  async saveField(versionId, fieldData) {
    const [[version]] = await db.query(
      `SELECT status, form_key FROM merchant_form_versions WHERE id = ? LIMIT 1`,
      [versionId]
    );
    if (!version) {
      const err = new Error("Form version not found.");
      err.statusCode = 404;
      throw err;
    }
    assertDynamicScopeAllowed(version.form_key);
    if (version.status !== "draft") {
      const err = new Error("Fields can only be modified in a draft form version.");
      err.statusCode = 400;
      throw err;
    }

    // Verify section belongs to this draft version
    const [[section]] = await db.query(
      `SELECT id FROM merchant_form_sections WHERE id = ? AND form_version_id = ? LIMIT 1`,
      [fieldData.sectionId, versionId]
    );
    if (!section) {
      const err = new Error("Specified section does not belong to this form version.");
      err.statusCode = 400;
      throw err;
    }

    // Protect core system fields
    const isProtected = PROTECTED_SYSTEM_FIELDS.has(fieldData.fieldKey);
    if (isProtected) {
      if (fieldData.isSystemField === false) {
        fieldData.isSystemField = true;
      }
      if (fieldData.isRequired === false) {
        // Enforce required for core system identifiers
        fieldData.isRequired = true;
      }
      if (fieldData.isVisible === false) {
        const err = new Error(`Protected system field '${fieldData.fieldKey}' cannot be hidden.`);
        err.statusCode = 400;
        throw err;
      }
    }

    if (fieldData.id) {
      const [[existingField]] = await db.query(
        `SELECT field_key, is_system_field, field_type, system_field_key FROM merchant_form_fields WHERE id = ? AND form_version_id = ? LIMIT 1`,
        [fieldData.id, versionId]
      );
      if (existingField) {
        const wasProtected = PROTECTED_SYSTEM_FIELDS.has(existingField.field_key) || existingField.is_system_field;
        if (wasProtected) {
          if (existingField.field_key !== fieldData.fieldKey) {
            const err = new Error(`Protected system field key '${existingField.field_key}' cannot be renamed.`);
            err.statusCode = 400;
            throw err;
          }
          if (existingField.field_type !== fieldData.fieldType) {
            const err = new Error(`Protected system field '${existingField.field_key}' field type cannot be changed.`);
            err.statusCode = 400;
            throw err;
          }
          if (existingField.system_field_key && fieldData.systemFieldKey && fieldData.systemFieldKey !== existingField.system_field_key) {
            const err = new Error(`Protected system field '${existingField.field_key}' system mapping cannot be modified.`);
            err.statusCode = 400;
            throw err;
          }
        }
      }
    }

    // Check duplicate field key within same draft version
    const [existingKey] = await db.query(
      `SELECT id FROM merchant_form_fields WHERE form_version_id = ? AND field_key = ? AND id != ? LIMIT 1`,
      [versionId, fieldData.fieldKey, fieldData.id || 0]
    );
    if (existingKey.length > 0) {
      const err = new Error(`Field key '${fieldData.fieldKey}' already exists in this form version. Field keys must be unique.`);
      err.statusCode = 400;
      throw err;
    }

    // Check duplicate option keys if choice field
    if (["select", "multi_select", "checkbox", "radio"].includes(fieldData.fieldType)) {
      const optionValues = (fieldData.options || []).map((o) => o.optionValue);
      const uniqueValues = new Set(optionValues);
      if (uniqueValues.size !== optionValues.length) {
        const err = new Error("Duplicate option values found within choice field.");
        err.statusCode = 400;
        throw err;
      }
    }

    const conn = await db.getConnection();
    await conn.beginTransaction();

    try {
      let fieldId = fieldData.id;

      if (fieldId) {
        await conn.query(
          `UPDATE merchant_form_fields
           SET section_id = ?, field_key = ?, system_field_key = ?, label_bn = ?, label_en = ?, help_text_bn = ?, help_text_en = ?, placeholder_bn = ?, placeholder_en = ?, description_bn = ?, description_en = ?, field_type = ?, field_width = ?, alignment = ?, display_order = ?, is_visible = ?, is_required = ?, is_system_field = ?, is_active = ?, validation_config = ?, updated_at = NOW()
           WHERE id = ? AND form_version_id = ?`,
          [
            fieldData.sectionId,
            fieldData.fieldKey,
            fieldData.systemFieldKey || null,
            fieldData.labelBn,
            fieldData.labelEn,
            fieldData.helpTextBn || "",
            fieldData.helpTextEn || "",
            fieldData.placeholderBn || "",
            fieldData.placeholderEn || "",
            fieldData.descriptionBn || "",
            fieldData.descriptionEn || "",
            fieldData.fieldType,
            fieldData.fieldWidth || "50%",
            fieldData.alignment || "left",
            fieldData.displayOrder || 0,
            fieldData.isVisible !== false ? 1 : 0,
            fieldData.isRequired ? 1 : 0,
            fieldData.isSystemField ? 1 : 0,
            fieldData.isActive !== false ? 1 : 0,
            fieldData.validationConfig ? JSON.stringify(fieldData.validationConfig) : null,
            fieldId,
            versionId,
          ]
        );
      } else {
        const [fRes] = await conn.query(
          `INSERT INTO merchant_form_fields
           (form_version_id, section_id, field_key, system_field_key, label_bn, label_en, help_text_bn, help_text_en, placeholder_bn, placeholder_en, description_bn, description_en, field_type, field_width, alignment, display_order, is_visible, is_required, is_system_field, is_active, validation_config, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
          [
            versionId,
            fieldData.sectionId,
            fieldData.fieldKey,
            fieldData.systemFieldKey || null,
            fieldData.labelBn,
            fieldData.labelEn,
            fieldData.helpTextBn || "",
            fieldData.helpTextEn || "",
            fieldData.placeholderBn || "",
            fieldData.placeholderEn || "",
            fieldData.descriptionBn || "",
            fieldData.descriptionEn || "",
            fieldData.fieldType,
            fieldData.fieldWidth || "50%",
            fieldData.alignment || "left",
            fieldData.displayOrder || 0,
            fieldData.isVisible !== false ? 1 : 0,
            fieldData.isRequired ? 1 : 0,
            fieldData.isSystemField ? 1 : 0,
            fieldData.isActive !== false ? 1 : 0,
            fieldData.validationConfig ? JSON.stringify(fieldData.validationConfig) : null,
          ]
        );
        fieldId = fRes.insertId;
      }

      // Sync options (for select, radio, multi_select, checkbox)
      await conn.query(`DELETE FROM merchant_form_field_options WHERE field_id = ?`, [fieldId]);
      if (Array.isArray(fieldData.options) && fieldData.options.length > 0) {
        for (const opt of fieldData.options) {
          await conn.query(
            `INSERT INTO merchant_form_field_options
             (field_id, option_value, label_bn, label_en, display_order, is_active, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`,
            [
              fieldId,
              opt.optionValue,
              opt.labelBn || opt.labelEn,
              opt.labelEn,
              opt.displayOrder || 0,
              opt.isActive !== false ? 1 : 0,
            ]
          );
        }
      }

      // Sync rules
      await conn.query(`DELETE FROM merchant_form_field_rules WHERE field_id = ?`, [fieldId]);
      if (Array.isArray(fieldData.rules) && fieldData.rules.length > 0) {
        for (const r of fieldData.rules) {
          await conn.query(
            `INSERT INTO merchant_form_field_rules
             (field_id, merchant_segment, channel, is_visible, is_required, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, NOW(), NOW())`,
            [
              fieldId,
              r.merchantSegment || null,
              r.channel || null,
              r.isVisible !== false ? 1 : 0,
              r.isRequired ? 1 : 0,
            ]
          );
        }
      }

      await conn.commit();
      return fieldId;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  /**
   * Delete field from draft
   */
  async deleteField(versionId, fieldId) {
    const [[version]] = await db.query(
      `SELECT status, form_key FROM merchant_form_versions WHERE id = ? LIMIT 1`,
      [versionId]
    );
    if (!version || version.status !== "draft") {
      const err = new Error("Fields can only be deleted in a draft form version.");
      err.statusCode = 400;
      throw err;
    }
    assertDynamicScopeAllowed(version.form_key);

    const [[field]] = await db.query(
      `SELECT field_key, is_system_field FROM merchant_form_fields WHERE id = ? AND form_version_id = ? LIMIT 1`,
      [fieldId, versionId]
    );
    if (!field) {
      const err = new Error("Field not found in this form version.");
      err.statusCode = 404;
      throw err;
    }
    if (PROTECTED_SYSTEM_FIELDS.has(field.field_key) || field.is_system_field) {
      const err = new Error(`Protected system field '${field.field_key}' cannot be deleted.`);
      err.statusCode = 400;
      throw err;
    }

    const conn = await db.getConnection();
    await conn.beginTransaction();
    try {
      await conn.query(`DELETE FROM merchant_form_field_rules WHERE field_id = ?`, [fieldId]);
      await conn.query(`DELETE FROM merchant_form_field_options WHERE field_id = ?`, [fieldId]);
      await conn.query(`DELETE FROM merchant_form_fields WHERE id = ? AND form_version_id = ?`, [
        fieldId,
        versionId,
      ]);
      await conn.commit();
      return true;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  /**
   * Reorder fields within a section
   */
  async reorderFields(versionId, sectionId, fieldIds) {
    const [[version]] = await db.query(
      `SELECT status, form_key FROM merchant_form_versions WHERE id = ? LIMIT 1`,
      [versionId]
    );
    if (!version || version.status !== "draft") {
      const err = new Error("Fields can only be reordered in a draft form version.");
      err.statusCode = 400;
      throw err;
    }
    assertDynamicScopeAllowed(version.form_key);

    const conn = await db.getConnection();
    await conn.beginTransaction();
    try {
      for (let i = 0; i < fieldIds.length; i++) {
        await conn.query(
          `UPDATE merchant_form_fields
           SET display_order = ?, section_id = ?, updated_at = NOW()
           WHERE id = ? AND form_version_id = ?`,
          [i + 1, sectionId, fieldIds[i], versionId]
        );
      }
      await conn.commit();
      return true;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  /**
   * Preview a draft or published version filtered by Segment (micro/big) and Channel (bank/mfs)
   */
  async previewVersion(versionId, { merchantSegment = "micro", channel = "bank" } = {}) {
    if (!["micro", "big"].includes(merchantSegment)) {
      const err = new Error("Invalid merchant segment. Must be 'micro' or 'big'.");
      err.statusCode = 400;
      throw err;
    }
    if (!["bank", "mfs"].includes(channel)) {
      const err = new Error("Invalid channel. Must be 'bank' or 'mfs'.");
      err.statusCode = 400;
      throw err;
    }

    const fullDetails = await this.getVersionDetails(versionId);

    // Filter sections and fields applicable to this segment & channel
    const filteredSections = fullDetails.sections
      .filter((s) => s.is_active === 1)
      .map((sec) => {
        const activeFields = sec.fields
          .filter((f) => f.is_active === 1)
          .map((f) => {
            // Find applicable rule
            const rule = f.rules.find(
              (r) => r.merchant_segment === merchantSegment && r.channel === channel
            );

            // If rules exist for this field, visibility is strictly determined by matching rule
            const hasRules = Array.isArray(f.rules) && f.rules.length > 0;
            const isVisible = hasRules ? Boolean(rule && rule.is_visible) : Boolean(f.is_visible);
            const isRequired = rule ? Boolean(rule.is_required) : Boolean(f.is_required);

            return {
              ...f,
              isVisible,
              isRequired,
            };
          })
          .filter((f) => f.isVisible);

        return {
          ...sec,
          fields: activeFields,
        };
      })
      .filter((sec) => sec.fields.length > 0);

    return {
      version: fullDetails.version,
      merchantSegment,
      channel,
      sections: filteredSections,
    };
  },

  /**
   * Publish a draft version
   */
  async publishDraft(userId, versionId) {
    const conn = await db.getConnection();
    await conn.beginTransaction();

    try {
      const [[draft]] = await conn.query(
        `SELECT * FROM merchant_form_versions WHERE id = ? FOR UPDATE`,
        [versionId]
      );
      if (!draft) {
        const err = new Error("Form version not found.");
        err.statusCode = 404;
        throw err;
      }
      assertDynamicScopeAllowed(draft.form_key);
      if (draft.status !== "draft") {
        const err = new Error(`Form version is already ${draft.status}. Only draft versions can be published.`);
        err.statusCode = 400;
        throw err;
      }

      // 1. Validation: At least one section exists
      const [sections] = await conn.query(
        `SELECT * FROM merchant_form_sections WHERE form_version_id = ? AND is_active = 1`,
        [versionId]
      );
      if (sections.length === 0) {
        const err = new Error("Cannot publish form: At least one active section is required.");
        err.statusCode = 400;
        throw err;
      }

      // 2. Validation: At least one field exists
      const [fields] = await conn.query(
        `SELECT * FROM merchant_form_fields WHERE form_version_id = ? AND is_active = 1`,
        [versionId]
      );
      if (fields.length === 0) {
        const err = new Error("Cannot publish form: At least one active field is required.");
        err.statusCode = 400;
        throw err;
      }

      // 3. Validation: Verify protected fields exist
      const fieldKeys = new Set(fields.map((f) => f.field_key));
      const requiredProtected = [...PROTECTED_SYSTEM_FIELDS].filter((k) => {
        // If this scope is company, check company keys; if contact, check contact keys, etc.
        if (draft.form_key === "onboarding_company") {
          return ["company_name", "business_type", "address"].includes(k);
        }
        if (draft.form_key === "onboarding_contact") {
          return ["name", "phone", "email"].includes(k);
        }
        if (draft.form_key === "onboarding_kyc") {
          return ["legal_business_name"].includes(k);
        }
        return false;
      });

      for (const pk of requiredProtected) {
        if (!fieldKeys.has(pk)) {
          const err = new Error(`Cannot publish: Required compliance system field '${pk}' is missing from this form version.`);
          err.statusCode = 400;
          throw err;
        }
      }

      // 4. Archive currently published version for this form_key
      await conn.query(
        `UPDATE merchant_form_versions
         SET status = 'archived', updated_at = NOW()
         WHERE form_key = ? AND status = 'published'`,
        [draft.form_key]
      );

      // 5. Mark draft as published
      await conn.query(
        `UPDATE merchant_form_versions
         SET status = 'published', published_at = NOW(), published_by = ?, updated_at = NOW()
         WHERE id = ?`,
        [userId, versionId]
      );

      await conn.commit();
      return await this.getVersionDetails(versionId);
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  /**
   * Discard a draft version
   */
  async discardDraft(versionId) {
    const conn = await db.getConnection();
    await conn.beginTransaction();

    try {
      const [[draft]] = await conn.query(
        `SELECT * FROM merchant_form_versions WHERE id = ? FOR UPDATE`,
        [versionId]
      );
      if (!draft) {
        const err = new Error("Form version not found.");
        err.statusCode = 404;
        throw err;
      }
      assertDynamicScopeAllowed(draft.form_key);
      if (draft.status !== "draft") {
        const err = new Error("Cannot discard an already published or archived form version.");
        err.statusCode = 400;
        throw err;
      }

      // Delete child rules, options, fields, sections
      const [fields] = await conn.query(
        `SELECT id FROM merchant_form_fields WHERE form_version_id = ?`,
        [versionId]
      );
      const fieldIds = fields.map((f) => f.id);

      if (fieldIds.length > 0) {
        await conn.query(`DELETE FROM merchant_form_field_rules WHERE field_id IN (?)`, [fieldIds]);
        await conn.query(`DELETE FROM merchant_form_field_options WHERE field_id IN (?)`, [fieldIds]);
        await conn.query(`DELETE FROM merchant_form_fields WHERE id IN (?)`, [fieldIds]);
      }

      await conn.query(`DELETE FROM merchant_form_sections WHERE form_version_id = ?`, [versionId]);
      await conn.query(`DELETE FROM merchant_form_versions WHERE id = ?`, [versionId]);

      await conn.commit();
      return true;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  /**
   * Idempotently bootstrap an initial Draft Form Version from defined Step Seeds
   * If an active Draft or Published version for formKey already exists, returns that version.
   */
  async bootstrapInitialDraft(userId = null, formKey = "onboarding_company") {
    assertDynamicScopeAllowed(formKey);
    const conn = await db.getConnection();
    await conn.beginTransaction();

    try {
      // 1. Check if a draft or published version already exists
      const [existing] = await conn.query(
        `SELECT id, version_number, status FROM merchant_form_versions
         WHERE form_key = ? AND status IN ('draft', 'published')
         ORDER BY id DESC LIMIT 1`,
        [formKey]
      );

      let draftId;
      if (existing.length > 0 && existing[0].status === "draft") {
        draftId = existing[0].id;
        // Check if sections already exist
        const [existingSections] = await conn.query(
          `SELECT COUNT(*) as count FROM merchant_form_sections WHERE form_version_id = ?`,
          [draftId]
        );
        if (existingSections[0].count > 0) {
          await conn.commit();
          return await this.getVersionDetails(draftId);
        }
      } else if (existing.length > 0 && existing[0].status === "published") {
        // Form is already bootstraped and published!
        await conn.commit();
        return await this.getVersionDetails(existing[0].id);
      } else {
        // Create new draft v1
        const [nextVerRow] = await conn.query(
          `SELECT COALESCE(MAX(version_number), 0) + 1 AS next_ver
           FROM merchant_form_versions WHERE form_key = ?`,
          [formKey]
        );
        const nextVer = nextVerRow[0].next_ver;

        const [vResult] = await conn.query(
          `INSERT INTO merchant_form_versions (form_key, version_number, status, created_by, created_at, updated_at)
           VALUES (?, ?, 'draft', ?, NOW(), NOW())`,
          [formKey, nextVer, userId]
        );
        draftId = vResult.insertId;
      }

      // 2. Fetch seed configuration for this formKey
      const seed = STEP_SEEDS[formKey];
      if (!seed || !Array.isArray(seed.sections)) {
        await conn.commit();
        return await this.getVersionDetails(draftId);
      }

      // 3. Populate sections, fields, and options from seed
      for (let sIdx = 0; sIdx < seed.sections.length; sIdx++) {
        const sec = seed.sections[sIdx];
        const [secRes] = await conn.query(
          `INSERT INTO merchant_form_sections
           (form_version_id, section_key, title_bn, title_en, description_bn, description_en, display_order, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, NOW(), NOW())`,
          [
            draftId,
            sec.sectionKey,
            sec.titleBn,
            sec.titleEn,
            sec.descriptionBn || "",
            sec.descriptionEn || "",
            sec.displayOrder || sIdx + 1,
          ]
        );
        const sectionId = secRes.insertId;

        if (Array.isArray(sec.fields)) {
          for (let fIdx = 0; fIdx < sec.fields.length; fIdx++) {
            const f = sec.fields[fIdx];
            const [fRes] = await conn.query(
              `INSERT INTO merchant_form_fields
               (form_version_id, section_id, field_key, system_field_key, label_bn, label_en, help_text_bn, help_text_en, placeholder_bn, placeholder_en, description_bn, description_en, field_type, field_width, alignment, display_order, is_visible, is_required, is_system_field, is_active, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'left', ?, 1, ?, ?, 1, NOW(), NOW())`,
              [
                draftId,
                sectionId,
                f.fieldKey,
                f.systemFieldKey || f.fieldKey,
                f.labelBn,
                f.labelEn,
                f.helpTextBn || "",
                f.helpTextEn || "",
                f.placeholderBn || "",
                f.placeholderEn || "",
                f.descriptionBn || "",
                f.descriptionEn || "",
                f.fieldType || "text",
                f.fieldWidth || "half",
                f.displayOrder || fIdx + 1,
                f.isRequired ? 1 : 0,
                f.isSystemField ? 1 : 0,
              ]
            );
            const fieldId = fRes.insertId;

            if (Array.isArray(f.options) && f.options.length > 0) {
              for (let oIdx = 0; oIdx < f.options.length; oIdx++) {
                const opt = f.options[oIdx];
                await conn.query(
                  `INSERT INTO merchant_form_field_options
                   (field_id, option_value, label_bn, label_en, display_order, is_active, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, 1, NOW(), NOW())`,
                  [
                    fieldId,
                    opt.value,
                    opt.labelBn || opt.labelEn,
                    opt.labelEn,
                    oIdx + 1,
                  ]
                );
              }
            }

            // Insert default segment & channel rules so the field is visible
            const segments = ["micro", "big"];
            const channels = ["bank", "mfs"];
            for (const seg of segments) {
              for (const chn of channels) {
                await conn.query(
                  `INSERT INTO merchant_form_field_rules
                   (field_id, merchant_segment, channel, is_visible, is_required, created_at, updated_at)
                   VALUES (?, ?, ?, 1, ?, NOW(), NOW())`,
                  [fieldId, seg, chn, f.isRequired ? 1 : 0]
                );
              }
            }
          }
        }
      }

      await conn.commit();
      return await this.getVersionDetails(draftId);
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  /**
   * Resolve Onboarding Form for an authenticated merchant by step (e.g. 'onboarding_company', 'onboarding_contact', etc.)
   * 1. Resolves segment and channel
   * 2. Pins form_version_id into merchant_form_step_versions per step if not already pinned
   * 3. Fetches rendered schema filtered by segment and channel
   * 4. Fetches and merges existing core fields + custom values for that step
   */
  async getMerchantOnboardingForm(userId, formKey = "onboarding_company") {
    assertDynamicScopeAllowed(formKey);

    const [[merchant]] = await db.query(
      `SELECT m.id, m.merchant_segment, m.account_status,
              p.form_version_id, p.channel, p.company_name, p.business_type,
              p.industry, p.website, p.address, p.city, p.state, p.postal_code, p.country,
              p.institution_id, p.bank_name, p.branch_id, p.branch_name, p.routing_number,
              p.has_existing_account, p.apply_new_account
       FROM merchants m
       LEFT JOIN merchant_profiles p ON p.merchant_id = m.id
       WHERE m.user_id = ? LIMIT 1`,
      [userId]
    );

    if (!merchant) {
      const err = new Error("Merchant account not found.");
      err.statusCode = 404;
      throw err;
    }

    const merchantId = merchant.id;
    const segment = merchant.merchant_segment === "big" ? "big" : "micro";
    const channel = merchant.channel === "mfs" ? "mfs" : "bank";

    const isSubmitted = merchant.account_status && merchant.account_status !== "draft";

    // 1. For already-submitted/approved applications, maintain the immutable pinned version
    let targetVersionId = null;
    if (isSubmitted) {
      const [[pinnedStep]] = await db.query(
        `SELECT form_version_id FROM merchant_form_step_versions
         WHERE merchant_id = ? AND form_key = ? LIMIT 1`,
        [merchantId, formKey]
      );
      targetVersionId = pinnedStep ? pinnedStep.form_version_id : null;

      // Backward compatibility: If onboarding_company and not in step_versions, check merchant_profiles.form_version_id
      if (!targetVersionId && formKey === "onboarding_company" && merchant.form_version_id) {
        targetVersionId = merchant.form_version_id;
      }
    }

    // 2. If in-draft or no valid pinned version found, resolve currently published version
    if (!targetVersionId) {
      const [[published]] = await db.query(
        `SELECT id FROM merchant_form_versions
         WHERE form_key = ? AND status = 'published'
         ORDER BY version_number DESC LIMIT 1`,
        [formKey]
      );

      if (published) {
        targetVersionId = published.id;
        // Keep merchant_form_step_versions updated with current version
        await db.query(
          `INSERT INTO merchant_form_step_versions (merchant_id, form_key, form_version_id, pinned_at)
           VALUES (?, ?, ?, NOW())
           ON DUPLICATE KEY UPDATE form_version_id = VALUES(form_version_id), updated_at = NOW()`,
          [merchantId, formKey, targetVersionId]
        );

        if (formKey === "onboarding_company") {
          await db.query(
            `UPDATE merchant_profiles SET form_version_id = ? WHERE merchant_id = ?`,
            [targetVersionId, merchantId]
          );
        }
      }
    }

    // If no published version exists for this step, signal fallback
    if (!targetVersionId) {
      return {
        hasPublishedForm: false,
        formKey,
        formVersionId: null,
        merchantSegment: segment,
        channel,
        sections: [],
        values: {},
      };
    }

    // Get filtered version details for this segment and channel
    const rendered = await this.previewVersion(targetVersionId, {
      merchantSegment: segment,
      channel,
    });

    // Fetch existing custom values for this merchant and step
    const [customValRows] = await db.query(
      `SELECT field_id, field_key, field_value
       FROM merchant_profile_custom_values
       WHERE merchant_id = ? AND (step_key = ? OR step_key IS NULL)`,
      [merchantId, formKey]
    );

    const customValuesMap = {};
    for (const row of customValRows) {
      let parsed = row.field_value;
      try {
        parsed = JSON.parse(row.field_value);
      } catch (e) {}
      if (row.field_key) customValuesMap[row.field_key] = parsed;
      customValuesMap[`field_${row.field_id}`] = parsed;
    }

    // Fetch step-specific core values
    let stepCoreValues = {};
    if (formKey === "onboarding_company") {
      const [[kyc]] = await db.query(
        `SELECT trade_license_number, tin, bin FROM merchant_kyc WHERE merchant_id = ? LIMIT 1`,
        [merchantId]
      );
      const [[contact]] = await db.query(
        `SELECT phone, name_bn FROM merchant_contacts WHERE merchant_id = ? LIMIT 1`,
        [merchantId]
      );
      const rawCName = merchant.company_name || "";
      const validCName = rawCName.toLowerCase() === "my business" ? "" : rawCName;

      stepCoreValues = {
        companyName: validCName,
        company_name: validCName,
        companyNameBn: customValuesMap.company_name_bn || "",
        company_name_bn: customValuesMap.company_name_bn || "",
        businessType: merchant.business_type || "",
        business_type: merchant.business_type || "",
        businessNature: merchant.industry || customValuesMap.business_nature || "",
        business_nature: merchant.industry || customValuesMap.business_nature || "",
        industry: merchant.industry || "",
        website: merchant.website || "",
        address: merchant.address || "",
        businessRegPhone: customValuesMap.business_reg_phone || contact?.phone || "",
        business_reg_phone: customValuesMap.business_reg_phone || contact?.phone || "",
        contactMobile: customValuesMap.contact_mobile || contact?.phone || "",
        contact_mobile: customValuesMap.contact_mobile || contact?.phone || "",
        tradeLicense: kyc?.trade_license_number || customValuesMap.trade_license || "",
        trade_license: kyc?.trade_license_number || customValuesMap.trade_license || "",
        businessTin: kyc?.tin || customValuesMap.business_tin || "",
        business_tin: kyc?.tin || customValuesMap.business_tin || "",
        binVatNumber: kyc?.bin || customValuesMap.bin_vat_number || "",
        bin_vat_number: kyc?.bin || customValuesMap.bin_vat_number || "",
        businessEmail: customValuesMap.business_email || "",
        business_email: customValuesMap.business_email || "",
        businessStartYear: customValuesMap.business_start_year || "",
        business_start_year: customValuesMap.business_start_year || "",
        city: merchant.city || "",
        state: merchant.state || "",
        postalCode: merchant.postal_code || "",
        postal_code: merchant.postal_code || "",
        country: merchant.country || "Bangladesh",
        channel,
        institutionId: merchant.institution_id || null,
        bankName: merchant.bank_name || null,
        branchId: merchant.branch_id || null,
        branchName: merchant.branch_name || null,
        routingNumber: merchant.routing_number || "",
        hasExistingAccount: merchant.has_existing_account !== null ? Boolean(merchant.has_existing_account) : true,
        applyNewAccount: merchant.apply_new_account !== null ? Boolean(merchant.apply_new_account) : false,
      };
    } else if (formKey === "onboarding_contact") {
      const [[contact]] = await db.query(
        `SELECT * FROM merchant_contacts WHERE merchant_id = ? LIMIT 1`,
        [merchantId]
      );
      if (contact) {
        stepCoreValues = {
          name: contact.name || "",
          name_bn: contact.name_bn || "",
          nameBn: contact.name_bn || "",
          phone: contact.phone || "",
          email: contact.email || "",
          designation: contact.designation || "",
          nid_no: contact.nid_no || "",
          nidNo: contact.nid_no || "",
          division: contact.division || "",
          country: contact.country || "Bangladesh",
          dob: contact.dob ? (typeof contact.dob === "string" ? contact.dob.split("T")[0] : (contact.dob.toISOString ? contact.dob.toISOString().split("T")[0] : String(contact.dob))) : null,
          fatherName: contact.father_name || "",
          father_name: contact.father_name || "",
          motherName: contact.mother_name || "",
          mother_name: contact.mother_name || "",
          gender: contact.gender || "",
          permanentAddress: contact.permanent_address || "",
          permanent_address: contact.permanent_address || "",
          presentAddress: contact.present_address || "",
          present_address: contact.present_address || "",
          isSameAddress: Boolean(contact.is_same_address),
          is_same_address: Boolean(contact.is_same_address),
          maritalStatus: contact.marital_status || "",
          marital_status: contact.marital_status || "",
          spouseName: contact.spouse_name || "",
          spouse_name: contact.spouse_name || "",
          passportNo: contact.passport_no || "",
          passport_no: contact.passport_no || "",
          otherId: contact.other_id || "",
          other_id: contact.other_id || "",
          nomineeName: contact.nominee_name || "",
          nominee_name: contact.nominee_name || "",
          nomineeRelation: contact.nominee_relation || "",
          nominee_relation: contact.nominee_relation || "",
          nomineeMobile: contact.nominee_mobile || "",
          nominee_mobile: contact.nominee_mobile || "",
          nomineeNid: contact.nominee_nid || "",
          nominee_nid: contact.nominee_nid || "",
        };
      }
    } else if (formKey === "onboarding_commercial") {
      const [[comm]] = await db.query(
        `SELECT * FROM merchant_commercial_details WHERE merchant_id = ? LIMIT 1`,
        [merchantId]
      );
      if (comm) {
        stepCoreValues = {
          transactionsPerDay: comm.transactions_per_day || 0,
          transactions_per_day: comm.transactions_per_day || 0,
          transactionsPerMonth: comm.transactions_per_month || 0,
          transactions_per_month: comm.transactions_per_month || 0,
          volumePerDay: comm.volume_per_day || 0,
          volume_per_day: comm.volume_per_day || 0,
          volumePerMonth: comm.volume_per_month || 0,
          volume_per_month: comm.volume_per_month || 0,
          maximumTicketSize: comm.maximum_ticket_size || 0,
          maximum_ticket_size: comm.maximum_ticket_size || 0,
          returnUrl: comm.return_url || "",
          return_url: comm.return_url || "",
          merchantDomain: comm.merchant_domain || "",
          merchant_domain: comm.merchant_domain || "",
          merchantIpAddress: comm.merchant_ip_address || "",
          merchant_ip_address: comm.merchant_ip_address || "",
        };
      }
    } else if (formKey === "onboarding_kyc") {
      const [[kyc]] = await db.query(
        `SELECT * FROM merchant_kyc WHERE merchant_id = ? LIMIT 1`,
        [merchantId]
      );
      if (kyc) {
        stepCoreValues = {
          legalBusinessName: kyc.legal_business_name || "",
          legal_business_name: kyc.legal_business_name || "",
          businessEntityType: kyc.business_entity_type || "",
          business_entity_type: kyc.business_entity_type || "",
          legalStructureId: kyc.legal_structure_id || null,
          tradeLicenseNumber: kyc.trade_license_number || "",
          trade_license_number: kyc.trade_license_number || "",
          registrationNumber: kyc.registration_number || "",
          registration_number: kyc.registration_number || "",
          tin: kyc.tin || "",
          bin: kyc.bin || "",
          authorizedPersonName: kyc.authorized_person_name || "",
          authorized_person_name: kyc.authorized_person_name || "",
          designation: kyc.designation || "",
          nidNumber: kyc.nid_number || "",
          nid_number: kyc.nid_number || "",
          nidIssueDate: kyc.nid_issue_date ? (typeof kyc.nid_issue_date === "string" ? kyc.nid_issue_date.split("T")[0] : (kyc.nid_issue_date.toISOString ? kyc.nid_issue_date.toISOString().split("T")[0] : String(kyc.nid_issue_date))) : null,
          nid_issue_date: kyc.nid_issue_date ? (typeof kyc.nid_issue_date === "string" ? kyc.nid_issue_date.split("T")[0] : (kyc.nid_issue_date.toISOString ? kyc.nid_issue_date.toISOString().split("T")[0] : String(kyc.nid_issue_date))) : null,
          nidExpiryDate: kyc.nid_expiry_date ? (typeof kyc.nid_expiry_date === "string" ? kyc.nid_expiry_date.split("T")[0] : (kyc.nid_expiry_date.toISOString ? kyc.nid_expiry_date.toISOString().split("T")[0] : String(kyc.nid_expiry_date))) : null,
          nid_expiry_date: kyc.nid_expiry_date ? (typeof kyc.nid_expiry_date === "string" ? kyc.nid_expiry_date.split("T")[0] : (kyc.nid_expiry_date.toISOString ? kyc.nid_expiry_date.toISOString().split("T")[0] : String(kyc.nid_expiry_date))) : null,
          institutionId: kyc.institution_id || null,
          branchId: kyc.branch_id || null,
          bankName: kyc.bank_name || "",
          branchName: kyc.branch_name || "",
          branchCode: kyc.branch_code || "",
          division: kyc.division || "",
          district: kyc.district || "",
          upazila: kyc.upazila || "",
          branchAddress: kyc.branch_address || "",
          accountHolderName: kyc.bank_account_name || "",
          accountNumber: kyc.bank_account_number || "",
          routingNumber: kyc.routing_number || "",
          accountType: kyc.account_type || "Current",
        };
      }
    }

    const initialValues = {
      merchantSegment: segment,
      channel,
      ...stepCoreValues,
      ...customValuesMap,
    };

    return {
      hasPublishedForm: true,
      formKey,
      formVersionId: targetVersionId,
      versionNumber: rendered.version.version_number,
      merchantSegment: segment,
      channel,
      sections: rendered.sections,
      values: initialValues,
    };
  },
};
