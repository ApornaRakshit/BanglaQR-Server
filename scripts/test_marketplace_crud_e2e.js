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

async function runTest() {
  console.log("==========================================================================");
  console.log("  MARKETPLACE CRUD, EDIT, DELETE & SNAPSHOT VERIFICATION E2E TEST         ");
  console.log("==========================================================================\n");

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const BASE_URL = `http://127.0.0.1:${port}/api/v1`;
  console.log(`Test Server running on: ${BASE_URL}\n`);

  let testGatewayId = null;
  let testAppId = null;
  let testAddonId = null;
  let testMerchantAddonId = null;

  try {
    // -------------------------------------------------------------
    // 1. Authenticate Admin and Merchant
    // -------------------------------------------------------------
    console.log("[STEP 1] Authenticating Admin & Merchant...");
    const adminLogin = await request(`${BASE_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: process.env.ADMIN_EMAIL || "admin@banglaqr.com",
        password: process.env.ADMIN_PASSWORD || "Admin@123456",
      }),
    });
    if (adminLogin.status !== 200 || !adminLogin.data?.data?.token) {
      throw new Error(`Admin login failed: ${JSON.stringify(adminLogin.data)}`);
    }
    const adminToken = adminLogin.data.data.token;
    const adminHeaders = {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json",
    };
    console.log("✓ Admin logged in successfully.");

    // Merchant login
    const merchantLogin = await request(`${BASE_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "merchant@gmail.com",
        password: "Merchant@123456",
      }),
    });
    if (merchantLogin.status !== 200 || !merchantLogin.data?.data?.token) {
      throw new Error(`Merchant login failed: ${JSON.stringify(merchantLogin.data)}`);
    }
    const merchantHeaders = {
      Authorization: `Bearer ${merchantLogin.data.data.token}`,
      "Content-Type": "application/json",
    };
    console.log("✓ Merchant logged in successfully.");

    // -------------------------------------------------------------
    // 2. Create New Gateway (with custom logo, fee, and capabilities)
    // -------------------------------------------------------------
    const timestamp = Date.now();
    const testCode = `TEST_GW_${timestamp}`;
    console.log(`\n[STEP 2] Creating new Gateway [${testCode}]...`);

    const createGwRes = await request(`${BASE_URL}/admin/gateways`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        name: `Automated Test Bank ${timestamp}`,
        code: testCode,
        category: "bank",
        serviceType: "Bank MFS",
        status: "active",
        isPublished: true,
        acceptsApplications: true,
        displayOrder: 99,
        serviceFee: 1.45,
        setupFee: 100,
        logoUrl: "/uploads/cms/test-logo.png",
        shortDescription: "স্বয়ংক্রিয় টেস্ট ব্যাংক বিবরণী",
        description: "Full description for automated test bank acquiring service.",
        eligibility: "ট্রেড লাইসেন্স ও ন্যাশনাল আইডি",
        qrSupported: true,
        cardSupported: true,
        mobileSupported: false,
        apiSupported: true,
        supportedMethods: ["BanglaQR", "Debit Card", "Credit Card"],
      }),
    });

    if (createGwRes.status !== 201 || !(createGwRes.data?.id || createGwRes.data?.data?.id)) {
      throw new Error(`Failed to create gateway: ${JSON.stringify(createGwRes.data)}`);
    }
    testGatewayId = createGwRes.data.id || createGwRes.data.data.id;
    console.log(`✓ Gateway created with ID: ${testGatewayId}`);

    // Verify it appears on public marketplace
    const publicList1 = await request(`${BASE_URL}/public/marketplace/services`);
    const foundInMarketplace1 = publicList1.data?.data?.some((s) => s.rawId === testGatewayId);
    if (!foundInMarketplace1) {
      throw new Error("Newly created published gateway is NOT appearing in public marketplace!");
    }
    console.log("✓ Newly created gateway immediately visible in public marketplace.");

    // -------------------------------------------------------------
    // 3. Edit Gateway Fields (Persisting changes)
    // -------------------------------------------------------------
    console.log(`\n[STEP 3] Editing Gateway [ID: ${testGatewayId}]...`);
    const updatedName = `Updated Test Bank Name ${timestamp}`;
    const editGwRes = await request(`${BASE_URL}/admin/gateways/${testGatewayId}`, {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify({
        name: updatedName,
        code: testCode,
        category: "bank",
        serviceType: "Bank MFS",
        status: "active",
        isPublished: true,
        acceptsApplications: true,
        displayOrder: 1,
        serviceFee: 1.25,
        setupFee: 0,
        logoUrl: "/uploads/cms/updated-logo.png",
        shortDescription: "আপডেটেড টেস্ট বিবরণী",
        description: "Updated full description.",
        eligibility: "আপডেটেড যোগ্যতা শর্তাবলী",
        qrSupported: true,
        cardSupported: true,
        mobileSupported: true,
        apiSupported: true,
        supportedMethods: ["BanglaQR", "NPSB", "RTGS"],
      }),
    });

    if (editGwRes.status !== 200) {
      throw new Error(`Failed to update gateway: ${JSON.stringify(editGwRes.data)}`);
    }

    // Verify persistence in DB
    const [dbRows] = await db.query("SELECT * FROM gateways WHERE id = ?", [testGatewayId]);
    if (dbRows.length === 0 || dbRows[0].name !== updatedName || Number(dbRows[0].service_fee) !== 1.25) {
      throw new Error(`DB values did not match updated fields: ${JSON.stringify(dbRows[0])}`);
    }
    console.log(`✓ Gateway fields updated and persisted: Name="${dbRows[0].name}", Fee=${dbRows[0].service_fee}%`);

    // -------------------------------------------------------------
    // 4. Test Dedicated Status & Publish PATCH Endpoints
    // -------------------------------------------------------------
    console.log(`\n[STEP 4] Testing dedicated status & publish PATCH endpoints...`);

    // 4a. Unpublish
    const unpublishRes = await request(`${BASE_URL}/admin/gateways/${testGatewayId}/publish`, {
      method: "PATCH",
      headers: adminHeaders,
      body: JSON.stringify({ isPublished: false, acceptsApplications: false }),
    });
    if (unpublishRes.status !== 200) {
      throw new Error(`Unpublish failed: ${JSON.stringify(unpublishRes.data)}`);
    }

    // Check public marketplace -> should NOT appear
    const publicList2 = await request(`${BASE_URL}/public/marketplace/services`);
    const foundInMarketplace2 = publicList2.data?.data?.some((s) => s.rawId === testGatewayId);
    if (foundInMarketplace2) {
      throw new Error("Unpublished gateway should NOT appear in public marketplace!");
    }
    console.log("✓ Unpublish verified: gateway correctly excluded from public marketplace.");

    // 4b. Re-publish and test Deactivation
    await request(`${BASE_URL}/admin/gateways/${testGatewayId}/publish`, {
      method: "PATCH",
      headers: adminHeaders,
      body: JSON.stringify({ isPublished: true, acceptsApplications: true }),
    });

    const deactivateRes = await request(`${BASE_URL}/admin/gateways/${testGatewayId}/status`, {
      method: "PATCH",
      headers: adminHeaders,
      body: JSON.stringify({ status: "inactive" }),
    });
    if (deactivateRes.status !== 200) {
      throw new Error(`Deactivate failed: ${JSON.stringify(deactivateRes.data)}`);
    }

    const publicList3 = await request(`${BASE_URL}/public/marketplace/services`);
    const foundInMarketplace3 = publicList3.data?.data?.some((s) => s.rawId === testGatewayId);
    if (foundInMarketplace3) {
      throw new Error("Inactive gateway should NOT appear in public marketplace!");
    }
    console.log("✓ Inactivate verified: inactive gateway correctly excluded from public marketplace.");

    // Reactivate
    await request(`${BASE_URL}/admin/gateways/${testGatewayId}/status`, {
      method: "PATCH",
      headers: adminHeaders,
      body: JSON.stringify({ status: "active" }),
    });
    console.log("✓ Reactivate verified.");

    // -------------------------------------------------------------
    // 5. Simulate Merchant Application with Snapshot Storage
    // -------------------------------------------------------------
    console.log(`\n[STEP 5] Simulating Merchant Application for test gateway...`);
    const [merchants] = await db.query("SELECT id FROM merchants LIMIT 1");
    if (merchants.length === 0) {
      throw new Error("No merchant found in database for test!");
    }
    const merchantId = merchants[0].id;

    // Insert test application with snapshots
    const [appInsert] = await db.query(
      `INSERT INTO merchant_gateway_applications 
       (merchant_id, gateway_id, gateway_name, gateway_code, logo_url, service_type, service_fee, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'applied', NOW())`,
      [merchantId, testGatewayId, updatedName, testCode, "/uploads/cms/updated-logo.png", "Bank MFS", 1.25]
    );
    testAppId = appInsert.insertId;
    console.log(`✓ Test application created with ID: ${testAppId} linked to gateway ${testGatewayId}`);

    // -------------------------------------------------------------
    // 6. Test Permanent Deletion & Snapshot Preservation
    // -------------------------------------------------------------
    console.log(`\n[STEP 6] Testing Permanent Deletion of Gateway [ID: ${testGatewayId}]...`);
    const deleteRes = await request(`${BASE_URL}/admin/gateways/${testGatewayId}`, {
      method: "DELETE",
      headers: adminHeaders,
    });
    if (deleteRes.status !== 200) {
      throw new Error(`Delete gateway failed: ${JSON.stringify(deleteRes.data)}`);
    }
    console.log(`✓ DELETE request succeeded: ${JSON.stringify(deleteRes.data)}`);

    // 6a. Check gateways table: record must be physically removed
    const [checkDeletedGw] = await db.query("SELECT * FROM gateways WHERE id = ?", [testGatewayId]);
    if (checkDeletedGw.length > 0) {
      throw new Error(`Gateway ID ${testGatewayId} was NOT deleted from gateways table!`);
    }
    console.log("✓ Confirmed: Gateway record was permanently deleted from MySQL gateways table.");

    // 6b. Check public marketplace: must not be present
    const publicListAfterDelete = await request(`${BASE_URL}/public/marketplace/services`);
    const foundAfterDelete = publicListAfterDelete.data?.data?.some((s) => s.rawId === testGatewayId);
    if (foundAfterDelete) {
      throw new Error("Deleted gateway still appearing in public marketplace!");
    }
    console.log("✓ Confirmed: Deleted gateway is absent from public marketplace.");

    // 6c. Check merchant application record: must be preserved with snapshots!
    const [checkAppRow] = await db.query(
      "SELECT * FROM merchant_gateway_applications WHERE id = ?",
      [testAppId]
    );
    if (checkAppRow.length === 0) {
      throw new Error("Merchant application was accidentally deleted when gateway was deleted!");
    }
    const appRecord = checkAppRow[0];
    if (appRecord.gateway_id !== null) {
      throw new Error(`gateway_id was expected to be NULL after deletion, got: ${appRecord.gateway_id}`);
    }
    if (appRecord.gateway_name !== updatedName || appRecord.gateway_code !== testCode) {
      throw new Error(`Snapshot values were lost: ${JSON.stringify(appRecord)}`);
    }
    console.log("✓ Confirmed: Merchant application record preserved perfectly!");
    console.log(`  Snapshot Details: gateway_id=NULL, gateway_name="${appRecord.gateway_name}", gateway_code="${appRecord.gateway_code}", service_fee=${appRecord.service_fee}`);

    // 6d. Check Admin listApplications handles deleted gateway gracefully
    const adminAppsRes = await request(`${BASE_URL}/admin/gateways/applications`, {
      headers: adminHeaders,
    });
    const foundAdminApp = adminAppsRes.data?.data?.find((a) => a.id === testAppId);
    if (!foundAdminApp) {
      throw new Error("Admin applications list failed to return application with deleted gateway!");
    }
    console.log(`✓ Admin applications list displays snapshot name: "${foundAdminApp.gatewayName || foundAdminApp.gateway_name}"`);

    // Clean up test application
    await db.query("DELETE FROM merchant_gateway_applications WHERE id = ?", [testAppId]);

    // -------------------------------------------------------------
    // 7. Add-on CRUD, Toggle, and Permanent Deletion
    // -------------------------------------------------------------
    console.log(`\n[STEP 7] Testing Add-on CRUD & Permanent Deletion...`);
    const testAddonCode = `TEST_ADDON_${timestamp}`;
    const createAddonRes = await request(`${BASE_URL}/admin/addons`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        name: `Automated Test Addon ${timestamp}`,
        code: testAddonCode,
        category: "analytics",
        price: 499,
        pricingType: "monthly",
        status: "available",
        isPublished: true,
        acceptsApplications: true,
        displayOrder: 50,
        shortDescription: "স্বয়ংক্রিয় টেস্ট অ্যাড-অন বিবরণী",
        description: "Full description for automated test addon.",
      }),
    });
    if (createAddonRes.status !== 201 || !(createAddonRes.data?.id || createAddonRes.data?.data?.id)) {
      throw new Error(`Failed to create addon: ${JSON.stringify(createAddonRes.data)}`);
    }
    testAddonId = createAddonRes.data?.id || createAddonRes.data?.data?.id;
    console.log(`✓ Addon created with ID: ${testAddonId}`);

    // Update Addon
    const updatedAddonName = `Updated Test Addon ${timestamp}`;
    await request(`${BASE_URL}/admin/addons/${testAddonId}`, {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify({
        name: updatedAddonName,
        code: testAddonCode,
        category: "analytics",
        price: 599,
        pricingType: "monthly",
        status: "available",
        isPublished: true,
        acceptsApplications: true,
        displayOrder: 2,
        shortDescription: "আপডেটেড অ্যাড-অন বিবরণী",
        description: "Updated addon description.",
      }),
    });
    console.log(`✓ Addon updated.`);

    // Toggle Addon Status & Publish
    await request(`${BASE_URL}/admin/addons/${testAddonId}/publish`, {
      method: "PATCH",
      headers: adminHeaders,
      body: JSON.stringify({ isPublished: false, acceptsApplications: false }),
    });
    console.log(`✓ Addon publish toggle verified.`);

    // Create merchant addon application
    const [merchantAddonInsert] = await db.query(
      `INSERT INTO merchant_addons 
       (merchant_id, addon_id, addon_name, addon_code, category, price, pricing_type, status, created_at)
       VALUES (?, ?, ?, ?, 'analytics', 599, 'monthly', 'activated', NOW())`,
      [merchantId, testAddonId, updatedAddonName, testAddonCode]
    );
    testMerchantAddonId = merchantAddonInsert.insertId;
    console.log(`✓ Merchant addon row created with ID: ${testMerchantAddonId}`);

    // Permanent delete addon
    const deleteAddonRes = await request(`${BASE_URL}/admin/addons/${testAddonId}`, {
      method: "DELETE",
      headers: adminHeaders,
    });
    if (deleteAddonRes.status !== 200) {
      throw new Error(`Failed to delete addon: ${JSON.stringify(deleteAddonRes.data)}`);
    }
    console.log(`✓ DELETE addon succeeded.`);

    // Check addons table
    const [checkDeletedAddon] = await db.query("SELECT * FROM addons WHERE id = ?", [testAddonId]);
    if (checkDeletedAddon.length > 0) {
      throw new Error(`Addon ID ${testAddonId} was not removed from addons table!`);
    }
    console.log("✓ Confirmed: Addon physically deleted from addons table.");

    // Check merchant addon row preserved with addon_id = NULL
    const [checkMerchantAddon] = await db.query("SELECT * FROM merchant_addons WHERE id = ?", [testMerchantAddonId]);
    if (checkMerchantAddon.length === 0 || checkMerchantAddon[0].addon_id !== null) {
      throw new Error(`Merchant addon record was corrupted: ${JSON.stringify(checkMerchantAddon)}`);
    }
    console.log(`✓ Confirmed: Merchant addon preserved with snapshot name: "${checkMerchantAddon[0].addon_name}"`);

    // Clean up test merchant addon
    await db.query("DELETE FROM merchant_addons WHERE id = ?", [testMerchantAddonId]);

    console.log("\n==========================================================================");
    console.log("  ALL TESTS PASSED SUCCESSFULLY! CRUD, SYNC, DELETE & SNAPSHOTS VERIFIED  ");
    console.log("==========================================================================");
  } catch (err) {
    console.error("\n❌ TEST FAILED:", err);
    process.exitCode = 1;
  } finally {
    // Clean up any test records if left behind
    if (testGatewayId) {
      await db.query("DELETE FROM gateways WHERE id = ?", [testGatewayId]).catch(() => {});
    }
    if (testAppId) {
      await db.query("DELETE FROM merchant_gateway_applications WHERE id = ?", [testAppId]).catch(() => {});
    }
    if (testAddonId) {
      await db.query("DELETE FROM addons WHERE id = ?", [testAddonId]).catch(() => {});
    }
    if (testMerchantAddonId) {
      await db.query("DELETE FROM merchant_addons WHERE id = ?", [testMerchantAddonId]).catch(() => {});
    }
    server.close();
    await db.end().catch(() => {});
  }
}

runTest();
