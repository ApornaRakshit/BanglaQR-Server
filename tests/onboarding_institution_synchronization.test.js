import assert from "node:assert";
import { db } from "../src/config/db.js";
import { merchantService } from "../src/modules/merchants/merchant.service.js";
import { registerUser } from "../src/modules/auth/auth.service.js";

async function runSynchronizationTests() {
  console.log("=== Testing Institution Synchronization Across All Onboarding Steps ===");
  const timestamp = Date.now();
  const createdUserIds = [];
  const createdMerchantIds = [];

  try {
    const activeInstitutions = await merchantService.getActiveInstitutions();
    const bracBank = activeInstitutions.find((i) => i.name.toLowerCase().includes("brac"));
    const cityBank = activeInstitutions.find((i) => i.name.toLowerCase().includes("city"));
    const bkash = activeInstitutions.find((i) => i.institution_code === "BKASH");

    assert.ok(bracBank, "BRAC Bank must exist in active institutions");
    assert.ok(cityBank, "City Bank must exist in active institutions");
    assert.ok(bkash, "bKash must exist in active institutions");

    // Helper: Register merchant
    async function createTestMerchant(suffix) {
      const email = `sync_${suffix}_${timestamp}@test.banglaqr.com`;
      const phone = `017${Math.floor(10000000 + Math.random() * 90000000)}`;
      const regRes = await registerUser({
        fullName: `Sync Tester ${suffix}`,
        name: `Sync Tester ${suffix}`,
        email,
        phone,
        password: "Password123@#",
      });
      createdUserIds.push(regRes.userId);
      await db.execute("UPDATE users SET status = 'active', phone_verified_at = NOW(), email_verified_at = NOW() WHERE id = ?", [regRes.userId]);
      const merchant = await merchantService.getOrCreateMerchant(regRes.userId);
      createdMerchantIds.push(merchant.id);
      await db.execute("UPDATE merchant_contacts SET phone_verified_at = NOW(), email_verified_at = NOW() WHERE merchant_id = ?", [merchant.id]);
      return { userId: regRes.userId, merchantId: merchant.id, email, phone };
    }

    const testMerchant = await createTestMerchant("sync");

    // Test 1: Select BRAC Bank on Page 1
    console.log("[Test 1] Saving BRAC Bank on Page 1 (Company Information)...");
    await merchantService.updateCompany(testMerchant.userId, {
      companyName: "Sync Enterprise Ltd",
      institutionId: bracBank.id,
      bankName: bracBank.name,
      channel: "bank",
      branchName: "Gulshan Branch",
    });

    let meData = await merchantService.getMerchantMe(testMerchant.userId);
    assert.strictEqual(meData.profile.institutionId, bracBank.id, "Profile institutionId must be BRAC Bank");
    assert.strictEqual(meData.kyc.institutionId, bracBank.id, "KYC institutionId must be auto-synchronized to BRAC Bank");
    assert.strictEqual(meData.kyc.bankName, bracBank.name, "KYC bankName must match BRAC Bank");
    console.log(`✓ Page 1 saved BRAC Bank (${bracBank.id}) and synced to KYC Information successfully!`);

    // Test 2: Change to City Bank on Page 1
    console.log("[Test 2] Updating selection to City Bank on Page 1...");
    await merchantService.updateCompany(testMerchant.userId, {
      companyName: "Sync Enterprise Ltd",
      institutionId: cityBank.id,
      bankName: cityBank.name,
      channel: "bank",
      branchName: "Principal Branch",
    });

    meData = await merchantService.getMerchantMe(testMerchant.userId);
    assert.strictEqual(meData.profile.institutionId, cityBank.id, "Profile institutionId must update to City Bank");
    assert.strictEqual(meData.kyc.institutionId, cityBank.id, "KYC institutionId must update to City Bank");
    assert.strictEqual(meData.kyc.bankName, cityBank.name, "KYC bankName must match City Bank");
    assert.strictEqual(meData.profile.branchName, "Principal Branch", "Profile branch must update to Principal Branch");
    console.log(`✓ Selection updated to City Bank (${cityBank.id}) and auto-propagated without stale BRAC Bank retention!`);

    // Test 3: Change to MFS provider (bKash)
    console.log("[Test 3] Updating selection to bKash (MFS channel)...");
    await merchantService.updateCompany(testMerchant.userId, {
      companyName: "Sync Enterprise Ltd",
      institutionId: bkash.id,
      bankName: bkash.name,
      channel: "mfs",
      branchName: "",
    });

    meData = await merchantService.getMerchantMe(testMerchant.userId);
    assert.strictEqual(meData.profile.institutionId, bkash.id, "Profile institutionId must be bKash");
    assert.strictEqual(meData.kyc.institutionId, bkash.id, "KYC institutionId must be bKash");
    assert.strictEqual(meData.profile.channel, "mfs", "Profile channel must be mfs");
    assert.strictEqual(meData.profile.branchName, "", "Branch name must be cleared for MFS");
    console.log(`✓ Selection switched to MFS (bKash ${bkash.id}) and bank branches properly invalidated!`);

    // Test 4: Verify Dynamic KYC Requirements reflect the selected provider
    console.log("[Test 4] Verifying Dynamic KYC Requirements resolve according to authoritative institution...");
    const effectiveBkashReqs = await merchantService.getInstitutionKycRequirements(bkash.id, null, "big_merchant");
    const bkashCodes = effectiveBkashReqs.map((r) => r.requirement_code);
    assert.ok(bkashCodes.includes("MFS_WALLET_STATEMENT"), "bKash requirements must include MFS_WALLET_STATEMENT");
    assert.strictEqual(bkashCodes.includes("CANCELLED_BANK_CHEQUE"), false, "bKash requirements must not include CANCELLED_BANK_CHEQUE");
    console.log("✓ Dynamic KYC resolution accurately reflects MFS channel requirements!");

    // Test 5: Switch back to BRAC Bank, update KYC details on Page 3, and submit
    console.log("[Test 5] Switching back to BRAC Bank, updating KYC details on Page 3, and verifying final routing...");
    await merchantService.updateCompany(testMerchant.userId, {
      companyName: "Sync Enterprise Ltd",
      institutionId: bracBank.id,
      bankName: bracBank.name,
      channel: "bank",
      branchName: "Gulshan - 1",
    });

    await merchantService.updateKyc(testMerchant.userId, {
      legalBusinessName: "Sync Enterprise Ltd",
      authorizedPersonName: "Authorized Person",
      businessEntityType: "Sole Proprietorship",
      nidNumber: "1234567890",
      institutionId: bracBank.id,
      bankName: bracBank.name,
      accountHolderName: "Sync Enterprise Ltd",
      accountNumber: "205011223344",
      branchName: "Gulshan - 1",
    });

    // Seed mock docs for submission
    await db.query(`INSERT INTO merchant_documents (merchant_id, document_type, document_name, storage_key, mime_type, file_size, status)
      VALUES 
      (${testMerchant.merchantId}, 'NID_FRONT', 'NID Front', 'mock/nid_front.jpg', 'image/jpeg', 1024, 'Uploaded'),
      (${testMerchant.merchantId}, 'NID_BACK', 'NID Back', 'mock/nid_back.jpg', 'image/jpeg', 1024, 'Uploaded'),
      (${testMerchant.merchantId}, 'MERCHANT_SIGNATURE', 'Signature', 'mock/sig.jpg', 'image/jpeg', 1024, 'Uploaded'),
      (${testMerchant.merchantId}, 'UTILITY_BILL', 'Utility', 'mock/util.jpg', 'image/jpeg', 1024, 'Uploaded'),
      (${testMerchant.merchantId}, 'NOMINEE_PHOTO', 'Nominee', 'mock/nom_photo.jpg', 'image/jpeg', 1024, 'Uploaded'),
      (${testMerchant.merchantId}, 'NOMINEE_NID', 'Nominee NID', 'mock/nom_nid.jpg', 'image/jpeg', 1024, 'Uploaded'),
      (${testMerchant.merchantId}, 'NOMINEE_SIGNATURE', 'Nominee Sig', 'mock/nom_sig.jpg', 'image/jpeg', 1024, 'Uploaded'),
      (${testMerchant.merchantId}, 'TIN_CERTIFICATE', 'TIN', 'mock/tin.jpg', 'image/jpeg', 1024, 'Uploaded')
    `);

    await merchantService.submitApplication(testMerchant.userId);

    const [appRows] = await db.query("SELECT institution_id FROM merchant_gateway_applications WHERE merchant_id = ?", [testMerchant.merchantId]);
    assert.strictEqual(appRows[0].institution_id, bracBank.id, `Application must be routed to BRAC Bank (${bracBank.id})`);
    console.log(`✓ Application submitted and successfully routed to BRAC Bank (ID ${bracBank.id})!`);

    console.log("\n=========================================================================");
    console.log("ALL ONBOARDING INSTITUTION SYNCHRONIZATION TESTS PASSED WITH 100% SUCCESS!");
    console.log("=========================================================================");
  } finally {
    if (createdMerchantIds.length > 0) {
      const placeholders = createdMerchantIds.map(() => "?").join(",");
      await db.query(`DELETE FROM merchant_gateway_applications WHERE merchant_id IN (${placeholders})`, createdMerchantIds);
      await db.query(`DELETE FROM merchant_documents WHERE merchant_id IN (${placeholders})`, createdMerchantIds);
      await db.query(`DELETE FROM merchant_onboarding_history WHERE merchant_id IN (${placeholders})`, createdMerchantIds);
      await db.query(`DELETE FROM merchant_profiles WHERE merchant_id IN (${placeholders})`, createdMerchantIds);
      await db.query(`DELETE FROM merchant_contacts WHERE merchant_id IN (${placeholders})`, createdMerchantIds);
      await db.query(`DELETE FROM merchant_kyc WHERE merchant_id IN (${placeholders})`, createdMerchantIds);
      await db.query(`DELETE FROM merchants WHERE id IN (${placeholders})`, createdMerchantIds);
    }
    if (createdUserIds.length > 0) {
      const placeholders = createdUserIds.map(() => "?").join(",");
      await db.query(`DELETE FROM user_roles WHERE user_id IN (${placeholders})`, createdUserIds);
      await db.query(`DELETE FROM users WHERE id IN (${placeholders})`, createdUserIds);
    }
    await db.end();
  }
}

runSynchronizationTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
