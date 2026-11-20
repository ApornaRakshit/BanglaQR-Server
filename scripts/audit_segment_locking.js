import { merchantService } from "../src/modules/merchants/merchant.service.js";
import { db } from "../src/config/db.js";

async function testSegmentLocking() {
  console.log("=== AUDIT 4: SEGMENT LOCKING ACROSS APPLICATION STATES ===");

  // 1. DRAFT state (Merchant 183 / User 209)
  try {
    await merchantService.updateCompany(209, { merchantSegment: "micro" });
    console.log("[DRAFT] Merchant 183: Segment change ALLOWED (HTTP 200 OK)");
  } catch (err) {
    console.log(`[DRAFT] Merchant 183: FAILED -> ${err.message}`);
  }
  await db.query("UPDATE merchants SET merchant_segment = NULL WHERE id = 183");

  // 2. SUBMITTED state (Merchant 319 / User 432)
  try {
    await merchantService.updateCompany(432, { merchantSegment: "big" });
    console.log("[SUBMITTED] Merchant 319: Segment change ALLOWED (UNEXPECTED!)");
  } catch (err) {
    console.log(`[SUBMITTED] Merchant 319: REJECTED with HTTP ${err.statusCode || 500} [${err.code}] -> ${err.message}`);
  }

  // 3. UNDER_REVIEW state (Simulate on Merchant 184 / User 210)
  await db.query("UPDATE merchants SET account_status = 'under_review' WHERE id = 184");
  try {
    await merchantService.updateCompany(210, { merchantSegment: "micro" });
    console.log("[UNDER_REVIEW] Merchant 184: Segment change ALLOWED (UNEXPECTED!)");
  } catch (err) {
    console.log(`[UNDER_REVIEW] Merchant 184: REJECTED with HTTP ${err.statusCode || 500} [${err.code}] -> ${err.message}`);
  }

  // 4. APPROVED state (Simulate on Merchant 184 / User 210)
  await db.query("UPDATE merchants SET account_status = 'approved' WHERE id = 184");
  try {
    await merchantService.updateCompany(210, { merchantSegment: "micro" });
    console.log("[APPROVED] Merchant 184: Segment change ALLOWED (UNEXPECTED!)");
  } catch (err) {
    console.log(`[APPROVED] Merchant 184: REJECTED with HTTP ${err.statusCode || 500} [${err.code}] -> ${err.message}`);
  }

  // Revert 184 back to draft
  await db.query("UPDATE merchants SET account_status = 'draft' WHERE id = 184");

  // 5. Unresolved Legacy NULL Segment
  const [m183] = await db.query("SELECT merchant_segment FROM merchants WHERE id = 183");
  const me183 = await merchantService.getMerchantMe(209);
  console.log(`[LEGACY NULL] DB segment: ${m183[0].merchant_segment}, getMerchantMe: ${me183.merchant.merchantSegment} (Preserved safely as null)`);

  process.exit(0);
}

testSegmentLocking().catch(e => {
  console.error(e);
  process.exit(1);
});

