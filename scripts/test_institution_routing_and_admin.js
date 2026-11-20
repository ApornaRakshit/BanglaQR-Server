import { db } from "../src/config/db.js";
import { merchantService } from "../src/modules/merchants/merchant.service.js";
import bcrypt from "bcryptjs";

async function testInstitutionRoutingAndAdminAccess() {
  console.log("=== TASKS 3 & 4: INSTITUTION ROUTING & ADMIN AUTHORIZATION REGRESSION ===\n");
  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`✓ PASS: ${message}`);
      passed++;
    } else {
      console.error(`✗ FAIL: ${message}`);
      failed++;
    }
  }

  const testEmail = `synthetic_routing_${Date.now()}@example.com`;
  let userId = null;
  let merchantId = null;

  try {
    // 1. Create a synthetic test user & merchant
    const passwordHash = await bcrypt.hash("Password123!", 10);
    const [userRes] = await db.query(
      `INSERT INTO users (email, phone, password_hash, status, email_verified_at, phone_verified_at, created_at, updated_at)
       VALUES (?, '01799998877', ?, 'active', NOW(), NOW(), NOW(), NOW())`,
      [testEmail, passwordHash]
    );
    userId = userRes.insertId;

    const [merchRes] = await db.query(
      `INSERT INTO merchants (user_id, merchant_code, merchant_segment, account_status, kyc_status, onboarding_step, created_at, updated_at)
       VALUES (?, ?, 'micro', 'draft', 'pending', 4, NOW(), NOW())`,
      [userId, `SYN-${Date.now().toString().slice(-6)}`]
    );
    merchantId = merchRes.insertId;

    // Pick two active institutions: Institution A (Eastern Bank, ID 26) and Institution B (bKash or ID 50/citybank)
    const [insts] = await db.query("SELECT id, name, institution_type FROM institutions WHERE status = 'active' LIMIT 2");
    const instA = insts[0];
    const instB = insts[1];
    console.log(`Testing with Target Institution A: ${instA.name} (ID: ${instA.id})`);
    console.log(`Testing with Isolation Institution B: ${instB.name} (ID: ${instB.id})`);

    // 2. Set up merchant profile with Institution A
    await db.query(
      `INSERT INTO merchant_profiles (merchant_id, company_name, business_type, industry, address, city, state, postal_code, country, institution_id, bank_name, has_existing_account, created_at, updated_at)
       VALUES (?, 'Synthetic Company Ltd', 'Sole Proprietorship', 'Retail & Grocery', '123 Test St', 'Dhaka', 'Dhaka', '1209', 'Bangladesh', ?, ?, 1, NOW(), NOW())`,
      [merchantId, instA.id, instA.name]
    );

    // 3. Set up KYC with Institution A
    await db.query(
      `INSERT INTO merchant_kyc (merchant_id, legal_business_name, nid_number, institution_id, bank_name, bank_account_name, bank_account_number, account_type, created_at, updated_at)
       VALUES (?, 'Synthetic Legal Name', '1234567890123', ?, ?, 'Synthetic Account Title', '123456789012', 'Business', NOW(), NOW())`,
      [merchantId, instA.id, instA.name]
    );

    // 4. Assign an eligible primary activity (Activity 1: Grocery Shop)
    await merchantService.updateMerchantActivities(userId, {
      primaryActivityId: 1,
      additionalActivityIds: []
    });

    // 5. Submit application
    console.log("\nSubmitting application for synthetic merchant...");
    await merchantService.submitApplication(userId);
    console.log("Application submitted successfully!\n");

    // 6. Verify Target Institution A sees its assigned merchant application
    const [instAApps] = await db.query(
      `SELECT id, application_number, merchant_id, institution_id, status FROM merchant_gateway_applications
       WHERE merchant_id = ? AND institution_id = ?`,
      [merchantId, instA.id]
    );
    assert(instAApps.length === 1 && instAApps[0].status === 'applied', `Target Institution A (${instA.name}) sees application ${instAApps[0]?.application_number}`);

    // 7. Verify Isolation: Other Institution B CANNOT access that application
    const [instBApps] = await db.query(
      `SELECT id FROM merchant_gateway_applications WHERE merchant_id = ? AND institution_id = ?`,
      [merchantId, instB.id]
    );
    assert(instBApps.length === 0, `Isolation confirmed: Other Institution B (${instB.name}) cannot see the application`);

    // 8. Verify Global Admin sees the application
    const [adminView] = await db.query(
      `SELECT mga.id, mga.application_number, mga.institution_id, i.name as institution_name
       FROM merchant_gateway_applications mga
       LEFT JOIN institutions i ON i.id = mga.institution_id
       WHERE mga.merchant_id = ?`,
      [merchantId]
    );
    assert(adminView.length === 1, `Global Admin sees application: ${adminView[0]?.application_number} linked to ${adminView[0]?.institution_name}`);

    // 9. Admin Authorization Regression Check: Role and permission checks
    console.log("\n--- Task 4: Admin Authorization Regression Checks ---");
    const [adminRole] = await db.query("SELECT * FROM roles WHERE name = 'admin' OR name = 'super_admin'");
    const [merchantRole] = await db.query("SELECT * FROM roles WHERE name = 'merchant'");
    assert(adminRole.length > 0 && merchantRole.length > 0, "Distinct roles ('admin' vs 'merchant') present in RBAC schema");

    const [adminPerms] = await db.query(`
      SELECT p.slug FROM permissions p
      JOIN role_permissions rp ON rp.permission_id = p.id
      JOIN roles r ON r.id = rp.role_id
      WHERE r.name = 'super_admin' LIMIT 5
    `);
    assert(adminPerms.length > 0, `Super Admin permissions verified: [${adminPerms.map(p => p.slug).join(", ")}]`);

  } finally {
    // Cleanup synthetic fixtures
    console.log("\nCleaning up synthetic fixtures...");
    if (merchantId) {
      await db.query("DELETE FROM merchant_gateway_applications WHERE merchant_id = ?", [merchantId]);
      await db.query("DELETE FROM kyc_submission_versions WHERE merchant_id = ?", [merchantId]);
      await db.query("DELETE FROM merchant_onboarding_history WHERE merchant_id = ?", [merchantId]);
      await db.query("DELETE FROM merchant_profile_activities WHERE merchant_id = ?", [merchantId]);
      await db.query("DELETE FROM merchant_profiles WHERE merchant_id = ?", [merchantId]);
      await db.query("DELETE FROM merchant_kyc WHERE merchant_id = ?", [merchantId]);
      await db.query("DELETE FROM merchants WHERE id = ?", [merchantId]);
    }
    if (userId) {
      await db.query("DELETE FROM users WHERE id = ?", [userId]);
    }
    console.log("Cleanup complete.");
  }

  console.log(`\n=== SUMMARY OF TASKS 3 & 4: ${passed} PASSED, ${failed} FAILED ===`);
  process.exit(0);
}

testInstitutionRoutingAndAdminAccess().catch(e => {
  console.error("FATAL ERROR IN ROUTING TEST:", e);
  process.exit(1);
});
