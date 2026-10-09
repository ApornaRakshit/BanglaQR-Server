import { db } from "../src/config/db.js";
import { loginUser, registerUser, verifyOtp } from "../src/modules/auth/auth.service.js";
import { adminRepository } from "../src/modules/admin/admin.repository.js";
import { adminService } from "../src/modules/admin/admin.service.js";
import { merchantService } from "../src/modules/merchants/merchant.service.js";
import { merchantRepository } from "../src/modules/merchants/merchant.repository.js";

async function runTests() {
  console.log("==================================================");
  console.log("STARTING ADMIN PORTAL & END-TO-END TESTS");
  console.log("==================================================");

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${message}`);
      failed++;
    }
  }

  try {
    // TEST 1: Merchant login and permission check
    console.log("\n--- TEST 1: Merchant Access Check ---");
    const merchantLogin = await loginUser({
      email: "merchant@gmail.com",
      password: "Merchant@123456",
    });
    assert(merchantLogin.user.role === "merchant", "Merchant user logged in with 'merchant' role");

    // Check user permissions in DB for merchant
    const [merchantPerms] = await db.execute(
      `SELECT p.name FROM permissions p
       JOIN role_permissions rp ON rp.permission_id = p.id
       JOIN user_roles ur ON ur.role_id = rp.role_id
       WHERE ur.user_id = ?`,
      [merchantLogin.user.id]
    );
    const hasDashboardView = merchantPerms.some((p) => p.name === "dashboard.view");
    assert(!hasDashboardView, "Merchant does NOT have 'dashboard.view' permission");

    // TEST 2: Admin login & dashboard data retrieval
    console.log("\n--- TEST 2: Admin Login & Dashboard Fetch ---");
    const adminLogin = await loginUser({
      email: "admin@banglaqr.com",
      password: "Admin@123456",
    });
    assert(adminLogin.user.role === "admin", "Admin user logged in with 'admin' role");

    const [adminPerms] = await db.execute(
      `SELECT p.name FROM permissions p
       JOIN role_permissions rp ON rp.permission_id = p.id
       JOIN user_roles ur ON ur.role_id = rp.role_id
       WHERE ur.user_id = ?`,
      [adminLogin.user.id]
    );
    assert(
      adminPerms.some((p) => p.name === "dashboard.view"),
      "Admin user HAS 'dashboard.view' permission"
    );

    const adminDashboardData = await adminService.getDashboardData({
      user: { id: adminLogin.user.id, role: adminLogin.user.role },
      timeframe: "30days",
    });
    assert(adminDashboardData.stats.totalMerchants >= 1, "Dashboard returns real totalMerchants from MySQL");
    assert(Array.isArray(adminDashboardData.pendingApplications), "Dashboard returns pendingApplications array");
    assert(Array.isArray(adminDashboardData.recentMerchants), "Dashboard returns recentMerchants array");
    assert(Array.isArray(adminDashboardData.registrationTrend), "Dashboard returns registrationTrend array");
    assert(typeof adminDashboardData.kycQueue === "object", "Dashboard returns kycQueue metrics");
    assert(typeof adminDashboardData.documentQueue === "object", "Dashboard returns documentQueue metrics");

    // TEST 3: Reviewer role access
    console.log("\n--- TEST 3: Reviewer Role Access ---");
    const reviewerLogin = await loginUser({
      email: "reviewer@banglaqr.com",
      password: "Reviewer@123456",
    });
    assert(reviewerLogin.user.role === "reviewer", "Reviewer user logged in with 'reviewer' role");
    const reviewerData = await adminService.getDashboardData({
      user: { id: reviewerLogin.user.id, role: reviewerLogin.user.role },
      timeframe: "30days",
    });
    assert(reviewerData.stats !== undefined, "Reviewer successfully accesses permitted dashboard data");

    // TEST 4: Support Agent role access
    console.log("\n--- TEST 4: Support Agent Role Access ---");
    const supportLogin = await loginUser({
      email: "support@banglaqr.com",
      password: "Support@123456",
    });
    assert(supportLogin.user.role === "support_agent", "Support agent logged in with 'support_agent' role");
    const supportData = await adminService.getDashboardData({
      user: { id: supportLogin.user.id, role: supportLogin.user.role },
      timeframe: "30days",
    });
    assert(supportData.stats !== undefined, "Support agent successfully accesses dashboard data");

    // TEST 5: Complete Merchant Onboarding & Admin Sync Flow
    console.log("\n--- TEST 5: Merchant Registration -> Submit -> Admin Dashboard Reflection ---");
    const initialStats = await adminRepository.getStats();
    console.log(`Initial Pending Review Count: ${initialStats.pendingReview}`);

    const uniqueSuffix = Date.now();
    const newMerchantEmail = `merchant_${uniqueSuffix}@example.com`;
    const newMerchantPhone = `+88019${String(uniqueSuffix).slice(-8)}`;

    const regResult = await registerUser({
      fullName: "Automated Test Business",
      email: newMerchantEmail,
      phone: newMerchantPhone,
      password: "TestPassword123!",
    });
    assert(regResult.userId !== undefined, `Created new merchant user (${newMerchantEmail})`);

    // Activate merchant
    await db.execute(
      `UPDATE users SET status = 'active', email_verified_at = NOW(), phone_verified_at = NOW() WHERE id = ?`,
      [regResult.userId]
    );

    const merchantObj = await merchantRepository.findOrCreateMerchantByUserId(regResult.userId);
    assert(merchantObj.id !== undefined, `Created merchant record (ID: ${merchantObj.id}, Code: ${merchantObj.merchant_code})`);

    // Fill onboarding steps
    await merchantService.updateCompany(regResult.userId, {
      companyName: `Test Enterprise ${uniqueSuffix}`,
      businessType: "Private Limited",
      industry: "Financial Technology",
      website: "https://testenterprise.com",
      address: "House 10, Road 5, Banani",
      city: "Dhaka",
      state: "Dhaka",
      postalCode: "1213",
      country: "Bangladesh",
    });

    await merchantService.updateContact(regResult.userId, {
      name: "Managing Director",
      email: newMerchantEmail,
      phone: newMerchantPhone,
      designation: "CEO",
    });

    await merchantService.updateCommercial(regResult.userId, {
      transactionsPerDay: 500,
      transactionsPerMonth: 15000,
      volumePerDay: 250000.0,
      volumePerMonth: 7500000.0,
      maximumTicketSize: 50000.0,
      returnUrl: "https://testenterprise.com/callback",
      merchantDomain: "testenterprise.com",
      merchantIpAddress: "103.14.24.1",
    });

    await merchantService.updateKyc(regResult.userId, {
      legalBusinessName: `Test Enterprise ${uniqueSuffix} Ltd`,
      registrationNumber: `REG-${uniqueSuffix}`,
      tin: "123456789012",
      tradeLicenseNumber: `TL-${uniqueSuffix}`,
      nidNumber: "19901234567890",
      authorizedPersonName: "Managing Director",
      bankName: "City Bank",
      bankAccountName: `Test Enterprise ${uniqueSuffix}`,
      bankAccountNumber: "11029384756",
      routingNumber: "225272635",
      branchName: "Gulshan",
      businessEntityType: "Private Limited",
      designation: "CEO",
      accountType: "Current",
    });

    // Insert required documents for submission validation
    const requiredDocs = [
      { type: "NID_FRONT", name: "nid_front.jpg" },
      { type: "NID_BACK", name: "nid_back.jpg" },
      { type: "TIN_CERTIFICATE", name: "tin_cert.pdf" },
      { type: "CANCELLED_BANK_CHEQUE", name: "cheque.jpg" },
    ];
    for (const d of requiredDocs) {
      await db.execute(
        `INSERT INTO merchant_documents (merchant_id, document_type, document_name, storage_key, mime_type, file_size, status, uploaded_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'image/jpeg', 10240, 'Uploaded', NOW(), NOW(), NOW())`,
        [merchantObj.id, d.type, d.name, `storage/test/${d.name}`]
      );
    }

    // Submit application
    const submitRes = await merchantService.submitApplication(regResult.userId);
    assert(submitRes.accountStatus === "submitted", "Application submitted successfully (accountStatus = 'submitted')");

    // TEST 6: Check Admin Dashboard reflection
    const updatedStats = await adminRepository.getStats();
    console.log(`Updated Pending Review Count: ${updatedStats.pendingReview}`);
    assert(
      updatedStats.pendingReview === initialStats.pendingReview + 1,
      "Admin Dashboard 'Pending Review' count incremented by 1 in MySQL"
    );

    const pendingApps = await adminRepository.getPendingApplications(10);
    const foundApp = pendingApps.find((a) => a.id === merchantObj.id);
    assert(Boolean(foundApp), `New merchant application found in Admin Pending Queue (${foundApp?.businessName})`);

    console.log("\n==================================================");
    console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log("==================================================");

    process.exit(failed > 0 ? 1 : 0);
  } catch (err) {
    console.error("Test execution failed with error:", err);
    process.exit(1);
  }
}

runTests();
