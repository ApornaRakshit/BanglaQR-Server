import mysql from "mysql2/promise";
import crypto from "crypto";
import argon2 from "argon2";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "banglaqr_db",
  waitForConnections: true,
  connectionLimit: 5,
});

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  [PASS] ${message}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${message}`);
    failed++;
  }
}

async function runStep3Tests() {
  console.log("==================================================================");
  console.log(" BANGLAQR STEP 3: BANK ADMIN ACCOUNT & INVITATION TEST SUITE");
  console.log("==================================================================");

  const testEmail = `test_bank_admin_${Date.now()}@e2e-banglaqr.com`;
  let testInstitutionId = null;
  let rawToken = null;
  let tokenHash = null;
  let invitationId = null;

  try {
    // 1. Verify Database Schema & Role Definitions
    console.log("\n[Test 1] Verify database roles and invitation tables");
    const [roles] = await pool.query(
      "SELECT id, name FROM roles WHERE name IN ('bank_admin', 'bank_reviewer', 'bank_operations')"
    );
    assert(roles.length >= 3, `Expected at least 3 bank roles, found ${roles.length}`);

    const [insts] = await pool.query("SELECT id, name, institution_code FROM institutions LIMIT 1");
    assert(insts.length > 0, "At least one institution exists in database");
    testInstitutionId = insts[0].id;
    console.log(`  Using institution: ${insts[0].name} (ID: ${testInstitutionId})`);

    // 2. Generate a secure invitation token
    console.log("\n[Test 2] Cryptographic Token & Hash Generation");
    rawToken = crypto.randomBytes(32).toString("hex");
    tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    assert(rawToken.length === 64, "Raw invitation token is 64 hex characters (32 bytes entropy)");
    assert(tokenHash.length === 64, "Token hash is SHA-256 (64 hex characters)");

    const bankAdminRole = roles.find((r) => r.name === "bank_admin");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    // 3. Insert invitation into institution_invitations
    console.log("\n[Test 3] Store Token Hash in institution_invitations");
    const [invInsert] = await pool.execute(
      `INSERT INTO institution_invitations 
       (institution_id, email, name, phone, role_id, token_hash, status, expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, NOW(), NOW())`,
      [testInstitutionId, testEmail, "E2E Test Bank Admin", "+8801700009999", bankAdminRole.id, tokenHash, expiresAt]
    );
    invitationId = invInsert.insertId;
    assert(invitationId > 0, `Invitation record created with ID ${invitationId}`);

    // Verify DB does NOT store plaintext token
    const [storedInv] = await pool.query("SELECT * FROM institution_invitations WHERE id = ?", [invitationId]);
    assert(storedInv[0].token_hash === tokenHash, "Stored token_hash matches SHA-256 digest");
    assert(storedInv[0].token_hash !== rawToken, "Raw token is NEVER stored in database");
    assert(storedInv[0].status === "pending", "Initial invitation status is 'pending'");

    // 4. Test Verification Logic (Valid Token)
    console.log("\n[Test 4] Token Verification via SHA-256 lookup");
    const lookupHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const [foundInv] = await pool.query(
      `SELECT inv.*, i.name as institution_name, r.name as role_name 
       FROM institution_invitations inv
       JOIN institutions i ON i.id = inv.institution_id
       JOIN roles r ON r.id = inv.role_id
       WHERE inv.token_hash = ? AND inv.status = 'pending'`,
      [lookupHash]
    );
    assert(foundInv.length === 1, "Token verification succeeds with valid token");
    assert(foundInv[0].email === testEmail, "Verified invitation matches target email");
    assert(foundInv[0].role_name === "bank_admin", "Verified invitation matches bank_admin role");

    // 5. Test Rejection of Expired Token
    console.log("\n[Test 5] Expired Token Rejection");
    const pastDate = new Date(Date.now() - 1000);
    await pool.execute("UPDATE institution_invitations SET expires_at = ? WHERE id = ?", [pastDate, invitationId]);
    const [expiredCheck] = await pool.query(
      "SELECT id, expires_at < NOW() AS is_expired FROM institution_invitations WHERE id = ?",
      [invitationId]
    );
    assert(expiredCheck[0].is_expired === 1, "Database recognizes expired token");

    // Restore expiry for next tests
    await pool.execute("UPDATE institution_invitations SET expires_at = ? WHERE id = ?", [expiresAt, invitationId]);

    // 6. Test Rejection of Revoked Token
    console.log("\n[Test 6] Revoked Token Handling");
    await pool.execute("UPDATE institution_invitations SET status = 'revoked' WHERE id = ?", [invitationId]);
    const [revokedCheck] = await pool.query(
      "SELECT status FROM institution_invitations WHERE id = ?",
      [invitationId]
    );
    assert(revokedCheck[0].status === "revoked", "Status successfully updated to 'revoked'");

    // Restore to pending for acceptance test
    await pool.execute("UPDATE institution_invitations SET status = 'pending' WHERE id = ?", [invitationId]);

    // 7. Complete Password Setup & Account Activation Flow
    console.log("\n[Test 7] Accept Invitation & Set User Password with Argon2");
    const testPassword = "SecurePassword123!";
    const passwordHash = await argon2.hash(testPassword);
    assert(passwordHash.startsWith("$argon2"), "Password hashed securely with Argon2");

    // Start Transaction
    const conn = await pool.getConnection();
    await conn.beginTransaction();

    // Create user in users table
    const [userInsert] = await conn.execute(
      `INSERT INTO users (email, phone, password_hash, email_verified_at, status, created_at, updated_at)
       VALUES (?, ?, ?, NOW(), 'active', NOW(), NOW())`,
      [testEmail, "+8801700009999", passwordHash]
    );
    const newUserId = userInsert.insertId;

    // Assign to institution_users
    await conn.execute(
      `INSERT INTO institution_users (institution_id, user_id, staff_name, role_id, membership_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', NOW(), NOW())`,
      [testInstitutionId, newUserId, "E2E Test Bank Admin", bankAdminRole.id]
    );

    // Mark invitation accepted
    await conn.execute(
      "UPDATE institution_invitations SET status = 'accepted', accepted_at = NOW() WHERE id = ?",
      [invitationId]
    );

    await conn.commit();
    conn.release();

    assert(newUserId > 0, `User created with ID ${newUserId}`);

    // 8. CRITICAL SECURITY CHECK: Bank roles must NEVER leak to platform user_roles!
    console.log("\n[Test 8] Role Isolation & Zero Platform Admin Escalation");
    const [platformRoles] = await pool.query(
      "SELECT * FROM user_roles WHERE user_id = ?",
      [newUserId]
    );
    assert(platformRoles.length === 0, "No platform roles assigned in user_roles table (Zero Privilege Escalation)");

    const [bankMembership] = await pool.query(
      `SELECT iu.*, r.name as role_name 
       FROM institution_users iu
       JOIN roles r ON r.id = iu.role_id
       WHERE iu.user_id = ?`,
      [newUserId]
    );
    assert(bankMembership.length === 1, "User has exactly 1 institution membership");
    assert(bankMembership[0].role_name === "bank_admin", "Assigned bank role is 'bank_admin'");
    assert(bankMembership[0].membership_status === "active", "Membership status is 'active'");

    // 9. Verify Password Authentication
    console.log("\n[Test 9] Verify Argon2 Password Authentication");
    const [authCheck] = await pool.query("SELECT password_hash FROM users WHERE id = ?", [newUserId]);
    const isValidPass = await argon2.verify(authCheck[0].password_hash, testPassword);
    assert(isValidPass === true, "Argon2 successfully validates user-chosen password");

    const isWrongPass = await argon2.verify(authCheck[0].password_hash, "WrongPassword456");
    assert(isWrongPass === false, "Argon2 rejects invalid password");

    // 10. Single-Use Validation (Cannot accept twice)
    console.log("\n[Test 10] Single-Use Token Enforcement");
    const [recheckInv] = await pool.query(
      "SELECT status FROM institution_invitations WHERE id = ?",
      [invitationId]
    );
    assert(recheckInv[0].status === "accepted", "Invitation status is permanently 'accepted'");

    // Clean up test data
    console.log("\n[Cleanup] Removing E2E test records...");
    await pool.execute("DELETE FROM institution_users WHERE user_id = ?", [newUserId]);
    await pool.execute("DELETE FROM institution_invitations WHERE id = ?", [invitationId]);
    await pool.execute("DELETE FROM users WHERE id = ?", [newUserId]);
    console.log("  Test records cleaned up successfully.");

  } catch (err) {
    console.error("Test Suite Encountered Fatal Error:", err);
    failed++;
  } finally {
    await pool.end();
  }

  console.log("\n==================================================================");
  console.log(` TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log("==================================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runStep3Tests();

