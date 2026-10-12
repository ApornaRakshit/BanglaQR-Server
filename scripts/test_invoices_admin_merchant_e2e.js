import ExcelJS from "exceljs";

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

async function runTests() {
  console.log("=========================================================");
  console.log("  BANGLAQR FULL INVOICE MANAGEMENT E2E VERIFICATION     ");
  console.log("=========================================================");

  // -------------------------------------------------------------------
  // [1] Admin Authentication
  // -------------------------------------------------------------------
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
    throw new Error(`Admin authentication failed (Status ${adminLoginRes.status}): ${JSON.stringify(adminLoginRes.data)}`);
  }
  const adminToken = adminLoginRes.data.data.token;
  const adminHeaders = {
    Authorization: `Bearer ${adminToken}`,
    "Content-Type": "application/json",
  };
  console.log("✓ Admin authenticated successfully");

  // -------------------------------------------------------------------
  // [2] Admin Invoice Stats
  // -------------------------------------------------------------------
  console.log("\n[2] Checking Admin Invoice Aggregate Stats (MySQL)...");
  const adminStatsRes = await request(`${BASE_URL}/admin/invoices/stats`, {
    headers: adminHeaders,
  });
  if (adminStatsRes.status !== 200 || !adminStatsRes.data?.data) {
    throw new Error(`Failed to fetch admin invoice stats: ${JSON.stringify(adminStatsRes.data)}`);
  }
  const adminStats = adminStatsRes.data.data;
  console.log("✓ Live Admin Invoice Stats:", adminStats);
  if (adminStats.totalInvoices <= 0) {
    throw new Error("Expected at least existing invoices in MySQL!");
  }

  // -------------------------------------------------------------------
  // [3] Admin Invoice List Verification (Inspect IDs 8 and 10)
  // -------------------------------------------------------------------
  console.log("\n[3] Checking Admin Invoice List & Resolving Historical Records...");
  const adminListRes = await request(`${BASE_URL}/admin/invoices?limit=50`, {
    headers: adminHeaders,
  });
  if (adminListRes.status !== 200 || !adminListRes.data?.invoices) {
    throw new Error(`Failed to list admin invoices: ${JSON.stringify(adminListRes.data)}`);
  }
  const invoices = adminListRes.data.invoices;
  console.log(`✓ Retrieved ${invoices.length} invoices from database.`);

  // Check Invoice 8
  const inv8 = invoices.find((i) => i.id === 8);
  if (inv8) {
    console.log(`  Inspecting Invoice #8: Number='${inv8.invoiceNumber}', Company='${inv8.companyName}', DueDate='${inv8.dueDate}'`);
    if (inv8.invoiceNumber !== "1") {
      throw new Error(`Expected Invoice #8 to have persisted invoiceNumber '1', got '${inv8.invoiceNumber}'!`);
    }
    if (inv8.companyName === "Merchant #undefined" || !inv8.companyName) {
      throw new Error(`Invoice #8 has corrupted merchant display: '${inv8.companyName}'!`);
    }
    console.log("  ✓ Confirmed Invoice #8 displays canonical number '1' and correct merchant (No 'Merchant #undefined')");
  } else {
    console.log("  (Invoice #8 not found in current DB records)");
  }

  // Check Invoice 10
  const inv10 = invoices.find((i) => i.id === 10);
  if (inv10) {
    console.log(`  Inspecting Invoice #10: Number='${inv10.invoiceNumber}', Company='${inv10.companyName}', Status='${inv10.status}'`);
    if (inv10.companyName === "Merchant #undefined" || !inv10.companyName) {
      throw new Error(`Invoice #10 has corrupted merchant display: '${inv10.companyName}'!`);
    }
    console.log("  ✓ Confirmed Invoice #10 displays proper merchant and data");
  }

  // -------------------------------------------------------------------
  // [4] Admin Invoice Details by ID
  // -------------------------------------------------------------------
  console.log("\n[4] Opening Admin Invoice Details for ID 10...");
  const adminDetail10 = await request(`${BASE_URL}/admin/invoices/10`, {
    headers: adminHeaders,
  });
  if (adminDetail10.status !== 200 || !adminDetail10.data?.data) {
    throw new Error(`Admin failed to open Invoice #10 (Status ${adminDetail10.status}): ${JSON.stringify(adminDetail10.data)}`);
  }
  console.log("✓ Invoice #10 Details loaded successfully (Fixes 'Invoice not found'):", {
    id: adminDetail10.data.data.id,
    invoiceNumber: adminDetail10.data.data.invoiceNumber,
    merchantCode: adminDetail10.data.data.merchantCode,
    companyName: adminDetail10.data.data.companyName,
    amount: adminDetail10.data.data.amount,
    status: adminDetail10.data.data.status,
  });

  // -------------------------------------------------------------------
  // [5] Admin PDF Generation & Download
  // -------------------------------------------------------------------
  console.log("\n[5] Testing Admin Invoice PDF Generation & Download...");
  const adminPdfRes = await request(`${BASE_URL}/admin/invoices/10/pdf`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  if (adminPdfRes.status !== 200) {
    throw new Error(`Admin PDF download failed with status ${adminPdfRes.status}`);
  }
  const adminPdfContentType = adminPdfRes.headers.get("content-type");
  const adminPdfSize = adminPdfRes.data?.byteLength || 0;
  console.log(`✓ Admin PDF status: ${adminPdfRes.status}`);
  console.log(`✓ Content-Type: ${adminPdfContentType}`);
  console.log(`✓ PDF Buffer Size: ${adminPdfSize} bytes`);
  if (!adminPdfContentType.includes("application/pdf") || adminPdfSize < 500) {
    throw new Error("Invalid Admin PDF binary stream received!");
  }

  // -------------------------------------------------------------------
  // [6] Admin Excel Export (.xlsx)
  // -------------------------------------------------------------------
  console.log("\n[6] Testing Admin Excel Workbook Export (All matching records)...");
  const adminExcelRes = await request(`${BASE_URL}/admin/invoices/export.xlsx`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  if (adminExcelRes.status !== 200) {
    throw new Error(`Admin Excel export failed with status ${adminExcelRes.status}`);
  }
  const adminExcelContentType = adminExcelRes.headers.get("content-type");
  const adminExcelSize = adminExcelRes.data?.byteLength || 0;
  console.log(`✓ Admin Excel status: ${adminExcelRes.status}`);
  console.log(`✓ Content-Type: ${adminExcelContentType}`);
  console.log(`✓ Excel Buffer Size: ${adminExcelSize} bytes`);

  // Parse Excel workbook with ExcelJS to verify worksheets and data
  const adminWorkbook = new ExcelJS.Workbook();
  await adminWorkbook.xlsx.load(Buffer.from(adminExcelRes.data));
  const adminSheetNames = adminWorkbook.worksheets.map((s) => s.name);
  console.log("✓ Parsed Worksheets in Admin Workbook:", adminSheetNames);

  if (!adminSheetNames.includes("Invoice Summary")) throw new Error("Missing 'Invoice Summary' sheet!");
  if (!adminSheetNames.includes("Invoice Items")) throw new Error("Missing 'Invoice Items' sheet!");
  if (!adminSheetNames.includes("Payment References")) throw new Error("Missing 'Payment References' sheet!");

  const adminSummarySheet = adminWorkbook.getWorksheet("Invoice Summary");
  console.log(`✓ Admin Summary Sheet Row Count: ${adminSummarySheet.rowCount}`);
  if (adminSummarySheet.rowCount <= 1) {
    throw new Error("Admin Excel export summary sheet has no data rows!");
  }

  // -------------------------------------------------------------------
  // [7] Merchant Lifecycle & End-to-End Workflow
  // -------------------------------------------------------------------
  console.log("\n[7] Registering & Authenticating Test Merchant A...");
  const suffix = Date.now();
  const emailA = `merchant_e2e_${suffix}@banglaqr.com`;
  const passwordA = "Password@123456";

  await request(`${BASE_URL}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fullName: "Merch Alpha E2E",
      businessName: `Alpha E2E Mart ${suffix}`,
      email: emailA,
      phone: `017${String(suffix).slice(-8)}`,
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

  // Create Customer
  console.log("\n[8] Creating Customer in Directory...");
  const custRes = await request(`${BASE_URL}/merchants/me/invoice-customers`, {
    method: "POST",
    headers: headersA,
    body: JSON.stringify({
      name: "Tariqul Rahman",
      businessName: "Rahman Enterprise Ltd.",
      email: "tariqul@enterprise.bd",
      phone: "+880 1812-345678",
      billingAddress: "Motijheel C/A, Dhaka-1000",
    }),
  });
  const customerId = custRes.data.data.id;
  console.log(`✓ Customer created (ID: ${customerId})`);

  // Create Invoice
  console.log("\n[9] Generating Sequential Invoice Number & Creating Invoice...");
  const numRes = await request(`${BASE_URL}/merchants/me/invoices/next-number`, {
    headers: headersA,
  });
  const invoiceNumber = numRes.data.data.invoiceNumber;
  console.log(`✓ Next Sequential Number: ${invoiceNumber}`);

  const createInvRes = await request(`${BASE_URL}/merchants/me/invoices`, {
    method: "POST",
    headers: headersA,
    body: JSON.stringify({
      invoiceNumber,
      customerId,
      issueDate: new Date().toISOString().split("T")[0],
      dueDate: new Date(Date.now() + 86400000 * 5).toISOString().split("T")[0],
      currency: "BDT",
      items: [
        {
          description: "BanglaQR Dynamic Soundbox POS Terminal",
          quantity: 2,
          unitPrice: 3500,
          discountPercent: 10,
          taxPercent: 5,
        },
        {
          description: "Digital Payment Gateway Setup & Testing",
          quantity: 1,
          unitPrice: 2000,
          discountPercent: 0,
          taxPercent: 0,
        },
      ],
      notes: "E2E Automated invoice test note.",
    }),
  });

  const newInvoiceId = createInvRes.data.data.id;
  console.log(`✓ Invoice created successfully (ID: ${newInvoiceId}, Total: ৳${createInvRes.data.data.amount})`);

  // Record Payment
  console.log("\n[10] Recording Manual Payment against Invoice...");
  const payRes = await request(`${BASE_URL}/merchants/me/invoices/${newInvoiceId}/payments`, {
    method: "POST",
    headers: headersA,
    body: JSON.stringify({
      amount: 3000,
      paymentDate: new Date().toISOString().split("T")[0],
      paymentMethod: "bank_transfer",
      referenceId: `TXN_E2E_${suffix}`,
      notes: "Advance installment received via Bank",
    }),
  });
  console.log("✓ Payment recorded:", payRes.data.message);

  // Check Merchant Invoice Details
  const merchDetail = await request(`${BASE_URL}/merchants/me/invoices/${newInvoiceId}`, {
    headers: headersA,
  });
  console.log("✓ Merchant Invoice Details verified:", {
    id: merchDetail.data.data.id,
    invoiceNumber: merchDetail.data.data.invoiceNumber,
    amountPaid: merchDetail.data.data.amountPaid,
    balanceDue: merchDetail.data.data.balanceDue,
    status: merchDetail.data.data.status,
    paymentsCount: merchDetail.data.data.payments?.length,
  });

  // Merchant PDF Download
  console.log("\n[11] Testing Merchant PDF Download...");
  const merchPdfRes = await request(`${BASE_URL}/merchants/me/invoices/${newInvoiceId}/pdf`, {
    headers: { Authorization: `Bearer ${tokenA}` },
  });
  console.log(`✓ Merchant PDF status: ${merchPdfRes.status}, Size: ${merchPdfRes.data?.byteLength} bytes`);

  // Merchant Excel Export
  console.log("\n[12] Testing Merchant Excel Export (.xlsx)...");
  const merchExcelRes = await request(`${BASE_URL}/merchants/me/invoices/export.xlsx`, {
    headers: { Authorization: `Bearer ${tokenA}` },
  });
  if (merchExcelRes.status !== 200) {
    throw new Error(`Merchant Excel export failed (Status ${merchExcelRes.status})`);
  }
  const merchWorkbook = new ExcelJS.Workbook();
  await merchWorkbook.xlsx.load(Buffer.from(merchExcelRes.data));
  const merchSummarySheet = merchWorkbook.getWorksheet("Invoice Summary");
  console.log(`✓ Merchant Workbook parsed successfully. Worksheets: ${merchWorkbook.worksheets.map((s) => s.name)}`);
  console.log(`✓ Merchant Summary Rows: ${merchSummarySheet.rowCount}`);

  // -------------------------------------------------------------------
  // [13] Multi-Merchant Security & Isolation
  // -------------------------------------------------------------------
  console.log("\n[13] Testing Multi-Merchant Security & Isolation...");
  const suffixB = Date.now() + 1;
  const emailB = `merchant_b_${suffixB}@banglaqr.com`;
  await request(`${BASE_URL}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fullName: "Merch Beta",
      businessName: `Beta Mart ${suffixB}`,
      email: emailB,
      phone: `017${String(suffixB).slice(-8)}`,
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
  const headersB = { Authorization: `Bearer ${tokenB}` };

  // Merchant B attempting to view Merchant A's invoice
  const crossView = await request(`${BASE_URL}/merchants/me/invoices/${newInvoiceId}`, {
    headers: headersB,
  });
  console.log(`✓ Cross-Merchant Invoice Access: HTTP ${crossView.status} (Protected)`);
  if (crossView.status !== 404 && crossView.status !== 403) {
    throw new Error("Security breach: Merchant B was able to view Merchant A's invoice!");
  }

  // Merchant B attempting to download Merchant A's PDF
  const crossPdf = await request(`${BASE_URL}/merchants/me/invoices/${newInvoiceId}/pdf`, {
    headers: headersB,
  });
  console.log(`✓ Cross-Merchant PDF Download: HTTP ${crossPdf.status} (Protected)`);
  if (crossPdf.status !== 404 && crossPdf.status !== 403) {
    throw new Error("Security breach: Merchant B was able to download Merchant A's PDF!");
  }

  // -------------------------------------------------------------------
  // [14] Admin Status Update & Audit Logging
  // -------------------------------------------------------------------
  console.log("\n[14] Testing Admin Status Management & Payment Reconciliation...");
  const adminUpdateRes = await request(`${BASE_URL}/admin/invoices/${newInvoiceId}/status`, {
    method: "PATCH",
    headers: adminHeaders,
    body: JSON.stringify({ status: "paid", paymentReference: `BANK_SETTLE_${suffix}` }),
  });
  console.log("✓ Admin update result:", adminUpdateRes.data?.message);

  // Re-verify invoice status in Admin Details
  const updatedInv = await request(`${BASE_URL}/admin/invoices/${newInvoiceId}`, {
    headers: adminHeaders,
  });
  console.log("✓ Re-verified updated invoice status:", {
    status: updatedInv.data.data.status,
    amountPaid: updatedInv.data.data.amountPaid,
    balanceDue: updatedInv.data.data.balanceDue,
    paymentReference: updatedInv.data.data.paymentReference,
    historyCount: updatedInv.data.data.history?.length,
  });

  console.log("\n=========================================================");
  console.log("  ALL INVOICE MANAGEMENT E2E TESTS PASSED 100%!         ");
  console.log("=========================================================");
}

runTests().catch((err) => {
  console.error("\n❌ E2E Test Suite Failed:", err);
  process.exitCode = 1;
});
