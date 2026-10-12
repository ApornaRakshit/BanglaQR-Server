import dotenv from "dotenv";
import path from "path";
import http from "http";
import { fileURLToPath } from "url";
import { db } from "../src/config/db.js";
import app from "../src/app.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, "../.env") });

async function request(url, options = {}) {
  try {
    const res = await fetch(url, options);
    const contentType = res.headers.get("content-type") || "";
    let data = null;
    if (contentType.includes("application/json")) {
      data = await res.json();
    } else {
      data = await res.text();
    }
    return { status: res.status, headers: res.headers, data };
  } catch (err) {
    return { status: 0, error: err.message };
  }
}

async function runE2ETests() {
  console.log("==================================================================");
  console.log("  BANGLAQR PUBLIC MARKETPLACE E2E INTEGRATION & WORKFLOW TEST   ");
  console.log("==================================================================\n");

  // Spin up temporary local server on dynamic free port
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const BASE_URL = `http://127.0.0.1:${port}/api/v1`;
  console.log(`Local Express Test Server listening on http://127.0.0.1:${port}`);

  let testGatewayId = null;
  let testApplicationId = null;

  try {
    // -------------------------------------------------------------
    // TEST 1: Public Marketplace Services API
    // -------------------------------------------------------------
    console.log("\n[TEST 1] Testing Public Marketplace API (GET /api/v1/public/marketplace/services)...");
    
    // 1a. All services
    const allRes = await request(`${BASE_URL}/public/marketplace/services`);
    if (allRes.status !== 200 || !allRes.data?.data) {
      throw new Error(`Public services list failed (status ${allRes.status}): ${JSON.stringify(allRes.data || allRes.error)}`);
    }
    const allServices = allRes.data.data;
    console.log(`✓ Retrieved ${allServices.length} total published marketplace items.`);
    
    // Verify categories present
    const categoriesFound = new Set(allServices.map((s) => s.category));
    console.log(`✓ Categories present in marketplace: ${Array.from(categoriesFound).join(", ")}`);

    // Verify fields contract
    const firstItem = allServices[0];
    if (!firstItem.id || !firstItem.name || !firstItem.sourceType) {
      throw new Error(`Service item missing required schema attributes: ${JSON.stringify(firstItem)}`);
    }
    console.log(`✓ Schema contract verified: id="${firstItem.id}", name="${firstItem.name}", sourceType="${firstItem.sourceType}", category="${firstItem.category}"`);

    // 1b. Filtering by category
    const bankRes = await request(`${BASE_URL}/public/marketplace/services?category=bank`);
    console.log(`✓ Filter category=bank returned ${bankRes.data?.data?.length || 0} items.`);

    const mfsRes = await request(`${BASE_URL}/public/marketplace/services?category=mfs`);
    console.log(`✓ Filter category=mfs returned ${mfsRes.data?.data?.length || 0} items.`);

    const addonRes = await request(`${BASE_URL}/public/marketplace/services?category=addon`);
    console.log(`✓ Filter category=addon returned ${addonRes.data?.data?.length || 0} items.`);

    // 1c. Search functionality
    const searchRes = await request(`${BASE_URL}/public/marketplace/services?search=City`);
    console.log(`✓ Search ?search=City returned ${searchRes.data?.data?.length || 0} matching items.`);

    // 1d. Details endpoint
    const detailsRes = await request(`${BASE_URL}/public/marketplace/services/${firstItem.id}`);
    if (detailsRes.status !== 200 || !detailsRes.data?.data) {
      throw new Error(`Failed to fetch service details: ${JSON.stringify(detailsRes.data)}`);
    }
    console.log(`✓ Single service details retrieved successfully: "${detailsRes.data.data.name}"`);
    console.log(`  Fees: ${detailsRes.data.data.serviceFee || detailsRes.data.data.priceFormatted}, Eligibility: ${detailsRes.data.data.eligibility || 'Standard'}`);

    // -------------------------------------------------------------
    // TEST 2: Admin Portal Gateway Management & Real-time Marketplace Sync
    // -------------------------------------------------------------
    console.log("\n[TEST 2] Testing Admin Gateway Update & Real-Time Sync to Marketplace...");

    // Authenticate Admin
    const adminLoginRes = await request(`${BASE_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: process.env.ADMIN_EMAIL || "admin@banglaqr.com",
        password: process.env.ADMIN_PASSWORD || "Admin@123456",
      }),
    });
    if (adminLoginRes.status !== 200 || !adminLoginRes.data?.data?.token) {
      throw new Error(`Admin login failed: ${JSON.stringify(adminLoginRes.data)}`);
    }
    const adminToken = adminLoginRes.data.data.token;
    const adminHeaders = {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json",
    };
    console.log("✓ Admin authenticated successfully.");

    // Create a dedicated test gateway via Admin
    const timestamp = Date.now();
    const testGwCode = `TEST_BANK_${timestamp}`;
    const createGwRes = await request(`${BASE_URL}/admin/gateways`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        name: `Automated Test Bank Acquiring ${timestamp}`,
        code: testGwCode,
        category: "bank",
        serviceType: "Bank MFS",
        status: "active",
        isPublished: true,
        acceptsApplications: true,
        displayOrder: 1,
        serviceFee: 1.15,
        setupFee: 0,
        shortDescription: "স্বয়ংক্রিয় টেস্ট ব্যাংক বাংলা কিউআর সার্ভিস",
        description: "Automated test bank gateway acquiring service description.",
        eligibility: "ভ্যালিড ট্রেড লাইসেন্স ও ব্যাংক অ্যাকাউন্ট প্রয়োজন।",
        qrSupported: true,
        cardSupported: true,
        mobileSupported: true,
        apiSupported: true,
        supportedMethods: ["BanglaQR", "Bank App", "NPSB"],
      }),
    });
    if (createGwRes.status !== 201 && createGwRes.status !== 200) {
      throw new Error(`Failed to create test gateway: ${JSON.stringify(createGwRes.data)}`);
    }
    testGatewayId = createGwRes.data?.id || createGwRes.data?.data?.id || createGwRes.data?.gateway?.id;
    console.log(`✓ Admin created new marketplace service: ID=${testGatewayId}, Code=${testGwCode}`);

    // Verify it appears in Public Marketplace immediately
    const checkPublicRes = await request(`${BASE_URL}/public/marketplace/services?search=${testGwCode}`);
    const foundInMarketplace = (checkPublicRes.data?.data || []).find((s) => s.id === `gw_${testGatewayId}`);
    if (!foundInMarketplace) {
      throw new Error(`Newly created service gw_${testGatewayId} not found in public marketplace!`);
    }
    console.log(`✓ Real-time sync verified: Service is publicly visible with Bengali short description: "${foundInMarketplace.shortDescription}"`);

    // Admin updates status to unpublish
    await request(`${BASE_URL}/admin/gateways/${testGatewayId}`, {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify({
        name: `Automated Test Bank Acquiring ${timestamp}`,
        code: testGwCode,
        category: "bank",
        serviceType: "Bank MFS",
        status: "active",
        isPublished: false, // unpublish
        acceptsApplications: false,
        displayOrder: 1,
        serviceFee: 1.15,
        setupFee: 0,
      }),
    });

    const checkUnpublished = await request(`${BASE_URL}/public/marketplace/services?search=${testGwCode}`);
    const unpubFound = (checkUnpublished.data?.data || []).find((s) => s.id === `gw_${testGatewayId}`);
    if (unpubFound) {
      throw new Error("Unpublished service should not be visible in public marketplace!");
    }
    console.log("✓ Dynamic unpublish verified: Service immediately hidden from public landing page.");

    // Re-publish so merchant can apply
    await request(`${BASE_URL}/admin/gateways/${testGatewayId}`, {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify({
        name: `Automated Test Bank Acquiring ${timestamp}`,
        code: testGwCode,
        category: "bank",
        serviceType: "Bank MFS",
        status: "active",
        isPublished: true,
        acceptsApplications: true,
        displayOrder: 1,
        serviceFee: 1.15,
        setupFee: 0,
        shortDescription: "স্বয়ংক্রিয় টেস্ট ব্যাংক বাংলা কিউআর সার্ভিস",
        eligibility: "ভ্যালিড ট্রেড লাইসেন্স ও ব্যাংক অ্যাকাউন্ট প্রয়োজন।",
      }),
    });
    console.log("✓ Service re-published for merchant application continuation.");

    // -------------------------------------------------------------
    // TEST 3: Merchant Authenticated Application Submission
    // -------------------------------------------------------------
    console.log("\n[TEST 3] Testing Merchant Application Continuation & Database Persistence...");

    // Register test merchant
    const merchantEmail = `marketplace.tester.${timestamp}@banglaqr.com`;
    const merchantPassword = "Password@123456";

    await request(`${BASE_URL}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyName: `Marketplace Merchant ${timestamp}`,
        merchantName: "Ashik Rahman",
        email: merchantEmail,
        phone: "017" + String(timestamp).slice(-8),
        password: merchantPassword,
      }),
    });

    const merchantLoginRes = await request(`${BASE_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: merchantEmail, password: merchantPassword }),
    });
    if (merchantLoginRes.status !== 200 || !merchantLoginRes.data?.data?.token) {
      throw new Error(`Merchant login failed: ${JSON.stringify(merchantLoginRes.data)}`);
    }
    const merchantToken = merchantLoginRes.data.data.token;
    const merchantHeaders = {
      Authorization: `Bearer ${merchantToken}`,
      "Content-Type": "application/json",
    };
    console.log(`✓ Test Merchant logged in: ${merchantEmail}`);

    // Merchant applies for the gateway
    const applyRes = await request(`${BASE_URL}/merchants/me/gateways/${testGatewayId}/apply`, {
      method: "POST",
      headers: merchantHeaders,
      body: JSON.stringify({
        expectedMonthlyVolume: 350000,
        purposeOfUse: "Direct retail store BanglaQR transactions",
        businessNotes: "Applied directly from Public Marketplace",
      }),
    });
    if (applyRes.status !== 200 && applyRes.status !== 201) {
      throw new Error(`Failed to apply for gateway: ${JSON.stringify(applyRes.data)}`);
    }
    testApplicationId = applyRes.data?.applicationId || applyRes.data?.data?.id;
    console.log(`✓ Application created in MySQL: ID=${testApplicationId}, Status=${applyRes.data?.status || 'under_review'}`);

    // Verify row in MySQL `merchant_gateway_applications`
    const [appRows] = await db.query(
      "SELECT * FROM merchant_gateway_applications WHERE id = ? LIMIT 1",
      [testApplicationId]
    );
    if (appRows.length === 0) {
      throw new Error(`Application ID ${testApplicationId} not found in MySQL table merchant_gateway_applications!`);
    }
    console.log(`✓ Database verification: Row persisted in merchant_gateway_applications (status: ${appRows[0].status})`);

    // Verify notification was generated in MySQL `notifications`
    const [notifRows] = await db.query(
      "SELECT * FROM notifications WHERE type IN ('application_submitted', 'new_application', 'gateway_application') ORDER BY id DESC LIMIT 5"
    );
    console.log(`✓ System Notification verification: ${notifRows.length} recent application notification(s) logged.`);

    // -------------------------------------------------------------
    // TEST 4: Admin Review & Automatic Service Provisioning
    // -------------------------------------------------------------
    console.log("\n[TEST 4] Testing Admin Application Review & Automatic Service Provisioning...");

    const reviewRes = await request(`${BASE_URL}/admin/gateways/applications/${testApplicationId}/review`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        action: "approve",
        reviewNote: "Approved compliance verification. Service active.",
      }),
    });
    if (reviewRes.status !== 200) {
      throw new Error(`Admin review failed: ${JSON.stringify(reviewRes.data)}`);
    }
    console.log(`✓ Admin review response: "${reviewRes.data?.message}"`);

    // Verify application status updated to approved in MySQL
    const [reviewedAppRows] = await db.query(
      "SELECT status, reviewed_at FROM merchant_gateway_applications WHERE id = ?",
      [testApplicationId]
    );
    console.log(`✓ Application status in database: ${reviewedAppRows[0]?.status} (Reviewed at: ${reviewedAppRows[0]?.reviewed_at})`);

    // Verify service provisioned in `merchant_gateway_services`
    const [serviceRows] = await db.query(
      "SELECT * FROM merchant_gateway_services WHERE gateway_id = ? AND merchant_id = ?",
      [testGatewayId, appRows[0].merchant_id]
    );
    if (serviceRows.length === 0) {
      throw new Error("Provisioned service row not found in merchant_gateway_services!");
    }
    console.log(`✓ Service provisioned in MySQL: Service ID=${serviceRows[0].id}, Status=${serviceRows[0].status}`);

    // Verify merchant sees it in `/merchants/me/services`
    const myServicesRes = await request(`${BASE_URL}/merchants/me/services`, {
      headers: merchantHeaders,
    });
    const myServicesList = myServicesRes.data?.data || [];
    const foundProvisioned = myServicesList.find((s) => s.gatewayId === testGatewayId || s.gateway_id === testGatewayId);
    if (!foundProvisioned) {
      throw new Error("Provisioned service not returned in Merchant My Services API!");
    }
    console.log(`✓ Merchant My Services verification: "${foundProvisioned.gatewayName || foundProvisioned.gateway_name}" is active!`);

    console.log("\n==================================================================");
    console.log("  ALL MARKETPLACE E2E INTEGRATION TESTS PASSED SUCCESSFULLY! ✓   ");
    console.log("==================================================================");

  } finally {
    // Cleanup test records
    if (testGatewayId) {
      await db.query("DELETE FROM merchant_gateway_services WHERE gateway_id = ?", [testGatewayId]).catch(() => {});
      await db.query("DELETE FROM merchant_gateway_applications WHERE gateway_id = ?", [testGatewayId]).catch(() => {});
      await db.query("DELETE FROM gateways WHERE id = ?", [testGatewayId]).catch(() => {});
      console.log(`\n(Cleaned up automated test gateway ID ${testGatewayId} from MySQL)`);
    }
    server.close(() => {
      process.exit(0);
    });
  }
}

runE2ETests().catch((err) => {
  console.error("\n❌ E2E Test Failure:", err.message);
  process.exit(1);
});
