import assert from "node:assert/strict";
import { db } from "../src/config/db.js";
import { merchantService } from "../src/modules/merchants/merchant.service.js";
import { merchantRepository } from "../src/modules/merchants/merchant.repository.js";

async function runPhase3AcceptanceTests() {
  console.log("=== Running Phase 3 Acceptance Tests: Entry Flow & Conditional Bank/MFS Setup ===\n");

  const testEmail = `phase3_test_${Date.now()}@test.banglaqr.com`;
  const testPhone = `017${Math.floor(10000000 + Math.random() * 90000000)}`;

  let userId = null;
  let merchantId = null;

  try {
    // 1. Create a test user and merchant
    const [userRes] = await db.query(
      `INSERT INTO users (email, phone, password_hash, status, email_verified_at, phone_verified_at, created_at, updated_at)
       VALUES (?, ?, 'dummy_hash', 'active', NOW(), NOW(), NOW(), NOW())`,
      [testEmail, testPhone]
    );
    userId = userRes.insertId;

    const merchant = await merchantRepository.findOrCreateMerchantByUserId(userId);
    merchantId = merchant.id;

    console.log(`[Setup] Created test merchant: ID ${merchantId}, User ID ${userId}`);

    // =========================================================================
    // Test 1: Setup Flow - Micro Merchant with Bank & Existing Account
    // =========================================================================
    console.log("\n[Test 1] Saving Setup: Micro Merchant + City Bank (ID 84) + Existing Account...");
    await merchantService.updateCompany(userId, {
      companyName: "Green Agro Store",
      businessType: "Sole Proprietorship",
      institutionId: 84, // City Bank
      channel: "bank",
      branchName: "Badda Link Road",
      routingNumber: "225271234",
      hasExistingAccount: true,
      applyNewAccount: false,
    });

    await merchantService.updateKyc(userId, {
      legalBusinessName: "Green Agro Store",
      businessEntityType: "Sole Proprietorship",
      institutionId: 84,
      bankName: "The City Bank PLC",
      branchName: "Badda Link Road",
      routingNumber: "225271234",
      accountHolderName: "Green Agro Store",
      accountNumber: "1501234567890",
      nidNumber: "19901234567890",
      hasExistingAccount: true,
    });

    const status1 = await merchantService.getMerchantMe(userId);
    assert.equal(status1.profile.institutionId, 84, "Profile must store City Bank ID 84");
    assert.equal(status1.profile.channel, "bank", "Channel must be bank");
    assert.equal(status1.profile.hasExistingAccount, true, "hasExistingAccount must be true");
    assert.equal(status1.kyc.accountNumber, "1501234567890", "Account number must persist");
    assert.equal(status1.kyc.branchName, "Badda Link Road", "Branch name must persist for bank");
    console.log("✓ Test 1 Passed: Setup with existing bank account persisted accurately!");

    // =========================================================================
    // Test 2: Setup Flow - Switch to MFS (bKash 74) with Existing Account
    // =========================================================================
    console.log("\n[Test 2] Switching Setup to MFS: bKash (ID 74) + Existing Account...");
    await merchantService.updateCompany(userId, {
      companyName: "Green Agro Store",
      businessType: "Sole Proprietorship",
      institutionId: 74, // bKash
      channel: "mfs",
      branchName: "",
      routingNumber: null,
      hasExistingAccount: true,
      applyNewAccount: false,
    });

    await merchantService.updateKyc(userId, {
      legalBusinessName: "Green Agro Store",
      businessEntityType: "Sole Proprietorship",
      institutionId: 74,
      bankName: "bKash Limited",
      branchName: "",
      accountHolderName: "Md. Green Merchant",
      accountNumber: "01712345678",
      nidNumber: "19901234567890",
      hasExistingAccount: true,
    });

    const status2 = await merchantService.getMerchantMe(userId);
    assert.equal(status2.profile.institutionId, 74, "Institution must update to bKash 74");
    assert.equal(status2.profile.channel, "mfs", "Channel must be mfs");
    assert.equal(status2.kyc.branchName, "", "Bank branch name must be cleared for MFS");
    assert.equal(status2.kyc.accountNumber, "01712345678", "MFS mobile account number stored");
    console.log("✓ Test 2 Passed: MFS setup correctly isolated without bank branch fields!");

    // =========================================================================
    // Test 3: Setup Flow - No Existing Account (Assisted Account Opening)
    // =========================================================================
    console.log("\n[Test 3] Setup Flow: Bank without Existing Account -> Apply New Account (Assisted)...");
    await merchantService.updateCompany(userId, {
      companyName: "Tech Horizon BD",
      businessType: "Private Limited",
      institutionId: 25, // BRAC Bank
      channel: "bank",
      branchName: "",
      routingNumber: null,
      hasExistingAccount: false,
      applyNewAccount: true,
      accountOpeningStatus: "assisted_account_opening_pending",
    });

    await merchantService.updateKyc(userId, {
      legalBusinessName: "Tech Horizon BD",
      businessEntityType: "Private Limited Company",
      institutionId: 25,
      bankName: "BRAC Bank PLC",
      branchName: "",
      routingNumber: "",
      accountHolderName: "",
      accountNumber: "",
      nidNumber: "19901234567890",
      tradeLicenseNumber: "TL-DHAKA-998811",
      tin: "123456789012",
      hasExistingAccount: false,
      applyNewAccount: true,
    });

    const status3 = await merchantService.getMerchantMe(userId);
    assert.equal(status3.profile.institutionId, 25, "Institution must update to BRAC Bank 25");
    assert.equal(status3.profile.hasExistingAccount, false, "hasExistingAccount must be false");
    assert.equal(status3.profile.applyNewAccount, true, "applyNewAccount must be true");
    assert.equal(status3.profile.accountOpeningStatus, "assisted_account_opening_pending", "Status must reflect assisted account opening");
    assert.equal(status3.kyc.accountNumber, "", "Account number must be empty without error");
    assert.equal(status3.kyc.branchName, "", "Branch name must be empty without error");
    console.log("✓ Test 3 Passed: No-account assisted opening setup saved without validation failure!");

    // =========================================================================
    // Test 4: End-to-End Application Submission & Application Record Snapshot
    // =========================================================================
    console.log("\n[Test 4] Submitting Application with Assisted Account Opening...");
    // Upload required basic documents
    await db.query(
      `INSERT INTO merchant_documents (merchant_id, document_type, document_name, storage_key, mime_type, file_size, status, created_at, updated_at)
       VALUES 
       (?, 'NID_FRONT', 'nid_front.jpg', 'test_nid_f.jpg', 'image/jpeg', 1024, 'approved', NOW(), NOW()),
       (?, 'NID_BACK', 'nid_back.jpg', 'test_nid_b.jpg', 'image/jpeg', 1024, 'approved', NOW(), NOW()),
       (?, 'MERCHANT_SIGNATURE', 'sig.jpg', 'test_sig.jpg', 'image/jpeg', 1024, 'approved', NOW(), NOW()),
       (?, 'UTILITY_BILL', 'utility.pdf', 'test_util.pdf', 'application/pdf', 1024, 'approved', NOW(), NOW()),
       (?, 'TIN_CERTIFICATE', 'tin.pdf', 'test_tin.pdf', 'application/pdf', 1024, 'approved', NOW(), NOW()),
       (?, 'TRADE_LICENSE', 'trade.pdf', 'test_tl.pdf', 'application/pdf', 1024, 'approved', NOW(), NOW()),
       (?, 'NOMINEE_PHOTO', 'nominee.jpg', 'test_nom.jpg', 'image/jpeg', 1024, 'approved', NOW(), NOW()),
       (?, 'NOMINEE_NID', 'nom_nid.jpg', 'test_nom_nid.jpg', 'image/jpeg', 1024, 'approved', NOW(), NOW()),
       (?, 'NOMINEE_SIGNATURE', 'nom_sig.jpg', 'test_nom_sig.jpg', 'image/jpeg', 1024, 'approved', NOW(), NOW())`,
      [merchantId, merchantId, merchantId, merchantId, merchantId, merchantId, merchantId, merchantId, merchantId]
    );

    // Save contact info & mark phone as verified
    await merchantService.updateContact(userId, {
      name: "Tanzir Ahmed",
      email: testEmail,
      phone: testPhone,
    });
    await db.query(
      `UPDATE merchant_contacts SET phone_verified_at = NOW(), email_verified_at = NOW() WHERE merchant_id = ?`,
      [merchantId]
    );

    const submitResult = await merchantService.submitApplication(userId);
    assert.equal(submitResult.accountStatus, "submitted", "Account status must transition to submitted");

    // Verify merchant_gateway_applications record
    const [apps] = await db.query(
      `SELECT * FROM merchant_gateway_applications WHERE merchant_id = ? ORDER BY id DESC LIMIT 1`,
      [merchantId]
    );
    assert.equal(apps.length, 1, "Must have an application record");
    assert.equal(Number(apps[0].institution_id), 25, "Must route to exact BRAC Bank ID 25");
    
    const snapshot = typeof apps[0].submitted_data_snapshot === "string" ? JSON.parse(apps[0].submitted_data_snapshot) : apps[0].submitted_data_snapshot;
    assert.equal(snapshot.hasExistingAccount, false, "Snapshot hasExistingAccount must be false");
    assert.equal(snapshot.applyNewAccount, true, "Snapshot applyNewAccount must be true");
    assert.equal(snapshot.accountOpeningStatus, "assisted_account_opening_pending", "Snapshot accountOpeningStatus must match");
    console.log("✓ Test 4 Passed: Final application record created with exact institution ID and assisted account snapshot!");

    console.log("\n=========================================================================");
    console.log("ALL PHASE 3 ENTRY FLOW & CONDITIONAL SETUP ACCEPTANCE TESTS PASSED (100%)");
    console.log("=========================================================================");
  } finally {
    // Cleanup
    if (merchantId) {
      await db.query(`DELETE FROM merchant_gateway_applications WHERE merchant_id = ?`, [merchantId]);
      await db.query(`DELETE FROM merchant_documents WHERE merchant_id = ?`, [merchantId]);
      await db.query(`DELETE FROM merchant_kyc WHERE merchant_id = ?`, [merchantId]);
      await db.query(`DELETE FROM merchant_profiles WHERE merchant_id = ?`, [merchantId]);
      await db.query(`DELETE FROM merchant_contacts WHERE merchant_id = ?`, [merchantId]);
      await db.query(`DELETE FROM merchants WHERE id = ?`, [merchantId]);
    }
    if (userId) {
      await db.query(`DELETE FROM users WHERE id = ?`, [userId]);
    }
  }
}

runPhase3AcceptanceTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Test failed:", err);
    process.exit(1);
  });
