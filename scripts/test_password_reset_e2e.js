import { db } from "../src/config/db.js";
import argon2 from "argon2";
import { requestPasswordReset, verifyResetToken, resetPassword, loginUser } from "../src/modules/auth/auth.service.js";

async function runTests() {
  console.log("=== Testing Password Reset End-to-End ===");

  const testEmail = "reset_test_merchant@banglaqr.com";
  const tempNewPassword = "NewSecretPassword123!";
  const originalPassword = "OriginalPassword123!";

  // Ensure test user exists and is active
  const [existingUser] = await db.execute(`SELECT id FROM users WHERE email = ?`, [testEmail]);
  let userId;
  const initialHash = await argon2.hash(originalPassword);

  if (existingUser.length > 0) {
    userId = existingUser[0].id;
    await db.execute(
      `UPDATE users SET password_hash = ?, status = 'active', email_verified_at = NOW(), phone_verified_at = NOW() WHERE id = ?`,
      [initialHash, userId]
    );
  } else {
    const [ins] = await db.execute(
      `INSERT INTO users (email, phone, password_hash, status, email_verified_at, phone_verified_at) VALUES (?, '01711223344', ?, 'active', NOW(), NOW())`,
      [testEmail, initialHash]
    );
    userId = ins.insertId;
  }
  console.log("✓ Active test user ready with ID:", userId, testEmail);

  // Step 1: Request Password Reset for test user
  console.log("\n1. Requesting password reset for:", testEmail);
  const reqResult = await requestPasswordReset({ email: testEmail });
  console.log("✓ Request result:", reqResult);

  // Query database for the latest reset record
  const [resets] = await db.execute(
    `SELECT * FROM password_resets WHERE email = ? ORDER BY created_at DESC LIMIT 1`,
    [testEmail]
  );
  if (!resets.length) {
    throw new Error("FAIL: No password_resets record found in database!");
  }
  const latestReset = resets[0];
  console.log("✓ Found DB password reset record ID:", latestReset.id);
  console.log("✓ Token Hash stored:", latestReset.token_hash.slice(0, 16) + "...");
  console.log("✓ Used At:", latestReset.used_at);
  console.log("✓ Expires At:", latestReset.expires_at);

  // Step 2: Request Password Reset for non-existent user (anti-enumeration check)
  console.log("\n2. Requesting reset for non-existent email: unknown_user_xyz@domain.com");
  const nonExistentResult = await requestPasswordReset({ email: "unknown_user_xyz@domain.com" });
  console.log("✓ Non-existent response message (must be generic):", nonExistentResult.message);

  // Step 3: Test token verification with a fake token
  console.log("\n3. Verifying invalid token");
  const invalidVerify = await verifyResetToken({ token: "0000000000000000000000000000000000000000000000000000000000000000" });
  console.log("✓ Invalid token verify result:", invalidVerify);
  if (invalidVerify.valid) {
    throw new Error("FAIL: Invalid token was accepted as valid!");
  }

  // To test the reset flow end-to-end, let's create a known test token
  const crypto = await import("crypto");
  const rawTestToken = crypto.randomBytes(32).toString("hex");
  const { hashResetToken } = await import("../src/modules/auth/auth.utils.js");
  const hashedTestToken = hashResetToken(rawTestToken);

  await db.execute(
    `INSERT INTO password_resets (user_id, email, token_hash, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 15 MINUTE))`,
    [userId, testEmail, hashedTestToken]
  );

  // Verify the valid token
  console.log("\n4. Verifying valid generated test token");
  const validVerify = await verifyResetToken({ token: rawTestToken });
  console.log("✓ Valid token verify result:", validVerify);
  if (!validVerify.valid) {
    throw new Error("FAIL: Valid token was reported as invalid!");
  }

  // Step 5: Reset password with valid token
  console.log("\n5. Executing resetPassword with new password");
  const resetRes = await resetPassword({ token: rawTestToken, newPassword: tempNewPassword });
  console.log("✓ Reset password response:", resetRes);

  // Verify login works with new password
  console.log("\n6. Authenticating user with new password");
  const authWithNew = await loginUser({ email: testEmail, password: tempNewPassword });
  console.log("✓ Authenticated successfully with new password! User ID:", authWithNew.user.id);

  // Verify old password no longer works
  console.log("\n7. Verifying old password is now rejected");
  let oldAuthFailed = false;
  try {
    await loginUser({ email: testEmail, password: originalPassword });
  } catch (e) {
    oldAuthFailed = true;
    console.log("✓ Old password correctly rejected:", e.message);
  }
  if (!oldAuthFailed) {
    throw new Error("FAIL: Old password was still accepted!");
  }

  // Step 8: Verify token cannot be reused
  console.log("\n8. Attempting to reuse already-used token");
  let reuseFailed = false;
  try {
    await resetPassword({ token: rawTestToken, newPassword: "AnotherPassword999!" });
  } catch (e) {
    reuseFailed = true;
    console.log("✓ Reused token correctly rejected:", e.message);
  }
  if (!reuseFailed) {
    throw new Error("FAIL: Reused token was accepted!");
  }

  // Step 9: Restore original password
  console.log("\n9. Restoring original password for test user");
  const originalHash = await argon2.hash(originalPassword);
  await db.execute(`UPDATE users SET password_hash = ? WHERE id = ?`, [originalHash, userId]);
  const finalCheck = await loginUser({ email: testEmail, password: originalPassword });
  console.log("✓ Restored and verified original password for user:", finalCheck.user.email);

  console.log("\n🎉 ALL PASSWORD RESET E2E TESTS PASSED SUCCESSFULLY! 🎉\n");
  process.exit(0);
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
