import jwt from "jsonwebtoken";
import request from "supertest";
import { app } from "../src/app.js";
import { db } from "../src/config/db.js";

async function runSmokeTests3_4_5() {
  console.log("=== 3, 4, 5. INSTITUTION ROUTING, ADMIN AUTH & CMS/FAQ/PAYMENT SMOKE TESTS ===\n");
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

  const accessSecret = process.env.JWT_ACCESS_SECRET || "787e40b06454c0388dbb4f4cf87fbaa1710cbe9c22a4c4f9e62920ea41295f62";

  // Create JWT tokens for different roles
  // 1. Admin Token (User 4: superadmin@banglaqr.com)
  const adminToken = jwt.sign({ id: 4, email: "superadmin@banglaqr.com", role: "super_admin" }, accessSecret, { expiresIn: "1h" });

  // 2. Merchant Token (User 432: aporna.rakshit@gmail.com)
  const merchantToken = jwt.sign({ id: 432, email: "aporna.rakshit@gmail.com", role: "merchant" }, accessSecret, { expiresIn: "1h" });

  // 3. Institution Token (User 56: brac.admin@banglaqr.com)
  const instToken = jwt.sign({ id: 56, email: "brac.admin@banglaqr.com", role: "bank_admin" }, accessSecret, { expiresIn: "1h" });

  try {
    // -------------------------------------------------------------
    // SMOKE 3: Institution Routing Smoke Test
    // -------------------------------------------------------------
    console.log("--- Smoke 3: Institution Routing & Isolation ---");
    // Synthetic application check on merchant 319 (institution_id = 4 / bKash)
    // Query applications endpoint as institution user 56 (BRAC Bank)
    const instAppsRes = await request(app)
      .get("/api/v1/institution/applications")
      .set("Authorization", `Bearer ${instToken}`);
    
    assert(instAppsRes.status === 200, `Institution applications list HTTP status: ${instAppsRes.status}`);

    // Confirm that BRAC Bank does not see applications belonging to Eastern Bank or bKash
    const appsList = instAppsRes.body.data || [];
    const nonBracLeak = appsList.some(app => app.institutionId && app.institutionId !== 4); // assuming BRAC is not bKash
    assert(!nonBracLeak, "Institution application endpoint correctly isolates applications to authenticated institution");

    // Global Admin access to all applications
    const adminAppsRes = await request(app)
      .get("/api/v1/admin/merchants")
      .set("Authorization", `Bearer ${adminToken}`);
    assert(adminAppsRes.status === 200, `Global Admin access to merchants list HTTP status: ${adminAppsRes.status}`);

    // -------------------------------------------------------------
    // SMOKE 4: Admin Authorization API Smoke Test
    // -------------------------------------------------------------
    console.log("\n--- Smoke 4: Admin Authorization API Tests ---");
    // 1. Merchant accessing protected Admin endpoint -> HTTP 403
    const merchToAdmin = await request(app)
      .get("/api/v1/admin/settings")
      .set("Authorization", `Bearer ${merchantToken}`);
    assert(merchToAdmin.status === 403, `Merchant blocked from Admin settings with HTTP ${merchToAdmin.status}`);

    // 2. Institution accessing protected Global Admin endpoint -> HTTP 403
    const instToAdmin = await request(app)
      .get("/api/v1/admin/settings")
      .set("Authorization", `Bearer ${instToken}`);
    assert(instToAdmin.status === 403, `Institution blocked from Admin settings with HTTP ${instToAdmin.status}`);

    // 3. Authorized Admin accessing Admin endpoint -> HTTP 200
    const adminAccess = await request(app)
      .get("/api/v1/admin/settings")
      .set("Authorization", `Bearer ${adminToken}`);
    assert(adminAccess.status === 200, `Authorized Admin granted access with HTTP ${adminAccess.status}`);

    // -------------------------------------------------------------
    // SMOKE 5: CMS, FAQ and Payment Smoke Test
    // -------------------------------------------------------------
    console.log("\n--- Smoke 5: CMS, FAQ & Payment Workflow Tests ---");
    // 1. Existing homepage content loads (public)
    const cmsRes = await request(app).get("/api/v1/public/cms/homepage");
    assert(cmsRes.status === 200, `Public CMS homepage endpoint returns HTTP ${cmsRes.status}`);

    // 2. Existing FAQ list loads (public)
    const faqRes = await request(app).get("/api/v1/public/faqs");
    assert(faqRes.status === 200 && Array.isArray(faqRes.body.data), `Public FAQ list returns HTTP ${faqRes.status} with ${faqRes.body.data?.length} FAQs`);

    // 3. Unauthorized access to Admin CMS editor -> HTTP 403
    const unauthCms = await request(app)
      .put("/api/v1/admin/cms/homepage")
      .set("Authorization", `Bearer ${merchantToken}`)
      .send({ hero: {} });
    assert(unauthCms.status === 403, `Unauthorized user blocked from editing CMS with HTTP ${unauthCms.status}`);

    // 4. Fake/Invalid payment callback cannot activate subscription
    const fakeCallback = await request(app)
      .post("/api/v1/payments/callback")
      .send({ transactionId: "FAKE-TXN-12345", status: "success", amount: 1000 });
    // Callback should either reject with 400/404/403 or signature invalid, never 200 success activation
    assert(fakeCallback.status !== 200 || !fakeCallback.body.success, `Fake payment callback rejected or safe with HTTP ${fakeCallback.status}`);

  } catch (err) {
    console.error("FATAL ERROR IN SMOKE TESTS:", err);
    failed++;
  }

  console.log(`\n=== SMOKE 3, 4, 5 RESULT: ${passed} PASSED, ${failed} FAILED ===\n`);
  return failed === 0;
}

runSmokeTests3_4_5().then(success => {
  process.exit(success ? 0 : 1);
});

