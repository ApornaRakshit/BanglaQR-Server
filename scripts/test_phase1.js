import { db } from "../src/config/db.js";
import { merchantService } from "../src/modules/merchants/merchant.service.js";
import { companyDraftSchema, companySchema } from "../src/modules/merchants/merchant.validation.js";

async function runTestSuite() {
  console.log("=== RUNNING PHASE 1 AUTOMATED TESTS ===\n");
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

  try {
    // Test 1: Only 'micro' and 'big' are accepted in segment validation
    console.log("--- 1. Segment Validation Rules ---");
    const validMicro = companyDraftSchema.safeParse({ merchantSegment: "micro" });
    assert(validMicro.success, "Segment 'micro' is valid");

    const validBig = companyDraftSchema.safeParse({ merchantSegment: "big" });
    assert(validBig.success, "Segment 'big' is valid");

    const invalidBoth = companyDraftSchema.safeParse({ merchantSegment: "both" });
    assert(!invalidBoth.success, "Segment 'both' is strictly rejected");

    const invalidAll = companyDraftSchema.safeParse({ merchantSegment: "all" });
    assert(!invalidAll.success, "Segment 'all' is strictly rejected");

    const invalidOther = companyDraftSchema.safeParse({ merchantSegment: "third_party" });
    assert(!invalidOther.success, "Arbitrary third segments are strictly rejected");

    // Test 2: Database Table Integrity & Seed Counts
    console.log("\n--- 2. Database Catalogues & Segment Eligibility ---");
    const [legalRows] = await db.query("SELECT COUNT(*) as c FROM business_legal_structures WHERE is_active = 1");
    assert(legalRows[0].c === 11, `Legal structures active count is 11 (Found: ${legalRows[0].c})`);

    const [indRows] = await db.query("SELECT COUNT(*) as c FROM industry_categories WHERE is_active = 1");
    assert(indRows[0].c === 18, `Industry categories active count is 18 (Found: ${indRows[0].c})`);

    const [actRows] = await db.query("SELECT COUNT(*) as c FROM trade_license_activities WHERE is_active = 1");
    assert(actRows[0].c === 49, `Trade license activities active count is 49 (Found: ${actRows[0].c})`);

    const [segRulesDistinct] = await db.query("SELECT DISTINCT merchant_segment FROM business_activity_segment_rules");
    const segmentsInDb = segRulesDistinct.map((r) => r.merchant_segment);
    assert(
      segmentsInDb.length === 2 && segmentsInDb.includes("micro") && segmentsInDb.includes("big"),
      `business_activity_segment_rules has ONLY 'micro' and 'big': [${segmentsInDb.join(", ")}]`
    );

    const [invalidSegInDb] = await db.query("SELECT COUNT(*) as c FROM business_activity_segment_rules WHERE merchant_segment NOT IN ('micro', 'big')");
    assert(invalidSegInDb[0].c === 0, `No forbidden segments found in rules table (Found: ${invalidSegInDb[0].c})`);

    // Test 3: Shared activities have separate records
    console.log("\n--- 3. Activity Separate Eligibility Verification ---");
    const [groceryShopRules] = await db.query(
      `SELECT basr.merchant_segment, basr.is_eligible 
       FROM business_activity_segment_rules basr
       INNER JOIN trade_license_activities tla ON tla.id = basr.activity_id
       WHERE tla.code = 'act_grocery_shop'`
    );
    assert(groceryShopRules.length === 2, `Grocery Shop has 2 separate eligibility rows (Found: ${groceryShopRules.length})`);
    const microEligible = groceryShopRules.find((r) => r.merchant_segment === "micro")?.is_eligible === 1;
    const bigEligible = groceryShopRules.find((r) => r.merchant_segment === "big")?.is_eligible === 1;
    assert(microEligible && bigEligible, "Grocery Shop is separately enabled for both 'micro' and 'big' via 2 records");

    const [factoryRules] = await db.query(
      `SELECT basr.merchant_segment, basr.is_eligible 
       FROM business_activity_segment_rules basr
       INNER JOIN trade_license_activities tla ON tla.id = basr.activity_id
       WHERE tla.code = 'act_garments_factory'`
    );
    const factoryMicro = factoryRules.find((r) => r.merchant_segment === "micro")?.is_eligible === 1;
    const factoryBig = factoryRules.find((r) => r.merchant_segment === "big")?.is_eligible === 1;
    assert(!factoryMicro && factoryBig, "Garments factory is eligible for Big Merchant and disabled for Micro Merchant");

    // Test 4: End-to-End Persistence for a Merchant
    console.log("\n--- 4. Merchant Segment Persistence & Restoration ---");
    const testUserId = 209; // Merchant 183
    const [beforeMerchant] = await db.query("SELECT id, merchant_segment FROM merchants WHERE user_id = ?", [testUserId]);
    
    // Save as micro
    await merchantService.updateCompany(testUserId, {
      merchantSegment: "micro",
      companyName: "Company A Limited",
    });
    const [afterMicro] = await db.query("SELECT merchant_segment FROM merchants WHERE user_id = ?", [testUserId]);
    assert(afterMicro[0].merchant_segment === "micro", "Merchant segment successfully persisted as 'micro'");

    // Service getMerchantMe should return authoritative merchantSegment
    const meDataMicro = await merchantService.getMerchantMe(testUserId);
    assert(meDataMicro.merchant.merchantSegment === "micro", "getMerchantMe returns merchantSegment: 'micro'");

    // Switch to big
    await merchantService.updateCompany(testUserId, {
      merchantSegment: "big",
      companyName: "Company A Limited",
    });
    const [afterBig] = await db.query("SELECT merchant_segment FROM merchants WHERE user_id = ?", [testUserId]);
    assert(afterBig[0].merchant_segment === "big", "Merchant segment successfully switched and persisted as 'big'");

    const meDataBig = await merchantService.getMerchantMe(testUserId);
    assert(meDataBig.merchant.merchantSegment === "big", "getMerchantMe returns merchantSegment: 'big'");

    // Test 5: Industry Categories filtered by segment
    console.log("\n--- 5. Authenticated Catalogues API Filtering ---");
    const categoriesForBig = await merchantService.getIndustryCategories(testUserId);
    assert(categoriesForBig.length > 0, `Big merchant receives filtered industry categories (Found: ${categoriesForBig.length})`);

    const activitiesForBig = await merchantService.getBusinessActivities(testUserId);
    const hasFactory = activitiesForBig.some((a) => a.code === "act_garments_factory");
    assert(hasFactory, "Big merchant activities include Garments Factory");

    // Switch to micro to verify category/activity exclusion
    await merchantService.updateCompany(testUserId, { merchantSegment: "micro" });
    const activitiesForMicro = await merchantService.getBusinessActivities(testUserId);
    const hasFactoryInMicro = activitiesForMicro.some((a) => a.code === "act_garments_factory");
    assert(!hasFactoryInMicro, "Micro merchant activities EXCLUDE Garments Factory");

    // Test 6: Ineligible activity assignment rejected
    console.log("\n--- 6. Security Rejection of Ineligible Activity Assignment ---");
    const [factoryRow] = await db.query("SELECT id FROM trade_license_activities WHERE code = 'act_garments_factory'");
    let rejected = false;
    try {
      await merchantService.updateMerchantActivities(testUserId, {
        primaryActivityId: factoryRow[0].id,
      });
    } catch (e) {
      rejected = true;
      assert(e.statusCode === 400, "Server returned 400 Bad Request for ineligible activity assignment");
    }
    assert(rejected, "Micro merchant cannot assign Big-only activity");

    // Test 7: Valid activity assignment works
    const [groceryRow] = await db.query("SELECT id FROM trade_license_activities WHERE code = 'act_grocery_shop'");
    const updatedActivities = await merchantService.updateMerchantActivities(testUserId, {
      primaryActivityId: groceryRow[0].id,
    });
    assert(updatedActivities.length === 1 && updatedActivities[0].activity_role === "primary", "Primary activity successfully assigned");

    // Cleanup: restore merchant 183 segment to null (original state) and remove test profile
    await db.query("UPDATE merchants SET merchant_segment = NULL WHERE id = 183");
    await db.query("DELETE FROM merchant_profile_activities WHERE merchant_id = 183");
    await db.query("DELETE FROM merchant_profiles WHERE merchant_id = 183");
    console.log("\n✓ Cleaned up test modifications on merchant 183.");

    // Test 8: Legacy Data Preserved
    console.log("\n--- 8. Legacy Data Preservation Check ---");
    const [legacyProf] = await db.query("SELECT merchant_id, company_name, business_type, industry FROM merchant_profiles");
    assert(legacyProf.length === 2, `merchant_profiles row count preserved at 2 (Found: ${legacyProf.length})`);
    const aps = legacyProf.find((p) => p.company_name === "Aps Co.");
    assert(aps && aps.business_type === "Private Limited" && aps.industry === "Software & Technology", "Existing profile values (Aps Co.) intact");

    console.log(`\n========================================`);
    console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log(`========================================\n`);

    if (failed > 0) process.exit(1);
    process.exit(0);
  } catch (err) {
    console.error("Test execution error:", err);
    process.exit(1);
  }
}

runTestSuite();
