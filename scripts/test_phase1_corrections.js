import { merchantService } from "../src/modules/merchants/merchant.service.js";
import { updateActivitiesSchema } from "../src/modules/merchants/merchant.validation.js";
import { db } from "../src/config/db.js";

async function verifyCorrections() {
  console.log("=== RUNNING PHASE 1 CORRECTION VERIFICATION ===\n");

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
    // 1. Array where scalar primaryActivityId is expected -> Schema rejection
    console.log("--- 1. Payload Schema Validation ---");
    const arrayPrimary = updateActivitiesSchema.safeParse({ primaryActivityId: [1, 1], additionalActivityIds: [] });
    assert(!arrayPrimary.success, "Array supplied for primaryActivityId rejected by Zod schema");

    // 2. Duplicate Additional Activities -> HTTP 400
    console.log("\n--- 2. Duplicate Additional Activities Rejection ---");
    let dupAdditionalsRejected = false;
    let dupAddMsg = "";
    try {
      await merchantService.updateMerchantActivities(209, { primaryActivityId: 1, additionalActivityIds: [2, 2] });
    } catch (err) {
      dupAdditionalsRejected = err.statusCode === 400;
      dupAddMsg = err.message;
    }
    assert(dupAdditionalsRejected && dupAddMsg.includes("Duplicate Additional Activity ID"), `Duplicate additionals rejected with 400: '${dupAddMsg}'`);

    // 3. Same activity as both Primary and Additional -> HTTP 400
    console.log("\n--- 3. Primary & Additional Overlap Rejection ---");
    let overlapRejected = false;
    let overlapMsg = "";
    try {
      await merchantService.updateMerchantActivities(209, { primaryActivityId: 1, additionalActivityIds: [1, 2] });
    } catch (err) {
      overlapRejected = err.statusCode === 400;
      overlapMsg = err.message;
    }
    assert(overlapRejected && overlapMsg.includes("cannot be submitted as both Primary and Additional"), `Overlap rejected with 400: '${overlapMsg}'`);

    // 4. Draft save without Primary Activity allowed (incomplete drafts permissible mid-entry)
    console.log("\n--- 4. Draft Lifecycle Permissibility ---");
    let draftSaved = false;
    try {
      await merchantService.updateMerchantActivities(209, { primaryActivityId: null, additionalActivityIds: [2] });
      draftSaved = true;
    } catch (err) {
      draftSaved = false;
    }
    assert(draftSaved, "Draft save with null primaryActivityId allowed during incomplete onboarding entry");

    // 5. Final Submission enforces Primary Activity
    console.log("\n--- 5. Final Submission Enforcement ---");
    let submitBlockedWithoutPrimary = false;
    let submitDetails = [];
    try {
      // Merchant 183 / User 209 attempts to submit without primary activity
      await merchantService.submitApplication(209);
    } catch (err) {
      submitBlockedWithoutPrimary = err.statusCode === 422;
      submitDetails = err.details || [];
    }
    const hasPrimaryMissingMsg = submitDetails.some(d => d.includes("Primary Business Activity") || d.includes("প্রধান ব্যবসায়িক কার্যক্রম"));
    assert(submitBlockedWithoutPrimary && hasPrimaryMissingMsg, "Final submission strictly requires Primary Business Activity");

    // Clean up test merchant 183
    await db.query("DELETE FROM merchant_profile_activities WHERE merchant_id = 183");
    await db.query("UPDATE merchants SET merchant_segment = NULL WHERE user_id = 209");

    console.log(`\n=== SUMMARY: ${passed} PASSED, ${failed} FAILED ===`);
  } catch (err) {
    console.error("FATAL ERROR:", err);
  } finally {
    process.exit(0);
  }
}

verifyCorrections();

