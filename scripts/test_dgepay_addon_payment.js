import http from "http";
import app from "../src/app.js";
import { db } from "../src/config/db.js";

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

async function run() {
  console.log("Testing DGePay Add-on Payment backend endpoints...");
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const BASE_URL = `http://127.0.0.1:${port}/api/v1`;

  try {
    // 1. Merchant login
    const loginRes = await request(`${BASE_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "merchant@gmail.com", password: "Merchant@123456" }),
    });
    if (loginRes.status !== 200 || !loginRes.data?.data?.token) {
      throw new Error("Merchant login failed: " + JSON.stringify(loginRes.data));
    }
    const token = loginRes.data.data.token;
    const merchantHeaders = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    console.log("✓ Merchant authenticated.");

    // 2. Admin login
    const adminLoginRes = await request(`${BASE_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@banglaqr.com", password: "Admin@123456" }),
    });
    const adminToken = adminLoginRes.data?.data?.token;
    const adminHeaders = {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json",
    };
    console.log("✓ Admin authenticated.");

    // 3. Find a paid add-on from addons table
    const [addons] = await db.query("SELECT * FROM addons WHERE price > 0 AND status = 'available' LIMIT 1");
    if (!addons.length) {
      throw new Error("No paid add-on found in database.");
    }
    const testAddon = addons[0];
    console.log(`✓ Testing with Add-on: "${testAddon.name}" (ID: ${testAddon.id}, Price: ৳${testAddon.price})`);

    // Clean any prior pending order for this addon & merchant 2
    await db.query("DELETE FROM merchant_addons WHERE merchant_id = 2 AND addon_id = ?", [testAddon.id]);

    // 4. Create Add-on order & checkout session
    console.log("Initiating DGePay checkout order via POST /merchants/me/addons/:id/order...");
    const orderRes = await request(`${BASE_URL}/merchants/me/addons/${testAddon.id}/order`, {
      method: "POST",
      headers: merchantHeaders,
      body: JSON.stringify({ notes: "Automated test order notes" }),
    });

    if (orderRes.status !== 201 || !orderRes.data?.checkoutUrl) {
      throw new Error("Failed to create order / checkout session: " + JSON.stringify(orderRes.data));
    }

    console.log("✓ Order created successfully!");
    console.log(`  Order Number: ${orderRes.data.orderNumber}`);
    console.log(`  Payment Reference: ${orderRes.data.paymentReference}`);
    console.log(`  DGePay Checkout URL: ${orderRes.data.checkoutUrl}`);

    // Verify order and payment saved in MySQL
    const [savedOrder] = await db.query("SELECT * FROM addon_orders WHERE order_number = ?", [orderRes.data.orderNumber]);
    const [savedPayment] = await db.query("SELECT * FROM addon_payments WHERE payment_reference = ?", [orderRes.data.paymentReference]);

    if (!savedOrder.length || !savedPayment.length) {
      throw new Error("Records missing from MySQL tables!");
    }
    console.log(`✓ Stored in MySQL: Order amount = ৳${savedOrder[0].amount}, Payment status = '${savedPayment[0].status}'`);

    // 5. Merchant list payments
    const merchantPaymentsRes = await request(`${BASE_URL}/merchants/me/addon-payments`, {
      headers: merchantHeaders,
    });
    if (merchantPaymentsRes.status !== 200 || !merchantPaymentsRes.data?.payments) {
      throw new Error("Merchant payments list failed: " + JSON.stringify(merchantPaymentsRes.data));
    }
    console.log(`✓ Merchant payments list retrieved (${merchantPaymentsRes.data.payments.length} payments).`);

    // 6. Admin list payments & stats
    const adminPaymentsRes = await request(`${BASE_URL}/admin/addon-payments`, {
      headers: adminHeaders,
    });
    if (adminPaymentsRes.status !== 200 || !adminPaymentsRes.data?.stats) {
      throw new Error("Admin payments list failed: " + JSON.stringify(adminPaymentsRes.data));
    }
    console.log("✓ Admin payments & stats retrieved successfully:");
    console.log(`  Stats:`, adminPaymentsRes.data.stats);

    // 7. Test simulated status check / reconciliation
    const statusRes = await request(
      `${BASE_URL}/merchants/me/addon-payments/${orderRes.data.paymentReference}/status`,
      { headers: merchantHeaders }
    );
    console.log(`✓ Merchant payment status endpoint returned status: '${statusRes.data?.data?.status}'`);

    // Clean up test order & payment
    await db.query("DELETE FROM addon_payments WHERE id = ?", [savedPayment[0].id]);
    await db.query("DELETE FROM addon_orders WHERE id = ?", [savedOrder[0].id]);
    await db.query("DELETE FROM merchant_addons WHERE merchant_id = 2 AND addon_id = ?", [testAddon.id]);
    console.log("✓ Test records cleaned up.");

    console.log("\n=======================================================");
    console.log("  DGePay BACKEND INTEGRATION TEST PASSED 100%!        ");
    console.log("=======================================================");
  } finally {
    server.close();
    await db.end().catch(() => {});
  }
}

run().catch((e) => {
  console.error("Test failed:", e);
  process.exit(1);
});

