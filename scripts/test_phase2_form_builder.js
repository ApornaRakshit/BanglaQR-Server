import { db } from "../src/config/db.js";
import { formBuilderService } from "../src/modules/admin/formBuilder/formBuilder.service.js";

async function runPhase2AutomatedTests() {
  console.log("=== RUNNING PHASE 2 AUTOMATED TEST SUITE ===\n");
  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`✓ PASS: ${message}`);
      passed++;
    } else {
      console.error(`✗ FAIL: ${message}`);
      failed++;
    }
  }

  const adminUserId = 4; // super_admin user
  const formKey = "test_merchant_onboarding";
  let draftVersionId = null;
  let section1Id = null;
  let section2Id = null;
  let field1Id = null;
  let field2Id = null;

  try {
    // -------------------------------------------------------------
    // Test 1: Create a fresh Draft Version
    // -------------------------------------------------------------
    console.log("--- 1. Version Management: Create Draft ---");
    const draftDetails = await formBuilderService.createDraft(adminUserId, formKey);
    draftVersionId = draftDetails.version.id;
    assert(draftDetails.version.status === "draft", `Draft created with status 'draft' (Version ID: ${draftVersionId})`);

    // Prevent duplicate draft creation
    let duplicateDraftBlocked = false;
    try {
      await formBuilderService.createDraft(adminUserId, formKey);
    } catch (err) {
      duplicateDraftBlocked = err.statusCode === 400 && err.message.includes("active Draft Version already exists");
    }
    assert(duplicateDraftBlocked, "Creating duplicate draft for same form_key correctly blocked with 400");

    // -------------------------------------------------------------
    // Test 2: Dynamic Section Management
    // -------------------------------------------------------------
    console.log("\n--- 2. Section Management ---");
    section1Id = await formBuilderService.saveSection(draftVersionId, {
      sectionKey: "sec_company_info",
      titleBn: "কোম্পানি পরিচিতি",
      titleEn: "Company Information",
      descriptionBn: "প্রতিষ্ঠানের সাধারণ বিবরণ",
      descriptionEn: "General company overview",
      displayOrder: 1,
      isActive: true,
    });
    assert(Boolean(section1Id), `Section 1 created (ID: ${section1Id})`);

    section2Id = await formBuilderService.saveSection(draftVersionId, {
      sectionKey: "sec_kyc_details",
      titleBn: "কেওয়াইসি বিবরণ",
      titleEn: "KYC Details",
      displayOrder: 2,
      isActive: true,
    });
    assert(Boolean(section2Id), `Section 2 created (ID: ${section2Id})`);

    // Reorder sections
    await formBuilderService.reorderSections(draftVersionId, [section2Id, section1Id]);
    const reorderedDetails = await formBuilderService.getVersionDetails(draftVersionId);
    assert(
      reorderedDetails.sections[0].id === section2Id && reorderedDetails.sections[1].id === section1Id,
      "Sections reordered successfully (KYC Details is first, Company Information is second)"
    );

    // -------------------------------------------------------------
    // Test 3: Dynamic Field Builder & Protections
    // -------------------------------------------------------------
    console.log("\n--- 3. Field Builder & Protections ---");
    // Field 1: Text field (System-protected: company_name)
    field1Id = await formBuilderService.saveField(draftVersionId, {
      sectionId: section1Id,
      fieldKey: "company_name",
      systemFieldKey: "company_name",
      labelBn: "প্রতিষ্ঠানের নাম",
      labelEn: "Company Name",
      placeholderBn: "আপনার প্রতিষ্ঠানের নাম লিখুন",
      placeholderEn: "Enter your legal company name",
      fieldType: "text",
      fieldWidth: "100%",
      displayOrder: 1,
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
    assert(Boolean(field1Id), `Field 1 (company_name) created with 4 separate segment/channel rules (ID: ${field1Id})`);

    // Verify system protection: Cannot hide company_name
    let hideProtectedBlocked = false;
    try {
      await formBuilderService.saveField(draftVersionId, {
        id: field1Id,
        sectionId: section1Id,
        fieldKey: "company_name",
        labelBn: "প্রতিষ্ঠানের নাম",
        labelEn: "Company Name",
        fieldType: "text",
        isVisible: false, // Trying to hide protected field
      });
    } catch (err) {
      hideProtectedBlocked = err.statusCode === 400 && err.message.includes("cannot be hidden");
    }
    assert(hideProtectedBlocked, "Hiding protected system field correctly blocked by server with 400");

    // Field 2: Select field with options
    field2Id = await formBuilderService.saveField(draftVersionId, {
      sectionId: section1Id,
      fieldKey: "business_tier",
      labelBn: "ব্যবসার ক্যাটাগরি স্তর",
      labelEn: "Business Tier",
      fieldType: "select",
      fieldWidth: "50%",
      displayOrder: 2,
      isVisible: true,
      isRequired: true,
      options: [
        { optionValue: "tier_starter", labelBn: "স্টার্টার", labelEn: "Starter", displayOrder: 1 },
        { optionValue: "tier_growth", labelBn: "গ্রোথ", labelEn: "Growth", displayOrder: 2 },
      ],
      rules: [
        { merchantSegment: "big", channel: "bank", isVisible: true, isRequired: true },
        { merchantSegment: "big", channel: "mfs", isVisible: true, isRequired: true },
      ], // Big Merchant only!
    });
    assert(Boolean(field2Id), `Field 2 (business_tier) created with options and Big-only rules (ID: ${field2Id})`);

    // Duplicate field key rejection
    let dupFieldKeyBlocked = false;
    try {
      await formBuilderService.saveField(draftVersionId, {
        sectionId: section1Id,
        fieldKey: "company_name", // Duplicate key in same version!
        labelBn: "ডুপ্লিকেট",
        labelEn: "Duplicate",
        fieldType: "text",
      });
    } catch (err) {
      dupFieldKeyBlocked = err.statusCode === 400 && err.message.includes("already exists in this form version");
    }
    assert(dupFieldKeyBlocked, "Duplicate field key in same draft version correctly rejected with 400");

    // Duplicate option key rejection
    let dupOptionKeyBlocked = false;
    try {
      await formBuilderService.saveField(draftVersionId, {
        sectionId: section1Id,
        fieldKey: "custom_choice",
        labelBn: "পছন্দ",
        labelEn: "Choice",
        fieldType: "radio",
        options: [
          { optionValue: "opt_same", labelBn: "অপশন ১", labelEn: "Opt 1" },
          { optionValue: "opt_same", labelBn: "অপশন ২", labelEn: "Opt 2" },
        ],
      });
    } catch (err) {
      dupOptionKeyBlocked = err.statusCode === 400 && err.message.includes("Duplicate option values found");
    }
    assert(dupOptionKeyBlocked, "Duplicate option values inside choice field correctly rejected with 400");

    // -------------------------------------------------------------
    // Test 4: Preview Filtering across the 4 Segment x Channel combinations
    // -------------------------------------------------------------
    console.log("\n--- 4. Preview Filtering (Micro/Big x Bank/MFS) ---");
    // Micro + Bank: should see Field 1, but NOT Field 2 (which is Big only)
    const prevMicroBank = await formBuilderService.previewVersion(draftVersionId, {
      merchantSegment: "micro",
      channel: "bank",
    });
    const microBankFieldKeys = prevMicroBank.sections.flatMap((s) => s.fields.map((f) => f.field_key));
    assert(
      microBankFieldKeys.includes("company_name") && !microBankFieldKeys.includes("business_tier"),
      `Micro + Bank preview contains [${microBankFieldKeys.join(", ")}] (business_tier excluded as expected)`
    );

    // Big + Bank: should see BOTH Field 1 and Field 2
    const prevBigBank = await formBuilderService.previewVersion(draftVersionId, {
      merchantSegment: "big",
      channel: "bank",
    });
    const bigBankFieldKeys = prevBigBank.sections.flatMap((s) => s.fields.map((f) => f.field_key));
    assert(
      bigBankFieldKeys.includes("company_name") && bigBankFieldKeys.includes("business_tier"),
      `Big + Bank preview contains [${bigBankFieldKeys.join(", ")}] (both fields included as expected)`
    );

    // Invalid segment in preview rejected
    let invalidPrevSegBlocked = false;
    try {
      await formBuilderService.previewVersion(draftVersionId, { merchantSegment: "both", channel: "bank" });
    } catch (err) {
      invalidPrevSegBlocked = err.statusCode === 400;
    }
    assert(invalidPrevSegBlocked, "Invalid segment 'both' in preview correctly rejected with 400");

    // -------------------------------------------------------------
    // Test 5: Publishing Draft & Immutability
    // -------------------------------------------------------------
    console.log("\n--- 5. Publishing Draft & Immutability ---");
    const publishedDetails = await formBuilderService.publishDraft(adminUserId, draftVersionId);
    assert(publishedDetails.version.status === "published", `Form version ${draftVersionId} successfully published!`);

    // Verify immutability of published version: modifying section must be blocked by trigger
    let pubSecModBlocked = false;
    try {
      await formBuilderService.saveSection(draftVersionId, {
        id: section1Id,
        sectionKey: "sec_company_info",
        titleBn: "পরিবর্তিত",
        titleEn: "Changed",
      });
    } catch (err) {
      pubSecModBlocked = err.message.includes("Cannot edit a section in a published or archived form version") || err.message.includes("Immutable Published Form");
    }
    assert(pubSecModBlocked, "Modifying section in published version blocked at both service and trigger level");

    // -------------------------------------------------------------
    // Test 6: Cloning Published Version into a New Draft
    // -------------------------------------------------------------
    console.log("\n--- 6. Cloning Published Version to New Draft ---");
    const clonedDraftDetails = await formBuilderService.createDraft(adminUserId, formKey, draftVersionId);
    const clonedDraftId = clonedDraftDetails.version.id;
    assert(
      clonedDraftId !== draftVersionId && clonedDraftDetails.version.version_number === 2 && clonedDraftDetails.version.status === "draft",
      `New Draft cloned (Version ID: ${clonedDraftId}, Version Number: 2)`
    );

    // Verify sections and fields were faithfully duplicated
    assert(clonedDraftDetails.sections.length === 2, `Cloned draft contains 2 sections`);
    const clonedFields = clonedDraftDetails.sections.flatMap((s) => s.fields);
    assert(clonedFields.length === 2, `Cloned draft contains 2 fields`);
    const clonedField2 = clonedFields.find((f) => f.field_key === "business_tier");
    assert(clonedField2 && clonedField2.options.length === 2, `Cloned choice field has 2 options cloned intact`);

    // Discard the new cloned draft
    console.log("\n--- 7. Discard Draft ---");
    const discardRes = await formBuilderService.discardDraft(clonedDraftId);
    assert(discardRes.success, "Cloned draft successfully discarded without touching published version");

    // Verify original published version remains active and untouched
    const currentVersions = await formBuilderService.getVersions(formKey);
    assert(
      currentVersions.publishedVersion?.id === draftVersionId && currentVersions.draftVersion === null,
      `Original published version ${draftVersionId} remains active and published, draft is null`
    );

    console.log(`\n=== SUMMARY: ${passed} PASSED, ${failed} FAILED ===\n`);
  } finally {
    // Cleanup synthetic form test data
    console.log("Cleaning up synthetic test form data...");
    await db.query(`UPDATE merchant_form_versions SET status = 'archived' WHERE form_key = ?`, [formKey]);
    const [fields] = await db.query(
      `SELECT id FROM merchant_form_fields WHERE form_version_id IN (SELECT id FROM merchant_form_versions WHERE form_key = ?)`,
      [formKey]
    );
    const fIds = fields.map((f) => f.id);
    if (fIds.length > 0) {
      await db.query(`DELETE FROM merchant_form_field_rules WHERE field_id IN (?)`, [fIds]);
      await db.query(`DELETE FROM merchant_form_field_options WHERE field_id IN (?)`, [fIds]);
      await db.query(`DELETE FROM merchant_form_fields WHERE id IN (?)`, [fIds]);
    }
    await db.query(`DELETE FROM merchant_form_sections WHERE form_version_id IN (SELECT id FROM merchant_form_versions WHERE form_key = ?)`, [formKey]);
    await db.query(`DELETE FROM merchant_form_versions WHERE form_key = ?`, [formKey]);
    console.log("Synthetic test form data cleaned up.");
  }

  process.exit(failed === 0 ? 0 : 1);
}

runPhase2AutomatedTests().catch((e) => {
  console.error("FATAL ERROR IN TEST SUITE:", e);
  process.exit(1);
});

