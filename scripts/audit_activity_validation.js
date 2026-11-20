import { merchantService } from "../src/modules/merchants/merchant.service.js";
import { db } from "../src/config/db.js";

async function testActivityValidation() {
  console.log("=== AUDIT 2: ACTIVITY ASSIGNMENT VALIDATION & EDGE CASES ===");

  // Set user 209 (Merchant 183) to 'micro'
  await db.query("UPDATE merchants SET merchant_segment = 'micro' WHERE user_id = 209");

  const runTest = async (title, fn) => {
    try {
      const res = await fn();
      console.log(`[PASS_THROUGH/ACCEPTED] ${title}: HTTP 200 OK (Allowed by code) -> ${JSON.stringify(res).slice(0, 90)}...`);
      return { title, status: 200, outcome: "ACCEPTED", res };
    } catch (err) {
      console.log(`[REJECTED] ${title}: HTTP ${err.statusCode || 500} -> ${err.message}`);
      return { title, status: err.statusCode || 500, outcome: "REJECTED", message: err.message };
    }
  };

  // 1. Duplicate Primary Activity (passing array or invalid type)
  await runTest("Duplicate Primary Activity (array passed as primaryActivityId: [1, 1])", async () => {
    return merchantService.updateMerchantActivities(209, { primaryActivityId: [1, 1], additionalActivityIds: [] });
  });

  // 2. Duplicate Additional Activity ([2, 2])
  await runTest("Duplicate Additional Activity ([2, 2] in additionalActivityIds)", async () => {
    return merchantService.updateMerchantActivities(209, { primaryActivityId: 1, additionalActivityIds: [2, 2] });
  });

  // 3. Same activity as both Primary and Additional (primary: 1, additionals: [1, 2])
  await runTest("Same activity submitted as both Primary and Additional (1 and [1, 2])", async () => {
    return merchantService.updateMerchantActivities(209, { primaryActivityId: 1, additionalActivityIds: [1, 2] });
  });

  // 4. Activity from invalid industry / not mapped / non-existent (ID 99999)
  await runTest("Non-existent activity ID (primaryActivityId: 99999)", async () => {
    return merchantService.updateMerchantActivities(209, { primaryActivityId: 99999, additionalActivityIds: [] });
  });

  // 5. Activity unavailable for authenticated segment (micro user with activity 14: Garments Factory)
  await runTest("Activity unavailable for authenticated segment (micro with activity 14)", async () => {
    return merchantService.updateMerchantActivities(209, { primaryActivityId: 14, additionalActivityIds: [] });
  });

  // 6. Multiple Primary Activities (attempting to set multiple rows with activity_role='primary')
  await runTest("Multiple Primary Activities in payload (service accepts only single primaryActivityId parameter)", async () => {
    // Service method signature accepts single `primaryActivityId` and `additionalActivityIds`
    return merchantService.updateMerchantActivities(209, { primaryActivityId: 1, additionalActivityIds: [2] });
  });

  // 7. No Primary Activity when submitting empty payload
  await runTest("No Primary Activity provided ({ primaryActivityId: null, additionalActivityIds: [2] })", async () => {
    return merchantService.updateMerchantActivities(209, { primaryActivityId: null, additionalActivityIds: [2] });
  });

  // Check what actually got stored in DB after the tests
  const [stored] = await db.query("SELECT * FROM merchant_profile_activities WHERE merchant_id = 183");
  console.log("\nActual stored rows in merchant_profile_activities for merchant 183:", stored);

  // Clean up
  await db.query("UPDATE merchants SET merchant_segment = NULL WHERE user_id = 209");
  await db.query("DELETE FROM merchant_profile_activities WHERE merchant_id = 183");

  process.exit(0);
}

testActivityValidation().catch(e => {
  console.error(e);
  process.exit(1);
});

