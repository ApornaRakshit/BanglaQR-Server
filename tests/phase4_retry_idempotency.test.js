import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { db } from "../src/config/db.js";
import { secureStorage } from "../src/config/storage.js";
import { merchantService } from "../src/modules/merchants/merchant.service.js";

async function runDuplicateUploadRetryTest() {
  console.log("=== RUNNING DUPLICATE UPLOAD & CLIENT LOSS RETRY TEST ===");

  const tmpDir = secureStorage.getTmpUploadsDir();
  const TEST_PHONE = "01788776655";

  await db.execute("DELETE FROM users WHERE phone = ?", [TEST_PHONE]);
  const [uRes] = await db.execute(
    `INSERT INTO users (phone, email, password_hash, status, token_version, created_at, updated_at)
     VALUES (?, 'retry_test@banglaqr.local', 'hash', 'active', 0, NOW(), NOW())`,
    [TEST_PHONE]
  );
  const testUserId = uRes.insertId;

  const [mRes] = await db.execute(
    `INSERT INTO merchants (user_id, merchant_code, account_status, onboarding_step, created_at, updated_at)
     VALUES (?, 'RETRY_M_TEST', 'draft', 5, NOW(), NOW())`,
    [testUserId]
  );
  const testMerchantId = mRes.insertId;

  try {
    // 1. Initial successful upload
    const file1Path = path.join(tmpDir, `file1_${Date.now()}.jpg`);
    fs.writeFileSync(file1Path, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9]));

    const firstUpload = await merchantService.uploadDocument(testUserId, {
      path: file1Path,
      originalname: "nid_front.jpg",
      mimetype: "image/jpeg",
      size: 13,
    }, {
      documentType: "NID_FRONT",
      documentName: "National ID Front",
    });

    assert.ok(firstUpload.id);
    const initialDocId = firstUpload.id;

    // Verify 1 document in DB
    const [count1] = await db.execute(
      "SELECT COUNT(*) as count FROM merchant_documents WHERE merchant_id = ? AND document_type = 'NID_FRONT'",
      [testMerchantId]
    );
    assert.equal(Number(count1[0].count), 1, "Exactly 1 record must exist after first upload");

    // 2. Simulate client lost connection / retries same upload with the same document
    const fileRetryPath = path.join(tmpDir, `retry_${Date.now()}.jpg`);
    fs.writeFileSync(fileRetryPath, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9]));

    const retryUpload = await merchantService.uploadDocument(testUserId, {
      path: fileRetryPath,
      originalname: "nid_front.jpg",
      mimetype: "image/jpeg",
      size: 13,
    }, {
      documentType: "NID_FRONT",
      documentName: "National ID Front",
    });

    // Verify count in DB is STILL exactly 1 (Idempotent 1:1 replacement logic applied, no duplicate rows!)
    const [count2] = await db.execute(
      "SELECT COUNT(*) as count FROM merchant_documents WHERE merchant_id = ? AND document_type = 'NID_FRONT'",
      [testMerchantId]
    );
    assert.equal(Number(count2[0].count), 1, "Retrying MUST NOT create duplicate document records");

    // Verify document on disk is valid and readable
    const diskPath = secureStorage.getFilePath(retryUpload.storage_key, testMerchantId);
    assert.equal(fs.existsSync(diskPath), true, "Latest retried document must exist on disk");

    console.log("✓ Duplicate Upload & Retry Protection Verified: Exactly 1 record maintained, zero duplicate records created.");
  } finally {
    await db.execute("DELETE FROM merchant_documents WHERE merchant_id = ?", [testMerchantId]);
    await db.execute("DELETE FROM merchant_onboarding_history WHERE merchant_id = ?", [testMerchantId]);
    await db.execute("DELETE FROM merchants WHERE id = ?", [testMerchantId]);
    await db.execute("DELETE FROM users WHERE id = ?", [testUserId]);
    const mFolder = path.join(secureStorage.getStorageRoot(), `merchant_${testMerchantId}`);
    if (fs.existsSync(mFolder)) {
      fs.rmSync(mFolder, { recursive: true, force: true });
    }
  }
}

runDuplicateUploadRetryTest()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

