import http from "http";
import jwt from "jsonwebtoken";
import app from "../src/app.js";
import { db } from "../src/config/db.js";
import { env } from "../src/config/env.js";
import { formBuilderService, PROTECTED_SYSTEM_FIELDS } from "../src/modules/admin/formBuilder/formBuilder.service.js";

function generateTestToken(userId) {
  return jwt.sign(
    { sub: userId, token_version: 0 },
    env.jwt.accessSecret,
    { expiresIn: "1h" }
  );
}

async function runAlignmentAndSectionAudit() {
  console.log("==================================================================");
  console.log(" BANGLAQR — PHASE 2 FINAL COMPLETION: ALIGNMENT & SECTION AUDIT   ");
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
    } catch (e) {}
    return { status: res.status, body: data };
  }

  const adminId = 5; // admin with merchant permissions
  const adminToken = generateTestToken(adminId);

  let draftVersionId = null;
  let section1Id = null;
  let section2Id = null;
  let fieldLeftId = null;
  let fieldCenterId = null;
  let fieldRightId = null;

  try {
    // -------------------------------------------------------------------------
    // 1. Create fresh draft
    // -------------------------------------------------------------------------
    const draftRes = await apiRequest("POST", "/admin/form-builder/draft", adminToken, {
      formKey: "merchant_onboarding",
    });
    assert(draftRes.status === 201, "Draft version created");
    draftVersionId = draftRes.body?.data?.version?.id;

    // -------------------------------------------------------------------------
    // 2. Section Description & Visibility Testing (Task 2)
    // -------------------------------------------------------------------------
    console.log("\n--- Task 2: Section Description & Visibility Testing ---");
    // Section 1: Active section with Bengali & English descriptions
    const sec1Res = await apiRequest("POST", `/admin/form-builder/versions/${draftVersionId}/sections`, adminToken, {
      sectionKey: "sec_active_profile",
      titleBn: "সক্রিয় প্রোফাইল",
      titleEn: "Active Profile",
      descriptionBn: "এটি সক্রিয় সেকশনের বিবরণ",
      descriptionEn: "This is the active section description",
      displayOrder: 1,
      isActive: true,
    });
    assert(sec1Res.status === 200, "Section 1 created with descriptions and isActive = true");
    section1Id = sec1Res.body.data.sectionId;

    // Section 2: Inactive/Hidden section
    const sec2Res = await apiRequest("POST", `/admin/form-builder/versions/${draftVersionId}/sections`, adminToken, {
      sectionKey: "sec_hidden_section",
      titleBn: "লুকানো সেকশন",
      titleEn: "Hidden Section",
      descriptionBn: "লুকানো বিবরণ",
      descriptionEn: "Hidden description",
      displayOrder: 2,
      isActive: false, // Hiding section
    });
    assert(sec2Res.status === 200, "Section 2 created with isActive = false (Hidden)");
    section2Id = sec2Res.body.data.sectionId;

    // Verify sections saved & reloaded with descriptions and visibility intact
    const details1 = await formBuilderService.getVersionDetails(draftVersionId);
    const dbSec1 = details1.sections.find(s => s.id === section1Id);
    const dbSec2 = details1.sections.find(s => s.id === section2Id);

    assert(
      dbSec1.description_bn === "এটি সক্রিয় সেকশনের বিবরণ" &&
      dbSec1.description_en === "This is the active section description" &&
      dbSec1.is_active === 1,
      "Section 1 descriptions and active status correctly persisted in MySQL"
    );

    assert(
      dbSec2.description_bn === "লুকানো বিবরণ" &&
      dbSec2.description_en === "Hidden description" &&
      dbSec2.is_active === 0,
      "Section 2 hidden status (is_active = 0) correctly persisted in MySQL"
    );

    // -------------------------------------------------------------------------
    // 3. Field Alignment & Field Description Testing (Task 1 & Task 3)
    // -------------------------------------------------------------------------
    console.log("\n--- Task 1 & Task 3: Field Alignment & Description Persistence ---");
    // Field 1: Left aligned with full descriptions & help text
    const fld1Res = await apiRequest("POST", `/admin/form-builder/versions/${draftVersionId}/fields`, adminToken, {
      sectionId: section1Id,
      fieldKey: "fld_align_left",
      labelBn: "বাম প্রান্তিক ফিল্ড",
      labelEn: "Left Aligned Field",
      placeholderBn: "স্থানধারক বাম",
      placeholderEn: "Placeholder Left",
      descriptionBn: "ফিল্ড বিস্তারিত বিবরণ বাংলা (বাম)",
      descriptionEn: "Field detailed description English (left)",
      helpTextBn: "সাহায্যকারী টেক্সট বাংলা",
      helpTextEn: "Helper text English",
      fieldType: "text",
      fieldWidth: "50%",
      alignment: "left",
      displayOrder: 1,
      isVisible: true,
      isRequired: true,
      rules: [
        { merchantSegment: "micro", channel: "bank", isVisible: true, isRequired: true },
        { merchantSegment: "big", channel: "bank", isVisible: true, isRequired: true },
      ],
    });
    assert(fld1Res.status === 200, "Left aligned field created with descriptions and help text");
    fieldLeftId = fld1Res.body.data.fieldId;

    // Field 2: Centered field
    const fld2Res = await apiRequest("POST", `/admin/form-builder/versions/${draftVersionId}/fields`, adminToken, {
      sectionId: section1Id,
      fieldKey: "fld_align_center",
      labelBn: "মাঝের ফিল্ড",
      labelEn: "Centered Field",
      descriptionBn: "মাঝের ফিল্ড বিবরণ",
      descriptionEn: "Centered field description",
      fieldType: "number",
      fieldWidth: "50%",
      alignment: "center",
      displayOrder: 2,
      isVisible: true,
      isRequired: false,
      rules: [
        { merchantSegment: "micro", channel: "bank", isVisible: true, isRequired: false },
        { merchantSegment: "big", channel: "bank", isVisible: true, isRequired: false },
      ],
    });
    assert(fld2Res.status === 200, "Centered field created with alignment = center");
    fieldCenterId = fld2Res.body.data.fieldId;

    // Field 3: Right aligned field
    const fld3Res = await apiRequest("POST", `/admin/form-builder/versions/${draftVersionId}/fields`, adminToken, {
      sectionId: section1Id,
      fieldKey: "fld_align_right",
      labelBn: "ডান প্রান্তিক ফিল্ড",
      labelEn: "Right Aligned Field",
      descriptionBn: "ডান প্রান্তিক ফিল্ড বিবরণ",
      descriptionEn: "Right aligned field description",
      fieldType: "text",
      fieldWidth: "100%",
      alignment: "right",
      displayOrder: 3,
      isVisible: true,
      isRequired: false,
      rules: [
        { merchantSegment: "micro", channel: "bank", isVisible: true, isRequired: false },
        { merchantSegment: "big", channel: "bank", isVisible: true, isRequired: false },
      ],
    });
    assert(fld3Res.status === 200, "Right aligned field created with alignment = right");
    fieldRightId = fld3Res.body.data.fieldId;

    // Also add field to Section 2 (hidden section) to verify child field retention
    await apiRequest("POST", `/admin/form-builder/versions/${draftVersionId}/fields`, adminToken, {
      sectionId: section2Id,
      fieldKey: "fld_in_hidden_sec",
      labelBn: "লুকানো সেকশনের ফিল্ড",
      labelEn: "Field in Hidden Section",
      fieldType: "text",
      rules: [{ merchantSegment: "micro", channel: "bank", isVisible: true, isRequired: false }],
    });

    // Verify all field properties persisted and reloaded from MySQL
    const details2 = await formBuilderService.getVersionDetails(draftVersionId);
    const dbFldLeft = details2.sections[0].fields.find(f => f.id === fieldLeftId);
    const dbFldCenter = details2.sections[0].fields.find(f => f.id === fieldCenterId);
    const dbFldRight = details2.sections[0].fields.find(f => f.id === fieldRightId);

    assert(
      dbFldLeft.alignment === "left" &&
      dbFldLeft.description_bn === "ফিল্ড বিস্তারিত বিবরণ বাংলা (বাম)" &&
      dbFldLeft.description_en === "Field detailed description English (left)" &&
      dbFldLeft.help_text_bn === "সাহায্যকারী টেক্সট বাংলা" &&
      dbFldLeft.help_text_en === "Helper text English" &&
      dbFldLeft.placeholder_bn === "স্থানধারক বাম" &&
      dbFldLeft.placeholder_en === "Placeholder Left",
      "Left aligned field persisted with all 7 description/help/placeholder properties intact"
    );

    assert(dbFldCenter.alignment === "center", "Centered field persisted with alignment = center");
    assert(dbFldRight.alignment === "right", "Right aligned field persisted with alignment = right");

    // -------------------------------------------------------------------------
    // 4. Preview Filtering: Hidden section excluded from Preview (Task 2 & Task 1)
    // -------------------------------------------------------------------------
    console.log("\n--- Task 2 & Task 1: Preview Reflection ---");
    const previewRes = await apiRequest("GET", `/admin/form-builder/versions/${draftVersionId}/preview?merchantSegment=micro&channel=bank`, adminToken);
    assert(previewRes.status === 200, "Preview endpoint succeeded HTTP 200");
    const previewSections = previewRes.body.data.sections;
    const previewSectionKeys = previewSections.map(s => s.section_key);

    assert(
      previewSectionKeys.includes("sec_active_profile") && !previewSectionKeys.includes("sec_hidden_section"),
      "Hidden section (isActive = 0) properly excluded from live preview"
    );

    // Verify preview fields include alignment and description
    const previewFldLeft = previewSections[0].fields.find(f => f.field_key === "fld_align_left");
    assert(
      previewFldLeft.alignment === "left" && previewFldLeft.description_en === "Field detailed description English (left)",
      "Live preview reflects alignment and descriptions accurately"
    );

    // -------------------------------------------------------------------------
    // 5. Protected Field Applicability Security (Task 4)
    // -------------------------------------------------------------------------
    console.log("\n--- Task 4: Protected Field Applicability Security ---");
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

    // 1. Attempt to set isVisible: false in segment/channel rule for protected field
    const hideRuleRes = await apiRequest("PUT", `/admin/form-builder/versions/${draftVersionId}/fields/${protFieldId}`, adminToken, {
      sectionId: section1Id,
      fieldKey: "company_name",
      labelBn: "কোম্পানি নাম",
      labelEn: "Company Name",
      fieldType: "text",
      isVisible: true,
      isRequired: true,
      rules: [
        { merchantSegment: "micro", channel: "bank", isVisible: false, isRequired: false }, // FORBIDDEN!
      ],
    });
    assert(
      hideRuleRes.status === 400 && hideRuleRes.body.message.includes("cannot be hidden in segment/channel rules"),
      "Attempt to hide protected field in segment/channel rule rejected with HTTP 400"
    );

    // 2. Attempt to set isRequired: false in segment/channel rule for protected field
    const optRuleRes = await apiRequest("PUT", `/admin/form-builder/versions/${draftVersionId}/fields/${protFieldId}`, adminToken, {
      sectionId: section1Id,
      fieldKey: "company_name",
      labelBn: "কোম্পানি নাম",
      labelEn: "Company Name",
      fieldType: "text",
      isVisible: true,
      isRequired: true,
      rules: [
        { merchantSegment: "micro", channel: "bank", isVisible: true, isRequired: false }, // FORBIDDEN!
      ],
    });
    assert(
      optRuleRes.status === 400 && optRuleRes.body.message.includes("cannot be optional in segment/channel rules"),
      "Attempt to make protected field optional in segment/channel rule rejected with HTTP 400"
    );

    // -------------------------------------------------------------------------
    // 6. Cloning into New Draft: All properties cloned intact (Tasks 1, 2, 3)
    // -------------------------------------------------------------------------
    console.log("\n--- Tasks 1, 2, 3: Cloning & Immutability Verification ---");
    // Publish V1
    const publishRes = await apiRequest("POST", `/admin/form-builder/versions/${draftVersionId}/publish`, adminToken);
    assert(publishRes.status === 200, "Draft version published successfully");

    // Clone to Draft V2
    const cloneRes = await apiRequest("POST", "/admin/form-builder/draft", adminToken, {
      formKey: "merchant_onboarding",
      fromVersionId: draftVersionId,
    });
    assert(cloneRes.status === 201, "Cloned published version into Draft V2");
    const draftV2Id = cloneRes.body?.data?.version?.id;

    // Verify all properties cloned in Draft V2:
    const clonedDetails = await formBuilderService.getVersionDetails(draftV2Id);
    const clonedSec1 = clonedDetails.sections.find(s => s.section_key === "sec_active_profile");
    const clonedSec2 = clonedDetails.sections.find(s => s.section_key === "sec_hidden_section");
    const clonedFldLeft = clonedSec1.fields.find(f => f.field_key === "fld_align_left");
    const clonedFldCenter = clonedSec1.fields.find(f => f.field_key === "fld_align_center");
    const clonedFldRight = clonedSec1.fields.find(f => f.field_key === "fld_align_right");
    const clonedFldInHidden = clonedSec2.fields.find(f => f.field_key === "fld_in_hidden_sec");

    assert(
      clonedSec1.description_bn === "এটি সক্রিয় সেকশনের বিবরণ" &&
      clonedSec1.description_en === "This is the active section description" &&
      clonedSec1.is_active === 1,
      "Cloned active section preserved title, descriptions, and is_active = 1"
    );

    assert(
      clonedSec2.description_bn === "লুকানো বিবরণ" &&
      clonedSec2.description_en === "Hidden description" &&
      clonedSec2.is_active === 0,
      "Cloned hidden section preserved descriptions and is_active = 0"
    );

    assert(
      Boolean(clonedFldInHidden),
      "Child field inside hidden section was preserved during cloning without data loss"
    );

    assert(
      clonedFldLeft.alignment === "left" &&
      clonedFldLeft.description_en === "Field detailed description English (left)" &&
      clonedFldLeft.help_text_en === "Helper text English" &&
      clonedFldLeft.placeholder_en === "Placeholder Left",
      "Cloned left-aligned field preserved alignment, descriptions, and placeholders"
    );

    assert(clonedFldCenter.alignment === "center", "Cloned centered field preserved alignment = center");
    assert(clonedFldRight.alignment === "right", "Cloned right-aligned field preserved alignment = right");

    // Clean up test versions safely
    await db.query(`UPDATE merchant_form_versions SET status = 'archived' WHERE id IN (?, ?)`, [draftVersionId, draftV2Id]);
    await db.query(`DELETE FROM merchant_form_field_rules WHERE field_id IN (SELECT id FROM merchant_form_fields WHERE form_version_id IN (?, ?))`, [draftVersionId, draftV2Id]);
    await db.query(`DELETE FROM merchant_form_field_options WHERE field_id IN (SELECT id FROM merchant_form_fields WHERE form_version_id IN (?, ?))`, [draftVersionId, draftV2Id]);
    await db.query(`DELETE FROM merchant_form_fields WHERE form_version_id IN (?, ?)`, [draftVersionId, draftV2Id]);
    await db.query(`DELETE FROM merchant_form_sections WHERE form_version_id IN (?, ?)`, [draftVersionId, draftV2Id]);
    await db.query(`DELETE FROM merchant_form_versions WHERE id IN (?, ?)`, [draftVersionId, draftV2Id]);
    console.log("\nSynthetic test audit data cleaned up.");

    console.log(`\n==================================================================`);
    console.log(`  SUMMARY: ${passedTests} PASSED, ${failedTests} FAILED (TOTAL: ${totalTests})`);
    console.log(`==================================================================`);

    server.close();
    process.exit(failedTests > 0 ? 1 : 0);
  } catch (err) {
    console.error("FATAL ERROR IN TEST SUITE:", err);
    if (server) server.close();
    process.exit(1);
  }
}

runAlignmentAndSectionAudit();

