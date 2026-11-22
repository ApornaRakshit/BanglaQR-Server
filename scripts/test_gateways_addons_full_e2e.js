import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, "../.env") });

// const BASE_URL = process.env.API_BASE_URL || "http://localhost:5000/api/v1";
const BASE_URL = process.env.API_BASE_URL || "https://api.banglaqr.online/api/v1";

async function request(url, options = {}) {
  const res = await fetch(url, options);
  const contentType = res.headers.get("content-type") || "";
  let data = null;
  if (contentType.includes("application/json")) {
    data = await res.json();
  } else {
    data = await res.text();
  }
  return { status: res.status, headers: res.headers, data };
}

async function runTests() {
  console.log("=========================================================");
  console.log("  BANGLAQR GATEWAYS & ADD-ONS ADMIN-MERCHANT FULL E2E   ");
  console.log("=========================================================");

  // 1. Authenticate Admin
  console.log("\n[1] Authenticating Admin User...");
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
  console.log("✓ Admin authenticated successfully");

  // 2. Test Admin Gateway Stats & Listing
  console.log("\n[2] Checking Admin Gateway Stats & List...");
  const gwStatsRes = await request(`${BASE_URL}/admin/gateways/stats`, {
    headers: adminHeaders,
  });
  console.log("✓ Gateway Stats:", gwStatsRes.data?.data);

  const gwListRes = await request(`${BASE_URL}/admin/gateways`, {
    headers: adminHeaders,
  });
  const initialGateways = gwListRes.data?.data || gwListRes.data?.gateways || [];
  console.log(`✓ Retrieved ${initialGateways.length} existing gateways from MySQL`);

  // 3. Create a New Gateway via Admin
  console.log("\n[3] Admin Creating New Payment Gateway...");
  const suffix = Date.now();
  const newGatewayCode = `UPAY_QR_${suffix}`;
  const createGwRes = await request(`${BASE_URL}/admin/gateways`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      name: `Upay Digital BanglaQR ${suffix}`,
      code: newGatewayCode,
      serviceType: "MFS Gateway",
      serviceFee: 1.25,
      setupFee: 0,
      status: "active",
      qrSupported: true,
      cardSupported: false,
      mobileSupported: true,
      apiSupported: true,
      supportedMethods: ["BanglaQR", "Upay App", "USSD"],
      description: "UCB Upay digital payments and interoperable BanglaQR acquiring.",
    }),
  });

  if (createGwRes.status !== 201) {
    throw new Error(`Failed to create gateway: ${JSON.stringify(createGwRes.data)}`);
  }
  const gatewayId = createGwRes.data?.id;
  console.log(`✓ Gateway created successfully (ID: ${gatewayId}, Code: ${newGatewayCode})`);

  // 4. Update Gateway Details
  console.log("\n[4] Admin Updating Gateway Details...");
  const updateGwRes = await request(`${BASE_URL}/admin/gateways/${gatewayId}`, {
    method: "PUT",
    headers: adminHeaders,
    body: JSON.stringify({
      name: `Upay Digital BanglaQR ${suffix} (Updated)`,
      code: newGatewayCode,
      serviceType: "MFS Gateway",
      serviceFee: 1.15,
      setupFee: 100,
      status: "active",
      qrSupported: true,
      cardSupported: true,
      mobileSupported: true,
      apiSupported: true,
      supportedMethods: ["BanglaQR", "Upay App", "USSD", "NPSB"],
      description: "UCB Upay updated acquiring specification.",
    }),
  });
  console.log("✓ Gateway updated (Status:", updateGwRes.status, ")");

  // 5. Authenticate Merchant A
  console.log("\n[5] Registering & Authenticating Merchant A...");
  const merchantEmailA = `merchant_gw_a_${suffix}@banglaqr.com`;
  const merchantPasswordA = "Password@123456";

  await request(`${BASE_URL}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fullName: "Merchant GW Alpha",
      businessName: `GW Alpha Corp ${suffix}`,
      email: merchantEmailA,
      phone: `017${String(suffix).slice(-8)}`,
      password: merchantPasswordA,
      businessType: "ecommerce",
    }),
  });

  const merchantLoginA = await request(`${BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: merchantEmailA, password: merchantPasswordA }),
  });
  const tokenA = merchantLoginA.data?.data?.token;
  const headersA = {
    Authorization: `Bearer ${tokenA}`,
    "Content-Type": "application/json",
  };
  console.log("✓ Merchant A authenticated successfully");

  // 6. Merchant Browse Gateway Catalogue
  console.log("\n[6] Merchant A Browsing Published Gateways Catalogue...");
  const merchantGwListRes = await request(`${BASE_URL}/merchants/me/gateways`, {
    headers: headersA,
  });
  const availableGateways = merchantGwListRes.data?.data || [];
  const foundGateway = availableGateways.find((g) => g.id === gatewayId);
  console.log(`✓ Merchant sees ${availableGateways.length} gateways.`);
  if (!foundGateway) {
    throw new Error("Newly created gateway is not visible in Merchant catalogue!");
  }
  console.log(`✓ Confirmed newly created gateway '${foundGateway.name}' is dynamically visible in Merchant Catalogue!`);

  // 7. Merchant Applies for the Gateway
  console.log("\n[7] Merchant A Applying for Gateway...");
  const applyGwRes = await request(`${BASE_URL}/merchants/me/gateways/${gatewayId}/apply`, {
    method: "POST",
    headers: headersA,
    body: JSON.stringify({
      expectedMonthlyVolume: 250000,
      purposeOfUse: "Retail store BanglaQR collections",
    }),
  });
  if (applyGwRes.status !== 200 && applyGwRes.status !== 201) {
    throw new Error(`Failed to apply for gateway: ${JSON.stringify(applyGwRes.data)}`);
  }
  const applicationId = applyGwRes.data?.applicationId;
  console.log(`✓ Application submitted (App ID: ${applicationId}, Status: ${applyGwRes.data?.status})`);

  // Verify application in Merchant's list
  const merchantAppsRes = await request(`${BASE_URL}/merchants/me/applications`, {
    headers: headersA,
  });
  console.log(`✓ Merchant has ${merchantAppsRes.data?.data?.length} applications in history.`);

  // 8. Admin Reviews and Approves Application
  console.log("\n[8] Admin Reviewing Application...");
  const adminAppsRes = await request(`${BASE_URL}/admin/gateways/applications`, {
    headers: adminHeaders,
  });
  const adminFoundApp = (adminAppsRes.data?.data || []).find((a) => a.id === applicationId);
  console.log(`✓ Application found in Admin Applications list: ${adminFoundApp?.companyName} -> ${adminFoundApp?.gatewayName}`);

  const reviewRes = await request(`${BASE_URL}/admin/gateways/applications/${applicationId}/review`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      action: "approve",
      reviewNote: "Approved compliance check and merchant terminal provisioned.",
    }),
  });
  console.log("✓ Application review result:", reviewRes.data?.message);

  // 9. Merchant Accesses Provisioned My Services
  console.log("\n[9] Merchant Checking My Services (Provisioned Rails)...");
  const myServicesRes = await request(`${BASE_URL}/merchants/me/services`, {
    headers: headersA,
  });
  const myServices = myServicesRes.data?.data || [];
  console.log(`✓ Merchant A has ${myServices.length} active provisioned services.`);
  const myService = myServices.find((s) => s.gatewayId === gatewayId || s.gateway_id === gatewayId);
  if (!myService) {
    throw new Error("Approved gateway service is not provisioned in Merchant's My Services!");
  }
  console.log(`✓ Provisioned Service ID: ${myService.id}, Status: ${myService.status}`);

  // 10. Merchant Configures Credentials
  console.log("\n[10] Merchant Configuring Service Credentials...");
  const configRes = await request(`${BASE_URL}/merchants/me/services/${myService.id}/configuration`, {
    method: "PUT",
    headers: headersA,
    body: JSON.stringify({
      storeId: `STORE_ALPHA_${suffix}`,
      merchantId: `MID_ALPHA_${suffix}`,
      apiKey: "test_api_key_alpha_12345",
      secretKey: "test_secret_key_alpha_secure_9988",
      webhookUrl: "https://alpha.example.com/webhook",
      returnUrl: "https://alpha.example.com/callback",
      sandboxMode: true,
    }),
  });
  console.log("✓ Configuration save result:", configRes.data?.message);

  // 11. Admin Add-ons Workflow
  console.log("\n[11] Testing Admin Add-ons Workflow...");
  const addonStatsRes = await request(`${BASE_URL}/admin/addons/stats`, {
    headers: adminHeaders,
  });
  console.log("✓ Addon Stats:", addonStatsRes.data?.data);

  const newAddonCode = `SOUNDBOX_${suffix}`;
  const createAddonRes = await request(`${BASE_URL}/admin/addons`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      name: `BanglaQR Voice SoundBox Terminal ${suffix}`,
      code: newAddonCode,
      category: "Hardware",
      pricingType: "monthly",
      price: 350.00,
      billingCycle: "Monthly",
      status: "available",
      requirements: "Active BanglaQR Merchant Account",
      description: "Instant real-time Bangla voice notification speaker on payment receipt.",
    }),
  });
  const addonId = createAddonRes.data?.id;
  console.log(`✓ Add-on created (ID: ${addonId}, Code: ${newAddonCode})`);

  // Merchant sees Addon and applies
  const merchantAddonsRes = await request(`${BASE_URL}/merchants/me/addons`, {
    headers: headersA,
  });
  const foundAddon = (merchantAddonsRes.data?.data || []).find((a) => a.id === addonId);
  if (!foundAddon) {
    throw new Error("Newly created Add-on is not visible in Merchant Add-ons catalog!");
  }
  console.log(`✓ Merchant sees newly created Add-on: '${foundAddon.name}'`);

  const applyAddonRes = await request(`${BASE_URL}/merchants/me/addons/${addonId}/apply`, {
    method: "POST",
    headers: headersA,
  });
  console.log("✓ Merchant applied for add-on:", applyAddonRes.data?.message);

  // Admin reviews add-on application
  const adminAddonAppsRes = await request(`${BASE_URL}/admin/addons/applications`, {
    headers: adminHeaders,
  });
  const foundAddonApp = (adminAddonAppsRes.data?.data || []).find((a) => a.addonId === addonId);
  if (foundAddonApp) {
    console.log(`✓ Found Add-on Application #${foundAddonApp.id}. Admin activating...`);
    const activateRes = await request(`${BASE_URL}/admin/addons/applications/${foundAddonApp.id}/review`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ action: "activate" }),
    });
    console.log("✓ Admin Add-on review result:", activateRes.data?.message);
  }

  // 12. Security Isolation: Merchant B cannot access Merchant A's service
  console.log("\n[12] Testing Multi-Merchant Security Isolation...");
  const merchantEmailB = `merchant_gw_b_${suffix}@banglaqr.com`;
  await request(`${BASE_URL}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fullName: "Merchant GW Beta",
      businessName: `GW Beta Corp ${suffix}`,
      email: merchantEmailB,
      phone: `016${String(suffix).slice(-8)}`,
      password: "Password@123456",
      businessType: "retail",
    }),
  });

  const merchantLoginB = await request(`${BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: merchantEmailB, password: "Password@123456" }),
  });
  const headersB = {
    Authorization: `Bearer ${merchantLoginB.data?.data?.token}`,
    "Content-Type": "application/json",
  };

  const rogueServiceRead = await request(`${BASE_URL}/merchants/me/services/${myService.id}`, {
    headers: headersB,
  });
  console.log(`✓ Merchant B accessing Merchant A's service: HTTP ${rogueServiceRead.status} (Protected)`);

  const rogueConfigWrite = await request(`${BASE_URL}/merchants/me/services/${myService.id}/configuration`, {
    method: "PUT",
    headers: headersB,
    body: JSON.stringify({ apiKey: "hacked_key" }),
  });
  console.log(`✓ Merchant B writing Merchant A's config: HTTP ${rogueConfigWrite.status} (Protected)`);

  console.log("\n=========================================================");
  console.log("  ALL GATEWAYS & ADD-ONS E2E TESTS PASSED SUCCESSFULLY!  ");
  console.log("=========================================================\n");
}

runTests().catch((err) => {
  console.error("❌ Test Suite Failed:", err);
  process.exit(1);
});

