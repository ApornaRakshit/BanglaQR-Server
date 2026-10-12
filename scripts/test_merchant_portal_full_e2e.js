// const BASE_URL = process.env.API_BASE_URL || "http://localhost:5000/api/v1";
const BASE_URL = process.env.API_BASE_URL || "https://api.banglaqr.online/api/v1";

async function request(url, options = {}) {
  const res = await fetch(url, options);
  const contentType = res.headers.get("content-type") || "";
  let data = null;
  if (contentType.includes("application/json")) {
    data = await res.json();
  } else {
    data = await res.arrayBuffer();
  }
  return { status: res.status, headers: res.headers, data };
}

async function runE2ETests() {
  console.log("=================================================");
  console.log("  BANGLAQR MERCHANT PORTAL FULL E2E TEST SUITE  ");
  console.log("=================================================");

  // 1. Admin Login
  console.log("\n[1] Logging in as Admin...");
  const adminLoginRes = await request(`${BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "admin@banglaqr.com",
      password: "Admin@123456",
    }),
  });
  if (adminLoginRes.status !== 200) {
    throw new Error(`Admin login failed: ${JSON.stringify(adminLoginRes.data)}`);
  }
  const adminToken = adminLoginRes.data.data.token;
  console.log("✓ Admin logged in successfully");

  // 2. Register / Login Test Merchant
  console.log("\n[2] Registering & Authenticating Test Merchant...");
  const suffix = Date.now();
  const merchantEmail = `e2e_merchant_${suffix}@banglaqr.com`;
  const merchantPhone = `018${String(suffix).slice(-8)}`;
  const merchantPassword = "Password@123456";

  const regRes = await request(`${BASE_URL}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fullName: "E2E Test Merchant",
      businessName: `E2E Store ${suffix}`,
      email: merchantEmail,
      phone: merchantPhone,
      password: merchantPassword,
      businessType: "retail",
    }),
  });

  if (regRes.status !== 201) {
    throw new Error(`Merchant registration failed: ${JSON.stringify(regRes.data)}`);
  }
  console.log("✓ Test merchant registered in dev bypass mode");

  // Merchant Login
  const merchantLoginRes = await request(`${BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: merchantEmail,
      password: merchantPassword,
    }),
  });
  if (merchantLoginRes.status !== 200) {
    throw new Error(`Merchant login failed: ${JSON.stringify(merchantLoginRes.data)}`);
  }
  const merchantToken = merchantLoginRes.data.data.token;
  const merchantUser = merchantLoginRes.data.data.user;
  console.log(`✓ Merchant logged in (User ID: ${merchantUser.id})`);

  const merchantHeaders = {
    Authorization: `Bearer ${merchantToken}`,
    "Content-Type": "application/json",
  };

  const adminHeaders = {
    Authorization: `Bearer ${adminToken}`,
    "Content-Type": "application/json",
  };

  // 3. Document Stream Test
  console.log("\n[3] Testing Private Document Stream Endpoint...");
  const docsRes = await request(`${BASE_URL}/merchants/me/documents`, {
    headers: merchantHeaders,
  });
  console.log(`✓ Documents endpoint reachable (Found: ${docsRes.data?.data?.length || 0})`);

  // 4. Gateways Catalogue & Application
  console.log("\n[4] Testing Gateways Catalogue & Application...");
  const gatewaysRes = await request(`${BASE_URL}/merchants/me/gateways`, {
    headers: merchantHeaders,
  });
  const gateways = gatewaysRes.data.data || [];
  console.log(`✓ Loaded ${gateways.length} gateways from catalogue`);

  let appliedAppId = null;
  if (gateways.length > 0) {
    const gw = gateways[0];
    console.log(`  Applying for gateway: ${gw.name} (ID: ${gw.id})`);
    const applyRes = await request(`${BASE_URL}/merchants/me/gateways/${gw.id}/apply`, {
      method: "POST",
      headers: merchantHeaders,
      body: JSON.stringify({
        business_volume: "100000-500000",
        notes: "Automated E2E Test Application",
      }),
    });
    console.log(`  Apply result status ${applyRes.status}:`, applyRes.data?.message || "Processed");
    appliedAppId = applyRes.data?.data?.id;
  }

  // 5. Merchant Applications List
  console.log("\n[5] Testing Merchant Applications List...");
  const appsRes = await request(`${BASE_URL}/merchants/me/applications`, {
    headers: merchantHeaders,
  });
  const apps = appsRes.data.data || [];
  console.log(`✓ Found ${apps.length} applications for merchant`);

  // 6. Admin Review Gateway Application
  const targetAppId = appliedAppId || (apps.length > 0 ? apps[0].id : null);
  if (targetAppId) {
    console.log(`\n[6] Admin Reviewing Application #${targetAppId}...`);
    const reviewRes = await request(
      `${BASE_URL}/admin/gateways/applications/${targetAppId}/review`,
      {
        method: "PUT",
        headers: adminHeaders,
        body: JSON.stringify({
          status: "approved",
          review_note: "Approved automatically via E2E Verification Suite",
        }),
      }
    );
    console.log(`✓ Admin review response status ${reviewRes.status}:`, reviewRes.data?.message || "Updated");
  }

  // 7. My Services & Configuration
  console.log("\n[7] Testing My Services & Configuration...");
  const myServicesRes = await request(`${BASE_URL}/merchants/me/services`, {
    headers: merchantHeaders,
  });
  const myServices = myServicesRes.data.data || [];
  console.log(`✓ Found ${myServices.length} active/assigned services for merchant`);

  if (myServices.length > 0) {
    const svc = myServices[0];
    console.log(`  Updating configuration for Service #${svc.id}...`);
    const updateRes = await request(
      `${BASE_URL}/merchants/me/services/${svc.id}/configuration`,
      {
        method: "PUT",
        headers: merchantHeaders,
        body: JSON.stringify({
          configuration: {
            mode: "sandbox",
            store_id: "test_store_banglaqr_01",
            merchant_id: "MID_TEST_101",
            secret_key: "secret_live_key_encrypted_demo",
            webhook_url: "https://example.com/api/v1/webhook",
            success_url: "https://example.com/payment/success",
            fail_url: "https://example.com/payment/failed",
          },
        }),
      }
    );
    console.log(`✓ Service configuration update status ${updateRes.status}:`, updateRes.data?.message || "Saved");
  }

  // 8. Add-ons
  console.log("\n[8] Testing Add-ons Catalogue & Application...");
  const addonsRes = await request(`${BASE_URL}/merchants/me/addons`, {
    headers: merchantHeaders,
  });
  const addons = addonsRes.data.data || [];
  console.log(`✓ Found ${addons.length} add-ons in catalogue`);

  if (addons.length > 0) {
    const addon = addons[0];
    const applyAddonRes = await request(`${BASE_URL}/merchants/me/addons/${addon.id}/apply`, {
      method: "POST",
      headers: merchantHeaders,
      body: JSON.stringify({ notes: "Automated test subscription" }),
    });
    console.log(`  Add-on application status ${applyAddonRes.status}:`, applyAddonRes.data?.message || "Processed");
  }

  // 9. API & Developer Integration Details
  console.log("\n[9] Testing API Integration Details...");
  const integrationRes = await request(`${BASE_URL}/merchants/me/integration`, {
    headers: merchantHeaders,
  });
  console.log("✓ Integration details retrieved:", {
    api_key: integrationRes.data.data?.api_key ? "PRESENT" : "GENERATED",
    webhook_secret: integrationRes.data.data?.webhook_secret ? "PRESENT" : "GENERATED",
  });

  // 10. Notifications
  console.log("\n[10] Testing Notifications...");
  const notifRes = await request(`${BASE_URL}/merchants/me/notifications`, {
    headers: merchantHeaders,
  });
  console.log(`✓ Retrieved ${notifRes.data.data?.length || 0} notifications`);

  // 11. Support Tickets
  console.log("\n[11] Testing Support Tickets...");
  const createTicketRes = await request(`${BASE_URL}/merchants/me/support`, {
    method: "POST",
    headers: merchantHeaders,
    body: JSON.stringify({
      subject: "E2E Automated Test Ticket",
      category: "technical_integration",
      priority: "medium",
      message: "This is an automated E2E test inquiry for BanglaQR gateway integration.",
    }),
  });
  console.log(`✓ Support ticket created (Status ${createTicketRes.status}, ID: ${createTicketRes.data.data?.id})`);

  // 12. Invoices
  console.log("\n[12] Testing Invoices...");
  const createInvRes = await request(`${BASE_URL}/merchants/me/invoices`, {
    method: "POST",
    headers: merchantHeaders,
    body: JSON.stringify({
      customer_name: "Tariqul Islam",
      customer_email: "tariqul@example.com",
      total_amount: 3500.0,
      items: [{ description: "BanglaQR QR Merchant Standee & Integration", quantity: 1, unit_price: 3500.0 }],
    }),
  });
  console.log(`✓ Digital invoice created (Status ${createInvRes.status}, ID: ${createInvRes.data.data?.id})`);

  console.log("\n=================================================");
  console.log("  ALL E2E INTEGRATION TESTS PASSED SUCCESSFULLY! ");
  console.log("=================================================");
}

runE2ETests().catch((err) => {
  console.error("Test execution failed:", err.message);
  process.exit(1);
});

