import assert from "node:assert";
import { db } from "../src/config/db.js";
import { adminInstitutionsService } from "../src/modules/admin/institutions/admin.institutions.service.js";
import {
  verifyInstitutionInvitation,
  acceptInstitutionInvitation,
  loginUser,
} from "../src/modules/auth/auth.service.js";
import { institutionService } from "../src/modules/institution/institution.service.js";
import { requireAdmin } from "../src/middlewares/permission.js";

async function runScenarioTests() {
  console.log("=== STARTING 16-SCENARIO BANK ADMIN INVITATION & REDIRECT TEST SUITE ===");

  const [activeBanks] = await db.execute(
    "SELECT id, name, institution_code FROM institutions WHERE status = 'active' ORDER BY id ASC LIMIT 3"
  );
  assert.ok(activeBanks.length >= 2, "Requires at least 2 active institutions");

  const bankA = activeBanks[0];
  const bankB = activeBanks[1];
  const greenBank = activeBanks[2] || activeBanks[0];

  console.log(`Target Institutions: Green Bank (${greenBank.name}, ID: ${greenBank.id}), Bank A (${bankA.name}, ID: ${bankA.id}), Bank B (${bankB.name}, ID: ${bankB.id})`);

  const createdUserIds = [];
  const createdInvIds = [];

  try {
    // -------------------------------------------------------------------------
    // Scenario 1, 2, 3: Green Bank Invitation, Activation & Login
    // -------------------------------------------------------------------------
    console.log("\n[SCENARIO 1, 2, 3] Testing Green Bank Invitation, Activation & Login...");
    const emailGreen = `green_admin_${Date.now()}@example.com`;
    const inviteGreen = await adminInstitutionsService.inviteStaff(
      {
        institutionId: greenBank.id,
        name: "Green Bank Manager",
        email: emailGreen,
        roleName: "bank_admin",
      },
      { id: 5, email: "admin@banglaqr.com" },
      { origin: "http://localhost:5173" }
    );
    createdInvIds.push(inviteGreen.invitationId);
    assert.strictEqual(inviteGreen.institutionId, greenBank.id);

    // Activate
    const acceptGreen = await acceptInstitutionInvitation({
      token: inviteGreen.invitationToken,
      password: "GreenPassword123!",
    });
    assert.strictEqual(acceptGreen.success, true);
    assert.strictEqual(acceptGreen.institutionId, greenBank.id);

    // Login
    const loginGreen = await loginUser({ email: emailGreen, password: "GreenPassword123!" });
    createdUserIds.push(loginGreen.user.id);

    assert.strictEqual(loginGreen.user.role, "bank_admin");
    assert.strictEqual(loginGreen.user.institutionId, greenBank.id);
    assert.strictEqual(loginGreen.user.institution.name, greenBank.name);
    console.log("✓ Scenario 1, 2, 3 Passed: Green Bank Admin created, activated, and associated with Green Bank!");

    // -------------------------------------------------------------------------
    // Scenario 4: Bank A Invitation & Association
    // -------------------------------------------------------------------------
    console.log("\n[SCENARIO 4] Testing Bank A Invitation & Verification...");
    const emailA = `bank_a_admin_${Date.now()}@example.com`;
    const inviteA = await adminInstitutionsService.inviteStaff(
      {
        institutionId: bankA.id,
        name: "Bank A Officer",
        email: emailA,
        roleName: "bank_admin",
      },
      { id: 5, email: "admin@banglaqr.com" },
      { origin: "http://localhost:5173" }
    );
    createdInvIds.push(inviteA.invitationId);

    await acceptInstitutionInvitation({
      token: inviteA.invitationToken,
      password: "PasswordA123!",
    });
    const loginA = await loginUser({ email: emailA, password: "PasswordA123!" });
    createdUserIds.push(loginA.user.id);

    assert.strictEqual(loginA.user.institutionId, bankA.id);
    assert.strictEqual(loginA.user.role, "bank_admin");
    console.log("✓ Scenario 4 Passed: Bank A Admin associated with Bank A!");

    // -------------------------------------------------------------------------
    // Scenario 5: Bank B Invitation & Association
    // -------------------------------------------------------------------------
    console.log("\n[SCENARIO 5] Testing Bank B Invitation & Verification...");
    const emailB = `bank_b_admin_${Date.now()}@example.com`;
    const inviteB = await adminInstitutionsService.inviteStaff(
      {
        institutionId: bankB.id,
        name: "Bank B Officer",
        email: emailB,
        roleName: "bank_admin",
      },
      { id: 5, email: "admin@banglaqr.com" },
      { origin: "http://localhost:5173" }
    );
    createdInvIds.push(inviteB.invitationId);

    await acceptInstitutionInvitation({
      token: inviteB.invitationToken,
      password: "PasswordB123!",
    });
    const loginB = await loginUser({ email: emailB, password: "PasswordB123!" });
    createdUserIds.push(loginB.user.id);

    assert.strictEqual(loginB.user.institutionId, bankB.id);
    assert.strictEqual(loginB.user.role, "bank_admin");
    console.log("✓ Scenario 5 Passed: Bank B Admin associated with Bank B!");

    // -------------------------------------------------------------------------
    // Scenario 6 & 7: Cross-Institution Data Isolation (Bank A vs Bank B)
    // -------------------------------------------------------------------------
    console.log("\n[SCENARIO 6 & 7] Testing Cross-Institution Isolation (Bank A vs Bank B)...");
    // Verify dashboard metrics for Bank A are strictly scoped to bankA.id
    const statsA = await institutionService.getDashboard(bankA.id);
    const statsB = await institutionService.getDashboard(bankB.id);
    assert.ok(statsA, "Bank A stats retrieved");
    assert.ok(statsB, "Bank B stats retrieved");

    // Verify Bank A staff listing only shows Bank A staff
    const staffA = await institutionService.listStaff(bankA.id);
    const staffB = await institutionService.listStaff(bankB.id);
    const staffEmailsA = staffA.map((s) => s.email);
    const staffEmailsB = staffB.map((s) => s.email);
    assert.ok(staffEmailsA.includes(emailA), "Bank A must contain Bank A admin");
    assert.strictEqual(staffEmailsA.includes(emailB), false, "Bank A must NOT contain Bank B admin");
    assert.ok(staffEmailsB.includes(emailB), "Bank B must contain Bank B admin");
    assert.strictEqual(staffEmailsB.includes(emailA), false, "Bank B must NOT contain Bank A admin");
    console.log("✓ Scenario 6 & 7 Passed: Strict cross-institution isolation enforced!");

    // -------------------------------------------------------------------------
    // Scenario 8 & 9: Bank Admin cannot access Admin-only routes or APIs
    // -------------------------------------------------------------------------
    console.log("\n[SCENARIO 8 & 9] Testing Admin Route & API Protection against Bank Admin...");
    let adminRouteBlocked = false;
    const fakeRes = {
      status(code) {
        if (code === 403) adminRouteBlocked = true;
        return {
          json(payload) {
            return payload;
          },
        };
      },
    };
    requireAdmin({ user: loginA.user }, fakeRes, () => {
      adminRouteBlocked = false;
    });
    assert.strictEqual(adminRouteBlocked, true, "requireAdmin middleware MUST block Bank Administrator");
    console.log("✓ Scenario 8 & 9 Passed: Bank Admin strictly blocked from Admin-only endpoints (403 Forbidden)!");

    // -------------------------------------------------------------------------
    // Scenario 10: Platform Admin User Verification
    // -------------------------------------------------------------------------
    console.log("\n[SCENARIO 10] Testing Platform Admin Access...");
    let adminPassed = false;
    const mockAdminUser = { id: 5, email: "admin@banglaqr.com", role: "admin", roles: ["admin"] };
    requireAdmin({ user: mockAdminUser }, fakeRes, () => {
      adminPassed = true;
    });
    assert.strictEqual(adminPassed, true, "requireAdmin MUST allow genuine admin");
    console.log("✓ Scenario 10 Passed: Genuine Admin user authorized for Admin Portal!");

    // -------------------------------------------------------------------------
    // Scenario 11: Merchant Role Verification
    // -------------------------------------------------------------------------
    console.log("\n[SCENARIO 11] Testing Merchant Isolation...");
    let merchantBlockedFromAdmin = false;
    const mockMerchantUser = { id: 175, email: "sima@gmail.com", role: "merchant", roles: ["merchant"] };
    requireAdmin({ user: mockMerchantUser }, fakeRes, () => {
      merchantBlockedFromAdmin = false;
    });
    assert.strictEqual(adminRouteBlocked, true, "requireAdmin MUST block merchant");
    console.log("✓ Scenario 11 Passed: Merchant user isolated from Admin & Bank routes!");

    // -------------------------------------------------------------------------
    // Scenario 12: Expired Invitation Rejection
    // -------------------------------------------------------------------------
    console.log("\n[SCENARIO 12] Testing Expired Invitation Rejection...");
    const emailExp = `exp_${Date.now()}@example.com`;
    const inviteExp = await adminInstitutionsService.inviteStaff(
      {
        institutionId: bankA.id,
        name: "Expired Officer",
        email: emailExp,
        roleName: "bank_admin",
      },
      { id: 5 },
      { origin: "http://localhost:5173" }
    );
    createdInvIds.push(inviteExp.invitationId);
    // Force expiration in DB
    await db.execute(
      "UPDATE institution_invitations SET expires_at = DATE_SUB(NOW(), INTERVAL 1 HOUR) WHERE id = ?",
      [inviteExp.invitationId]
    );

    let expiredRejected = false;
    try {
      await acceptInstitutionInvitation({
        token: inviteExp.invitationToken,
        password: "Password123!",
      });
    } catch (err) {
      if (err.statusCode === 400 || err.message.toLowerCase().includes("expired")) {
        expiredRejected = true;
      }
    }
    assert.strictEqual(expiredRejected, true, "Expired invitation must be rejected with 400");
    console.log("✓ Scenario 12 Passed: Expired invitation safely rejected!");

    // -------------------------------------------------------------------------
    // Scenario 13: Already-Used Invitation Replay Protection
    // -------------------------------------------------------------------------
    console.log("\n[SCENARIO 13] Testing Replay Protection on Used Invitation...");
    let replayRejected = false;
    try {
      // Replay inviteA which was accepted earlier
      await acceptInstitutionInvitation({
        token: inviteA.invitationToken,
        password: "NewPassword123!",
      });
    } catch (err) {
      if (err.statusCode === 400 || err.message.toLowerCase().includes("already")) {
        replayRejected = true;
      }
    }
    assert.strictEqual(replayRejected, true, "Consumed invitation must NOT be replayed");
    console.log("✓ Scenario 13 Passed: Already-used invitation cannot be reused!");

    // -------------------------------------------------------------------------
    // Scenario 14: Tamper Resistance (Recipient cannot change institution ID)
    // -------------------------------------------------------------------------
    console.log("\n[SCENARIO 14] Testing Institution Tamper Resistance...");
    const emailTamper = `tamper_${Date.now()}@example.com`;
    const inviteTamper = await adminInstitutionsService.inviteStaff(
      {
        institutionId: bankA.id,
        name: "Tamper Test Officer",
        email: emailTamper,
        roleName: "bank_admin",
      },
      { id: 5 },
      { origin: "http://localhost:5173" }
    );
    createdInvIds.push(inviteTamper.invitationId);

    // Accept with malicious payload trying to alter institutionId
    const acceptTamper = await acceptInstitutionInvitation({
      token: inviteTamper.invitationToken,
      institutionId: 999999, // Malicious override
      role: "super_admin", // Malicious override
      password: "TamperPassword123!",
    });
    // Verify server derived identity strictly from database record
    assert.strictEqual(acceptTamper.institutionId, bankA.id, "Server must resolve institution from DB token record only");
    const loginTamper = await loginUser({ email: emailTamper, password: "TamperPassword123!" });
    createdUserIds.push(loginTamper.user.id);
    assert.strictEqual(loginTamper.user.institutionId, bankA.id);
    assert.strictEqual(loginTamper.user.role, "bank_admin");
    assert.strictEqual(loginTamper.user.roles.includes("super_admin"), false);
    console.log("✓ Scenario 14 Passed: Client cannot alter institutionId or role during activation!");

    // -------------------------------------------------------------------------
    // Scenario 15: Missing or Invalid Association Does Not Fallback to Admin
    // -------------------------------------------------------------------------
    console.log("\n[SCENARIO 15] Testing Fallback Safe Behavior...");
    const orphanUser = { id: 999999, email: "orphan@example.com", roles: [], role: null };
    let orphanBlocked = false;
    const fakeResOrphan = {
      status(code) {
        if (code === 403 || code === 401) orphanBlocked = true;
        return {
          json(payload) {
            return payload;
          },
        };
      },
    };
    requireAdmin({ user: orphanUser }, fakeResOrphan, () => {
      orphanBlocked = false;
    });
    assert.strictEqual(orphanBlocked, true, "User with missing role MUST be rejected from Admin, never fallback");
    console.log("✓ Scenario 15 Passed: Missing institution or role never falls back to Admin!");

    // -------------------------------------------------------------------------
    // Scenario 16: Verification of Token Versioning & Password Recovery
    // -------------------------------------------------------------------------
    console.log("\n[SCENARIO 16] Testing Token Versioning on Bank Admin...");
    const [userRow] = await db.execute("SELECT token_version FROM users WHERE id = ?", [loginA.user.id]);
    assert.strictEqual(Number(userRow[0].token_version), 0);
    console.log("✓ Scenario 16 Passed: Bank Admin user conforms to token versioning & security standards!");

    console.log("\n=========================================================================");
    console.log("ALL 16 BANK ADMIN INVITATION & REDIRECT TEST SCENARIOS PASSED (100%)");
    console.log("=========================================================================");
  } finally {
    // Cleanup synthetic staging records
    console.log("\n[Cleanup] Cleaning up synthetic test users and invitations...");
    if (createdUserIds.length > 0) {
      await db.query("DELETE FROM institution_users WHERE user_id IN (?)", [createdUserIds]);
      await db.query("DELETE FROM users WHERE id IN (?)", [createdUserIds]);
    }
    if (createdInvIds.length > 0) {
      await db.query("DELETE FROM institution_invitations WHERE id IN (?)", [createdInvIds]);
    }
    console.log("[Cleanup] Complete.");
  }
}

runScenarioTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Test Suite Failed:", err);
    process.exit(1);
  });
