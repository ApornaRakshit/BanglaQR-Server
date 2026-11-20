import assert from "assert";
import { db } from "../src/config/db.js";
import { merchantService } from "../src/modules/merchants/merchant.service.js";
import { merchantRepository } from "../src/modules/merchants/merchant.repository.js";

async function runOnboardingDraftTests() {
  console.log("=== STARTING ONBOARDING COMPANY INFORMATION DRAFT TESTS ===");

  const cleanupUserIds = [];

  try {
    // Setup synthetic merchant A
    const phoneA = "01799881122";
    await db.execute("DELETE FROM users WHERE phone = ?", [phoneA]);
    const [uA] = await db.execute(
      `INSERT INTO users (phone, email, password_hash, status, token_version, created_at, updated_at)
       VALUES (?, 'synth_merchant_a@test.local', 'hash', 'active', 0, NOW(), NOW())`,
      [phoneA]
    );
    const userIdA = uA.insertId;
    cleanupUserIds.push(userIdA);

    const merchantA = await merchantRepository.findOrCreateMerchantByUserId(userIdA);

    // Setup synthetic merchant B
    const phoneB = "01799881133";
    await db.execute("DELETE FROM users WHERE phone = ?", [phoneB]);
    const [uB] = await db.execute(
      `INSERT INTO users (phone, email, password_hash, status, token_version, created_at, updated_at)
       VALUES (?, 'synth_merchant_b@test.local', 'hash', 'active', 0, NOW(), NOW())`,
      [phoneB]
    );
    const userIdB = uB.insertId;
    cleanupUserIds.push(userIdB);

    const merchantB = await merchantRepository.findOrCreateMerchantByUserId(userIdB);

    // -------------------------------------------------------------------------
    // Test 1: Save All Company Information Fields
    // -------------------------------------------------------------------------
    console.log("\n[TEST 1] Saving all Company Information fields for Merchant A...");
    const companyPayloadA = {
      companyName: "Acme Logistics Ltd",
      businessType: "Private Limited",
      industry: "Logistics & Delivery",
      website: "https://acmelogistics.com",
      address: "House 12, Road 4, Banani",
      city: "Dhaka",
      state: "Dhaka",
      postalCode: "1213",
      country: "Bangladesh",
      channel: "bank",
      institutionId: 1, // Prime Bank
      branchName: "Banani Branch",
      routingNumber: "175270001",
    };

    await merchantService.updateCompany(userIdA, companyPayloadA);
    console.log("✓ Test 1: All Company Information fields saved to MySQL.");

    // -------------------------------------------------------------------------
    // Test 2 & 3: Navigate / Restore Check via getMerchantMe
    // -------------------------------------------------------------------------
    console.log("\n[TEST 2 & 3] Restoring draft via getMerchantMe (Simulating navigation)...");
    const restoredA = await merchantService.getMerchantMe(userIdA);
    const pA = restoredA.profile;

    assert.strictEqual(pA.companyName, "Acme Logistics Ltd");
    assert.strictEqual(pA.businessType, "Private Limited");
    assert.strictEqual(pA.industry, "Logistics & Delivery");
    assert.strictEqual(pA.website, "https://acmelogistics.com");
    assert.strictEqual(pA.address, "House 12, Road 4, Banani");
    assert.strictEqual(pA.city, "Dhaka");
    assert.strictEqual(pA.state, "Dhaka");
    assert.strictEqual(pA.postalCode, "1213");
    assert.strictEqual(pA.country, "Bangladesh");
    assert.strictEqual(pA.institutionId, 1);
    assert.strictEqual(pA.channel, "bank");
    assert.strictEqual(pA.branchName, "Banani Branch");
    console.log("✓ Test 2 & 3: All Company fields restored identically without data loss.");

    // -------------------------------------------------------------------------
    // Test 4: Partial Update - Edit ONLY Website
    // -------------------------------------------------------------------------
    console.log("\n[TEST 4] Partial Update: Changing only website...");
    await merchantService.updateCompany(userIdA, {
      website: "https://newwebsite.com",
    });

    const afterPartialA = await merchantService.getMerchantMe(userIdA);
    const pAfter = afterPartialA.profile;
    assert.strictEqual(pAfter.website, "https://newwebsite.com");
    // Confirm all OTHER fields remained unchanged!
    assert.strictEqual(pAfter.companyName, "Acme Logistics Ltd");
    assert.strictEqual(pAfter.address, "House 12, Road 4, Banani");
    assert.strictEqual(pAfter.city, "Dhaka");
    assert.strictEqual(pAfter.state, "Dhaka");
    assert.strictEqual(pAfter.postalCode, "1213");
    assert.strictEqual(pAfter.institutionId, 1);
    console.log("✓ Test 4: Partial update changed only website; preserved all other fields.");

    // -------------------------------------------------------------------------
    // Test 5: Isolation Check - Merchant B cannot access Merchant A draft
    // -------------------------------------------------------------------------
    console.log("\n[TEST 5] Isolation: Merchant B querying getMerchantMe...");
    const restoredB = await merchantService.getMerchantMe(userIdB);
    assert.notStrictEqual(restoredB.merchant.id, merchantA.id);
    assert.strictEqual(restoredB.profile?.companyName || null, null);
    assert.strictEqual(restoredB.profile?.address || null, null);
    console.log("✓ Test 5: Merchant data strictly isolated across accounts.");

    console.log("\n=========================================================================");
    console.log("ALL ONBOARDING DRAFT RESTORATION TESTS PASSED (100%)");
    console.log("=========================================================================");
  } finally {
    console.log("\n[Cleanup] Cleaning up synthetic test records...");
    for (const uid of cleanupUserIds) {
      const [m] = await db.query("SELECT id FROM merchants WHERE user_id = ?", [uid]);
      if (m.length > 0) {
        await db.query("DELETE FROM merchant_profiles WHERE merchant_id = ?", [m[0].id]);
        await db.query("DELETE FROM merchant_contacts WHERE merchant_id = ?", [m[0].id]);
        await db.query("DELETE FROM merchant_kyc WHERE merchant_id = ?", [m[0].id]);
        await db.query("DELETE FROM merchant_commercial_details WHERE merchant_id = ?", [m[0].id]);
        await db.query("DELETE FROM merchants WHERE id = ?", [m[0].id]);
      }
      await db.query("DELETE FROM users WHERE id = ?", [uid]);
    }
    console.log("[Cleanup] Complete.");
  }
}

runOnboardingDraftTests()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Test failed:", e);
    process.exit(1);
  });
