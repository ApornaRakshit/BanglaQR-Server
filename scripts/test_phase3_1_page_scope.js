import http from "http";
import jwt from "jsonwebtoken";
import app from "../src/app.js";
import { db } from "../src/config/db.js";
import { env } from "../src/config/env.js";

function generateTestToken(userId) {
  return jwt.sign(
    { sub: userId, token_version: 0 },
    env.jwt.accessSecret,
    { expiresIn: "1h" }
  );
}

async function runPhase31PageScopeVerification() {
  console.log("==================================================================");
  console.log(" BANGLAQR — PHASE 3.1: PAGE-WISE ONBOARDING CONTROL VERIFICATION  ");
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
    const institutionToken = generateTestToken(56); // bank_admin

    console.log("--- 1. Testing Page Selector Isolation & Form Scope ---");
    // Querying versions for onboarding_company
    const companyScopeRes = await apiRequest("GET", "/admin/form-builder/versions?formKey=onboarding_company", adminToken);
    assert(companyScopeRes.status === 200, "Admin can query versions for onboarding_company", JSON.stringify(companyScopeRes.data));
    assert(
      (companyScopeRes.data?.data?.versions || []).every((v) => v.form_key === "onboarding_company"),
      "onboarding_company versions list contains ONLY onboarding_company records"
    );

    // Querying versions for onboarding_contact
    const contactScopeRes = await apiRequest("GET", "/admin/form-builder/versions?formKey=onboarding_contact", adminToken);
    assert(contactScopeRes.status === 200, "Admin can query versions for onboarding_contact", JSON.stringify(contactScopeRes.data));
    assert(
      (contactScopeRes.data?.data?.versions || []).every((v) => v.form_key === "onboarding_contact"),
      "onboarding_contact versions list contains ONLY onboarding_contact records"
    );

    console.log("\n--- 2. Testing Page-Scoped Draft Lifecycle & Scope Protection ---");
    // Ensure clean state: Discard any draft for onboarding_company
    const compDraft = companyScopeRes.data?.data?.draftVersion;
    if (compDraft) {
      await apiRequest("DELETE", `/admin/form-builder/versions/${compDraft.id}/draft`, adminToken);
    }
    // Create draft in onboarding_company
    const createCompanyDraftRes = await apiRequest("POST", "/admin/form-builder/draft", adminToken, {
      formKey: "onboarding_company",
    });
    assert(createCompanyDraftRes.status === 201, "Created draft for onboarding_company");
    const newCompanyDraftId = createCompanyDraftRes.data?.data?.version?.id;

    // Verify system-managed scopes reject createDraft
    const rejectSetupDraft = await apiRequest("POST", "/admin/form-builder/draft", adminToken, {
      formKey: "onboarding_setup",
    });
    assert(
      rejectSetupDraft.status === 400 && rejectSetupDraft.data?.message?.includes("system-managed"),
      "API rejects draft creation for system-controlled onboarding_setup (400)"
    );

    const rejectContactDraft = await apiRequest("POST", "/admin/form-builder/draft", adminToken, {
      formKey: "onboarding_contact",
    });
    assert(
      rejectContactDraft.status === 400 && rejectContactDraft.data?.message?.includes("system-managed"),
      "API rejects draft creation for system-managed onboarding_contact (400)"
    );

    const rejectKycDraft = await apiRequest("POST", "/admin/form-builder/draft", adminToken, {
      formKey: "onboarding_kyc",
    });
    assert(
      rejectKycDraft.status === 400 && rejectKycDraft.data?.message?.includes("system-managed"),
      "API rejects draft creation for system-managed onboarding_kyc (400)"
    );

    // Clean up valid draft
    await apiRequest("DELETE", `/admin/form-builder/versions/${newCompanyDraftId}/draft`, adminToken);

    console.log("\n--- 3. Testing Payment Channel Protection & Provider Integrity ---");
    // Read merchant's current profile
    const [[profBefore]] = await db.query(
      "SELECT channel, institution_id, bank_name, legal_structure_id, industry_category_id FROM merchant_profiles WHERE merchant_id = 325"
    );
    const originalChannel = profBefore?.channel || "bank";

    // Attempt to tamper with channel via PUT /merchants/me/company
    const tamperChannelRes = await apiRequest("PUT", "/merchants/me/company", merchantToken, {
      companyName: "ABC Company Tamper Test",
      channel: originalChannel === "bank" ? "mfs" : "bank",
    });
    assert(tamperChannelRes.status === 200, "Merchant company update executes successfully");

    const [[profAfterTamper]] = await db.query(
      "SELECT channel, company_name FROM merchant_profiles WHERE merchant_id = 325"
    );
    assert(
      profAfterTamper.channel === originalChannel,
      `Channel remains system-controlled ('${originalChannel}') and ignores client tamper payload ('${originalChannel === "bank" ? "mfs" : "bank"}')`
    );

    console.log("\n--- 4. Testing Legal Structure & Industry Catalogue Reference ID Persistence ---");
    // Update company with catalogue IDs and bilingual strings
    const updateCatalogueRes = await apiRequest("PUT", "/merchants/me/company", merchantToken, {
      companyName: "ABC Enterprise Ltd",
      legalStructureId: 1, // Sole Proprietorship
      industryCategoryId: 1, // Retail & Grocery
    });
    assert(updateCatalogueRes.status === 200, "Merchant updates company with legalStructureId=1 and industryCategoryId=1");

    const [[profCat]] = await db.query(
      "SELECT legal_structure_id, industry_category_id, business_type, industry FROM merchant_profiles WHERE merchant_id = 325"
    );
    assert(
      Number(profCat.legal_structure_id) === 1 && Number(profCat.industry_category_id) === 1,
      "merchant_profiles persists legal_structure_id (1) and industry_category_id (1)"
    );
    assert(
      profCat.business_type === "Sole Proprietorship" && profCat.industry === "Retail & Grocery",
      "merchant_profiles preserves canonical textual names ('Sole Proprietorship', 'Retail & Grocery')"
    );

    const [[kycCat]] = await db.query(
      "SELECT legal_structure_id, business_entity_type FROM merchant_kyc WHERE merchant_id = 325"
    );
    assert(
      Number(kycCat.legal_structure_id) === 1,
      "merchant_kyc synchronizes legal_structure_id (1)"
    );

    console.log("\n--- 5. Testing Merchant Route & Dynamic Integration ---");
    const merchantFormRes = await apiRequest("GET", "/merchants/me/form", merchantToken);
    assert(merchantFormRes.status === 200, "Merchant queries GET /merchants/me/form successfully");
    assert(merchantFormRes.data?.data?.hasPublishedForm === true, "Merchant receives published form for company step");
    assert(Array.isArray(merchantFormRes.data?.data?.sections), "Merchant receives rendered sections array");

    // Check sections belong to company information
    const sectionKeys = merchantFormRes.data?.data?.sections.map((s) => s.section_key);
    assert(
      sectionKeys.includes("company_general_info") && sectionKeys.includes("registered_office_address"),
      "Merchant company form contains Company Profile and Registered Address sections"
    );
    assert(
      !sectionKeys.includes("contact_person") && !sectionKeys.includes("kyc_details"),
      "No section or field leakage from Contact or KYC into Company Information"
    );

    console.log("\n--- 4. Testing Authorization & Role Enforcements ---");
    // Merchant trying to access Admin Form Builder
    const merchantForbiddenRes = await apiRequest("GET", "/admin/form-builder/versions?formKey=onboarding_company", merchantToken);
    assert(merchantForbiddenRes.status === 403, "Merchant access to Admin Form Builder is forbidden (403)");

    // Institution user trying to access Admin Form Builder
    const instForbiddenRes = await apiRequest("GET", "/admin/form-builder/versions?formKey=onboarding_company", institutionToken);
    assert(instForbiddenRes.status === 403, "Institution user access to Admin Form Builder is forbidden (403)");

    console.log("\n==================================================================");
    console.log(` PHASE 3.1 TEST SUMMARY: ${passedTests} PASSED, ${failedTests} FAILED (TOTAL: ${totalTests})`);
    console.log("==================================================================\n");

  } catch (err) {
    console.error("Test execution failed:", err);
  } finally {
    server.close();
    process.exit(failedTests > 0 ? 1 : 0);
  }
}

runPhase31PageScopeVerification();

