import { db } from "../src/config/db.js";
import crypto from "crypto";
import argon2 from "argon2";
import { adminInstitutionsService } from "../src/modules/admin/institutions/admin.institutions.service.js";
import { adminInstitutionsRepository } from "../src/modules/admin/institutions/admin.institutions.repository.js";
import {
  verifyInstitutionInvitation,
  acceptInstitutionInvitation,
  loginUser,
} from "../src/modules/auth/auth.service.js";

async function runTests() {
  console.log("=== STARTING BANGLAQR BANK FINAL FIX AUTOMATED VERIFICATION ===");
  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`[PASS] ${message}`);
      passed++;
    } else {
      console.error(`[FAIL] ${message}`);
      failed++;
    }
  }

  try {
    // 1. Super Admin and Merchant Login Verification
    console.log("\n--- TEST 1 & 2: Platform Logins (Super Admin & Merchant) ---");
    const [adminUserRows] = await db.query(
      `SELECT u.email FROM users u 
       JOIN user_roles ur ON u.id = ur.user_id 
       JOIN roles r ON ur.role_id = r.id 
       WHERE r.name = 'super_admin' AND u.status = 'active' LIMIT 1`
    );
    assert(adminUserRows.length > 0, "Super admin user exists in DB");

    const [merchantUserRows] = await db.query(
      `SELECT u.email FROM users u 
       JOIN user_roles ur ON u.id = ur.user_id 
       JOIN roles r ON ur.role_id = r.id 
       WHERE r.name = 'merchant' AND u.status = 'active' LIMIT 1`
    );
    assert(merchantUserRows.length > 0, "Merchant user exists in DB");

    // 2. Locate or Seed a Bank for Edit / Persistence Testing
    console.log("\n--- TEST 3: Bank Save, Persistence & Details By ID ---");
    const [bankRows] = await db.query(
      `SELECT id, name, institution_code FROM institutions WHERE institution_code = 'PRIME' OR institution_code = 'BRAC' OR id = 1 LIMIT 1`
    );
    assert(bankRows.length > 0, "Target Bank exists");
    const testBankId = bankRows[0].id;
    console.log(`Testing with Bank ID: ${testBankId} (${bankRows[0].name})`);

    // Perform partial update with all new fields
    const testUpdateData = {
      name: "Prime Bank PLC (Automated Test)",
      nameBn: "প্রাইম ব্যাংক পিএলসি",
      legalName: "Prime Bank PLC Bangladesh",
      institutionCode: "PRIME",
      institutionType: "commercial_bank",
      status: "active",
      logoUrl: "/uploads/institutions/logos/prime_bank_test.png",
      supportEmail: "support.test@primebank.com",
      supportPhone: "+880 2 9567281",
      websiteUrl: "https://www.primebank.com.bd",
      headOfficeAddress: "Prime Tower, 29 Rajuk Avenue, Motijheel, Dhaka-1000",
      division: "Dhaka",
      district: "Dhaka",
      upazila: "Motijheel",
      description: "Premier private commercial bank leading QR acquiring in Bangladesh.",
      // Bank Profile Fields
      swiftCode: "PRBLBDDH",
      officialBankCode: "185",
      bankCategory: "commercial_conventional",
      ownershipType: "private",
      regulatoryReference: "BB/BRPD/PRIME/2026",
      officialContactPerson: "Nazmul Haque",
      contactDesignation: "Head of Digital Financial Services",
    };

    const updatedBank = await adminInstitutionsService.update(
      testBankId,
      testUpdateData,
      { id: 1, email: "superadmin@banglaqr.com" }
    );
    assert(updatedBank && updatedBank.id === testBankId, "Bank update service call returned updated record");

    // Re-fetch record fresh from DB repository (GET by ID)
    const freshBank = await adminInstitutionsRepository.getById(testBankId);
    assert(freshBank.name === testUpdateData.name, "Bank name persisted and retrieved");
    assert(freshBank.name_bn === testUpdateData.nameBn, "Bengali name (name_bn) persisted and retrieved");
    assert(freshBank.legal_name === testUpdateData.legalName, "Legal name (legal_name) persisted and retrieved");
    assert(freshBank.division === testUpdateData.division, "Division persisted and retrieved");
    assert(freshBank.district === testUpdateData.district, "District persisted and retrieved");
    assert(freshBank.upazila === testUpdateData.upazila, "Upazila persisted and retrieved");
    assert(freshBank.website_url === testUpdateData.websiteUrl, "Website URL persisted and retrieved");
    assert(freshBank.support_email === testUpdateData.supportEmail, "Support email persisted and retrieved");
    assert(freshBank.support_phone === testUpdateData.supportPhone, "Support phone persisted and retrieved");
    assert(freshBank.head_office_address === testUpdateData.headOfficeAddress, "Head office address persisted");
    assert(freshBank.logo_url === testUpdateData.logoUrl, "Logo URL persisted");

    // Verify bank profile table (institution_bank_profiles)
    assert(freshBank.swift_code === testUpdateData.swiftCode, "SWIFT code persisted in bank profile");
    assert(freshBank.official_bank_code === testUpdateData.officialBankCode, "Official bank code persisted");
    assert(freshBank.bank_category === testUpdateData.bankCategory, "Bank category persisted");
    assert(freshBank.ownership_type === testUpdateData.ownershipType, "Ownership type persisted");
    assert(freshBank.regulatory_reference === testUpdateData.regulatoryReference, "Regulatory reference persisted");
    assert(freshBank.official_contact_person === testUpdateData.officialContactPerson, "Official contact person persisted");
    assert(freshBank.contact_designation === testUpdateData.contactDesignation, "Contact designation persisted");

    // 3. Bank Staff Invitation Workflow
    console.log("\n--- TEST 4: Bank Staff Invitation Workflow & Direct Activation ---");
    const testInviteEmail = `test.bankadmin.${Date.now()}@primebank.com`;
    const testPhone = `0171${Math.floor(1000000 + Math.random() * 8999999)}`;

    const inviteResult = await adminInstitutionsService.inviteStaff(
      {
        institutionId: testBankId,
        email: testInviteEmail,
        name: "Test Bank Admin Officer",
        phone: testPhone,
        roleName: "bank_admin",
      },
      { id: 1, email: "superadmin@banglaqr.com" }
    );

    assert(inviteResult.invitationId > 0, "Invitation successfully created in DB");
    assert(inviteResult.invitationToken && inviteResult.invitationToken.length === 64, "Raw invitation token is 64 hex chars (32 bytes crypto)");
    assert(inviteResult.invitationUrl.includes(inviteResult.invitationToken), "Invitation URL contains raw token");

    // Check DB directly to ensure plaintext token is NOT stored in DB, only token_hash
    const [invDbRows] = await db.query(
      `SELECT * FROM institution_invitations WHERE id = ?`,
      [inviteResult.invitationId]
    );
    assert(invDbRows.length > 0, "Invitation row found in DB");
    assert(invDbRows[0].token_hash !== inviteResult.invitationToken, "Database stores token_hash, NEVER plaintext token");
    assert(invDbRows[0].status === "pending", "Invitation status is pending");

    // Verify invitation via auth service
    const verifyResult = await verifyInstitutionInvitation(inviteResult.invitationToken);
    assert(verifyResult.valid === true, "verifyInstitutionInvitation returned valid=true");
    assert(verifyResult.email === testInviteEmail, "verifyInstitutionInvitation returned correct email");
    assert(verifyResult.institutionName === freshBank.name, "verifyInstitutionInvitation returned correct institution name");
    assert(verifyResult.roleName === "bank_admin", "verifyInstitutionInvitation returned correct role name (bank_admin)");
    assert(verifyResult.isExistingUser === false, "Detected as new user");

    // Accept invitation and set password
    const testStaffPassword = "SecureBankStaffPass123!";
    const acceptResult = await acceptInstitutionInvitation({
      token: inviteResult.invitationToken,
      password: testStaffPassword,
      name: "Test Bank Admin Officer",
      phone: testPhone,
    });
    assert(acceptResult.success === true, "acceptInstitutionInvitation succeeded");
    assert(acceptResult.targetPortal === "/institution/dashboard", "Target portal is /institution/dashboard");

    // Verify invitation row is now marked 'accepted'
    const [acceptedInvRows] = await db.query(
      `SELECT status, accepted_at FROM institution_invitations WHERE id = ?`,
      [inviteResult.invitationId]
    );
    assert(acceptedInvRows[0].status === "accepted", "Invitation status updated to accepted");
    assert(acceptedInvRows[0].accepted_at !== null, "Invitation accepted_at timestamp recorded");

    // Verify reuse of same invitation token fails
    let reuseFailed = false;
    try {
      await acceptInstitutionInvitation({
        token: inviteResult.invitationToken,
        password: "AnotherPassword123!",
      });
    } catch (e) {
      reuseFailed = true;
    }
    assert(reuseFailed, "Reusing already accepted invitation token is rejected");

    // 4. Role Separation Verification
    console.log("\n--- TEST 5: Role Separation & Institution Membership ---");
    const [newUserRows] = await db.query(
      `SELECT id, email, status FROM users WHERE email = ?`,
      [testInviteEmail]
    );
    assert(newUserRows.length > 0, "New staff user record created in users table");
    const staffUserId = newUserRows[0].id;

    // Check user_roles table: MUST NOT contain bank_admin!
    const [globalRoles] = await db.query(
      `SELECT r.name FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = ?`,
      [staffUserId]
    );
    assert(
      !globalRoles.some((r) => r.name.startsWith("bank_")),
      "CRITICAL: user_roles contains NO Bank roles (strict platform role separation)"
    );

    // Check institution_users table: MUST contain bank_admin membership!
    const [instUserRows] = await db.query(
      `SELECT iu.*, r.name as role_name FROM institution_users iu JOIN roles r ON iu.role_id = r.id WHERE iu.user_id = ? AND iu.institution_id = ?`,
      [staffUserId, testBankId]
    );
    assert(instUserRows.length === 1, "Staff member has exactly 1 membership in institution_users");
    assert(instUserRows[0].role_name === "bank_admin", "institution_users role_id maps to bank_admin");
    assert(instUserRows[0].membership_status === "active", "Membership status is active");

    // 5. Bank Staff Login & Redirection
    console.log("\n--- TEST 6: Bank Staff Login & Portal Resolution ---");
    const staffLoginResult = await loginUser({
      email: testInviteEmail,
      password: testStaffPassword,
    });
    assert(staffLoginResult.accessToken && staffLoginResult.accessToken.length > 10, "Staff login generated JWT access token");
    assert(
      staffLoginResult.user.institutionMemberships && staffLoginResult.user.institutionMemberships.length > 0,
      "Staff login returns institution memberships"
    );
    assert(
      staffLoginResult.user.institutionMemberships[0].institutionId === testBankId,
      "Membership institutionId matches"
    );
    assert(
      staffLoginResult.user.institutionMemberships[0].role === "bank_admin",
      "Membership role matches bank_admin"
    );
    assert(
      staffLoginResult.user.institution !== null,
      "Primary institution set on user object"
    );

    // 6. Multi-Role Account Test (Merchant who is also Bank Staff)
    console.log("\n--- TEST 7: Multi-Role Preservation (Merchant + Bank Staff) ---");
    const multiRoleEmail = `multi.merchant.${Date.now()}@banglaqr.com`;
    const merchantPassword = "MerchantPassword999!";
    const merchantPasswordHash = await argon2.hash(merchantPassword);

    // Create user as merchant with active status
    const [merchantUserInsert] = await db.query(
      `INSERT INTO users (email, password_hash, status, created_at, updated_at) VALUES (?, ?, 'active', NOW(), NOW())`,
      [multiRoleEmail, merchantPasswordHash]
    );
    const multiUserId = merchantUserInsert.insertId;

    // Assign merchant platform role
    const [merchantRoleRows] = await db.query(`SELECT id FROM roles WHERE name = 'merchant' LIMIT 1`);
    await db.query(
      `INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)`,
      [multiUserId, merchantRoleRows[0].id]
    );

    // Now invite this existing merchant as bank reviewer for testBank
    const multiInvite = await adminInstitutionsService.inviteStaff(
      {
        institutionId: testBankId,
        email: multiRoleEmail,
        name: "Dual Role Merchant-Staff",
        roleName: "bank_reviewer",
      },
      { id: 1, email: "superadmin@banglaqr.com" }
    );

    // Verify existing user detection
    const verifyMulti = await verifyInstitutionInvitation(multiInvite.invitationToken);
    assert(verifyMulti.isExistingUser === true, "verifyInstitutionInvitation correctly identifies existing user account");

    // Accept invitation (without requiring new password)
    const acceptMulti = await acceptInstitutionInvitation({
      token: multiInvite.invitationToken,
      name: "Dual Role Merchant-Staff",
    });
    assert(acceptMulti.success === true, "Multi-role user accepted bank invitation successfully");

    // Check user_roles: MUST STILL have merchant role!
    const [multiUserRoles] = await db.query(
      `SELECT r.name FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = ?`,
      [multiUserId]
    );
    assert(
      multiUserRoles.some((r) => r.name === "merchant"),
      "Merchant role preserved in user_roles"
    );
    assert(
      !multiUserRoles.some((r) => r.name.startsWith("bank_")),
      "No bank role inserted into user_roles for multi-role user"
    );

    // Check institution_users: MUST have bank_reviewer membership
    const [multiInstUsers] = await db.query(
      `SELECT r.name as role_name FROM institution_users iu JOIN roles r ON iu.role_id = r.id WHERE iu.user_id = ? AND iu.institution_id = ?`,
      [multiUserId, testBankId]
    );
    assert(multiInstUsers.length === 1 && multiInstUsers[0].role_name === "bank_reviewer", "Bank reviewer membership added to institution_users");

    // Verify multi-role user can still log in with ORIGINAL merchant password
    const multiLogin = await loginUser({
      email: multiRoleEmail,
      password: merchantPassword,
    });
    assert(multiLogin.accessToken !== null, "Multi-role user logs in successfully with original password");
    assert(multiLogin.user.isMerchant === true, "isMerchant flag is true");
    assert(multiLogin.user.institutionMemberships.length > 0, "institutionMemberships is populated");

    // 7. Suspended Membership Access Denial
    console.log("\n--- TEST 8: Suspended Membership Access Denial ---");
    // Suspend the membership
    await db.query(
      `UPDATE institution_users SET membership_status = 'suspended' WHERE user_id = ? AND institution_id = ?`,
      [staffUserId, testBankId]
    );
    const suspendedLogin = await loginUser({
      email: testInviteEmail,
      password: testStaffPassword,
    });
    const activeMemberships = (suspendedLogin.user?.institutionMemberships || []).filter(
      (m) => m.status === "active"
    );
    assert(activeMemberships.length === 0, "Suspended bank staff has 0 active memberships on login");

    // Clean up temporary test records
    console.log("\n--- Clean up temporary test records ---");
    await db.query(`DELETE FROM institution_invitations WHERE id IN (?, ?)`, [
      inviteResult.invitationId,
      multiInvite.invitationId,
    ]);
    await db.query(`DELETE FROM institution_users WHERE user_id IN (?, ?)`, [
      staffUserId,
      multiUserId,
    ]);
    await db.query(`DELETE FROM user_roles WHERE user_id IN (?, ?)`, [
      staffUserId,
      multiUserId,
    ]);
    await db.query(`DELETE FROM users WHERE id IN (?, ?)`, [
      staffUserId,
      multiUserId,
    ]);

    // Restore Prime Bank name for cleanliness
    await adminInstitutionsService.update(
      testBankId,
      { name: "Prime Bank PLC" },
      { id: 1, email: "superadmin@banglaqr.com" }
    );

    console.log(`\n========================================`);
    console.log(`TOTAL TESTS: ${passed + failed}`);
    console.log(`PASSED: ${passed}`);
    console.log(`FAILED: ${failed}`);
    console.log(`========================================`);

    if (failed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (err) {
    console.error("Test execution threw an uncaught error:", err);
    process.exit(1);
  } finally {
    await db.end();
  }
}

runTests();
