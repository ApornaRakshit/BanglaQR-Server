import assert from "node:assert";
import { db } from "../src/config/db.js";
import { merchantService } from "../src/modules/merchants/merchant.service.js";
import { adminMerchantsService } from "../src/modules/admin/merchants/admin.merchants.service.js";
import { institutionService } from "../src/modules/institution/institution.service.js";
import { adminInstitutionsRepository } from "../src/modules/admin/institutions/admin.institutions.repository.js";
import { registerUser } from "../src/modules/auth/auth.service.js";

async function testAll52InstitutionsAndDynamicKyc() {
  console.log("=== Running Comprehensive Test: All 52 Dynamic Bank/MFS Institutions & KYC Engine ===");

  const timestamp = Date.now();
  const createdUserIds = [];
  const createdMerchantIds = [];

  try {
    // -------------------------------------------------------------------------------------------------
    // 1. Fetch Dynamic Active Institutions from API / Repository
    // -------------------------------------------------------------------------------------------------
    console.log("\n[Step 1] Loading all active institutions dynamically from database...");
    const activeInstitutions = await merchantService.getActiveInstitutions();
    assert.ok(Array.isArray(activeInstitutions), "getActiveInstitutions() must return an array");

    const totalActiveCount = activeInstitutions.length;
    console.log(`Total Active Institutions Discovered: ${totalActiveCount}`);

    // Group by category/type
    const banks = activeInstitutions.filter((i) =>
      ["commercial_bank", "specialized_bank", "bank", "digital_bank"].includes(i.institution_type)
    );
    const mfsProviders = activeInstitutions.filter((i) => i.institution_type === "mfs");

    console.log(`- Active Banks: ${banks.length}`);
    console.log(`- Active MFS Providers: ${mfsProviders.length}`);
    console.log(`- Total Active: ${totalActiveCount}`);

    // Enforce discovery of all active institutions (must be 52)
    assert.strictEqual(
      totalActiveCount,
      52,
      `Expected exactly 52 active institutions in production database, found ${totalActiveCount}`
    );
    assert.strictEqual(banks.length, 48, `Expected 48 banks, found ${banks.length}`);
    assert.strictEqual(mfsProviders.length, 4, `Expected 4 MFS providers, found ${mfsProviders.length}`);

    // Dynamically retrieve EBL record from DB without hardcoded ID
    const [eblRows] = await db.query(
      "SELECT id, name, institution_code, institution_type FROM institutions WHERE institution_code = 'EBL' LIMIT 1"
    );
    const eblRecord = eblRows[0];
    assert.ok(eblRecord, "EBL record must exist in DB");
    console.log(`- Dynamically fetched EBL record from DB: ID ${eblRecord.id} (${eblRecord.name})`);

    // -------------------------------------------------------------------------------------------------
    // 2. Automated Coverage Test Across EVERY Single One of the 52 Active Institutions
    // -------------------------------------------------------------------------------------------------
    console.log("\n[Step 2] Verifying KYC Requirement Resolution across ALL 52 active institutions...");

    for (const inst of activeInstitutions) {
      assert.ok(inst.id, `Institution ${inst.name} must have a valid ID`);
      assert.ok(inst.name, `Institution ID ${inst.id} must have a name`);
      assert.ok(inst.institution_type, `Institution ${inst.name} must have a valid type`);

      // 2a. Resolve requirements for Big Merchant
      const bigReqs = await merchantService.getInstitutionKycRequirements(inst.id, null, "big_merchant");
      assert.ok(Array.isArray(bigReqs), `Requirements for ${inst.name} must be an array`);
      assert.ok(bigReqs.length >= 8, `Requirements for ${inst.name} must contain at least baseline global docs`);

      // Verify all global docs are present
      const reqCodes = bigReqs.map((r) => r.requirement_code);
      assert.ok(reqCodes.includes("NID_FRONT"), `${inst.name} missing NID_FRONT`);
      assert.ok(reqCodes.includes("NID_BACK"), `${inst.name} missing NID_BACK`);
      assert.ok(reqCodes.includes("MERCHANT_SIGNATURE"), `${inst.name} missing MERCHANT_SIGNATURE`);
      assert.ok(reqCodes.includes("UTILITY_BILL"), `${inst.name} missing UTILITY_BILL`);
      assert.ok(reqCodes.includes("TIN_CERTIFICATE"), `${inst.name} missing TIN_CERTIFICATE`);
      assert.ok(reqCodes.includes("NOMINEE_PHOTO"), `${inst.name} missing NOMINEE_PHOTO`);
      assert.ok(reqCodes.includes("NOMINEE_NID"), `${inst.name} missing NOMINEE_NID`);
      assert.ok(reqCodes.includes("NOMINEE_SIGNATURE"), `${inst.name} missing NOMINEE_SIGNATURE`);

      // 2b. Verify Channel Rule Separation (No cross-channel leakage!)
      if (inst.institution_type === "mfs") {
        // MFS must NOT receive Bank Cheque requirement
        assert.strictEqual(
          reqCodes.includes("CANCELLED_BANK_CHEQUE"),
          false,
          `MFS Provider '${inst.name}' should NOT have CANCELLED_BANK_CHEQUE requirement!`
        );
        // MFS may have wallet statement
        assert.ok(
          reqCodes.includes("MFS_WALLET_STATEMENT"),
          `MFS Provider '${inst.name}' must have MFS_WALLET_STATEMENT channel requirement`
        );
      } else {
        // Bank must receive Bank Cheque requirement
        assert.ok(
          reqCodes.includes("CANCELLED_BANK_CHEQUE"),
          `Bank '${inst.name}' must have CANCELLED_BANK_CHEQUE channel requirement`
        );
        // Bank must NOT receive MFS-specific wallet statement
        assert.strictEqual(
          reqCodes.includes("MFS_WALLET_STATEMENT"),
          false,
          `Bank '${inst.name}' must NOT have MFS_WALLET_STATEMENT channel requirement`
        );
      }

      // 2c. Resolve requirements for Micro Merchant (Cheque becomes optional/relaxed)
      const microReqs = await merchantService.getInstitutionKycRequirements(inst.id, null, "micro_merchant");
      const chequeReq = microReqs.find((r) => r.requirement_code === "CANCELLED_BANK_CHEQUE");
      if (chequeReq) {
        assert.strictEqual(
          chequeReq.is_mandatory,
          0,
          `CANCELLED_BANK_CHEQUE must be optional for micro merchant in ${inst.name}`
        );
      }
      // 2d. Verify Admin Effective Requirements endpoint for this institution
      const adminEffectiveReqs = await adminInstitutionsRepository.listKycRequirements({ institutionId: inst.id });
      assert.ok(Array.isArray(adminEffectiveReqs), `Admin effective requirements for ${inst.name} must be an array`);
      assert.ok(
        adminEffectiveReqs.length >= 8,
        `Admin effective requirements for ${inst.name} must return at least baseline global requirements (found ${adminEffectiveReqs.length})`
      );

      // Verify that all returned rows have proper source badges and no cross-channel leakage
      for (const row of adminEffectiveReqs) {
        assert.ok(row.source_scope, `Row ${row.requirement_code} must have source_scope badge defined`);
        if (inst.institution_type === "mfs") {
          assert.notStrictEqual(
            row.requirement_code,
            "CANCELLED_BANK_CHEQUE",
            `MFS ${inst.name} must NOT contain CANCELLED_BANK_CHEQUE in admin effective list`
          );
        } else {
          assert.notStrictEqual(
            row.requirement_code,
            "MFS_WALLET_STATEMENT",
            `Bank ${inst.name} must NOT contain MFS_WALLET_STATEMENT in admin effective list`
          );
        }
      }
    }
    console.log(`✓ All 52 institutions successfully verified for KYC resolution without cross-channel leakage!`);

    // -------------------------------------------------------------------------------------------------
    // 3. Representative End-to-End Application Routing Tests (City Bank, AB Bank, bKash)
    // -------------------------------------------------------------------------------------------------
    console.log("\n[Step 3] Running representative end-to-end routing tests (City Bank, AB Bank, bKash)...");

    const cityBank = activeInstitutions.find((i) => i.name.includes("City Bank"));
    const abBank = activeInstitutions.find((i) => i.name.includes("AB Bank"));
    const bkash = activeInstitutions.find((i) => i.institution_code === "BKASH");

    assert.ok(cityBank, "City Bank found in active institutions");
    assert.ok(abBank, "AB Bank found in active institutions");
    assert.ok(bkash, "bKash found in active institutions");

    // Helper to create test merchant
    async function createTestMerchant(suffix) {
      const email = `test_dyn_${suffix}_${timestamp}@test.banglaqr.com`;
      const phone = `017${Math.floor(10000000 + Math.random() * 90000000)}`;
      const regRes = await registerUser({
        fullName: `Dynamic KYC Test ${suffix}`,
        name: `Dynamic KYC Test ${suffix}`,
        email,
        phone,
        password: "Password123@#",
      });
      createdUserIds.push(regRes.userId);

      await db.execute(
        "UPDATE users SET status = 'active', phone_verified_at = NOW(), email_verified_at = NOW() WHERE id = ?",
        [regRes.userId]
      );
      const merchant = await merchantService.getOrCreateMerchant(regRes.userId);
      createdMerchantIds.push(merchant.id);

      await db.execute(
        "UPDATE merchant_contacts SET phone_verified_at = NOW(), email_verified_at = NOW() WHERE merchant_id = ?",
        [merchant.id]
      );

      return { userId: regRes.userId, merchantId: merchant.id, email, phone };
    }

    // Seed mock docs for submission
    async function seedMockDocs(merchantId) {
      await db.query(`INSERT INTO merchant_documents (merchant_id, document_type, document_name, storage_key, mime_type, file_size, status)
        VALUES 
        (${merchantId}, 'NID_FRONT', 'NID Front', 'mock/nid_front.jpg', 'image/jpeg', 1024, 'Uploaded'),
        (${merchantId}, 'NID_BACK', 'NID Back', 'mock/nid_back.jpg', 'image/jpeg', 1024, 'Uploaded'),
        (${merchantId}, 'MERCHANT_SIGNATURE', 'Signature', 'mock/sig.jpg', 'image/jpeg', 1024, 'Uploaded'),
        (${merchantId}, 'UTILITY_BILL', 'Utility', 'mock/util.jpg', 'image/jpeg', 1024, 'Uploaded'),
        (${merchantId}, 'NOMINEE_PHOTO', 'Nominee', 'mock/nom_photo.jpg', 'image/jpeg', 1024, 'Uploaded'),
        (${merchantId}, 'NOMINEE_NID', 'Nominee NID', 'mock/nom_nid.jpg', 'image/jpeg', 1024, 'Uploaded'),
        (${merchantId}, 'NOMINEE_SIGNATURE', 'Nominee Sig', 'mock/nom_sig.jpg', 'image/jpeg', 1024, 'Uploaded'),
        (${merchantId}, 'TIN_CERTIFICATE', 'TIN', 'mock/tin.jpg', 'image/jpeg', 1024, 'Uploaded'),
        (${merchantId}, 'CANCELLED_BANK_CHEQUE', 'Cheque', 'mock/cheque.jpg', 'image/jpeg', 1024, 'Uploaded')
      `);
    }

    // Test City Bank
    const mCity = await createTestMerchant("city");
    await merchantService.updateCompany(mCity.userId, { companyName: "City Partner Co", institutionId: cityBank.id, bankName: cityBank.name });
    await merchantService.updateKyc(mCity.userId, { legalBusinessName: "City Partner Co", authorizedPersonName: "City Agent", businessEntityType: "Micro", nidNumber: "1122334455", institutionId: cityBank.id, bankName: cityBank.name, accountHolderName: "City Partner Co", accountNumber: "12345678", branchName: "Principal Branch" });
    await seedMockDocs(mCity.merchantId);
    await merchantService.submitApplication(mCity.userId);

    const [cityApps] = await db.query("SELECT institution_id FROM merchant_gateway_applications WHERE merchant_id = ?", [mCity.merchantId]);
    assert.strictEqual(cityApps[0].institution_id, cityBank.id, "Application must route to City Bank");
    assert.notStrictEqual(cityApps[0].institution_id, eblRecord.id, `Must NOT default to EBL (${eblRecord.id})`);
    console.log(`✓ City Bank application routed correctly to ID ${cityBank.id}`);

    // Test AB Bank
    const mAb = await createTestMerchant("ab");
    await merchantService.updateCompany(mAb.userId, { companyName: "AB Partner Co", institutionId: abBank.id, bankName: abBank.name });
    await merchantService.updateKyc(mAb.userId, { legalBusinessName: "AB Partner Co", authorizedPersonName: "AB Agent", businessEntityType: "Micro", nidNumber: "2233445566", institutionId: abBank.id, bankName: abBank.name, accountHolderName: "AB Partner Co", accountNumber: "87654321", branchName: "Agrabad Branch" });
    await seedMockDocs(mAb.merchantId);
    await merchantService.submitApplication(mAb.userId);

    const [abApps] = await db.query("SELECT institution_id FROM merchant_gateway_applications WHERE merchant_id = ?", [mAb.merchantId]);
    assert.strictEqual(abApps[0].institution_id, abBank.id, "Application must route to AB Bank");
    assert.notStrictEqual(abApps[0].institution_id, eblRecord.id, `Must NOT default to EBL (${eblRecord.id})`);
    console.log(`✓ AB Bank application routed correctly to ID ${abBank.id}`);

    // Test bKash (MFS)
    const mBkash = await createTestMerchant("bkash");
    await merchantService.updateCompany(mBkash.userId, { companyName: "bKash Digital Shop", institutionId: bkash.id, bankName: bkash.name });
    await merchantService.updateKyc(mBkash.userId, { legalBusinessName: "bKash Digital Shop", authorizedPersonName: "bKash Merchant", businessEntityType: "Micro", nidNumber: "3344556677", institutionId: bkash.id, bankName: bkash.name, accountHolderName: "bKash Digital Shop", accountNumber: "01700112233", branchName: "MFS Wallet" });
    await seedMockDocs(mBkash.merchantId);
    await merchantService.submitApplication(mBkash.userId);

    const [bkashApps] = await db.query("SELECT institution_id FROM merchant_gateway_applications WHERE merchant_id = ?", [mBkash.merchantId]);
    assert.strictEqual(bkashApps[0].institution_id, bkash.id, "Application must route to bKash");
    assert.notStrictEqual(bkashApps[0].institution_id, eblRecord.id, `Must NOT default to EBL (${eblRecord.id})`);
    console.log(`✓ bKash application routed correctly to ID ${bkash.id}`);

    // -------------------------------------------------------------------------------------------------
    // 4. Invalid or Inactive Institution ID Rejection Test
    // -------------------------------------------------------------------------------------------------
    console.log("\n[Step 4] Testing rejection of missing, inactive, or non-existent institution IDs...");
    const [inactiveRows] = await db.query("SELECT id, name FROM institutions WHERE status = 'inactive' LIMIT 1");
    if (inactiveRows.length > 0) {
      const inactiveInst = inactiveRows[0];
      let inactiveError = null;
      try {
        await merchantService.getInstitutionKycRequirements(inactiveInst.id);
      } catch (err) {
        inactiveError = err;
      }
      assert.ok(inactiveError, "Must reject inactive institution");
      assert.strictEqual(inactiveError.statusCode, 400, "Inactive institution must return 400 Bad Request");
      console.log(`✓ Inactive institution '${inactiveInst.name}' (ID ${inactiveInst.id}) correctly rejected with 400!`);
    }

    let nonExistentError = null;
    try {
      await merchantService.getInstitutionKycRequirements(999999);
    } catch (err) {
      nonExistentError = err;
    }
    assert.ok(nonExistentError, "Must reject non-existent institution");
    assert.strictEqual(nonExistentError.statusCode, 404, "Non-existent institution must return 404 Not Found");
    console.log("✓ Non-existent institution (ID 999999) correctly rejected with 404!");

    console.log("\n=========================================================================");
    console.log("ALL 52 INSTITUTIONS & DYNAMIC KYC ENGINE TESTS PASSED WITH 100% SUCCESS!");
    console.log("=========================================================================");
  } finally {
    // Clean up test data without touching production records
    console.log("Cleaning up temporary test records...");
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

testAll52InstitutionsAndDynamicKyc().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
