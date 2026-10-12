import dotenv from "dotenv";
dotenv.config();

import { db } from "../src/config/db.js";
import { registerUser, loginUser, requestPasswordReset, resetPassword } from "../src/modules/auth/auth.service.js";
import { adminService } from "../src/modules/admin/admin.service.js";
import { adminMerchantsService } from "../src/modules/admin/merchants/admin.merchants.service.js";
import { isDevVerificationBypass } from "../src/config/env.js";
import { hashResetToken } from "../src/modules/auth/auth.utils.js";

async function runIntegrationTests() {
  console.log("=== STARTING BANGLAQR LOCAL DEV AUTH & ADMIN INTEGRATION TEST ===");
  console.log(`Current NODE_ENV: ${process.env.NODE_ENV}`);
  console.log(`AUTH_VERIFICATION_MODE: ${process.env.AUTH_VERIFICATION_MODE}`);
  console.log(`isDevVerificationBypass() => ${isDevVerificationBypass()}`);

  const testSuffix = Date.now();
  const testEmail = `devmerchant_${testSuffix}@banglaqr.com`;
  const testPhone = `0171${String(testSuffix).slice(-7)}`;
  const testPassword = "StrongPassword@123";
  const businessName = `Dev Merchant ${testSuffix}`;

  let createdUserId = null;
  let createdMerchantId = null;

  try {
    // ----------------------------------------------------
    // TEST 1: Register User in dev_bypass mode
    // ----------------------------------------------------
    console.log("\n[TEST 1] Testing Merchant Registration in dev bypass mode...");
    const regResult = await registerUser({
      fullName: "Dev Test Merchant",
      businessName,
      email: testEmail,
      phone: testPhone,
      password: testPassword,
      businessType: "retail"
    });

    if (!regResult || !regResult.user) {
      throw new Error("Registration failed to return user data.");
    }
    createdUserId = regResult.user.id;
    console.log(`✓ Registration succeeded. User ID: ${createdUserId}, bypassMode: ${regResult.verificationBypassed}`);

    // Verify DB integrity for truthful verification fields
    const [userRows] = await db.query("SELECT * FROM users WHERE id = ?", [createdUserId]);
    if (!userRows.length) throw new Error("User record not found in database.");
    const userDb = userRows[0];
    
    console.log(`- users.status: ${userDb.status}`);
    console.log(`- users.email_verified_at: ${userDb.email_verified_at}`);
    console.log(`- users.phone_verified_at: ${userDb.phone_verified_at}`);

    if (userDb.email_verified_at !== null || userDb.phone_verified_at !== null) {
      throw new Error("FAIL: email_verified_at or phone_verified_at should be NULL in dev bypass mode (truthful state).");
    }
    console.log("✓ Verification fields are truthfully NULL.");

    // Verify merchant and profile created
    const [merchantRows] = await db.query("SELECT * FROM merchants WHERE user_id = ?", [createdUserId]);
    if (!merchantRows.length) throw new Error("Merchant record was not created during registration!");
    createdMerchantId = merchantRows[0].id;
    console.log(`✓ Merchant record verified in DB. Merchant ID: ${createdMerchantId}, account_status: ${merchantRows[0].account_status}`);

    // ----------------------------------------------------
    // TEST 2: Login with Valid Password in dev bypass mode
    // ----------------------------------------------------
    console.log("\n[TEST 2] Testing Login with valid password in dev bypass mode...");
    const loginResult = await loginUser({
      identifier: testEmail,
      password: testPassword
    });

    if (!loginResult || !loginResult.accessToken) {
      throw new Error("Login failed to generate accessToken.");
    }
    console.log(`✓ Login successful. AccessToken issued. Role: ${loginResult.user.role}`);

    // ----------------------------------------------------
    // TEST 3: Login with Invalid Password Fails (Argon2 check)
    // ----------------------------------------------------
    console.log("\n[TEST 3] Testing Login with invalid password...");
    try {
      await loginUser({
        identifier: testEmail,
        password: "WrongPassword999!"
      });
      throw new Error("FAIL: Login with wrong password should have thrown an error.");
    } catch (err) {
      if (err.message.includes("FAIL")) throw err;
      console.log(`✓ Login with invalid password correctly rejected: ${err.message}`);
    }

    // ----------------------------------------------------
    // TEST 4: Suspended User is Blocked
    // ----------------------------------------------------
    console.log("\n[TEST 4] Testing Suspended User rejection...");
    await db.query("UPDATE users SET status = 'suspended' WHERE id = ?", [createdUserId]);
    try {
      await loginUser({
        identifier: testEmail,
        password: testPassword
      });
      throw new Error("FAIL: Suspended user should be blocked from logging in.");
    } catch (err) {
      if (err.message.includes("FAIL")) throw err;
      console.log(`✓ Suspended user login correctly blocked: ${err.message}`);
    }
    // Revert user status to pending
    await db.query("UPDATE users SET status = 'pending' WHERE id = ?", [createdUserId]);

    // ----------------------------------------------------
    // TEST 5: Admin Merchant Management List shows real data
    // ----------------------------------------------------
    console.log("\n[TEST 5] Testing Admin Merchant Management listing...");
    const adminMerchantsResult = await adminMerchantsService.listMerchants({
      search: testEmail,
      page: 1,
      limit: 10
    });

    const foundMerchant = adminMerchantsResult.merchants.find(m => m.user_id === createdUserId || m.email === testEmail);
    if (!foundMerchant) {
      throw new Error(`FAIL: Newly registered merchant with email ${testEmail} not found in Admin Merchant list.`);
    }
    console.log(`✓ Admin Merchant list returned newly registered merchant: ID ${foundMerchant.id}, Business: ${foundMerchant.company_name || foundMerchant.business_name || 'Found'}`);

    // ----------------------------------------------------
    // TEST 6: Admin Dashboard Overview
    // ----------------------------------------------------
    console.log("\n[TEST 6] Testing Admin Dashboard Overview...");
    const dashboardData = await adminService.getDashboardData({ user: { role: "admin" } });
    console.log(`✓ Admin Overview counts: totalMerchants=${dashboardData.stats.totalMerchants}, pendingReview=${dashboardData.stats.pendingReview}, approved=${dashboardData.stats.approved}`);
    if (typeof dashboardData.stats.totalMerchants !== "number" || dashboardData.stats.totalMerchants <= 0) {
      throw new Error("FAIL: Admin Overview returned invalid totalMerchants count.");
    }

    // ----------------------------------------------------
    // TEST 7: Production Guard (NODE_ENV=production blocks bypass)
    // ----------------------------------------------------
    console.log("\n[TEST 7] Testing Production Guard...");
    const prevNodeEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      const isBypassInProd = isDevVerificationBypass();
      console.log(`isDevVerificationBypass() in production: ${isBypassInProd}`);
      if (isBypassInProd === true) {
        throw new Error("FAIL: isDevVerificationBypass MUST be false when NODE_ENV=production!");
      }

      // Trying login in production for unverified user should fail with verification requirement
      try {
        await loginUser({
          identifier: testEmail,
          password: testPassword
        });
        throw new Error("FAIL: In production, unverified user must be blocked with HTTP 403 / verification required.");
      } catch (err) {
        if (err.message.includes("FAIL")) throw err;
        console.log(`✓ Production login check correctly enforced verification: status=${err.status}, message=${err.message}`);
      }
    } finally {
      process.env.NODE_ENV = prevNodeEnv;
    }

    // ----------------------------------------------------
    // TEST 8: Forgot Password and Reset Flow
    // ----------------------------------------------------
    console.log("\n[TEST 8] Testing Forgot Password and Single-Use Reset Token...");
    const resetReqResult = await requestPasswordReset({ email: testEmail });
    console.log(`✓ Password reset requested. Message: ${resetReqResult.message}`);

    // Generate a known token for direct validation and consumption test
    const rawToken = "test_reset_token_" + Date.now() + "_" + Math.random().toString(36).substring(2);
    const tokenHash = hashResetToken(rawToken);

    await db.execute(
      `INSERT INTO password_resets (user_id, email, token_hash, expires_at, created_at)
       VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 15 MINUTE), NOW())`,
      [createdUserId, testEmail, tokenHash]
    );

    const newPassword = "NewStrongPassword@456";
    const resetResult = await resetPassword({
      token: rawToken,
      newPassword
    });
    console.log(`✓ Password reset succeeded. Message: ${resetResult.message}`);

    // Verify token marked as used in password_resets
    const [usedTokenRows] = await db.query("SELECT used_at FROM password_resets WHERE token_hash = ?", [tokenHash]);
    if (!usedTokenRows[0].used_at) {
      throw new Error("FAIL: Token used_at timestamp was not updated.");
    }
    console.log(`✓ Token used_at timestamp verified: ${usedTokenRows[0].used_at}`);

    // Test token cannot be reused
    try {
      await resetPassword({
        token: rawToken,
        newPassword: "AnotherPassword@789"
      });
      throw new Error("FAIL: Reusing a used password reset token should be rejected.");
    } catch (err) {
      if (err.message.includes("FAIL")) throw err;
      console.log(`✓ Single-use token enforcement confirmed: ${err.message}`);
    }

    // Verify can login with new password
    const loginWithNewPass = await loginUser({
      identifier: testEmail,
      password: newPassword
    });
    if (!loginWithNewPass || !loginWithNewPass.accessToken) {
      throw new Error("FAIL: Could not log in with new password.");
    }
    console.log("✓ Login with newly reset password succeeded!");

    console.log("\n========================================================");
    console.log(" ALL INTEGRATION AND DEV BYPASS TESTS PASSED PERFECTLY! ");
    console.log("========================================================");

  } catch (error) {
    console.error("\n❌ TEST FAILED:", error);
    process.exitCode = 1;
  } finally {
    // Cleanup test data
    if (createdUserId) {
      try {
        await db.query("DELETE FROM password_resets WHERE user_id = ?", [createdUserId]);
        await db.query("DELETE FROM merchant_contacts WHERE merchant_id IN (SELECT id FROM merchants WHERE user_id = ?)", [createdUserId]);
        await db.query("DELETE FROM merchant_profiles WHERE merchant_id IN (SELECT id FROM merchants WHERE user_id = ?)", [createdUserId]);
        await db.query("DELETE FROM merchants WHERE user_id = ?", [createdUserId]);
        await db.query("DELETE FROM user_roles WHERE user_id = ?", [createdUserId]);
        await db.query("DELETE FROM users WHERE id = ?", [createdUserId]);
        console.log("✓ Cleaned up test user and merchant records.");
      } catch (cleanupErr) {
        console.warn("Cleanup warning:", cleanupErr.message);
      }
    }
    await db.end();
  }
}

runIntegrationTests();
