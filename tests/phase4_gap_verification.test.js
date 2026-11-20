import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { db } from "../src/config/db.js";
import { secureStorage } from "../src/config/storage.js";
import { merchantService } from "../src/modules/merchants/merchant.service.js";
import { merchantRepository } from "../src/modules/merchants/merchant.repository.js";
import { validateFileSignature } from "../src/utils/fileValidator.js";

async function runGapVerificationSuite() {
  console.log("=== STARTING PHASE 4 GAP VERIFICATION TEST SUITE ===");

  // Staging safety guard
  const [dbRows] = await db.execute("SELECT DATABASE() as db");
  const currentDb = dbRows[0]?.db;
  assert.ok(currentDb && !currentDb.toLowerCase().includes("prod"), "Never run tests against production!");
  console.log(`[Safety Guard PASS] Staging database verified: "${currentDb}"`);

  const tmpDir = secureStorage.getTmpUploadsDir();
  const storageRoot = secureStorage.getStorageRoot();

  // Synthetic Test User & Merchant
  const TEST_PHONE = "01799112233";
  await db.execute("DELETE FROM users WHERE phone = ?", [TEST_PHONE]);
  const [uRes] = await db.execute(
    `INSERT INTO users (phone, email, password_hash, status, token_version, created_at, updated_at)
     VALUES (?, 'gap_test_merchant@banglaqr.local', 'hash', 'active', 0, NOW(), NOW())`,
    [TEST_PHONE]
  );
  const testUserId = uRes.insertId;

  const [mRes] = await db.execute(
    `INSERT INTO merchants (user_id, merchant_code, account_status, onboarding_step, created_at, updated_at)
     VALUES (?, 'GAP_M_TEST', 'draft', 5, NOW(), NOW())`,
    [testUserId]
  );
  const testMerchantId = mRes.insertId;

  let initialDocId = null;

  try {
    // -------------------------------------------------------------
    // GAP REQUIREMENT A: Complete Replacement Failure Simulation
    // -------------------------------------------------------------
    console.log("\n[GAP REQUIREMENT A] Testing Complete Document Replacement Failure Simulation...");

    // Step 1: Upload an existing valid synthetic document
    const origFilePath = path.join(tmpDir, `orig_doc_${Date.now()}.jpg`);
    fs.writeFileSync(origFilePath, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9]));

    const origUpload = await merchantService.uploadDocument(testUserId, {
      path: origFilePath,
      originalname: "original_trade_license.jpg",
      mimetype: "image/jpeg",
      size: 13,
    }, {
      documentType: "TRADE_LICENSE",
      documentName: "Original Trade License",
    });

    initialDocId = origUpload.id;
    const initialStorageKey = origUpload.storage_key;
    const initialDiskPath = secureStorage.getFilePath(initialStorageKey, testMerchantId);

    // Step 2: Record its storage key and database reference
    assert.ok(initialDocId);
    assert.equal(fs.existsSync(initialDiskPath), true, "Original document must exist on disk");

    const [dbDocBefore] = await db.execute("SELECT storage_key, document_name FROM merchant_documents WHERE id = ?", [initialDocId]);
    assert.equal(dbDocBefore[0].storage_key, initialStorageKey);

    // Step 3 & 4: Attempt to replace it with a valid new file, but simulate MySQL failure
    const newReplacementPath = path.join(tmpDir, `replacement_doc_${Date.now()}.jpg`);
    fs.writeFileSync(newReplacementPath, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9]));

    // Monkeypatch merchantRepository.replaceDocument to throw simulated MySQL error
    const originalReplaceRepo = merchantRepository.replaceDocument;
    merchantRepository.replaceDocument = async () => {
      throw new Error("Simulated MySQL Deadlock/Constraint Error during replaceDocument update");
    };

    let replacementFailed = false;
    try {
      await merchantService.replaceDocument(testUserId, initialDocId, {
        path: newReplacementPath,
        originalname: "replacement_trade_license.jpg",
        mimetype: "image/jpeg",
        size: 13,
      }, {
        documentName: "Attempted Replacement",
      });
    } catch (err) {
      replacementFailed = true;
      assert.ok(err.message.includes("Simulated MySQL Deadlock"));
    } finally {
      merchantRepository.replaceDocument = originalReplaceRepo;
    }

    assert.equal(replacementFailed, true, "Replacement must throw on MySQL persistence failure");

    // Step 5: Confirm that the old document remains present and readable
    assert.equal(fs.existsSync(initialDiskPath), true, "Original document MUST NOT be deleted when replacement fails");

    // Step 6: Confirm that the database still points to the old document
    const [dbDocAfterFail] = await db.execute("SELECT storage_key, document_name FROM merchant_documents WHERE id = ?", [initialDocId]);
    assert.equal(dbDocAfterFail[0].storage_key, initialStorageKey, "DB must still reference original document storage_key");
    assert.equal(dbDocAfterFail[0].document_name, "Original Trade License");

    // Step 7: Confirm that the newly created replacement file is cleaned up (no orphaned files in merchant folder)
    const merchantFiles = fs.readdirSync(path.join(storageRoot, `merchant_${testMerchantId}`));
    assert.equal(merchantFiles.length, 1, "Only the 1 original file must remain in merchant directory (orphan cleaned up)");
    assert.equal(merchantFiles[0], path.basename(initialDiskPath));
    console.log("✓ Gap Requirement A Passed: Replacement rollback preserves original document & cleans orphaned replacement.");

    // -------------------------------------------------------------
    // GAP REQUIREMENT B: Temporary Upload Cleanup
    // -------------------------------------------------------------
    console.log("\n[GAP REQUIREMENT B] Testing Temporary Upload Cleanup Across Rejection Cases...");

    // B1: Invalid signature file cleanup
    const badSigPath = path.join(tmpDir, `badsig_${Date.now()}.png`);
    fs.writeFileSync(badSigPath, Buffer.from("NOT_A_VALID_PNG_DATA"));
    let badSigRejected = false;
    try {
      await merchantService.uploadDocument(testUserId, {
        path: badSigPath,
        originalname: "fake.png",
        mimetype: "image/png",
        size: 20,
      }, { documentType: "UTILITY_BILL" });
    } catch (err) {
      badSigRejected = true;
    }
    assert.equal(badSigRejected, true);
    assert.equal(fs.existsSync(badSigPath), false, "Temporary file with invalid signature must be purged from tmp");

    // B2: Stale tmp files cleanup routine
    const staleTmpFile = path.join(tmpDir, `stale_${Date.now()}.tmp`);
    fs.writeFileSync(staleTmpFile, "stale_upload_residue");
    // Artificially change mtime to 2 hours ago
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    fs.utimesSync(staleTmpFile, twoHoursAgo, twoHoursAgo);

    const cleanedCount = await secureStorage.cleanStaleTmpFiles(60 * 60 * 1000); // files > 1 hour
    assert.ok(cleanedCount >= 1, "Stale temporary file cleanup must purge old abandoned files");
    assert.equal(fs.existsSync(staleTmpFile), false, "Stale file must be removed");
    console.log("✓ Gap Requirement B Passed: Tmp files purged on validation failure and stale cleanup routine works.");

    // -------------------------------------------------------------
    // GAP REQUIREMENT F: Structural Image & PDF Validation
    // -------------------------------------------------------------
    console.log("\n[GAP REQUIREMENT F] Testing Deep Structural Validation for Malformed Files...");

    // F1: Truncated JPEG (missing FF D9 trailer)
    const truncatedJpg = path.join(tmpDir, `trunc_${Date.now()}.jpg`);
    fs.writeFileSync(truncatedJpg, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00])); // No FF D9
    const truncJpgRes = await validateFileSignature(truncatedJpg);
    assert.equal(truncJpgRes.isValid, false);
    assert.ok(truncJpgRes.error.includes("অসম্পূর্ণ বা ত্রুটিযুক্ত"));
    fs.unlinkSync(truncatedJpg);

    // F2: Truncated PNG (missing IEND)
    const truncatedPng = path.join(tmpDir, `trunc_${Date.now()}.png`);
    fs.writeFileSync(truncatedPng, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]));
    const truncPngRes = await validateFileSignature(truncatedPng);
    assert.equal(truncPngRes.isValid, false);
    assert.ok(truncPngRes.error.includes("IEND"));
    fs.unlinkSync(truncatedPng);

    // F3: Corrupted PDF (missing %%EOF)
    const truncatedPdf = path.join(tmpDir, `trunc_${Date.now()}.pdf`);
    fs.writeFileSync(truncatedPdf, Buffer.from("%PDF-1.4\nsome malformed content without EOF"));
    const truncPdfRes = await validateFileSignature(truncatedPdf);
    assert.equal(truncPdfRes.isValid, false);
    assert.ok(truncPdfRes.error.includes("%%EOF"));
    fs.unlinkSync(truncatedPdf);
    console.log("✓ Gap Requirement F Passed: Truncated/malformed JPEG, PNG, and PDF structurally rejected.");

    // -------------------------------------------------------------
    // GAP REQUIREMENT G: Response Headers & Containment Check
    // -------------------------------------------------------------
    console.log("\n[GAP REQUIREMENT G] Verifying Storage Containment & Security...");
    const relativeKey = origUpload.storage_key;
    const resolvedPath = secureStorage.getFilePath(relativeKey, testMerchantId);
    assert.ok(resolvedPath.startsWith(path.resolve(storageRoot)), "Resolved path must be inside secure storage root");
    assert.ok(!resolvedPath.includes(".."), "Normalized path must not contain traversal segments");
    console.log("✓ Gap Requirement G Passed: Path containment and canonical root verification confirmed.");

    console.log("\n=================================================================");
    console.log("ALL PHASE 4 GAP VERIFICATION TESTS PASSED (100%)");
    console.log("=================================================================");
  } finally {
    // Teardown
    await db.execute("DELETE FROM merchant_documents WHERE merchant_id = ?", [testMerchantId]);
    await db.execute("DELETE FROM merchant_onboarding_history WHERE merchant_id = ?", [testMerchantId]);
    await db.execute("DELETE FROM merchants WHERE id = ?", [testMerchantId]);
    await db.execute("DELETE FROM users WHERE id = ?", [testUserId]);

    const mFolder = path.join(storageRoot, `merchant_${testMerchantId}`);
    if (fs.existsSync(mFolder)) {
      fs.rmSync(mFolder, { recursive: true, force: true });
    }
    console.log("[Cleanup] Staging test fixtures safely removed.");
  }
}

runGapVerificationSuite()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Gap Verification Failed:", err);
    process.exit(1);
  });

