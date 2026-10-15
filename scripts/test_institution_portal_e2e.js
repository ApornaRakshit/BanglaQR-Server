import http from "http";
import jwt from "jsonwebtoken";
import { db } from "../src/config/db.js";
import { env } from "../src/config/env.js";
import app from "../src/app.js";

function generateToken(userId) {
  return jwt.sign({ sub: userId }, env.jwt.accessSecret, { expiresIn: "2h" });
}

let server;
let baseUrl;

async function request(path, options = {}) {
  const url = `${baseUrl}${path}`;
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  const body = options.body ? JSON.stringify(options.body) : undefined;

  const res = await fetch(url, {
    method: options.method || "GET",
    headers,
    body,
  });

  const contentType = res.headers.get("content-type") || "";
  let data = null;
  if (contentType.includes("application/json")) {
    data = await res.json();
  } else {
    data = await res.text();
  }

  return { status: res.status, headers: res.headers, data };
}

async function runInstitutionPortalE2ETest() {
  console.log("======================================================================");
  console.log(" BANGLAQR INSTITUTION PORTAL & BANK DIRECTORY FULL E2E TEST SUITE");
  console.log("======================================================================\n");

  try {
    // 0. Spin up server on random available port
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://localhost:${port}/api/v1`;
    console.log(`[PASS] Ephemeral test server running at ${baseUrl}\n`);

    // 1. Prepare Test Data in DB
    console.log("--> Preparing Test Roles, Institutions, and Accounts...");

    // Get roles
    const [roles] = await db.query(
      "SELECT id, name FROM roles WHERE name IN ('super_admin', 'bank_admin', 'bank_reviewer', 'merchant')"
    );
    const roleMap = {};
    roles.forEach((r) => {
      roleMap[r.name] = r.id;
    });

    if (!roleMap["bank_admin"]) {
      throw new Error("Role 'bank_admin' not found in roles table");
    }

    // Get two distinct institutions
    const [institutions] = await db.query(
      "SELECT id, name, institution_code FROM institutions ORDER BY id ASC LIMIT 2"
    );
    if (institutions.length < 2) {
      throw new Error("At least 2 institutions are required in DB for isolation tests");
    }
    const instA = institutions[0];
    const instB = institutions[1];
    console.log(`  Institution A: ${instA.name} (ID: ${instA.id})`);
    console.log(`  Institution B: ${instB.name} (ID: ${instB.id})`);

    // Find or create test users
    async function getOrCreateTestUser(email, roleName, institutionId = null) {
      const [existing] = await db.query("SELECT id, email, status FROM users WHERE email = ?", [email]);
      let userId;
      if (existing.length) {
        userId = existing[0].id;
        await db.query("UPDATE users SET status = 'active' WHERE id = ?", [userId]);
      } else {
        const [res] = await db.query(
          `INSERT INTO users (email, phone, password_hash, status, created_at, updated_at)
           VALUES (?, ?, 'dummy_hash', 'active', NOW(), NOW())`,
          [email, `017${Math.floor(10000000 + Math.random() * 90000000)}`]
        );
        userId = res.insertId;
      }

      // Assign system role
      const roleId = roleMap[roleName] || roleMap["merchant"];
      await db.query("DELETE FROM user_roles WHERE user_id = ?", [userId]);
      await db.query("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [userId, roleId]);

      // Assign institution membership if institutionId provided
      await db.query("DELETE FROM institution_users WHERE user_id = ?", [userId]);
      if (institutionId) {
        await db.query(
          `INSERT INTO institution_users (institution_id, user_id, role_id, membership_status, created_at)
           VALUES (?, ?, ?, 'active', NOW())`,
          [institutionId, userId, roleId]
        );
      }

      return userId;
    }

    const userAId = await getOrCreateTestUser("test_inst_a_staff@banglaqr.com", "bank_admin", instA.id);
    const userBId = await getOrCreateTestUser("test_inst_b_staff@banglaqr.com", "bank_reviewer", instB.id);
    const userMerchantId = await getOrCreateTestUser("test_regular_user@banglaqr.com", "merchant", null);
    const userAdminId = await getOrCreateTestUser("test_superadmin_user@banglaqr.com", "super_admin", null);

    const tokenA = generateToken(userAId);
    const tokenB = generateToken(userBId);
    const tokenMerchant = generateToken(userMerchantId);
    const tokenAdmin = generateToken(userAdminId);

    console.log("[PASS] Test users and JWT tokens ready.\n");

    // =========================================================================
    // TEST 1: Authentication & Scope Enforcement
    // =========================================================================
    console.log("--> TEST 1: Authentication & Scope Enforcement");

    // 1.1 Unauthenticated request
    const unauthRes = await request("/institution/dashboard");
    if (unauthRes.status !== 401) {
      throw new Error(`Expected 401 for unauthenticated request, got ${unauthRes.status}`);
    }
    console.log("  [PASS] Unauthenticated request rejected with 401");

    // 1.2 User with no institution membership
    const noInstRes = await request("/institution/dashboard", {
      headers: { Authorization: `Bearer ${tokenMerchant}` },
    });
    if (noInstRes.status !== 403) {
      throw new Error(`Expected 403 for user without institution, got ${noInstRes.status}`);
    }
    console.log("  [PASS] Non-institution user rejected with 403");

    // 1.3 Valid institution staff
    const validInstRes = await request("/institution/dashboard", {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    if (validInstRes.status !== 200 || !validInstRes.data?.success) {
      throw new Error(`Expected 200 for valid institution staff, got ${validInstRes.status}: ${JSON.stringify(validInstRes.data)}`);
    }
    console.log("  [PASS] Valid institution staff access granted (200 OK)");

    // =========================================================================
    // TEST 2: Institution Dashboard Metrics
    // =========================================================================
    console.log("\n--> TEST 2: Institution Dashboard Metrics");
    const dashData = validInstRes.data.data;
    if (
      !dashData ||
      dashData.applications?.total === undefined ||
      dashData.branches?.active === undefined ||
      dashData.staffCount === undefined
    ) {
      throw new Error(`Dashboard metrics missing required fields: ${JSON.stringify(dashData)}`);
    }
    console.log(`  [PASS] Dashboard metrics: Total Apps=${dashData.applications.total}, Pending Apps=${dashData.applications.pending}, Active Branches=${dashData.branches.active}, Staff=${dashData.staffCount}`);

    // =========================================================================
    // TEST 3: Applications & Multi-Tenant Data Isolation
    // =========================================================================
    console.log("\n--> TEST 3: Applications & Cross-Institution Isolation");

    // Ensure test merchant record exists in merchants and merchant_profiles tables
    const [existingMerchant] = await db.query("SELECT id FROM merchants WHERE user_id = ?", [userMerchantId]);
    let merchantRecordId;
    if (existingMerchant.length) {
      merchantRecordId = existingMerchant[0].id;
    } else {
      const [newMerchant] = await db.query(
        `INSERT INTO merchants (user_id, merchant_code, account_status, kyc_status, created_at, updated_at)
         VALUES (?, ?, 'active', 'approved', NOW(), NOW())`,
        [userMerchantId, `MCH-TEST-${Date.now()}`]
      );
      merchantRecordId = newMerchant.insertId;

      await db.query(
        `INSERT INTO merchant_profiles (merchant_id, company_name, business_type, created_at, updated_at)
         VALUES (?, 'Acme Retail Solutions', 'retail', NOW(), NOW())`,
        [merchantRecordId]
      );
    }

    const [existingKyc] = await db.query("SELECT id FROM merchant_kyc WHERE merchant_id = ?", [merchantRecordId]);
    if (!existingKyc.length) {
      await db.query(
        `INSERT INTO merchant_kyc 
         (merchant_id, legal_business_name, trade_license_number, nid_number, authorized_person_name, created_at, updated_at)
         VALUES (?, 'Acme Retail Solutions Ltd', 'TRAD/DNCC/123456/2026', '19901234567890123', 'John Doe', NOW(), NOW())`,
        [merchantRecordId]
      );
    }

    // Clean up any lingering open test issues from previous runs
    await db.query("DELETE FROM kyc_field_issues WHERE merchant_id = ?", [merchantRecordId]);

    // Create a test application in merchant_gateway_applications assigned to instA
    const testAppNumber = `APP-TEST-${Date.now()}`;
    const [createAppRes] = await db.query(
      `INSERT INTO merchant_gateway_applications 
       (merchant_id, institution_id, application_number, status, gateway_name, service_type, applied_at, created_at, updated_at)
       VALUES (?, ?, ?, 'under_review', 'BanglaQR Direct Gateway', 'Payment Gateway', NOW(), NOW(), NOW())`,
      [merchantRecordId, instA.id, testAppNumber]
    );
    const testAppId = createAppRes.insertId;
    console.log(`  Created test application #${testAppId} (${testAppNumber}) for Institution A`);

    // Inst A staff views applications
    const instAAppsRes = await request("/institution/applications", {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    const appsList = instAAppsRes.data?.applications || instAAppsRes.data?.data || [];
    if (instAAppsRes.status !== 200 || !Array.isArray(appsList)) {
      throw new Error(`Failed to list applications for Institution A: ${JSON.stringify(instAAppsRes.data)}`);
    }
    const foundAppA = appsList.find((a) => a.id === testAppId);
    if (!foundAppA) {
      throw new Error(`Application ${testAppId} not found in Institution A list`);
    }
    console.log("  [PASS] Application listed correctly for Institution A");

    // Inst A staff views application details
    const appDetailRes = await request(`/institution/applications/${testAppId}`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    const fetchedApp = appDetailRes.data?.data?.application || appDetailRes.data?.data;
    if (appDetailRes.status !== 200 || fetchedApp?.id !== testAppId) {
      throw new Error(`Failed to get application detail for ID ${testAppId}: ${JSON.stringify(appDetailRes.data)}`);
    }
    console.log("  [PASS] Application detail fetched successfully");

    // Isolation check: Inst B staff attempts to access Inst A's application
    const instBDetailRes = await request(`/institution/applications/${testAppId}`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    if (instBDetailRes.status !== 404 && instBDetailRes.status !== 403) {
      throw new Error(`Data leak: Institution B was able to access Institution A application! Status: ${instBDetailRes.status}`);
    }
    console.log(`  [PASS] Multi-tenant isolation verified: Institution B access rejected with ${instBDetailRes.status}`);

    // =========================================================================
    // TEST 4: KYC Correction Issue Workflow & Resolution Gate
    // =========================================================================
    console.log("\n--> TEST 4: KYC Correction Workflow & Approval Blocking");

    // 4.1 Inst A raises a KYC field issue
    const raiseIssueRes = await request(`/institution/applications/${testAppId}/correction`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenA}` },
      body: {
        fieldKey: "trade_license_number",
        issueType: "mismatch",
        issueReason: "Scanned trade license registration number does not match submitted text.",
      },
    });
    if (raiseIssueRes.status !== 201 && raiseIssueRes.status !== 200) {
      throw new Error(`Failed to raise KYC issue: ${JSON.stringify(raiseIssueRes.data)}`);
    }
    const issueId = raiseIssueRes.data?.issueId || raiseIssueRes.data?.data?.id || raiseIssueRes.data?.id;
    console.log(`  [PASS] KYC correction issue #${issueId} raised successfully`);

    // Verify application status changed to additional_information_required
    const checkStatusRes = await request(`/institution/applications/${testAppId}`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    const checkApp = checkStatusRes.data?.data?.application || checkStatusRes.data?.data;
    if (checkApp?.status !== "additional_information_required") {
      throw new Error(`Expected status 'additional_information_required', got '${checkApp?.status}'`);
    }
    console.log("  [PASS] Application status automatically transitioned to 'additional_information_required'");

    // 4.2 Verify Approval is BLOCKED while open KYC issues exist
    const blockApproveRes = await request(`/institution/applications/${testAppId}/review`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenA}` },
      body: {
        status: "approved",
        reviewComment: "Attempting approval while issue is open",
      },
    });
    if (blockApproveRes.status !== 400) {
      throw new Error(`Expected approval to be blocked with 400, but got ${blockApproveRes.status}: ${JSON.stringify(blockApproveRes.data)}`);
    }
    console.log(`  [PASS] Approval strictly blocked due to open KYC issue: "${blockApproveRes.data?.message}"`);

    // 4.3 Resolve the KYC issue
    const resolveIssueRes = await request(`/institution/applications/corrections/${issueId}/resolve`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${tokenA}` },
      body: {
        resolutionNote: "Merchant submitted refreshed trade license copy. Verified authentic.",
      },
    });
    if (resolveIssueRes.status !== 200 || !resolveIssueRes.data?.success) {
      throw new Error(`Failed to resolve issue: ${JSON.stringify(resolveIssueRes.data)}`);
    }
    console.log("  [PASS] KYC correction issue marked as resolved");

    // 4.4 Verify Approval SUCCEEDS now that issues are resolved
    const approveRes = await request(`/institution/applications/${testAppId}/review`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenA}` },
      body: {
        status: "approved",
        reviewComment: "All KYC verifications completed and verified authentic.",
      },
    });
    if (approveRes.status !== 200 || !approveRes.data?.success) {
      throw new Error(`Failed to approve application: ${JSON.stringify(approveRes.data)}`);
    }
    console.log("  [PASS] Application successfully approved after resolving issues");

    // Verify updated status in DB
    const finalAppRes = await request(`/institution/applications/${testAppId}`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    const finalApp = finalAppRes.data?.data?.application || finalAppRes.data?.data;
    if (finalApp?.status !== "approved") {
      throw new Error(`Expected final status 'approved', got '${finalApp?.status}'`);
    }
    console.log("  [PASS] Final application status verified as 'approved'");

    // =========================================================================
    // TEST 5: Branch Management, Change Requests & Scope Assignments
    // =========================================================================
    console.log("\n--> TEST 5: Branch Management & Scope Assignments");

    // 5.1 Fetch Branches
    const branchesRes = await request("/institution/branches", {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    const branchList = branchesRes.data?.branches || branchesRes.data?.data || [];
    if (branchesRes.status !== 200 || !Array.isArray(branchList)) {
      throw new Error(`Failed to list institution branches: ${JSON.stringify(branchesRes.data)}`);
    }
    console.log(`  [PASS] Listed ${branchList.length} branches for Institution A`);

    let testBranchId;
    if (branchList.length > 0) {
      testBranchId = branchList[0].id;
    } else {
      // Insert branch for testing
      const [newBranch] = await db.query(
        `INSERT INTO institution_branches (institution_id, branch_name, routing_number, status, created_at, updated_at)
         VALUES (?, 'Gulshan Test Branch', '020261234', 'active', NOW(), NOW())`,
        [instA.id]
      );
      testBranchId = newBranch.insertId;
      console.log(`  Inserted branch #${testBranchId} for Institution A`);
    }

    // 5.2 Branch Change Request
    const changeReqRes = await request("/institution/branches/change-request", {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenA}` },
      body: {
        branchId: testBranchId,
        reason: "Branch relocated to newly renovated building in Banani Commercial Area",
        address: "House 45, Road 11, Block D, Banani, Dhaka-1213",
      },
    });
    if (changeReqRes.status !== 202 && changeReqRes.status !== 200) {
      throw new Error(`Failed to submit branch change request (status ${changeReqRes.status}): ${JSON.stringify(changeReqRes.data)}`);
    }
    console.log(`  [PASS] Branch change request recorded with audit trace (Status ${changeReqRes.status})`);

    // 5.3 Staff Branch Assignment
    const [iuRows] = await db.query(
      "SELECT id FROM institution_users WHERE user_id = ? AND institution_id = ?",
      [userAId, instA.id]
    );
    const membershipId = iuRows[0].id;

    const assignBranchRes = await request(`/institution/staff/${membershipId}/branches`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenA}` },
      body: {
        branchIds: [testBranchId],
      },
    });
    if (assignBranchRes.status !== 200 || !assignBranchRes.data?.success) {
      throw new Error(`Failed to assign branch to staff: ${JSON.stringify(assignBranchRes.data)}`);
    }
    console.log(`  [PASS] Staff branch assignment updated successfully for Membership #${membershipId}`);

    // =========================================================================
    // TEST 6: Service Connections & Zero-Secret Handshake Test
    // =========================================================================
    console.log("\n--> TEST 6: Service Connections & Handshake Testing");

    // 6.1 Create or find test service
    const [existingServices] = await db.query(
      "SELECT id FROM institution_services WHERE institution_id = ? LIMIT 1",
      [instA.id]
    );
    let serviceId;
    if (existingServices.length > 0) {
      serviceId = existingServices[0].id;
    } else {
      const [insertServ] = await db.query(
        `INSERT INTO institution_services 
         (institution_id, service_code, service_name, service_type, integration_mode, availability_status, created_at, updated_at)
         VALUES (?, 'TEST_QR_GATEWAY', 'BanglaQR Direct Payment API', 'payment_gateway', 'api', 'available', NOW(), NOW())`,
        [instA.id]
      );
      serviceId = insertServ.insertId;
    }

    // 6.2 Test handshake trigger
    const handshakeRes = await request(`/institution/connections/${serviceId}/test`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    if (handshakeRes.status !== 200 || !handshakeRes.data?.success) {
      throw new Error(`Handshake test failed: ${JSON.stringify(handshakeRes.data)}`);
    }
    console.log(`  [PASS] Handshake test completed: ${handshakeRes.data.message} (Status: ${handshakeRes.data.data?.status || handshakeRes.data.status})`);

    // 6.3 Fetch connections list
    const connListRes = await request("/institution/connections", {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    const connList = connListRes.data?.connections || connListRes.data?.data || [];
    if (connListRes.status !== 200 || !Array.isArray(connList)) {
      throw new Error("Failed to fetch service connections");
    }
    console.log(`  [PASS] Service connections listed safely (${connList.length} active connection records)`);

    // =========================================================================
    // TEST 7: Admin Directory, Staging Data Import & Publish
    // =========================================================================
    console.log("\n--> TEST 7: Admin Directory & Staging Data Import Workflow");

    // 7.1 Admin directory list
    const dirRes = await request("/admin/institutions", {
      headers: { Authorization: `Bearer ${tokenAdmin}` },
    });
    const dirList = dirRes.data?.institutions || dirRes.data?.data || [];
    if (dirRes.status !== 200 || !Array.isArray(dirList)) {
      throw new Error("Failed to fetch admin institution directory");
    }
    console.log(`  [PASS] Admin directory query returned ${dirList.length} institutions`);

    // 7.2 Create staging import batch
    // Remove any previously inserted test branch with same routing number
    await db.query("DELETE FROM institution_branches WHERE routing_number = '020279999'");

    const stagingRes = await request("/admin/institutions/imports/stage", {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenAdmin}` },
      body: {
        entityType: "bank_branches",
        sourceName: "Bangladesh Bank Schedule 2026",
        sourceUrl: "https://www.bb.org.bd/en/index.php/financialactivity/bankfi",
        originalFileName: "bb_branches_2026.csv",
        storageKey: "imports/staging/bb_branches_2026.csv",
        totalRows: 2,
        validRows: 1,
        invalidRows: 1,
        rows: [
          {
            raw: {
              institution_code: instA.institution_code,
              branch_name: "Agrabad Commercial Branch",
              routing_number: "020279999",
            },
            parsed: {
              institutionId: instA.id,
              branchName: "Agrabad Commercial Branch",
              branchCode: "AGR-001",
              routingNumber: "020279999",
              division: "Chattogram",
              district: "Chattogram",
              upazila: "Double Mooring",
              address: "Agrabad Commercial Area",
              unitType: "branch",
            },
            status: "valid",
          },
          {
            raw: {
              institution_code: instA.institution_code,
              branch_name: "Invalid Routing Branch",
              routing_number: "123",
            },
            parsed: {
              institutionId: instA.id,
              branchName: "Invalid Routing Branch",
              branchCode: "INV-001",
              routingNumber: "123",
            },
            status: "invalid",
            errors: ["Routing number must be exactly 9 digits"],
          },
        ],
      },
    });
    if (stagingRes.status !== 201 && stagingRes.status !== 200) {
      throw new Error(`Failed to stage import batch: ${JSON.stringify(stagingRes.data)}`);
    }
    const importId = stagingRes.data?.importId || stagingRes.data?.data?.importId;
    if (!importId) {
      throw new Error(`No importId returned from staging: ${JSON.stringify(stagingRes.data)}`);
    }
    console.log(`  [PASS] Staged data import batch #${importId} created successfully`);

    // 7.3 Fetch import batch details
    const batchDetailRes = await request(`/admin/institutions/imports/${importId}`, {
      headers: { Authorization: `Bearer ${tokenAdmin}` },
    });
    const sampleRows = batchDetailRes.data?.data?.sampleRows || batchDetailRes.data?.sampleRows || [];
    if (batchDetailRes.status !== 200 || sampleRows.length !== 2) {
      throw new Error(`Failed to fetch staged import batch rows: ${JSON.stringify(batchDetailRes.data)}`);
    }
    console.log(`  [PASS] Staged batch preview with row-level validation retrieved (${sampleRows.length} rows staged)`);

    // 7.4 Explicit Publish
    const publishRes = await request(`/admin/institutions/imports/${importId}/publish`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenAdmin}` },
    });
    if (publishRes.status !== 200 || !publishRes.data?.success) {
      throw new Error(`Failed to publish staged import batch: ${JSON.stringify(publishRes.data)}`);
    }
    console.log(`  [PASS] Staged batch published to live branches: ${publishRes.data.message}`);

    // Verify live branch exists
    const [checkLiveBranch] = await db.query(
      "SELECT id, branch_name FROM institution_branches WHERE routing_number = '020279999'"
    );
    if (!checkLiveBranch.length) {
      throw new Error("Published branch not found in live institution_branches table!");
    }
    console.log(`  [PASS] Verified live branch record created: "${checkLiveBranch[0].branch_name}"`);

    // =========================================================================
    // TEST 8: Regression Tests (CMS, Health, Gateway & Payments)
    // =========================================================================
    console.log("\n--> TEST 8: Regression Testing (CMS, Health, Gateway & Billing)");

    // Health
    const healthRes = await fetch(`http://localhost:${port}/api/health`).then((r) => r.json());
    if (!healthRes.success) {
      throw new Error("Health check failed");
    }
    console.log("  [PASS] Health check responding 200 OK");

    // Public CMS
    const cmsRes = await request("/public/cms/homepage");
    if (cmsRes.status !== 200) {
      throw new Error(`Public homepage CMS check failed with status ${cmsRes.status}`);
    }
    console.log("  [PASS] Public CMS homepage responding 200 OK");

    // Public Marketplace Services
    const marketRes = await request("/public/marketplace/services");
    if (marketRes.status !== 200) {
      throw new Error(`Public marketplace check failed with status ${marketRes.status}`);
    }
    console.log(`  [PASS] Public marketplace responding 200 OK (${marketRes.data?.data?.length || marketRes.data?.count || 0} services)`);

    console.log("\n======================================================================");
    console.log(" ALL 8 INSTITUTION PORTAL & DIRECTORY E2E TEST SUITES PASSED! [100%]");
    console.log("======================================================================\n");
  } catch (error) {
    console.error("\n[FAIL] Test suite failed with error:", error);
    process.exitCode = 1;
  } finally {
    if (server) {
      server.close();
    }
    await db.end();
  }
}

runInstitutionPortalE2ETest();
