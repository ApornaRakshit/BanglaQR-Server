import http from "http";
import jwt from "jsonwebtoken";
import app from "../src/app.js";
import { db } from "../src/config/db.js";
import { env } from "../src/config/env.js";
import { formBuilderService } from "../src/modules/admin/formBuilder/formBuilder.service.js";

function generateTestToken(userId) {
  return jwt.sign(
    { sub: userId, token_version: 0 },
    env.jwt.accessSecret,
    { expiresIn: "1h" }
  );
}

async function runPhase3Verification() {
  console.log("==================================================================");
  console.log(" BANGLAQR — PHASE 3: DYNAMIC FORM INTEGRATION VERIFICATION SUITE ");
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
    return { status: res.status, data };
  }

  try {
    const adminToken = generateTestToken(4); // superadmin
    const merchantToken = generateTestToken(442); // merchant ABC Company (id: 325)

    console.log("--- 1. Testing Idempotent Bootstrap Mechanism ---");
    // Discard any existing draft if present to test clean bootstrap
    const [existingDraft] = await db.query(
      "SELECT id FROM merchant_form_versions WHERE form_key = 'merchant_onboarding' AND status = 'draft'"
    );
    if (existingDraft.length > 0) {
      await formBuilderService.discardDraft(existingDraft[0].id);
    }

    const bootRes = await apiRequest("POST", "/admin/form-builder/bootstrap", adminToken, {
      formKey: "merchant_onboarding",
    });
    assert(bootRes.status === 200, "POST /admin/form-builder/bootstrap returns 200", JSON.stringify(bootRes.data));
    assert(bootRes.data?.data?.sections?.length >= 2, "Bootstrapped draft contains standard sections (Profile & Address)", `Sections count: ${bootRes.data?.data?.sections?.length}`);

    const bootstrappedDraftId = bootRes.data?.data?.version?.id;

    // Idempotency check: Calling bootstrap again returns existing draft
    const bootRes2 = await apiRequest("POST", "/admin/form-builder/bootstrap", adminToken, {
      formKey: "merchant_onboarding",
    });
    assert(bootRes2.data?.data?.version?.id === bootstrappedDraftId, "Bootstrap is idempotent: returns existing draft", `Draft IDs: ${bootRes2.data?.data?.version?.id} vs ${bootstrappedDraftId}`);

    console.log("\n--- 2. Testing Fallback Mode When No Published Form ---");
    // Ensure no published version exists for onboarding_company or merchant_onboarding right now
    await db.query(
      "UPDATE merchant_form_versions SET status = 'archived' WHERE form_key IN ('onboarding_company', 'merchant_onboarding') AND status = 'published'"
    );
    // Clear merchant profile form_version_id
    await db.query("UPDATE merchant_profiles SET form_version_id = NULL WHERE merchant_id = 325");

    const fallbackRes = await apiRequest("GET", "/merchants/me/form", merchantToken);
    assert(fallbackRes.status === 200, "GET /merchants/me/form returns 200", JSON.stringify(fallbackRes.data));
    assert(fallbackRes.data?.data?.hasPublishedForm === false, "Returns hasPublishedForm: false when no published form exists");

    console.log("\n--- 3. Testing Publishing Draft Version ---");
    // Add custom field to draft to test custom values persistence
    const draftDetails = await formBuilderService.getVersionDetails(bootstrappedDraftId);
    const sec1 = draftDetails.sections[0];
    const addFieldRes = await apiRequest("POST", `/admin/form-builder/versions/${bootstrappedDraftId}/fields`, adminToken, {
      sectionId: sec1.id,
      fieldKey: "custom_notes",
      labelBn: "বিশেষ মন্তব্য",
      labelEn: "Special Notes",
      fieldType: "textarea",
      displayOrder: 99,
      width: "100%",
      alignment: "left",
      isRequired: false,
      isActive: true,
      rules: [
        { merchantSegment: "micro", channel: "bank", isVisible: true, isRequired: false },
        { merchantSegment: "micro", channel: "mfs", isVisible: true, isRequired: false },
        { merchantSegment: "big", channel: "bank", isVisible: true, isRequired: true },
        { merchantSegment: "big", channel: "mfs", isVisible: true, isRequired: true },
      ],
    });
    assert(addFieldRes.status === 200 || addFieldRes.status === 201, "Custom field added to draft successfully", JSON.stringify(addFieldRes.data));

    // Publish the draft
    const pubRes = await apiRequest("POST", `/admin/form-builder/versions/${bootstrappedDraftId}/publish`, adminToken);
    assert(pubRes.status === 200, "Draft version published successfully", JSON.stringify(pubRes.data));

    console.log("\n--- 4. Testing Form Version Pinning to Merchant Profile ---");
    const merchantFormRes = await apiRequest("GET", "/merchants/me/form", merchantToken);
    assert(merchantFormRes.status === 200, "GET /merchants/me/form returns 200 for merchant");
    assert(merchantFormRes.data?.data?.hasPublishedForm === true, "hasPublishedForm is true after publishing");
    assert(merchantFormRes.data?.data?.formVersionId === bootstrappedDraftId, "Merchant receives published version ID");

    // Verify pinned in DB
    const [[profRow]] = await db.query("SELECT form_version_id FROM merchant_profiles WHERE merchant_id = 325");
    assert(profRow.form_version_id === bootstrappedDraftId, "form_version_id is pinned in merchant_profiles", `Pinned: ${profRow.form_version_id}`);

    // Clean existing custom values for this test run
    await db.query("DELETE FROM merchant_profile_custom_values WHERE merchant_id = 325");

    console.log("\n--- 5. Testing Core Field Mapping & Custom Value Persistence ---");
    const saveCompanyRes = await apiRequest("PUT", "/merchants/me/company", merchantToken, {
      companyName: "ABC Dynamic Enterprises Ltd",
      businessType: "Sole Proprietorship",
      industry: "Retail & Grocery",
      address: "House 10, Road 4, Banani",
      city: "Dhaka",
      state: "Dhaka",
      postalCode: "1213",
      custom_notes: "Phase 3 dynamic custom field submitted value",
    });
    assert(saveCompanyRes.status === 200, "PUT /merchants/me/company returns 200", JSON.stringify(saveCompanyRes.data));

    // Check custom value in merchant_profile_custom_values
    const [cvRows] = await db.query(
      "SELECT * FROM merchant_profile_custom_values WHERE merchant_id = 325 AND field_key = 'custom_notes'"
    );
    assert(cvRows.length === 1, "Custom field value saved in merchant_profile_custom_values");
    assert(cvRows[0]?.field_value === "Phase 3 dynamic custom field submitted value", "Custom value matches submitted string");

    // Re-query /merchants/me/form to confirm prefilling
    const prefillRes = await apiRequest("GET", "/merchants/me/form", merchantToken);
    assert(prefillRes.data?.data?.values?.companyName === "ABC Dynamic Enterprises Ltd", "Core field prefilled in dynamic form");
    assert(prefillRes.data?.data?.values?.custom_notes === "Phase 3 dynamic custom field submitted value", "Custom value prefilled in dynamic form");

    console.log("\n--- 6. Testing Version Pinning Immutability when Newer Version is Published ---");
    // Admin creates draft v2 and publishes it
    const v2DraftRes = await apiRequest("POST", "/admin/form-builder/draft", adminToken, {
      formKey: "merchant_onboarding",
      fromVersionId: bootstrappedDraftId,
    });
    const v2DraftId = v2DraftRes.data?.data?.version?.id;
    assert(Boolean(v2DraftId), "Admin created draft v2 cloned from v1");

    // Publish v2
    const v2PubRes = await apiRequest("POST", `/admin/form-builder/versions/${v2DraftId}/publish`, adminToken);
    assert(v2PubRes.status === 200, "Admin published v2 successfully");

    // Merchant ABC should still be pinned to bootstrappedDraftId (v1)
    const merchantFormResAfterV2 = await apiRequest("GET", "/merchants/me/form", merchantToken);
    assert(
      merchantFormResAfterV2.data?.data?.formVersionId === bootstrappedDraftId,
      "Existing merchant remains pinned to Version 1 despite Version 2 being published",
      `Expected ${bootstrappedDraftId}, got ${merchantFormResAfterV2.data?.data?.formVersionId}`
    );

    console.log("\n--- 7. Testing Admin Merchant Review Dynamic Data Integration ---");
    const adminMerchantRes = await apiRequest("GET", "/admin/merchants/325", adminToken);
    assert(adminMerchantRes.status === 200, "GET /admin/merchants/325 returns 200");
    assert(Array.isArray(adminMerchantRes.data?.data?.customValues), "Admin review response contains customValues array");
    const hasCustomNote = adminMerchantRes.data?.data?.customValues?.some(
      (cv) => cv.fieldKey === "custom_notes" && cv.fieldValue === "Phase 3 dynamic custom field submitted value"
    );
    assert(hasCustomNote, "Admin review displays submitted dynamic custom values");

    console.log("\n==================================================================");
    console.log(` PHASE 3 TEST SUMMARY: ${passedTests} PASSED, ${failedTests} FAILED (TOTAL: ${totalTests})`);
    console.log("==================================================================\n");

  } catch (err) {
    console.error("Test execution failed:", err);
  } finally {
    server.close();
    process.exit(failedTests > 0 ? 1 : 0);
  }
}

runPhase3Verification();
