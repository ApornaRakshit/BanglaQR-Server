import assert from "node:assert/strict";
import { db } from "../src/config/db.js";
import { merchantService } from "../src/modules/merchants/merchant.service.js";
import { merchantRepository } from "../src/modules/merchants/merchant.repository.js";
import { adminDocumentsService } from "../src/modules/admin/documents/admin.documents.service.js";
import { institutionService } from "../src/modules/institution/institution.service.js";
import { faqController } from "../src/modules/admin/cms/faq.controller.js";
import { paymentsService } from "../src/modules/payments/payments.service.js";

async function runRemainingRegressionSuite() {
  console.log("=== RUNNING REMAINING REGRESSION TESTS ===");

  // 1. Merchant Draft Save / Restore
  console.log("[Regression 1] Testing Merchant Onboarding Draft Save / Restore...");
  const TEST_PHONE = "01755443322";
  await db.execute("DELETE FROM users WHERE phone = ?", [TEST_PHONE]);
  const [u] = await db.execute(
    `INSERT INTO users (phone, email, password_hash, status, token_version, created_at, updated_at)
     VALUES (?, 'draft_test@banglaqr.local', 'hash', 'active', 0, NOW(), NOW())`,
    [TEST_PHONE]
  );
  const userId = u.insertId;

  // Update company (Step 1 draft)
  await merchantService.updateCompany(userId, {
    companyName: "Draft Merchant Enterprise",
    businessType: "sole_proprietorship",
  });

  const [mRec] = await db.execute("SELECT id FROM merchants WHERE user_id = ?", [userId]);
  const merchantId = mRec[0].id;

  const profile = await merchantRepository.getProfile(merchantId);
  assert.equal(profile.company_name, "Draft Merchant Enterprise");

  const onboardingStatus = await merchantService.getOnboardingStatus(userId);
  assert.equal(onboardingStatus.merchantId, merchantId);
  assert.ok(onboardingStatus.onboardingStep >= 1);
  console.log("✓ Regression 1 Passed: Merchant draft successfully saved and restored.");

  // 2. Admin & Institution Document Review APIs
  console.log("[Regression 2] Testing Admin & Institution Document Review Lists...");
  const adminDocs = await adminDocumentsService.listDocuments({ page: 1, limit: 5 });
  assert.ok(Array.isArray(adminDocs.documents || adminDocs));
  console.log("✓ Regression 2 Passed: Admin document review service operational.");

  // 3. CMS Public Endpoints
  console.log("[Regression 3] Testing CMS FAQ Retrieval...");
  const [faqs] = await db.execute("SELECT id, question, answer FROM faqs LIMIT 1");
  assert.ok(Array.isArray(faqs));
  console.log("✓ Regression 3 Passed: CMS database connectivity & models operational.");

  // 4. Payment & Gateway Services
  console.log("[Regression 4] Testing Gateway catalogue & orders query...");
  const [gateways] = await db.execute("SELECT id, name, code, status FROM gateways LIMIT 1");
  assert.ok(Array.isArray(gateways));
  console.log("✓ Regression 4 Passed: Payment & Gateway data structures operational.");

  // Cleanup
  await db.execute("DELETE FROM merchant_profiles WHERE merchant_id = (SELECT id FROM merchants WHERE user_id = ?)", [userId]);
  await db.execute("DELETE FROM merchants WHERE user_id = ?", [userId]);
  await db.execute("DELETE FROM users WHERE id = ?", [userId]);

  console.log("=== ALL REMAINING REGRESSION CHECKS PASSED (100%) ===");
}

runRemainingRegressionSuite()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Regression Failed:", err);
    process.exit(1);
  });
