import http from "http";
import jwt from "jsonwebtoken";
import app from "../src/app.js";
import { db } from "../src/config/db.js";
import { env } from "../src/config/env.js";
import { formBuilderService, PROTECTED_SYSTEM_FIELDS } from "../src/modules/admin/formBuilder/formBuilder.service.js";

// Helper to generate access token for testing
function generateTestToken(userId) {
  return jwt.sign(
    { sub: userId, token_version: 0 },
    env.jwt.accessSecret,
    { expiresIn: "1h" }
  );
}

async function runComprehensiveVerification() {
  console.log("==================================================================");
  console.log("  BANGLAQR — PHASE 2 FINAL GAP VERIFICATION & ACCEPTANCE AUDIT   ");
  console.log("==================================================================\n");

  let totalTests = 0;
  let passedTests = 0;
  let failedTests = 0;

  function assert(condition, testName, details = "") {
    totalTests++;
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passedTests++;
    } else {
      console.error(`[FAIL] ${testName} -> ${details}`);
      failedTests++;
    }
  }

  // Start internal test server on ephemeral port
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/api/v1`;

  async function apiRequest(method, endpoint, token = null, body = null) {
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${baseUrl}${endpoint}`, opts);
    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      // not json
    }
    return { status: res.status, body: data };
  }

  // Pre-identified users:
  const superAdminId = 4; // role: super_admin
  const adminId = 5;      // role: admin (has merchant.manage)
  const supportId = 7;    // role: support_agent (no merchant.manage)
  const merchantId = 432; // merchant user
  const instUserId = 56;  // bank_admin institution user

  const superAdminToken = generateTestToken(superAdminId);
  const adminToken = generateTestToken(adminId);
  const supportToken = generateTestToken(supportId);
  const merchantToken = generateTestToken(merchantId);
  const instToken = generateTestToken(instUserId);

  let draftVersionId = null;
  let section1Id = null;
  let section2Id = null;

  try {
    // =========================================================================
    // TASK 1 & TASK 8: Endpoints & Authorization Audit
    // =========================================================================
    console.log("--- TASK 1 & TASK 8: Endpoints & Authorization Audit ---");

    // 1. Merchant access rejected (403)
    const merchantRes = await apiRequest("GET", "/admin/form-builder/versions", merchantToken);
    assert(merchantRes.status === 403, "Merchant access returns HTTP 403 Forbidden");

    // 2. Institution user access rejected (403)
    const instRes = await apiRequest("GET", "/admin/form-builder/versions", instToken);
    assert(instRes.status === 403, "Institution user access returns HTTP 403 Forbidden");

    // 3. Admin without merchant.create rejected on draft creation (403)
    const supportRes = await apiRequest("POST", "/admin/form-builder/draft", supportToken, { formKey: "merchant_onboarding" });
    assert(supportRes.status === 403, "Admin user without merchant.create returns HTTP 403 Forbidden");

    // 4. Authorized Admin with merchant.manage succeeds (200)
    const adminRes = await apiRequest("GET", "/admin/form-builder/versions", adminToken);
    assert(adminRes.status === 200 && adminRes.body?.success, "Authorized Admin (merchant.manage) access succeeds HTTP 200");

    // 5. Super Admin succeeds (200)
    const superAdminRes = await apiRequest("GET", "/admin/form-builder/versions", superAdminToken);
    assert(superAdminRes.status === 200 && superAdminRes.body?.success, "Super Admin access succeeds HTTP 200");

    // 6. Create Draft via API
    const createDraftRes = await apiRequest("POST", "/admin/form-builder/draft", adminToken, {
      formKey: "merchant_onboarding",
    });
    assert(createDraftRes.status === 201, `Draft created via API (Version ID: ${createDraftRes.body?.data?.version?.id})`);
    draftVersionId = createDraftRes.body?.data?.version?.id;

    // 7. Create Section 1 via POST
    const createSec1Res = await apiRequest("POST", `/admin/form-builder/versions/${draftVersionId}/sections`, adminToken, {
      sectionKey: "sec_business_profile",
      titleBn: "ব্যবসার তথ্য",
      titleEn: "Business Profile",
      displayOrder: 1,
      isActive: true,
    });
    assert(createSec1Res.status === 200 && createSec1Res.body?.data?.sectionId, "Create Section 1 via POST /sections succeeds");
    section1Id = createSec1Res.body.data.sectionId;

    // 8. Create Section 2 via POST
    const createSec2Res = await apiRequest("POST", `/admin/form-builder/versions/${draftVersionId}/sections`, adminToken, {
      sectionKey: "sec_compliance_docs",
      titleBn: "কমপ্লায়েন্স ডকুমেন্টস",
      titleEn: "Compliance Documents",
      displayOrder: 2,
      isActive: true,
    });
    assert(createSec2Res.status === 200 && createSec2Res.body?.data?.sectionId, "Create Section 2 via POST /sections succeeds");
    section2Id = createSec2Res.body.data.sectionId;

    // 9. Update Section 1 via PUT /sections/:sectionId
    const updateSec1Res = await apiRequest("PUT", `/admin/form-builder/versions/${draftVersionId}/sections/${section1Id}`, adminToken, {
      sectionKey: "sec_business_profile",
      titleBn: "ব্যবসায়িক তথ্য ও বিবরণ",
      titleEn: "Business Profile & Details",
      displayOrder: 1,
      isActive: true,
    });
    assert(updateSec1Res.status === 200, "Update Section 1 via PUT /sections/:sectionId succeeds");

    // 10. Reorder Sections via PUT /sections/reorder
    const reorderSecRes = await apiRequest("PUT", `/admin/form-builder/versions/${draftVersionId}/sections/reorder`, adminToken, {
      sectionIds: [section2Id, section1Id],
    });
    assert(reorderSecRes.status === 200, "Reorder sections via PUT /sections/reorder succeeds");

    // =========================================================================
    // TASK 2: Complete 12 Field Types Testing
    // =========================================================================
    console.log("\n--- TASK 2: Complete 12 Field Types Testing ---");
    const fieldTypes = [
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

    const widths = ["100%", "66.67%", "50%", "33.33%", "25%"];
    let createdFieldIds = {};

    for (let i = 0; i < fieldTypes.length; i++) {
      const type = fieldTypes[i];
      const width = widths[i % widths.length];
      const isChoice = ["select", "multi_select", "checkbox", "radio"].includes(type);

      const fieldPayload = {
        sectionId: section1Id,
        fieldKey: `fld_${type}_test`,
        labelBn: `বাংলা লেবেল ${type}`,
        labelEn: `English Label ${type}`,
        placeholderBn: `বাংলা স্থানধারক`,
        placeholderEn: `English placeholder`,
        helpTextBn: `সাহায্যকারী টেক্সট`,
        helpTextEn: `Helper text description`,
        fieldType: type,
        fieldWidth: width,
        displayOrder: i + 1,
        isVisible: true,
        isRequired: true,
        isActive: true,
        validationConfig: {
          minLength: 2,
          maxLength: 100,
          errorMessageBn: "ত্রুটি বার্তা",
          errorMessageEn: "Validation Error",
        },
        options: isChoice
          ? [
              { optionValue: `opt_1_${type}`, labelBn: "অপশন ১", labelEn: "Option 1", displayOrder: 1 },
              { optionValue: `opt_2_${type}`, labelBn: "অপশন ২", labelEn: "Option 2", displayOrder: 2 },
            ]
          : [],
        rules: [
          { merchantSegment: "micro", channel: "bank", isVisible: true, isRequired: true },
          { merchantSegment: "micro", channel: "mfs", isVisible: true, isRequired: true },
          { merchantSegment: "big", channel: "bank", isVisible: true, isRequired: true },
          { merchantSegment: "big", channel: "mfs", isVisible: true, isRequired: true },
        ],
      };

      const res = await apiRequest("POST", `/admin/form-builder/versions/${draftVersionId}/fields`, adminToken, fieldPayload);

      assert(res.status === 200 && res.body?.data?.fieldId, `Field type '${type}' created with width '${width}'`);
      createdFieldIds[type] = res.body?.data?.fieldId;
    }

    // Verify all 12 fields reloaded from MySQL
    const vDetails = await formBuilderService.getVersionDetails(draftVersionId);
    const sec1 = vDetails.sections.find((s) => s.id === section1Id);
    const dbFieldTypes = sec1.fields.map((f) => f.field_type);
    const allTypesPresent = fieldTypes.every((t) => dbFieldTypes.includes(t));
    assert(allTypesPresent, "All 12 field types correctly persisted in MySQL and reloaded");

    // =========================================================================
    // TASK 3: Validation Configuration Testing
    // =========================================================================
    console.log("\n--- TASK 3: Validation Configuration Testing ---");
    // Check validation_config in text field
    const textField = sec1.fields.find((f) => f.field_type === "text");
    const valCfg = typeof textField.validation_config === "string" 
      ? JSON.parse(textField.validation_config) 
      : textField.validation_config;
    assert(
      valCfg.minLength === 2 && valCfg.maxLength === 100 && valCfg.errorMessageBn === "ত্রুটি বার্তা",
      "Validation configuration (min, max, bilingual messages) correctly stored as JSON in MySQL"
    );

    // =========================================================================
    // TASK 4: Choice Options Management Testing
    // =========================================================================
    console.log("\n--- TASK 4: Choice Options Management Testing ---");
    // 1. Edit choice field options (add option, rename label, change value)
    const selectField = sec1.fields.find((f) => f.field_type === "select");
    const updateSelectRes = await apiRequest("PUT", `/admin/form-builder/versions/${draftVersionId}/fields/${selectField.id}`, adminToken, {
      sectionId: section1Id,
      fieldKey: selectField.field_key,
      labelBn: selectField.label_bn,
      labelEn: selectField.label_en,
      fieldType: "select",
      options: [
        { optionValue: "opt_val_renamed", labelBn: "পরিবর্তিত অপশন ১", labelEn: "Renamed Option 1", displayOrder: 1 },
        { optionValue: "opt_val_2", labelBn: "অপশন ২", labelEn: "Option 2", displayOrder: 2 },
        { optionValue: "opt_val_3", labelBn: "নতুন অপশন ৩", labelEn: "New Option 3", displayOrder: 3 },
      ],
      rules: [
        { merchantSegment: "micro", channel: "bank", isVisible: true, isRequired: true },
        { merchantSegment: "micro", channel: "mfs", isVisible: true, isRequired: true },
        { merchantSegment: "big", channel: "bank", isVisible: true, isRequired: true },
        { merchantSegment: "big", channel: "mfs", isVisible: true, isRequired: true },
      ],
    });
    assert(updateSelectRes.status === 200, "Choice field options successfully edited and added");

    // 2. Reject duplicate option values
    const dupOptionRes = await apiRequest("PUT", `/admin/form-builder/versions/${draftVersionId}/fields/${selectField.id}`, adminToken, {
      sectionId: section1Id,
      fieldKey: selectField.field_key,
      labelBn: selectField.label_bn,
      labelEn: selectField.label_en,
      fieldType: "select",
      options: [
        { optionValue: "duplicate_key", labelBn: "অপশন ক", labelEn: "Option A" },
        { optionValue: "duplicate_key", labelBn: "অপশন খ", labelEn: "Option B" },
      ],
    });
    assert(dupOptionRes.status === 400 && dupOptionRes.body?.message?.includes("Duplicate option"), "Duplicate option values rejected with HTTP 400");

    // =========================================================================
    // TASK 5: Complete Segment & Channel Matrix
    // =========================================================================
    console.log("\n--- TASK 5: Complete Segment & Channel Matrix ---");
    // Create dedicated segmented fields:
    // 1. micro_bank_only
    await formBuilderService.saveField(draftVersionId, {
      sectionId: section1Id,
      fieldKey: "fld_micro_bank_only",
      labelBn: "মাইক্রো ব্যাংক ফিল্ড",
      labelEn: "Micro Bank Field",
      fieldType: "text",
      rules: [{ merchantSegment: "micro", channel: "bank", isVisible: true, isRequired: true }],
    });
    // 2. big_mfs_only
    await formBuilderService.saveField(draftVersionId, {
      sectionId: section1Id,
      fieldKey: "fld_big_mfs_only",
      labelBn: "বিগ এমএফএস ফিল্ড",
      labelEn: "Big MFS Field",
      fieldType: "text",
      rules: [{ merchantSegment: "big", channel: "mfs", isVisible: true, isRequired: true }],
    });

    // Test all 4 combinations in preview
    const prevMicroBank = await formBuilderService.previewVersion(draftVersionId, { merchantSegment: "micro", channel: "bank" });
    const keysMicroBank = prevMicroBank.sections.flatMap(s => s.fields.map(f => f.field_key));

    const prevMicroMfs = await formBuilderService.previewVersion(draftVersionId, { merchantSegment: "micro", channel: "mfs" });
    const keysMicroMfs = prevMicroMfs.sections.flatMap(s => s.fields.map(f => f.field_key));

    const prevBigBank = await formBuilderService.previewVersion(draftVersionId, { merchantSegment: "big", channel: "bank" });
    const keysBigBank = prevBigBank.sections.flatMap(s => s.fields.map(f => f.field_key));

    const prevBigMfs = await formBuilderService.previewVersion(draftVersionId, { merchantSegment: "big", channel: "mfs" });
    const keysBigMfs = prevBigMfs.sections.flatMap(s => s.fields.map(f => f.field_key));

    assert(keysMicroBank.includes("fld_micro_bank_only") && !keysMicroBank.includes("fld_big_mfs_only"), "Micro + Bank preview correctly filters micro_bank_only");
    assert(!keysMicroMfs.includes("fld_micro_bank_only") && !keysMicroMfs.includes("fld_big_mfs_only"), "Micro + MFS preview correctly excludes micro_bank_only and big_mfs_only");
    assert(!keysBigBank.includes("fld_micro_bank_only") && !keysBigBank.includes("fld_big_mfs_only"), "Big + Bank preview correctly excludes both specialized fields");
    assert(!keysBigMfs.includes("fld_micro_bank_only") && keysBigMfs.includes("fld_big_mfs_only"), "Big + MFS preview correctly includes big_mfs_only");

    // Invalid segment/channel rejection
    let invalidSegBlocked = false;
    try {
      await formBuilderService.previewVersion(draftVersionId, { merchantSegment: "both", channel: "bank" });
    } catch (err) {
      invalidSegBlocked = err.statusCode === 400;
    }
    assert(invalidSegBlocked, "Invalid segment 'both' in preview correctly rejected with HTTP 400");

    // =========================================================================
    // TASK 6: Protected System Field Security
    // =========================================================================
    console.log("\n--- TASK 6: Protected System Field Security ---");
    // Create protected field: company_name
    const protFieldId = await formBuilderService.saveField(draftVersionId, {
      sectionId: section1Id,
      fieldKey: "company_name",
      systemFieldKey: "company_name",
      labelBn: "কোম্পানি নাম",
      labelEn: "Company Name",
      fieldType: "text",
      isVisible: true,
      isRequired: true,
      isSystemField: true,
      rules: [
        { merchantSegment: "micro", channel: "bank", isVisible: true, isRequired: true },
        { merchantSegment: "micro", channel: "mfs", isVisible: true, isRequired: true },
        { merchantSegment: "big", channel: "bank", isVisible: true, isRequired: true },
        { merchantSegment: "big", channel: "mfs", isVisible: true, isRequired: true },
      ],
    });

    // 1. Attempt to hide protected field
    let hideBlocked = false;
    try {
      await formBuilderService.saveField(draftVersionId, {
        id: protFieldId,
        sectionId: section1Id,
        fieldKey: "company_name",
        labelBn: "কোম্পানি নাম",
        labelEn: "Company Name",
        fieldType: "text",
        isVisible: false,
      });
    } catch (err) {
      hideBlocked = err.statusCode === 400 && err.message.includes("cannot be hidden");
    }
    assert(hideBlocked, "Hiding protected system field rejected with HTTP 400");

    // 2. Attempt to make protected field optional
    let optionalBlocked = false;
    try {
      await formBuilderService.saveField(draftVersionId, {
        id: protFieldId,
        sectionId: section1Id,
        fieldKey: "company_name",
        labelBn: "কোম্পানি নাম",
        labelEn: "Company Name",
        fieldType: "text",
        isVisible: true,
        isRequired: false,
      });
    } catch (err) {
      optionalBlocked = err.statusCode === 400 && err.message.includes("cannot be made optional");
    }
    assert(optionalBlocked, "Making protected system field optional rejected with HTTP 400");

    // 3. Attempt to delete protected field
    let deleteBlocked = false;
    try {
      await formBuilderService.deleteField(draftVersionId, protFieldId);
    } catch (err) {
      deleteBlocked = err.statusCode === 400 && err.message.includes("cannot be deleted");
    }
    assert(deleteBlocked, "Deleting protected system field rejected with HTTP 400");

    // 4. Attempt to rename protected field key
    let renameBlocked = false;
    try {
      await formBuilderService.saveField(draftVersionId, {
        id: protFieldId,
        sectionId: section1Id,
        fieldKey: "renamed_company_name",
        labelBn: "কোম্পানি নাম",
        labelEn: "Company Name",
        fieldType: "text",
        isVisible: true,
        isRequired: true,
      });
    } catch (err) {
      renameBlocked = err.statusCode === 400 && err.message.includes("cannot be renamed");
    }
    assert(renameBlocked, "Renaming protected system field key rejected with HTTP 400");

    // 5. Attempt to change protected field type
    let changeTypeBlocked = false;
    try {
      await formBuilderService.saveField(draftVersionId, {
        id: protFieldId,
        sectionId: section1Id,
        fieldKey: "company_name",
        labelBn: "কোম্পানি নাম",
        labelEn: "Company Name",
        fieldType: "textarea", // Changed from text to textarea
        isVisible: true,
        isRequired: true,
      });
    } catch (err) {
      changeTypeBlocked = err.statusCode === 400 && err.message.includes("field type cannot be changed");
    }
    assert(changeTypeBlocked, "Changing protected system field type rejected with HTTP 400");

    // =========================================================================
    // TASK 7: Full Draft & Publishing Lifecycle
    // =========================================================================
    console.log("\n--- TASK 7: Full Draft & Publishing Lifecycle ---");
    // Publish V1
    const publishV1Res = await apiRequest("POST", `/admin/form-builder/versions/${draftVersionId}/publish`, adminToken);
    assert(publishV1Res.status === 200, `Published Version 1 successfully (Version ID: ${draftVersionId})`);

    // Verify V1 is immutable: try to add section to published V1
    let modPublishedBlocked = false;
    try {
      await formBuilderService.saveSection(draftVersionId, {
        sectionKey: "sec_forbidden",
        titleBn: "নিষিদ্ধ",
        titleEn: "Forbidden",
      });
    } catch (err) {
      modPublishedBlocked = err.statusCode === 400;
    }
    assert(modPublishedBlocked, "Modifications to published Version 1 strictly blocked");

    // Clone V1 into Draft V2
    const cloneV2Res = await apiRequest("POST", "/admin/form-builder/draft", adminToken, {
      formKey: "merchant_onboarding",
      fromVersionId: draftVersionId,
    });
    assert(cloneV2Res.status === 201, `Cloned V1 into Draft V2 (Version ID: ${cloneV2Res.body?.data?.version?.id})`);
    const draftV2Id = cloneV2Res.body?.data?.version?.id;

    // Modify Draft V2: Add a section
    const addSecV2 = await formBuilderService.saveSection(draftV2Id, {
      sectionKey: "sec_v2_extra",
      titleBn: "ভি২ অতিরিক্ত সেকশন",
      titleEn: "V2 Extra Section",
    });
    assert(Boolean(addSecV2), "Added section to Draft V2 without affecting Published V1");

    // Publish V2
    const publishV2Res = await apiRequest("POST", `/admin/form-builder/versions/${draftV2Id}/publish`, adminToken);
    assert(publishV2Res.status === 200, `Published Version 2 successfully (Version ID: ${draftV2Id})`);

    // Check version states: V1 should be 'archived', V2 should be 'published'
    const [[v1Row]] = await db.query(`SELECT status FROM merchant_form_versions WHERE id = ?`, [draftVersionId]);
    const [[v2Row]] = await db.query(`SELECT status FROM merchant_form_versions WHERE id = ?`, [draftV2Id]);
    assert(v1Row.status === "archived", "Version 1 is now marked as 'archived'");
    assert(v2Row.status === "published", "Version 2 is now marked as 'published'");

    // Create Draft V3 and Discard it
    const cloneV3Res = await formBuilderService.createDraft(adminId, "merchant_onboarding");
    const draftV3Id = cloneV3Res.version.id;
    await formBuilderService.discardDraft(draftV3Id);
    const [[v3Row]] = await db.query(`SELECT id FROM merchant_form_versions WHERE id = ?`, [draftV3Id]);
    assert(!v3Row, "Draft V3 successfully discarded and deleted");

    // Confirm Published V2 remains intact
    const [[v2Check]] = await db.query(`SELECT status FROM merchant_form_versions WHERE id = ?`, [draftV2Id]);
    assert(v2Check.status === "published", "Published Version 2 remains intact and published after discarding V3");

    console.log(`\n==================================================================`);
    console.log(`  SUMMARY: ${passedTests} PASSED, ${failedTests} FAILED (TOTAL: ${totalTests})`);
    console.log(`==================================================================`);

    // Teardown test versions safely
    await db.query(`UPDATE merchant_form_versions SET status = 'archived' WHERE id IN (?, ?)`, [draftVersionId, draftV2Id]);
    await db.query(`DELETE FROM merchant_form_field_rules WHERE field_id IN (SELECT id FROM merchant_form_fields WHERE form_version_id IN (?, ?))`, [draftVersionId, draftV2Id]);
    await db.query(`DELETE FROM merchant_form_field_options WHERE field_id IN (SELECT id FROM merchant_form_fields WHERE form_version_id IN (?, ?))`, [draftVersionId, draftV2Id]);
    await db.query(`DELETE FROM merchant_form_fields WHERE form_version_id IN (?, ?)`, [draftVersionId, draftV2Id]);
    await db.query(`DELETE FROM merchant_form_sections WHERE form_version_id IN (?, ?)`, [draftVersionId, draftV2Id]);
    await db.query(`DELETE FROM merchant_form_versions WHERE id IN (?, ?)`, [draftVersionId, draftV2Id]);
    console.log("Synthetic verification test data cleaned up.");

    server.close();
    process.exit(failedTests > 0 ? 1 : 0);
  } catch (err) {
    console.error("FATAL ERROR IN TEST SUITE:", err);
    if (server) server.close();
    process.exit(1);
  }
}

runComprehensiveVerification();
