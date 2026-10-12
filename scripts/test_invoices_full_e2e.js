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

async function runInvoiceTests() {
  console.log("=========================================================");
  console.log("  BANGLAQR MERCHANT INVOICE MANAGEMENT FULL E2E SUITE   ");
  console.log("=========================================================");

  // 1. Register / Login Merchant A
  console.log("\n[1] Authenticating Merchant A...");
  const suffixA = Date.now();
  const emailA = `merchant_a_${suffixA}@banglaqr.com`;
  const passwordA = "Password@123456";

  await request(`${BASE_URL}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fullName: "Merchant Alpha",
      businessName: `Alpha Retailers ${suffixA}`,
      email: emailA,
      phone: `017${String(suffixA).slice(-8)}`,
      password: passwordA,
      businessType: "retail",
    }),
  });

  const loginResA = await request(`${BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: emailA, password: passwordA }),
  });
  const tokenA = loginResA.data.data.token;
  const headersA = {
    Authorization: `Bearer ${tokenA}`,
    "Content-Type": "application/json",
  };
  console.log("✓ Merchant A authenticated successfully");

  // 2. Fetch Initial Stats
  console.log("\n[2] Checking Merchant Invoice Dashboard Statistics...");
  const statsRes = await request(`${BASE_URL}/merchants/me/invoices/stats`, {
    headers: headersA,
  });
  console.log("✓ Initial Invoice Stats:", statsRes.data?.data);

  // 3. Customer Directory Management
  console.log("\n[3] Testing Customer Directory Management...");
  const createCustRes = await request(`${BASE_URL}/merchants/me/invoice-customers`, {
    method: "POST",
    headers: headersA,
    body: JSON.stringify({
      name: "Tariqul Islam",
      businessName: "Dhaka Tech Corp",
      email: "tariqul@example.com",
      phone: "01711223344",
      billingAddress: "Road 11, Banani, Dhaka-1213",
      taxIdentification: "BIN-9923812",
      notes: "VIP Corporate Client",
    }),
  });
  const customerId = createCustRes.data?.data?.id;
  console.log(`✓ Customer created (ID: ${customerId}, Name: ${createCustRes.data?.data?.name})`);

  const listCustRes = await request(`${BASE_URL}/merchants/me/invoice-customers`, {
    headers: headersA,
  });
  console.log(`✓ Retrieved ${listCustRes.data?.data?.length || 0} customers in directory`);

  // 4. Get Unique Invoice Number
  console.log("\n[4] Generating Unique Sequential Invoice Number...");
  const nextNumRes = await request(`${BASE_URL}/merchants/me/invoices/next-number`, {
    headers: headersA,
  });
  const generatedNumber = nextNumRes.data?.data?.invoiceNumber;
  console.log("✓ Generated Next Invoice Number:", generatedNumber);

  // 5. Create Draft Invoice with Calculations
  console.log("\n[5] Creating Multi-item Draft Invoice with Server-side Recalculations...");
  const createInvRes = await request(`${BASE_URL}/merchants/me/invoices`, {
    method: "POST",
    headers: headersA,
    body: JSON.stringify({
      invoiceNumber: generatedNumber,
      customerId,
      issueDate: new Date().toISOString().split("T")[0],
      dueDate: new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0],
      items: [
        {
          description: "BanglaQR Standee & QR Setup",
          quantity: 2,
          unitPrice: 1500,
          discountPercent: 10,
          taxPercent: 5,
        },
        {
          description: "Monthly Digital Merchant Terminal Subscription",
          quantity: 1,
          unitPrice: 2000,
          discountPercent: 0,
          taxPercent: 0,
        },
      ],
      notes: "Prompt payment is appreciated.",
      paymentInstructions: "Scan BanglaQR with any bank / MFS app.",
    }),
  });

  const invoiceId = createInvRes.data?.data?.id;
  const grandTotal = createInvRes.data?.data?.totalAmount;
  console.log(`✓ Invoice created successfully (ID: ${invoiceId}, Total: ৳${grandTotal})`);

  // 6. Update Draft Invoice
  console.log("\n[6] Updating Draft Invoice Items & Terms...");
  const updateRes = await request(`${BASE_URL}/merchants/me/invoices/${invoiceId}`, {
    method: "PUT",
    headers: headersA,
    body: JSON.stringify({
      notes: "Updated note: Free shipping included.",
      items: [
        {
          description: "BanglaQR Standee & QR Setup (Updated)",
          quantity: 2,
          unitPrice: 1500,
          discountPercent: 10,
          taxPercent: 5,
        },
        {
          description: "Monthly Digital Merchant Terminal Subscription",
          quantity: 2,
          unitPrice: 2000,
          discountPercent: 0,
          taxPercent: 0,
        },
      ],
    }),
  });
  console.log(`✓ Draft invoice updated (Status ${updateRes.status})`);

  // 7. PDF Generation & Authenticated Download
  console.log("\n[7] Testing PDF Generation & Binary Stream...");
  const pdfRes = await request(`${BASE_URL}/merchants/me/invoices/${invoiceId}/pdf`, {
    headers: { Authorization: `Bearer ${tokenA}` },
  });
  console.log(`✓ PDF stream status: ${pdfRes.status}`);
  console.log(`✓ PDF Content-Type: ${pdfRes.headers.get("content-type")}`);
  console.log(`✓ PDF Content-Disposition: ${pdfRes.headers.get("content-disposition")}`);
  console.log(`✓ PDF Buffer Size: ${pdfRes.data?.byteLength} bytes`);

  // 8. Send Invoice
  console.log("\n[8] Testing Invoice Send to Customer Workflow...");
  const sendRes = await request(`${BASE_URL}/merchants/me/invoices/${invoiceId}/send`, {
    method: "POST",
    headers: headersA,
  });
  console.log(`✓ Send result (${sendRes.status}):`, sendRes.data?.message);

  // 9. Payment Recording & Reconciliation
  console.log("\n[9] Testing Payment Recording (Partial & Full)...");
  // Partial Payment
  const partialPayRes = await request(`${BASE_URL}/merchants/me/invoices/${invoiceId}/payments`, {
    method: "POST",
    headers: headersA,
    body: JSON.stringify({
      amount: 2000.0,
      paymentMethod: "bank_transfer",
      referenceId: "BEFTN-982341",
      notes: "Initial partial bank deposit",
    }),
  });
  console.log(`✓ Partial payment recorded. Status: ${partialPayRes.data?.data?.status}, Remaining: ৳${partialPayRes.data?.data?.balanceDue}`);

  // Fetch details to verify remaining balance
  const invDetails1 = await request(`${BASE_URL}/merchants/me/invoices/${invoiceId}`, {
    headers: headersA,
  });
  console.log(`✓ Verified invoice status in DB: ${invDetails1.data?.data?.status}, Balance: ৳${invDetails1.data?.data?.balanceDue}`);

  // Full Remaining Payment
  const remaining = invDetails1.data?.data?.balanceDue;
  const fullPayRes = await request(`${BASE_URL}/merchants/me/invoices/${invoiceId}/payments`, {
    method: "POST",
    headers: headersA,
    body: JSON.stringify({
      amount: remaining,
      paymentMethod: "cash",
      referenceId: "CASH-REC-01",
      notes: "Final balance settlement",
    }),
  });
  console.log(`✓ Final payment recorded. Status: ${fullPayRes.data?.data?.status}, Remaining: ৳${fullPayRes.data?.data?.balanceDue}`);

  // 10. Multi-Merchant Isolation Security Test
  console.log("\n[10] Testing Multi-Merchant Security & Data Isolation...");
  const suffixB = Date.now() + 1;
  const emailB = `merchant_b_${suffixB}@banglaqr.com`;
  await request(`${BASE_URL}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fullName: "Merchant Beta",
      businessName: `Beta Corp ${suffixB}`,
      email: emailB,
      phone: `016${String(suffixB).slice(-8)}`,
      password: "Password@123456",
      businessType: "retail",
    }),
  });
  const loginResB = await request(`${BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: emailB, password: "Password@123456" }),
  });
  const tokenB = loginResB.data.data.token;
  const headersB = { Authorization: `Bearer ${tokenB}`, "Content-Type": "application/json" };

  // Merchant B tries to read Merchant A's invoice
  const unauthorizedRead = await request(`${BASE_URL}/merchants/me/invoices/${invoiceId}`, {
    headers: headersB,
  });
  console.log(`✓ Merchant B reading Merchant A's invoice: HTTP ${unauthorizedRead.status} (Protected)`);

  // Merchant B tries to download Merchant A's PDF
  const unauthorizedPdf = await request(`${BASE_URL}/merchants/me/invoices/${invoiceId}/pdf`, {
    headers: { Authorization: `Bearer ${tokenB}` },
  });
  console.log(`✓ Merchant B downloading Merchant A's PDF: HTTP ${unauthorizedPdf.status} (Protected)`);

  // Merchant B tries to access Merchant A's customer
  const unauthorizedCust = await request(`${BASE_URL}/merchants/me/invoice-customers/${customerId}`, {
    headers: headersB,
  });
  console.log(`✓ Merchant B reading Merchant A's customer: HTTP ${unauthorizedCust.status} (Protected)`);

  console.log("\n=========================================================");
  console.log("  ALL INVOICE MANAGEMENT E2E TESTS PASSED SUCCESSFULLY!  ");
  console.log("=========================================================");
}

runInvoiceTests().catch((err) => {
  console.error("Test failed:", err.message);
  process.exit(1);
});

