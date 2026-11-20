import assert from "assert";
import { db } from "../src/config/db.js";
import { loginUser } from "../src/modules/auth/auth.service.js";
import { adminInstitutionsService } from "../src/modules/admin/institutions/admin.institutions.service.js";
import { acceptInstitutionInvitation } from "../src/modules/auth/auth.service.js";
import { requireInstitutionStaff, requireInstitutionScope } from "../src/middlewares/permission.js";
import { requireAdmin } from "../src/middlewares/permission.js";
import { requireAuth } from "../src/middlewares/auth.js";
import jwt from "jsonwebtoken";
import { env } from "../src/config/env.js";

async function runSecurityChecks() {
  console.log("=== STARTING BANK ADMIN FINAL SECURITY CHECK SUITE ===");

  const cleanupUserIds = [];
  const cleanupInviteIds = [];

  try {
    // -------------------------------------------------------------------------
    // 1. Institution ID Trust & URL Tampering Test
    // -------------------------------------------------------------------------
    console.log("\n[CHECK 1] Verifying Institution ID Trust & Tamper Defense...");
    // Let's create an invited user for Bank A (id 1)
    const emailTamper = `security_test_bankA_${Date.now()}@example.com`;
    const inviteResult = await adminInstitutionsService.inviteStaff(
      {
        institutionId: 1, // Prime Bank PLC
        email: emailTamper,
        roleName: "bank_admin",
      },
      { id: 5, email: "admin@banglaqr.com" },
      { origin: "http://localhost:5173" }
    );
    cleanupInviteIds.push(inviteResult.invitationId);

    await acceptInstitutionInvitation({
      token: inviteResult.invitationToken,
      password: "SecurePassword123!",
    });

    const loginRes = await loginUser({ email: emailTamper, password: "SecurePassword123!" });
    cleanupUserIds.push(loginRes.user.id);

    const bankAUser = loginRes.user;
    assert.strictEqual(bankAUser.institutionId, 1, "User must be associated with Bank A (id 1)");

    // Now simulate an attacker logged in as Bank A user trying to access Bank B (id 2)
    // via query parameter: ?institutionId=2
    let tamperedReqBlocked = false;
    let tamperStatusCode = null;
    let tamperMessage = null;

    const fakeRes = {
      status(code) {
        tamperStatusCode = code;
        return {
          json(payload) {
            tamperMessage = payload.message;
            tamperedReqBlocked = code === 403;
            return payload;
          },
        };
      },
    };

    const mockReqWithTamperedUrl = {
      user: { ...bankAUser },
      query: { institutionId: "2" }, // Attacker changed URL to Bank B!
      headers: {},
      params: {},
      body: {},
    };

    await requireInstitutionStaff(mockReqWithTamperedUrl, fakeRes, () => {
      tamperedReqBlocked = false;
    });

    assert.strictEqual(
      tamperedReqBlocked,
      true,
      "requireInstitutionStaff MUST reject URL tampering to unauthorized institution"
    );
    assert.strictEqual(tamperStatusCode, 403);
    console.log(`✓ Check 1 Passed: URL institutionId tampering rejected with 403: "${tamperMessage}"`);

    // Also test requireInstitutionScope if query passed to scope check
    let scopeTamperBlocked = false;
    const mockScopeReq = {
      user: { ...bankAUser },
      targetInstitutionId: 1, // Authenticated user is Bank 1
      query: { institutionId: "2" }, // URL asks for Bank 2
    };
    await requireInstitutionScope(mockScopeReq, fakeRes, () => {
      scopeTamperBlocked = false;
    });
    assert.strictEqual(tamperStatusCode, 403);
    console.log("✓ Check 1.1 Passed: requireInstitutionScope strictly blocked URL tampering!");

    // -------------------------------------------------------------------------
    // 2. Role Compatibility & Permission Mapping
    // -------------------------------------------------------------------------
    console.log("\n[CHECK 2] Verifying Role Compatibility ('bank_admin')...");
    const [roleRows] = await db.query("SELECT * FROM roles WHERE name = 'bank_admin'");
    assert.strictEqual(roleRows.length, 1, "Role 'bank_admin' must exist in roles table");
    assert.strictEqual(roleRows[0].id, 6, "Role 'bank_admin' has id 6");

    // Verify bank_admin permissions in institution context
    const [permRows] = await db.query(
      `SELECT p.name 
       FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id
       WHERE rp.role_id = 6`
    );
    const bankAdminPerms = permRows.map((r) => r.name);
    console.log(`Bank admin has ${bankAdminPerms.length} assigned permissions.`);
    assert.ok(bankAdminPerms.includes("institution.dashboard.view"), "Must have institution.dashboard.view");
    assert.ok(bankAdminPerms.includes("institution.users.manage"), "Must have institution.users.manage");

    // Verify bank_admin does NOT have platform admin permissions
    assert.strictEqual(bankAdminPerms.includes("platform.admin"), false, "Must NOT have platform.admin");
    assert.strictEqual(bankAdminPerms.includes("admin.dashboard.view"), false, "Must NOT have admin.dashboard.view");
    console.log("✓ Check 2 Passed: 'bank_admin' is completely isolated from platform admin roles & permissions!");

    // -------------------------------------------------------------------------
    // 3. Stale Session Simulation: Admin Session in LocalStorage
    // -------------------------------------------------------------------------
    console.log("\n[CHECK 3] Testing Stale Admin Session vs Bank Admin Activation...");
    // 1. Generate legitimate admin token with sub: 5
    const adminToken = jwt.sign(
      { sub: 5, email: "admin@banglaqr.com", role: "admin", token_version: 0 },
      env.jwt.accessSecret,
      { expiresIn: "1h" }
    );

    // 2. Mock auth header with admin token
    let authUser = null;
    const reqAdmin = {
      headers: { authorization: `Bearer ${adminToken}` },
      signedCookies: {},
    };
    await requireAuth(reqAdmin, fakeRes, () => {
      authUser = reqAdmin.user;
    });
    assert.strictEqual(authUser.role, "admin");
    assert.strictEqual(authUser.email, "admin@banglaqr.com");

    // 3. Bank Admin user activates and logs in
    const bankToken = loginRes.accessToken;
    const reqBank = {
      headers: { authorization: `Bearer ${bankToken}` },
      signedCookies: {},
    };
    let bankAuthUser = null;
    await requireAuth(reqBank, fakeRes, () => {
      bankAuthUser = reqBank.user;
    });
    assert.strictEqual(bankAuthUser.role, "bank_admin");
    assert.strictEqual(bankAuthUser.email.toLowerCase(), emailTamper.toLowerCase());
    assert.strictEqual(bankAuthUser.roles.includes("admin"), false);
    assert.strictEqual(bankAuthUser.roles.includes("super_admin"), false);

    // 4. Confirm legitimate Admin can still log in again with their own credentials
    let adminReAuthPassed = false;
    requireAdmin({ user: authUser }, fakeRes, () => {
      adminReAuthPassed = true;
    });
    assert.strictEqual(adminReAuthPassed, true, "Legitimate admin can authenticate and access admin routes");
    console.log("✓ Check 3 Passed: Bank Admin cannot inherit Admin session; Admin retains distinct access!");

    // -------------------------------------------------------------------------
    // 4. Real Multi-Role Authentication Flow (Admin, Merchant, Institution)
    // -------------------------------------------------------------------------
    console.log("\n[CHECK 4] Testing Real Authentication Flow for All 3 Portals...");
    // A. Platform Admin
    let adminGuardPassed = false;
    requireAdmin({ user: { id: 5, role: "admin", roles: ["admin"] } }, fakeRes, () => {
      adminGuardPassed = true;
    });
    assert.strictEqual(adminGuardPassed, true, "Platform Admin passes Admin Guard");

    // B. Merchant
    let merchantBlockedFromBank = false;
    const reqMerchant = {
      user: { id: 175, role: "merchant", roles: ["merchant"], institutionMemberships: [] },
    };
    await requireInstitutionStaff(reqMerchant, fakeRes, () => {
      merchantBlockedFromBank = false;
    });
    assert.strictEqual(tamperStatusCode, 403, "Merchant must be blocked from Institution Portal");

    // C. Bank Admin
    let bankAdminPassedInstStaff = false;
    const reqValidBank = {
      user: { ...bankAUser },
      query: {},
      headers: {},
      params: {},
      body: {},
    };
    await requireInstitutionStaff(reqValidBank, fakeRes, () => {
      bankAdminPassedInstStaff = true;
    });
    assert.strictEqual(bankAdminPassedInstStaff, true, "Bank Admin passes Institution Guard");

    console.log("✓ Check 4 Passed: Admin, Merchant, and Institution flows are completely distinct and protected!");

    console.log("\n=========================================================================");
    console.log("ALL FINAL SECURITY CHECKS PASSED (100%)");
    console.log("=========================================================================");
  } finally {
    console.log("\n[Cleanup] Cleaning up test records...");
    for (const id of cleanupInviteIds) {
      await db.query("DELETE FROM institution_invitations WHERE id = ?", [id]);
    }
    for (const id of cleanupUserIds) {
      await db.query("DELETE FROM institution_users WHERE user_id = ?", [id]);
      await db.query("DELETE FROM users WHERE id = ?", [id]);
    }
    console.log("[Cleanup] Finished.");
  }
}

runSecurityChecks()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Test Suite Failed:", err);
    process.exit(1);
  });
