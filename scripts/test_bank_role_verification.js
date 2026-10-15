import http from "http";
import jwt from "jsonwebtoken";
import { db } from "../src/config/db.js";
import { env } from "../src/config/env.js";
import app from "../src/app.js";
import { adminInstitutionsService } from "../src/modules/admin/institutions/admin.institutions.service.js";

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

async function runTestSuite() {
  console.log("==========================================================================");
  console.log(" BANGLAQR: VERIFICATION TEST SUITE FOR BANK ROLES & AUTHORIZATION FLOWS");
  console.log("==========================================================================\n");

  let passed = 0;
  let failed = 0;

  function assert(condition, message, details = "") {
    if (condition) {
      console.log(`  [PASS] ${message}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${message} - ${details}`);
      failed++;
    }
  }

  try {
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://localhost:${port}/api/v1`;
    console.log(`Ephemeral test server running at ${baseUrl}\n`);

    // Fetch initial row counts to guarantee no destructive changes or data loss
    const [[initialInstCount]] = await db.query("SELECT COUNT(*) AS c FROM institutions");
    const [[initialBranchCount]] = await db.query("SELECT COUNT(*) AS c FROM institution_branches");
    const [[initialKycCount]] = await db.query("SELECT COUNT(*) AS c FROM merchant_kyc");
    const [[initialMerchantCount]] = await db.query("SELECT COUNT(*) AS c FROM merchants");

    // -------------------------------------------------------------------------
    // TEST 1: Existing Super Admin and Admin logins still work
    // -------------------------------------------------------------------------
    console.log("TEST 1: Existing Super Admin and Admin Logins");
    const superAdminRes = await request("/auth/login", {
      method: "POST",
      body: { email: "superadmin@banglaqr.com", password: "Admin@123456" },
    });
    assert(
      superAdminRes.status === 200 &&
        (superAdminRes.data.data.user.roles?.includes("super_admin") ||
          superAdminRes.data.data.user.role === "super_admin"),
      "Super Admin login succeeds and returns 'super_admin' role",
      JSON.stringify(superAdminRes.data)
    );

    const adminRes = await request("/auth/login", {
      method: "POST",
      body: { email: "admin@banglaqr.com", password: "Admin@123456" },
    });
    assert(
      adminRes.status === 200 &&
        (adminRes.data.data.user.roles?.includes("admin") ||
          adminRes.data.data.user.role === "admin"),
      "Admin login succeeds and returns 'admin' role",
      JSON.stringify(adminRes.data)
    );

    // -------------------------------------------------------------------------
    // TEST 2: Existing Merchant login still works
    // -------------------------------------------------------------------------
    console.log("\nTEST 2: Existing Merchant Login");
    const merchantRes = await request("/auth/login", {
      method: "POST",
      body: { email: "merchant@gmail.com", password: "Merchant@123456" },
    });
    assert(
      merchantRes.status === 200 &&
        (merchantRes.data.data.user.roles?.includes("merchant") ||
          merchantRes.data.data.user.isMerchant === true),
      "Merchant login succeeds and returns merchant role & isMerchant status",
      JSON.stringify(merchantRes.data)
    );

    // -------------------------------------------------------------------------
    // TEST 3: Active Bank membership access
    // -------------------------------------------------------------------------
    console.log("\nTEST 3: Active Bank Membership Access");
    // User 56 is brac.admin@banglaqr.com, with active membership in Institution 1 (BRAC Bank PLC)
    const bankStaffToken = generateToken(56);
    const bankAccessRes = await request("/institution/dashboard?institutionId=1", {
      headers: { Authorization: `Bearer ${bankStaffToken}` },
    });
    assert(
      bankAccessRes.status === 200 && bankAccessRes.data.success === true,
      "Bank staff with active membership accesses Institution 1 dashboard successfully (200 OK)",
      JSON.stringify(bankAccessRes.data)
    );

    // -------------------------------------------------------------------------
    // TEST 4: Global Bank role without active membership is NOT sufficient
    // -------------------------------------------------------------------------
    console.log("\nTEST 4: Global Bank Role Without Active Institution Membership Denied");
    // Create a temporary user with global role bank_admin in user_roles, but NO institution_users membership
    const [testRoleRow] = await db.query("SELECT id FROM roles WHERE name = 'bank_admin' LIMIT 1");
    const bankAdminRoleId = testRoleRow[0].id;

    const [fakeUserRes] = await db.query(
      `INSERT INTO users (email, password_hash, status, created_at, updated_at) 
       VALUES ('orphan.bankrole@banglaqr.com', 'test_hash', 'active', NOW(), NOW())`
    );
    const fakeUserId = fakeUserRes.insertId;

    try {
      // Assign global bank_admin in user_roles
      await db.query(`INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)`, [fakeUserId, bankAdminRoleId]);

      const orphanToken = generateToken(fakeUserId);

      // Attempt to access Institution 1
      const orphanAccessRes = await request("/institution/dashboard?institutionId=1", {
        headers: { Authorization: `Bearer ${orphanToken}` },
      });

      assert(
        orphanAccessRes.status === 403,
        "User with global bank role but NO institution_users membership receives 403 Forbidden",
        `Got status ${orphanAccessRes.status}: ${JSON.stringify(orphanAccessRes.data)}`
      );
      assert(
        orphanAccessRes.data.message?.includes("No active institution membership"),
        "Error message correctly states no active institution membership associated with account",
        orphanAccessRes.data.message
      );
    } finally {
      // Clean up the temporary orphan user and its user_roles
      await db.query("DELETE FROM user_roles WHERE user_id = ?", [fakeUserId]);
      await db.query("DELETE FROM users WHERE id = ?", [fakeUserId]);
    }

    // -------------------------------------------------------------------------
    // TEST 5: Bank A staff cannot access Bank B resources
    // -------------------------------------------------------------------------
    console.log("\nTEST 5: Cross-Institution Access Isolation (Bank A vs Bank B)");
    // User 56 is BRAC Bank staff (Institution 1). Institution 2 is Dhaka Bank.
    const crossAccessDashboard = await request("/institution/dashboard?institutionId=2", {
      headers: { Authorization: `Bearer ${bankStaffToken}` },
    });
    assert(
      crossAccessDashboard.status === 403,
      "Bank A staff accessing Bank B dashboard receives 403 Forbidden",
      `Got status ${crossAccessDashboard.status}`
    );

    const crossAccessApplications = await request("/institution/applications?institutionId=2", {
      headers: { Authorization: `Bearer ${bankStaffToken}` },
    });
    assert(
      crossAccessApplications.status === 403,
      "Bank A staff accessing Bank B merchant applications receives 403 Forbidden",
      `Got status ${crossAccessApplications.status}`
    );

    // -------------------------------------------------------------------------
    // TEST 6: Multi-role account: Merchant who is also Bank Staff
    // -------------------------------------------------------------------------
    console.log("\nTEST 6: Multi-Role Account (Merchant + Bank Staff)");
    // User 1 is merchant@gmail.com. Let's temporarily give User 1 an active membership in Institution 1.
    const [existingMembership] = await db.query(
      "SELECT id FROM institution_users WHERE user_id = 1 AND institution_id = 1"
    );

    let tempMembershipId = null;
    if (!existingMembership.length) {
      const [insertMem] = await db.query(
        `INSERT INTO institution_users (institution_id, user_id, staff_name, role_id, membership_status, created_at, updated_at)
         VALUES (1, 1, 'Merchant Bank Officer', ?, 'active', NOW(), NOW())`,
        [bankAdminRoleId]
      );
      tempMembershipId = insertMem.insertId;
    }

    try {
      const multiRoleToken = generateToken(1);

      // Verify Auth /me endpoint returns both roles and memberships
      const meRes = await request("/auth/me", {
        headers: { Authorization: `Bearer ${multiRoleToken}` },
      });

      assert(
        meRes.status === 200 &&
          meRes.data.data.user.isMerchant === true &&
          Array.isArray(meRes.data.data.user.institutionMemberships) &&
          meRes.data.data.user.institutionMemberships.some((m) => m.institutionId === 1),
        "Auth /me correctly reports user as both Merchant and Bank Staff member",
        JSON.stringify(meRes.data.data.user)
      );

      // Verify Merchant API path works (/merchants/me)
      const merchantProfileRes = await request("/merchants/me", {
        headers: { Authorization: `Bearer ${multiRoleToken}` },
      });
      assert(
        merchantProfileRes.status === 200,
        "Multi-role user retains full access to Merchant endpoints (200 OK)",
        `Status ${merchantProfileRes.status}`
      );

      // Verify Institution API path works (/institution/dashboard?institutionId=1)
      const institutionDashRes = await request("/institution/dashboard?institutionId=1", {
        headers: { Authorization: `Bearer ${multiRoleToken}` },
      });
      assert(
        institutionDashRes.status === 200,
        "Multi-role user retains full access to Bank Institution endpoints (200 OK)",
        `Status ${institutionDashRes.status}`
      );
    } finally {
      if (tempMembershipId) {
        await db.query("DELETE FROM institution_users WHERE id = ?", [tempMembershipId]);
      }
    }

    // -------------------------------------------------------------------------
    // TEST 7: Suspended memberships are denied Bank access
    // -------------------------------------------------------------------------
    console.log("\nTEST 7: Suspended Membership Access Denial");
    // Temporarily create a suspended membership for User 7 (support agent) at Institution 1
    const [suspendedMemRes] = await db.query(
      `INSERT INTO institution_users (institution_id, user_id, staff_name, role_id, membership_status, created_at, updated_at)
       VALUES (1, 7, 'Suspended Officer', ?, 'suspended', NOW(), NOW())`,
      [bankAdminRoleId]
    );
    const suspendedMemId = suspendedMemRes.insertId;

    try {
      const suspendedToken = generateToken(7);
      const suspendedAccessRes = await request("/institution/dashboard?institutionId=1", {
        headers: { Authorization: `Bearer ${suspendedToken}` },
      });

      assert(
        suspendedAccessRes.status === 403,
        "User with suspended bank membership receives 403 Forbidden",
        `Got status ${suspendedAccessRes.status}: ${JSON.stringify(suspendedAccessRes.data)}`
      );
      assert(
        suspendedAccessRes.data.message?.includes("suspended"),
        "Error message correctly reports staff access is suspended",
        suspendedAccessRes.data.message
      );
    } finally {
      await db.query("DELETE FROM institution_users WHERE id = ?", [suspendedMemId]);
    }

    // -------------------------------------------------------------------------
    // TEST 8: Staff provisioning does not create global Bank role in user_roles
    // -------------------------------------------------------------------------
    console.log("\nTEST 8: Staff Provisioning Isolation (No global user_roles insertion)");
    const timestamp = Date.now();
    const testProvEmail = `test.provisioning.${timestamp}@banglaqr.com`;
    const testProvPhone = `017${Math.floor(10000000 + Math.random() * 90000000)}`;
    let provisionedUserId = null;
    let provisionedMembershipId = null;

    try {
      const adminActor = { id: 4, email: "superadmin@banglaqr.com", role: "super_admin" };

      // 1. Provision a brand new bank staff member
      const provResult = await adminInstitutionsService.provisionStaff(
        {
          institutionId: 1,
          name: "Automated Test Staff",
          email: testProvEmail,
          phone: testProvPhone,
          password: "TempPassword123!",
          roleName: "bank_reviewer",
        },
        adminActor
      );

      provisionedMembershipId = provResult.membershipId;
      provisionedUserId = provResult.userId;

      // Verify user was created in users
      const [uRows] = await db.query("SELECT id, email FROM users WHERE id = ?", [provisionedUserId]);
      assert(uRows.length === 1, "New staff user record created in users table");

      // Verify institution_users has membership
      const [iuRows] = await db.query(
        "SELECT id, institution_id, role_id, membership_status FROM institution_users WHERE id = ?",
        [provisionedMembershipId]
      );
      assert(
        iuRows.length === 1 && iuRows[0].institution_id === 1 && iuRows[0].membership_status === "active",
        "Institution membership correctly created in institution_users with active status"
      );

      // Verify user_roles has NO rows for this user (NO global bank role inserted)
      const [urRows] = await db.query("SELECT * FROM user_roles WHERE user_id = ?", [provisionedUserId]);
      assert(
        urRows.length === 0,
        "CRITICAL: No global Bank role was inserted into user_roles for newly provisioned staff",
        `user_roles count: ${urRows.length}`
      );

      // 2. Provision existing user (User 1 - Merchant) as bank staff
      const merchantBefore = await db.query("SELECT password_hash, email_verified_at FROM users WHERE id = 1");
      const merchantHashBefore = merchantBefore[0][0].password_hash;
      const merchantVerifiedBefore = merchantBefore[0][0].email_verified_at;

      const provExistingResult = await adminInstitutionsService.provisionStaff(
        {
          institutionId: 2, // Dhaka Bank
          name: "Existing Merchant Staff",
          email: "merchant@gmail.com",
          phone: "01700000001",
          password: "NewPasswordShouldBeIgnored123!",
          roleName: "bank_operations",
        },
        adminActor
      );

      // Verify existing merchant credentials and verification state were PRESERVED
      const merchantAfter = await db.query("SELECT password_hash, email_verified_at FROM users WHERE id = 1");
      const merchantHashAfter = merchantAfter[0][0].password_hash;
      const merchantVerifiedAfter = merchantAfter[0][0].email_verified_at;

      assert(
        merchantHashBefore === merchantHashAfter,
        "Existing merchant password was NOT modified or overwritten during Bank staff provisioning"
      );
      assert(
        merchantVerifiedBefore?.toString() === merchantVerifiedAfter?.toString(),
        "Existing merchant verification state was NOT modified"
      );

      // Verify user_roles still only has merchant role, no bank_operations role added
      const [mRoles] = await db.query(
        "SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = 1"
      );
      const mRoleNames = mRoles.map((r) => r.name);
      assert(
        mRoleNames.includes("merchant") && !mRoleNames.includes("bank_operations"),
        "user_roles for existing user retains merchant and did NOT acquire bank_operations",
        `Roles: ${mRoleNames.join(", ")}`
      );

      // Clean up the newly created membership for merchant at institution 2
      if (provExistingResult.membershipId) {
        await db.query("DELETE FROM institution_users WHERE id = ?", [provExistingResult.membershipId]);
      }
    } finally {
      if (provisionedMembershipId) {
        await db.query("DELETE FROM institution_users WHERE id = ?", [provisionedMembershipId]);
      }
      if (provisionedUserId) {
        await db.query("DELETE FROM user_roles WHERE user_id = ?", [provisionedUserId]);
        await db.query("DELETE FROM users WHERE id = ?", [provisionedUserId]);
      }
    }

    // -------------------------------------------------------------------------
    // TEST 9: Existing data remains intact and unchanged
    // -------------------------------------------------------------------------
    console.log("\nTEST 9: Database Data Integrity Verification");
    const [[finalInstCount]] = await db.query("SELECT COUNT(*) AS c FROM institutions");
    const [[finalBranchCount]] = await db.query("SELECT COUNT(*) AS c FROM institution_branches");
    const [[finalKycCount]] = await db.query("SELECT COUNT(*) AS c FROM merchant_kyc");
    const [[finalMerchantCount]] = await db.query("SELECT COUNT(*) AS c FROM merchants");

    assert(
      initialInstCount.c === finalInstCount.c,
      `Institutions count preserved (${initialInstCount.c} === ${finalInstCount.c})`
    );
    assert(
      initialBranchCount.c === finalBranchCount.c,
      `Branches count preserved (${initialBranchCount.c} === ${finalBranchCount.c})`
    );
    assert(
      initialKycCount.c === finalKycCount.c,
      `Merchant KYC count preserved (${initialKycCount.c} === ${finalKycCount.c})`
    );
    assert(
      initialMerchantCount.c === finalMerchantCount.c,
      `Merchants count preserved (${initialMerchantCount.c} === ${finalMerchantCount.c})`
    );

    // -------------------------------------------------------------------------
    // SUMMARY
    // -------------------------------------------------------------------------
    console.log("\n==========================================================================");
    console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log("==========================================================================\n");

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error("Test execution encountered an error:", err);
    process.exit(1);
  } finally {
    if (server) {
      server.close();
    }
    await db.end();
    process.exit(failed > 0 ? 1 : 0);
  }
}

runTestSuite();
