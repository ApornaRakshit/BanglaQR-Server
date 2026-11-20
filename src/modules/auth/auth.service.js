import { hashPassword, verifyPassword } from "../../utils/password.js";
import crypto from "crypto";

import { db } from "../../config/db.js";
import { env, isDevVerificationBypass } from "../../config/env.js";
import { emailService } from "../../services/email.service.js";
import { smsService, normalizeBdPhone } from "../../services/sms.service.js";
import { adminSettingsRepository } from "../admin/settings/admin.settings.module.js";
import { smsOutboxService } from "../sms/outbox.worker.js";

import {
  generateOtp,
  hashOtp,
  createAccessToken,
  createLoginChallengeToken,
  verifyLoginChallengeToken,
  createPasswordResetChallengeToken,
  verifyPasswordResetChallengeToken,
  generateResetToken,
  hashResetToken,
} from "./auth.utils.js";

const OTP_LIFETIME_MS = 5 * 60 * 1000; // 5 minutes
const RESEND_COOLDOWN_MS = 60 * 1000; // 60 seconds
const MAX_OTP_ATTEMPTS = 5;

function getOtpExpiry() {
  return new Date(Date.now() + OTP_LIFETIME_MS);
}

function normalizeDestination(destination, purpose) {
  if (!destination || typeof destination !== "string") return "";
  const trimmed = destination.trim();
  if (purpose === "email_verification" || trimmed.includes("@")) {
    return trimmed.toLowerCase();
  }
  const normalizedPhone = normalizeBdPhone(trimmed);
  return normalizedPhone ? normalizedPhone.local : trimmed;
}

function getDestinationVariants(destination, purpose) {
  if (!destination || typeof destination !== "string") return [];
  const trimmed = destination.trim();
  if (purpose === "email_verification" || trimmed.includes("@")) {
    return [trimmed.toLowerCase()];
  }
  const phoneData = normalizeBdPhone(trimmed);
  if (phoneData) {
    return Array.from(
      new Set([phoneData.local, phoneData.international, phoneData.e164, trimmed])
    ).filter(Boolean);
  }
  return [trimmed];
}

async function getMerchantRoleId(connection) {
  const [rows] = await connection.execute(
    `
      SELECT id
      FROM roles
      WHERE name = 'merchant'
      LIMIT 1
    `
  );

  if (!rows.length) {
    throw new Error(
      "Merchant role is not configured"
    );
  }

  return rows[0].id;
}

export async function createAndSendOtp(
  connectionOrDb,
  userId,
  rawDestination,
  purpose
) {
  const destination = normalizeDestination(rawDestination, purpose);
  if (!destination) {
    const error = new Error("Invalid destination provided for verification");
    error.statusCode = 400;
    throw error;
  }

  const destinationVariants = getDestinationVariants(rawDestination, purpose);
  const placeholders = destinationVariants.map(() => "?").join(", ");

  // 1. Check Resend Cooldown
  const [activeOtps] = await connectionOrDb.execute(
    `
      SELECT created_at
      FROM otp_codes
      WHERE destination IN (${placeholders})
        AND purpose = ?
        AND verified_at IS NULL
        AND expires_at > NOW()
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [...destinationVariants, purpose]
  );

  if (activeOtps.length > 0) {
    const lastCreated = new Date(activeOtps[0].created_at).getTime();
    const elapsed = Date.now() - lastCreated;
    if (elapsed < RESEND_COOLDOWN_MS) {
      const waitSeconds = Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000);
      const error = new Error(
        `Please wait ${waitSeconds} seconds before requesting a new verification code.`
      );
      error.statusCode = 429;
      error.waitSeconds = waitSeconds;
      throw error;
    }
  }

  // 2. Generate 6-digit cryptographic OTP and HMAC hash
  const code = generateOtp();
  const codeHash = hashOtp(code);
  const expiresAt = getOtpExpiry();

  // 3. Invalidate previous unverified OTPs for this destination and purpose (expire them)
  await connectionOrDb.execute(
    `
      UPDATE otp_codes
      SET expires_at = DATE_SUB(NOW(), INTERVAL 1 SECOND)
      WHERE destination IN (${placeholders})
        AND purpose = ?
        AND verified_at IS NULL
    `,
    [...destinationVariants, purpose]
  );

  // 4. Store hashed OTP and enqueue durable outbox atomically inside a transaction
  let insertOtpResult;
  let otpCodeId = null;

  // Use connection if provided, otherwise obtain a dedicated connection for atomic transaction
  let conn = null;
  let shouldReleaseConn = false;
  if (typeof connectionOrDb.beginTransaction === "function") {
    conn = connectionOrDb;
  } else if (typeof connectionOrDb.getConnection === "function") {
    conn = await connectionOrDb.getConnection();
    shouldReleaseConn = true;
  }

  const executor = conn || connectionOrDb;
  if (conn) {
    await conn.beginTransaction();
  }

  try {
    const [res] = await executor.execute(
      `
        INSERT INTO otp_codes
        (
          user_id,
          destination,
          purpose,
          code_hash,
          expires_at,
          attempts,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, 0, NOW())
      `,
      [
        userId,
        destination,
        purpose,
        codeHash,
        expiresAt,
      ]
    );
    insertOtpResult = res;
    otpCodeId = insertOtpResult?.insertId || null;

    if (purpose === "password_reset") {
      await smsOutboxService.enqueueSms(executor, {
        otpCodeId,
        destination,
        purpose,
        otp: code,
        expiresAt,
      });
    }

    if (conn) {
      await conn.commit();
    }
  } catch (err) {
    if (conn) {
      await conn.rollback();
    }
    throw err;
  } finally {
    if (shouldReleaseConn && conn) {
      conn.release();
    }
  }

  // 5. Deliver through real channel.
  // For password_reset, outbox job was committed above; trigger worker asynchronously.
  let deliveryResult = null;
  if (purpose === "email_verification") {
    deliveryResult = await emailService.sendOtpEmail({
      to: destination,
      otp: code,
      purpose,
      expiresMinutes: 5,
    });
  } else if (purpose === "password_reset") {
    // Asynchronously trigger batch worker without blocking HTTP response
    smsOutboxService.processOutboxBatch(5).catch((err) => {
      console.error("[SmsOutbox] Async outbox batch processing error:", err.message);
    });
  } else if (purpose === "phone_verification" || purpose === "login") {
    deliveryResult = await smsService.sendOtpSms({
      to: destination,
      otp: code,
      purpose,
      expiresMinutes: 5,
    });
  }

  if (env.nodeEnv === "development") {
    console.log(
      `[DEV OTP DELIVERY] ${purpose} -> ${destination}: Code=${code} (Expires in 5m)`
    );
  }

  return {
    success: true,
    destination,
    purpose,
    expiresInSeconds: 300,
    cooldownSeconds: 60,
    delivery: deliveryResult,
  };
}

import { merchantRepository } from "../merchants/merchant.repository.js";

export async function registerUser({
  fullName,
  name,
  email,
  phone,
  password,
  otpChannel = "phone",
}) {
  // Check maintenance and registration policy from global settings
  try {
    const maintenance = await adminSettingsRepository.getSettingValue("maintenance_status", {});
    if (maintenance.maintenanceMode) {
      const err = new Error(maintenance.maintenanceMessage || "Platform is currently under scheduled maintenance. New registrations are temporarily disabled.");
      err.statusCode = 503;
      throw err;
    }
    if (maintenance.registrationEnabled === false) {
      const err = new Error("New merchant onboarding and registrations are currently closed by platform administrator.");
      err.statusCode = 403;
      throw err;
    }
  } catch (e) {
    if (e.statusCode) throw e;
  }

  const connection = await db.getConnection();
  const contactName = (fullName || name || "").trim();
  const normalizedEmail = (email || "").trim().toLowerCase();
  const normalizedPhoneData = normalizeBdPhone(phone);
  const normalizedPhone = normalizedPhoneData ? normalizedPhoneData.local : (phone || "").trim();

  try {
    await connection.beginTransaction();

    const [existing] = await connection.execute(
      `
        SELECT id
        FROM users
        WHERE email = ? OR phone = ?
        LIMIT 1
      `,
      [normalizedEmail, normalizedPhone]
    );

    if (existing.length) {
      const error = new Error(
        "An account already exists with this email or phone"
      );
      error.statusCode = 409;
      throw error;
    }

    const passwordHash = await hashPassword(password);

    const [result] = await connection.execute(
      `
        INSERT INTO users
        (
          email,
          phone,
          password_hash,
          status
        )
        VALUES (?, ?, ?, 'pending')
      `,
      [
        normalizedEmail,
        normalizedPhone,
        passwordHash,
      ]
    );

    const userId = result.insertId;

    const roleId = await getMerchantRoleId(connection);

    await connection.execute(
      `
        INSERT INTO user_roles
        (user_id, role_id)
        VALUES (?, ?)
      `,
      [userId, roleId]
    );

    // Create merchant record within transaction
    const merchant = await merchantRepository.findOrCreateMerchantByUserId(userId, connection);

    // Pre-populate merchant contact and initial profile within transaction
    if (contactName) {
      await merchantRepository.upsertContact(merchant.id, {
        name: contactName,
        email: normalizedEmail,
        phone: normalizedPhone,
        designation: "Authorized Signatory",
      }, connection);

      await merchantRepository.upsertProfile(merchant.id, {
        companyName: "",
      }, connection);
    }

    // Determine selected OTP channel: "email" or "phone" (or "choose" if deferred to verify page)
    const channel = String(otpChannel || "phone").toLowerCase();
    let otpSentChannel = null;
    let initialMessage = "Account created successfully. Please choose your verification method.";

    if (channel === "email") {
      await createAndSendOtp(
        connection,
        userId,
        normalizedEmail,
        "email_verification"
      );
      otpSentChannel = "email";
      initialMessage = "Account created. A 6-digit verification code has been sent to your email address.";
    } else if (channel === "phone") {
      await createAndSendOtp(
        connection,
        userId,
        normalizedPhone,
        "phone_verification"
      );
      otpSentChannel = "phone";
      initialMessage = "Account created. A 6-digit verification code has been sent to your mobile phone via SMS.";
    }

    await connection.commit();

    return {
      userId,
      merchantId: merchant.id,
      merchantCode: merchant.merchant_code,
      fullName: contactName,
      email: normalizedEmail,
      phone: normalizedPhone,
      otpChannel: otpSentChannel,
      status: "pending",
      role: "merchant",
      verificationBypassed: false,
      accessToken: null,
      message: initialMessage,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function verifyOtp({
  destination: rawDestination,
  code,
  purpose,
  email,
}) {
  const destination = normalizeDestination(rawDestination, purpose);
  if (!destination) {
    const error = new Error("Invalid destination provided for verification");
    error.statusCode = 400;
    throw error;
  }

  if (!code || typeof code !== "string" || code.trim().length !== 6) {
    const error = new Error("Please enter a valid 6-digit verification code");
    error.statusCode = 400;
    throw error;
  }

  const destinationVariants = getDestinationVariants(rawDestination, purpose);
  const placeholders = destinationVariants.map(() => "?").join(", ");
  const incomingHash = hashOtp(code.trim());

  let specifiedUser = null;
  if (email && typeof email === "string" && email.trim()) {
    const [uRows] = await db.execute(
      `SELECT id, email, phone FROM users WHERE email = ? LIMIT 1`,
      [email.trim().toLowerCase()]
    );
    if (uRows.length) specifiedUser = uRows[0];
  }

  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    // 1. Check if this code was already verified / consumed
    const [alreadyUsed] = await connection.execute(
      `
        SELECT id
        FROM otp_codes
        WHERE (destination IN (${placeholders}) ${specifiedUser ? "OR user_id = ?" : ""})
          AND purpose = ?
          AND code_hash = ?
          AND verified_at IS NOT NULL
        LIMIT 1
      `,
      specifiedUser
        ? [...destinationVariants, specifiedUser.id, purpose, incomingHash]
        : [...destinationVariants, purpose, incomingHash]
    );

    if (alreadyUsed.length > 0) {
      const error = new Error("This verification code has already been used.");
      error.statusCode = 400;
      throw error;
    }

    // 2. Fetch the latest unverified OTP for this destination and purpose
    const [rows] = await connection.execute(
      `
        SELECT
          id,
          user_id,
          destination,
          purpose,
          code_hash,
          expires_at,
          verified_at,
          attempts,
          created_at
        FROM otp_codes
        WHERE (destination IN (${placeholders}) ${specifiedUser ? "OR user_id = ?" : ""})
          AND purpose = ?
          AND verified_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE
      `,
      specifiedUser
        ? [...destinationVariants, specifiedUser.id, purpose]
        : [...destinationVariants, purpose]
    );

    if (!rows.length) {
      const error = new Error(
        "ভেরিফিকেশন কোড পাওয়া যায়নি। অনুগ্রহ করে পুনরায় কোড পাঠান।"
      );
      error.statusCode = 400;
      throw error;
    }

    const otp = rows[0];

    // 3. Check expiration
    if (new Date(otp.expires_at) < new Date()) {
      const error = new Error(
        "কোডটির মেয়াদ শেষ হয়েছে। নতুন কোড পাঠান।"
      );
      error.statusCode = 400;
      throw error;
    }

    // 4. Check attempts threshold
    if (otp.attempts >= MAX_OTP_ATTEMPTS) {
      const error = new Error(
        "অনেকবার ভুল কোড দেওয়া হয়েছে। নতুন কোড নিয়ে আবার চেষ্টা করুন।"
      );
      error.statusCode = 429;
      throw error;
    }

    // 5. Check hash matching
    if (incomingHash !== otp.code_hash) {
      await connection.execute(
        `
          UPDATE otp_codes
          SET attempts = attempts + 1
          WHERE id = ?
        `,
        [otp.id]
      );
      await connection.commit();

      const remainingAttempts = MAX_OTP_ATTEMPTS - (otp.attempts + 1);
      const error = new Error(
        remainingAttempts > 0
          ? `ভেরিফিকেশন কোডটি সঠিক নয়। আর ${remainingAttempts} বার চেষ্টা করতে পারবেন।`
          : "ভেরিফিকেশন কোডটি সঠিক নয়। সর্বোচ্চ চেষ্টার সীমা পার হয়েছে।"
      );
      error.statusCode = 400;
      throw error;
    }

    // 6. Mark OTP as consumed/verified atomically
    await connection.execute(
      `
        UPDATE otp_codes
        SET verified_at = NOW()
        WHERE id = ?
      `,
      [otp.id]
    );

    // 7. Invalidate any other unverified OTPs for this destination and purpose
    await connection.execute(
      `
        UPDATE otp_codes
        SET expires_at = DATE_SUB(NOW(), INTERVAL 1 SECOND)
        WHERE destination IN (${placeholders})
          AND purpose = ?
          AND id != ?
          AND verified_at IS NULL
      `,
      [...destinationVariants, purpose, otp.id]
    );

    // 8. Determine target user ID
    let targetUserId = otp.user_id;
    if (!targetUserId) {
      const [uRows] = await connection.execute(
        `SELECT id FROM users WHERE email = ? OR phone IN (${placeholders}) LIMIT 1`,
        [destination, ...destinationVariants]
      );
      if (uRows.length) {
        targetUserId = uRows[0].id;
      }
    }

    if (!targetUserId) {
      const error = new Error("User record associated with this verification code was not found.");
      error.statusCode = 404;
      throw error;
    }

    // 9. Update users table verification timestamps independently
    if (purpose === "email_verification") {
      await connection.execute(
        `
          UPDATE users
          SET email_verified_at = COALESCE(email_verified_at, NOW()), updated_at = NOW()
          WHERE id = ?
        `,
        [targetUserId]
      );
    } else if (purpose === "phone_verification") {
      await connection.execute(
        `
          UPDATE users
          SET phone_verified_at = COALESCE(phone_verified_at, NOW()), updated_at = NOW()
          WHERE id = ?
        `,
        [targetUserId]
      );

      // Also mark merchant contact phone verified for onboarding Step 5
      await connection.execute(
        `
          UPDATE merchant_contacts mc
          JOIN merchants m ON m.id = mc.merchant_id
          SET mc.phone_verified_at = NOW(), mc.updated_at = NOW()
          WHERE m.user_id = ?
        `,
        [targetUserId]
      );
    }

    // 10. Fetch updated user to check total verification state
    const [userRows] = await connection.execute(
      `
        SELECT
          id,
          email,
          phone,
          email_verified_at,
          phone_verified_at,
          status,
          COALESCE(token_version, 0) AS token_version
        FROM users
        WHERE id = ?
        FOR UPDATE
      `,
      [targetUserId]
    );

    if (!userRows.length) {
      const error = new Error("User record not found");
      error.statusCode = 404;
      throw error;
    }

    const user = userRows[0];
    const emailVerified = Boolean(user.email_verified_at);
    const phoneVerified = Boolean(user.phone_verified_at);
    // Either channel verification activates the pending account
    const anyVerified = emailVerified || phoneVerified;
    const allVerified = emailVerified && phoneVerified;

    if (anyVerified && user.status === "pending") {
      await connection.execute(
        `
          UPDATE users
          SET status = 'active', updated_at = NOW()
          WHERE id = ?
        `,
        [user.id]
      );
      user.status = "active";
    }

    // Fetch user roles for token creation
    const [roleRows] = await connection.execute(
      `
        SELECT r.name
        FROM user_roles ur
        JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = ?
      `,
      [user.id]
    );
    user.roles = roleRows.map((r) => r.name);
    user.role = user.roles[0] || "merchant";

    // Check merchant status
    const [merchantRows] = await connection.execute(
      `SELECT id, onboarding_step FROM merchants WHERE user_id = ? LIMIT 1`,
      [user.id]
    );
    user.isMerchant = merchantRows.length > 0 || user.roles.includes("merchant");
    if (user.isMerchant && !user.roles.includes("merchant")) {
      user.roles.push("merchant");
    }

    // For password_reset, do NOT issue an accessToken or log the user in!
    // Instead, return a short-lived one-time challenge token for resetting password
    if (purpose === "password_reset") {
      const challengeJti = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
      await connection.execute(
        `UPDATE otp_codes SET reset_challenge_jti = ? WHERE id = ?`,
        [challengeJti, otp.id]
      );
      const resetChallengeToken = createPasswordResetChallengeToken(user, challengeJti);
      await connection.commit();
      return {
        verified: true,
        userId: user.id,
        resetToken: resetChallengeToken,
        message: "মোবাইল ভেরিফিকেশন সফল হয়েছে। অনুগ্রহ করে নতুন পাসওয়ার্ড দিন।",
      };
    }

    const accessToken = createAccessToken(user);

    await connection.commit();

    return {
      verified: true,
      userId: user.id,
      channel: purpose === "email_verification" ? "email" : "phone",
      emailVerified,
      phoneVerified,
      allVerified,
      userStatus: user.status,
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        role: user.role,
        roles: user.roles,
        isMerchant: Boolean(user.isMerchant),
        status: user.status,
      },
      message:
        purpose === "email_verification"
          ? "আপনার ইমেইল সফলভাবে ভেরিফাই হয়েছে।"
          : "আপনার মোবাইল নম্বর সফলভাবে ভেরিফাই হয়েছে।",
    };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

export async function loginUser({
  email,
  identifier,
  password,
  portalType,
  ipAddress,
  userAgent,
}) {
  const normalizedEmail = (email || identifier || "").trim().toLowerCase();

  const [rows] = await db.execute(
    `
      SELECT
        u.id,
        u.email,
        u.phone,
        u.password_hash,
        u.email_verified_at,
        u.phone_verified_at,
        u.status,
        COALESCE(u.login_count, 0) AS login_count,
        COALESCE(u.must_change_password, 0) AS must_change_password,
        COALESCE(u.token_version, 0) AS token_version
      FROM users u
      WHERE u.email = ?
      LIMIT 1
    `,
    [normalizedEmail]
  );

  if (!rows.length) {
    const error = new Error(
      "Invalid email or password"
    );
    error.statusCode = 401;
    throw error;
  }

  const user = rows[0];

  // Fetch all platform roles assigned in user_roles
  const [roleRows] = await db.execute(
    `
      SELECT r.id, r.name
      FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = ?
    `,
    [user.id]
  );
  user.roles = roleRows.map((r) => r.name);
  user.role = user.roles[0] || null;

  // Check merchant status
  const [merchantRows] = await db.execute(
    `SELECT id FROM merchants WHERE user_id = ? LIMIT 1`,
    [user.id]
  );
  user.isMerchant = merchantRows.length > 0 || user.roles.includes("merchant");
  if (user.isMerchant && !user.roles.includes("merchant")) {
    user.roles.push("merchant");
    if (!user.role) user.role = "merchant";
  }

  const passwordValid = await verifyPassword(
    user.password_hash,
    password
  );

  if (!passwordValid) {
    const error = new Error(
      "Invalid email or password"
    );
    error.statusCode = 401;
    throw error;
  }

  // Fetch all active institution memberships if applicable
  const [instRows] = await db.execute(
    `
      SELECT
        iu.id AS membership_id,
        iu.institution_id,
        iu.role_id AS institution_role_id,
        iu.membership_status,
        iu.staff_name,
        i.name AS institution_name,
        i.institution_code,
        i.institution_type,
        i.logo_url,
        i.status AS institution_status,
        r.name AS institution_role
      FROM institution_users iu
      JOIN institutions i ON i.id = iu.institution_id
      JOIN roles r ON r.id = iu.role_id
      WHERE iu.user_id = ? AND iu.membership_status = 'active'
      ORDER BY iu.id ASC
    `,
    [user.id]
  );

  const institutionMemberships = instRows.map((row) => ({
    membershipId: row.membership_id,
    institutionId: row.institution_id,
    name: row.institution_name,
    code: row.institution_code,
    type: row.institution_type,
    logoUrl: row.logo_url,
    status: row.institution_status,
    role: row.institution_role,
    staffName: row.staff_name,
  }));

  const institution = institutionMemberships[0] || null;

  if (!user.role && institution?.role) {
    user.role = institution.role;
    if (!user.roles.includes(institution.role)) {
      user.roles.push(institution.role);
    }
  }

  // Validate account eligibility against portalType if requested
  const [pauCheck] = await db.query(
    `SELECT pau.id, pau.status, r.name as role_name 
     FROM platform_admin_users pau 
     JOIN roles r ON r.id = pau.role_id 
     WHERE pau.user_id = ? LIMIT 1`,
    [user.id]
  );

  const isPlatformAdminMember = pauCheck.length > 0 && pauCheck[0].status === "active";
  const isPlatformAdminSuspended = pauCheck.length > 0 && pauCheck[0].status !== "active";

  const isActualAdmin =
    (isPlatformAdminMember ||
      ["super_admin", "admin", "reviewer", "support_agent", "operations_admin", "finance_admin", "kyc_officer", "content_manager", "support_admin", "auditor_viewer"].includes(user.role) ||
      (Array.isArray(user.roles) && user.roles.some((r) => ["super_admin", "admin", "reviewer", "support_agent", "operations_admin", "finance_admin", "kyc_officer", "content_manager", "support_admin", "auditor_viewer"].includes(r)))) &&
    !isPlatformAdminSuspended;

  const isActualInstitution =
    (Boolean(institution) && institution.status !== "suspended") ||
    (Array.isArray(institutionMemberships) && institutionMemberships.some((m) => m.status === "active")) ||
    ["bank_admin", "bank_reviewer", "bank_operations", "institution_admin", "institution_reviewer", "institution_operations", "institution_compliance", "institution_viewer"].includes(user.role) ||
    (Array.isArray(user.roles) && user.roles.some((r) => ["bank_admin", "bank_reviewer", "bank_operations", "institution_admin", "institution_reviewer", "institution_operations", "institution_compliance", "institution_viewer"].includes(r)));

  const isActualMerchant =
    Boolean(user.isMerchant) ||
    user.role === "merchant" ||
    (Array.isArray(user.roles) && user.roles.includes("merchant"));

  if (portalType === "admin") {
    if (isPlatformAdminSuspended) {
      const error = new Error("Your platform administrator access has been suspended or disabled.");
      error.statusCode = 403;
      throw error;
    }
    if (!isActualAdmin) {
      const error = new Error("This account is not authorized for Admin Portal access.");
      error.statusCode = 403;
      throw error;
    }
  } else if (portalType === "institution") {
    if (!isActualInstitution) {
      const error = new Error("This account is not authorized for Institution (Bank/MFS) Portal access.");
      error.statusCode = 403;
      throw error;
    }
  } else if (portalType === "merchant") {
    if (!isActualMerchant) {
      const error = new Error("This account is not authorized for Merchant Portal access.");
      error.statusCode = 403;
      throw error;
    }
  }

  // Check Maintenance Mode for non-admin accounts
  const isAdminUser =
    ["super_admin", "admin"].includes(user.role) ||
    (Array.isArray(user.roles) && user.roles.some((r) => ["super_admin", "admin"].includes(r)));

  if (!isAdminUser) {
    try {
      const maintenance = await adminSettingsRepository.getSettingValue("maintenance_status", {});
      if (maintenance.maintenanceMode) {
        const error = new Error(
          maintenance.maintenanceMessage || "Platform is currently under scheduled maintenance. Please try again later."
        );
        error.statusCode = 503;
        throw error;
      }
      if (user.isMerchant && maintenance.merchantLoginEnabled === false) {
        const error = new Error("Merchant portal access is temporarily disabled for maintenance.");
        error.statusCode = 503;
        throw error;
      }
    } catch (e) {
      if (e.statusCode) throw e;
    }
  }

  // Check if account is suspended
  if (user.status === "suspended") {
    const error = new Error("Account is suspended. Please contact support.");
    error.statusCode = 403;
    throw error;
  }

  // Determine if OTP is required for this login:
  // 1. Admin and Bank roles do NOT require OTP for login (Email & Password only)
  const isBankUser =
    Boolean(user.institution || user.institutionId) ||
    (Array.isArray(user.institutionMemberships) && user.institutionMemberships.length > 0) ||
    ["bank_admin", "bank_reviewer", "bank_operations"].includes(user.role) ||
    (Array.isArray(user.roles) && user.roles.some((r) => ["bank_admin", "bank_reviewer", "bank_operations"].includes(r)));

  const isStaffOrAdmin = isAdminUser || isBankUser;

  // 2. For Merchants:
  // - The first 5 logins after registration do NOT require OTP (user can login directly with email & password)
  // - From the 6th login onward (login_count >= 5), OTP verification is required
  // - Or if logging in from an unrecognized new device, OTP verification is required
  let requiresOtp = false;

  if (!isStaffOrAdmin) {
    const currentLoginCount = Number(user.login_count || 0);

    // Compute device fingerprint hash from user-agent and IP
    const cleanAgent = String(userAgent || "").trim().toLowerCase();
    const cleanIp = String(ipAddress || "").trim();
    const deviceHash = crypto
      .createHash("sha256")
      .update(`${cleanAgent}`)
      .digest("hex");

    // Check if this device is already known for this user
    const [knownDevices] = await db.execute(
      `SELECT id FROM user_devices WHERE user_id = ? AND device_hash = ? LIMIT 1`,
      [user.id, deviceHash]
    );

    const isKnownDevice = knownDevices.length > 0;

    // OTP is triggered if:
    // a) User has already logged in 5 times (currentLoginCount >= 5)
    // b) Or this is a new unrecognized device (after having logged in at least once)
    if (currentLoginCount >= 5) {
      requiresOtp = true;
    } else if (currentLoginCount > 0 && !isKnownDevice) {
      requiresOtp = true;
    }
  }

  // If OTP is required, generate and send OTP to user's phone
  if (requiresOtp) {
    const phone = user.phone;
    if (!phone) {
      const error = new Error("No mobile phone number associated with this account. Please contact support.");
      error.statusCode = 400;
      throw error;
    }

    await createAndSendOtp(
      db,
      user.id,
      phone,
      "login"
    );

    const challengeToken = createLoginChallengeToken(user);

    return {
      requiresOtp: true,
      challengeToken,
      phoneMasked: phone.replace(/(\d{3})\d{5}(\d{3})/, "$1*****$2"),
      destination: phone,
      purpose: "login",
      email: user.email,
      message: "A 6-digit login verification code has been sent to your mobile phone.",
    };
  }

  // Otherwise, log in directly:
  // Register known device
  if (userAgent || ipAddress) {
    const cleanAgent = String(userAgent || "").trim().toLowerCase();
    const cleanIp = String(ipAddress || "").trim();
    const deviceHash = crypto
      .createHash("sha256")
      .update(`${cleanAgent}`)
      .digest("hex");

    try {
      await db.execute(
        `INSERT INTO user_devices (user_id, device_hash, ip_address, user_agent, last_used_at, created_at)
         VALUES (?, ?, ?, ?, NOW(), NOW())
         ON DUPLICATE KEY UPDATE ip_address = VALUES(ip_address), last_used_at = NOW()`,
        [user.id, deviceHash, cleanIp, cleanAgent]
      );
    } catch (_) {}
  }

  // Increment login_count and update last_login
  await db.execute(
    `UPDATE users SET login_count = login_count + 1, last_login_at = NOW(), last_login_ip = ? WHERE id = ?`,
    [ipAddress || null, user.id]
  );

  // If status was pending, activate upon successful credentials check
  if (user.status === "pending" && user.phone_verified_at) {
    await db.execute(
      `UPDATE users SET status = 'active', updated_at = NOW() WHERE id = ?`,
      [user.id]
    );
    user.status = "active";
  }

  // Ensure merchant record exists for merchant users
  if (user.role === "merchant" || user.isMerchant) {
    try {
      await merchantRepository.findOrCreateMerchantByUserId(user.id);
    } catch (e) {
      console.warn("Could not ensure merchant record on login:", e.message);
    }
  }

  const accessToken = createAccessToken(user);

  return {
    accessToken,
    user: {
      id: user.id,
      email: user.email,
      phone: user.phone,
      role: user.role,
      roles: user.roles || (user.role ? [user.role] : []),
      isMerchant: Boolean(user.isMerchant),
      status: user.status,
      mustChangePassword: Boolean(user.must_change_password),
      institution,
      institutionId: institution?.institutionId || null,
      institutionRole: institution?.role || null,
      institutionMemberships,
    },
  };
}

export async function completeLoginWithOtp({ challengeToken, code, ipAddress, userAgent }) {
  const decoded = verifyLoginChallengeToken(challengeToken);
  if (!decoded || !decoded.sub) {
    const error = new Error("Invalid or expired login session. Please sign in again.");
    error.statusCode = 401;
    throw error;
  }

  const userId = decoded.sub;

  // Verify the OTP for purpose 'login'
  await verifyOtp({
    destination: decoded.phone,
    code,
    purpose: "login",
    email: decoded.email,
  });

  // OTP verified! Fetch user and complete session login
  const [rows] = await db.execute(
    `
      SELECT
        u.id,
        u.email,
        u.phone,
        u.email_verified_at,
        u.phone_verified_at,
        u.status,
        COALESCE(u.login_count, 0) AS login_count,
        COALESCE(u.must_change_password, 0) AS must_change_password,
        COALESCE(u.token_version, 0) AS token_version
      FROM users u
      WHERE u.id = ?
      LIMIT 1
    `,
    [userId]
  );

  if (!rows.length) {
    const error = new Error("User record not found");
    error.statusCode = 404;
    throw error;
  }

  const user = rows[0];

  // Fetch all platform roles assigned in user_roles
  const [roleRows] = await db.execute(
    `
      SELECT r.id, r.name
      FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = ?
    `,
    [user.id]
  );
  user.roles = roleRows.map((r) => r.name);
  user.role = user.roles[0] || null;

  // Check merchant status
  const [merchantRows] = await db.execute(
    `SELECT id FROM merchants WHERE user_id = ? LIMIT 1`,
    [user.id]
  );
  user.isMerchant = merchantRows.length > 0 || user.roles.includes("merchant");
  if (user.isMerchant && !user.roles.includes("merchant")) {
    user.roles.push("merchant");
    if (!user.role) user.role = "merchant";
  }

  // Register device as trusted
  if (userAgent || ipAddress) {
    const cleanAgent = String(userAgent || "").trim().toLowerCase();
    const cleanIp = String(ipAddress || "").trim();
    const deviceHash = crypto
      .createHash("sha256")
      .update(`${cleanAgent}`)
      .digest("hex");

    try {
      await db.execute(
        `INSERT INTO user_devices (user_id, device_hash, ip_address, user_agent, last_used_at, created_at)
         VALUES (?, ?, ?, ?, NOW(), NOW())
         ON DUPLICATE KEY UPDATE ip_address = VALUES(ip_address), last_used_at = NOW()`,
        [user.id, deviceHash, cleanIp, cleanAgent]
      );
    } catch (_) {}
  }

  // Increment login_count and update last_login
  await db.execute(
    `UPDATE users SET login_count = login_count + 1, status = 'active', phone_verified_at = COALESCE(phone_verified_at, NOW()), last_login_at = NOW(), last_login_ip = ?, updated_at = NOW() WHERE id = ?`,
    [ipAddress || null, user.id]
  );
  user.status = "active";

  // Ensure merchant record exists for merchant users
  if (user.role === "merchant" || user.isMerchant) {
    try {
      await merchantRepository.findOrCreateMerchantByUserId(user.id);
    } catch (e) {
      console.warn("Could not ensure merchant record on login:", e.message);
    }
  }

  // Fetch all active institution memberships if applicable
  const [instRows] = await db.execute(
    `
      SELECT
        iu.id AS membership_id,
        iu.institution_id,
        iu.role_id AS institution_role_id,
        iu.membership_status,
        iu.staff_name,
        i.name AS institution_name,
        i.institution_code,
        i.institution_type,
        i.logo_url,
        i.status AS institution_status,
        r.name AS institution_role
      FROM institution_users iu
      JOIN institutions i ON i.id = iu.institution_id
      JOIN roles r ON r.id = iu.role_id
      WHERE iu.user_id = ? AND iu.membership_status = 'active'
      ORDER BY iu.id ASC
    `,
    [user.id]
  );

  const institutionMemberships = instRows.map((row) => ({
    membershipId: row.membership_id,
    institutionId: row.institution_id,
    name: row.institution_name,
    code: row.institution_code,
    type: row.institution_type,
    logoUrl: row.logo_url,
    status: row.institution_status,
    role: row.institution_role,
    staffName: row.staff_name,
  }));

  const institution = institutionMemberships[0] || null;

  if (!user.role && institution?.role) {
    user.role = institution.role;
    if (!user.roles.includes(institution.role)) {
      user.roles.push(institution.role);
    }
  }

  const accessToken = createAccessToken(user);

  return {
    accessToken,
    user: {
      id: user.id,
      email: user.email,
      phone: user.phone,
      role: user.role,
      roles: user.roles || (user.role ? [user.role] : []),
      isMerchant: Boolean(user.isMerchant),
      status: user.status,
      mustChangePassword: Boolean(user.must_change_password),
      institution,
      institutionId: institution?.institutionId || null,
      institutionRole: institution?.role || null,
      institutionMemberships,
    },
  };
}

export async function resendOtp({ destination: rawDestination, purpose, email, challengeToken }) {
  if (purpose === "login" && challengeToken) {
    const decoded = verifyLoginChallengeToken(challengeToken);
    if (!decoded || !decoded.sub) {
      const error = new Error("Invalid or expired login session. Please sign in again.");
      error.statusCode = 401;
      throw error;
    }
    const result = await createAndSendOtp(
      db,
      decoded.sub,
      decoded.phone,
      "login"
    );
    return {
      success: true,
      destination: decoded.phone,
      purpose: "login",
      cooldownSeconds: 60,
      message: "A new login verification code has been sent to your mobile phone.",
    };
  }

  const destination = normalizeDestination(rawDestination, purpose);
  if (!destination) {
    const error = new Error("Invalid destination provided");
    error.statusCode = 400;
    throw error;
  }

  const destinationVariants = getDestinationVariants(rawDestination, purpose);
  const placeholders = destinationVariants.map(() => "?").join(", ");

  let user = null;
  if (email && typeof email === "string" && email.trim()) {
    const [uRows] = await db.execute(
      `SELECT id, email, phone, email_verified_at, phone_verified_at FROM users WHERE email = ? LIMIT 1`,
      [email.trim().toLowerCase()]
    );
    if (uRows.length) user = uRows[0];
  }

  if (!user) {
    const [rows] = await db.execute(
      `
        SELECT id, email, phone, email_verified_at, phone_verified_at
        FROM users
        WHERE email = ? OR phone IN (${placeholders})
        ORDER BY id DESC
        LIMIT 1
      `,
      [destination, ...destinationVariants]
    );

    if (rows.length > 0) {
      user = rows[0];
    }
  }

  // If user is still not found in users table, check if the phone exists in merchant_contacts table
  if (!user && (purpose === "phone_verification" || !purpose)) {
    const [contactRows] = await db.execute(
      `
        SELECT m.user_id as id, mc.email, mc.phone, mc.email_verified_at, mc.phone_verified_at
        FROM merchant_contacts mc
        JOIN merchants m ON m.id = mc.merchant_id
        WHERE mc.phone IN (${placeholders}) OR mc.email = ?
        ORDER BY mc.id DESC
        LIMIT 1
      `,
      [...destinationVariants, destination]
    );

    if (contactRows.length > 0) {
      user = contactRows[0];
    }
  }

  // STRICT DATABASE CHECK:
  // If destination (phone/email) does not exist in the database, DO NOT send OTP
  if (!user) {
    const error = new Error("প্রদত্ত মোবাইল নম্বর বা ইমেইল দিয়ে ডাটাবেজে কোনো অ্যাকাউন্ট পাওয়া যায়নি। অনুগ্রহ করে সঠিক তথ্য প্রদান করুন।");
    error.statusCode = 404;
    throw error;
  }

  // Prevent sending OTP if already verified for that specific channel
  if (purpose === "email_verification" && user.email_verified_at) {
    return {
      success: true,
      alreadyVerified: true,
      message: "This email address is already verified.",
      destination,
      purpose,
    };
  }

  if (purpose === "phone_verification") {
    // For merchant onboarding phone verification, check if merchant contact is already verified
    const [contactRows] = await db.execute(
      `SELECT mc.phone_verified_at 
       FROM merchants m 
       JOIN merchant_contacts mc ON mc.merchant_id = m.id 
       WHERE m.user_id = ? LIMIT 1`,
      [user.id]
    );
    if (contactRows[0]?.phone_verified_at) {
      return {
        success: true,
        alreadyVerified: true,
        message: "This mobile number is already verified.",
        destination,
        purpose,
      };
    }
  }

  const connection = await db.getConnection();

  try {
    const result = await createAndSendOtp(
      connection,
      user.id,
      destination,
      purpose
    );

    return {
      success: true,
      message: purpose === "email_verification"
        ? "আপনার ইমেইলে ৬ সংখ্যার নতুন ভেরিফিকেশন কোড পাঠানো হয়েছে।"
        : "আপনার মোবাইল নম্বরে ৬ সংখ্যার নতুন ভেরিফিকেশন কোড পাঠানো হয়েছে।",
      destination,
      purpose,
      cooldownSeconds: 60,
      expiresInSeconds: 300,
      delivery: result.delivery,
    };
  } finally {
    connection.release();
  }
}

export async function getVerificationStatus({ destination: rawDestination }) {
  const trimmed = (rawDestination || "").trim();
  const phoneVariants = getDestinationVariants(trimmed, "phone_verification");
  const placeholders = phoneVariants.map(() => "?").join(", ");

  const [rows] = await db.execute(
    `
      SELECT id, email, phone, email_verified_at, phone_verified_at, status
      FROM users
      WHERE email = ? OR phone IN (${placeholders})
      LIMIT 1
    `,
    [trimmed.toLowerCase(), ...phoneVariants]
  );

  if (!rows.length) {
    return { found: false };
  }

  const u = rows[0];
  return {
    found: true,
    email: u.email,
    phone: u.phone,
    emailVerified: Boolean(u.email_verified_at),
    phoneVerified: Boolean(u.phone_verified_at),
    allVerified: Boolean(u.email_verified_at && u.phone_verified_at),
    status: u.status,
  };
}

export async function requestPasswordReset({ phone, email }) {
  const genericMessage =
    "যদি এই মোবাইল নম্বরে নিবন্ধিত অ্যাকাউন্ট থাকে, তবে ভেরিফিকেশন কোড পাঠানো হয়েছে।";

  let user = null;
  let destination = null;
  let destinationVariants = [];

  if (phone) {
    const normalizedPhone = normalizeBdPhone(phone);
    if (!normalizedPhone) {
      const error = new Error("সঠিক বাংলাদেশী মোবাইল নম্বর প্রদান করুন (যেমন: 017XXXXXXXX)");
      error.statusCode = 400;
      throw error;
    }
    destination = normalizedPhone.local;
    destinationVariants = [normalizedPhone.local, normalizedPhone.international, normalizedPhone.e164];
  } else if (email) {
    const normalizedEmail = (email || "").trim().toLowerCase();
    destination = normalizedEmail;
    destinationVariants = [normalizedEmail];
  }

  // --- UNIFORM DESTINATION-LEVEL COOLDOWN THROTTLING ---
  // Applies equally to registered and unregistered mobile numbers / emails
  // to protect all phone numbers from SMS bombing and eliminate enumeration side-channels.
  if (destinationVariants.length > 0) {
    const placeholders = destinationVariants.map(() => "?").join(", ");
    const [recentOtps] = await db.execute(
      `
        SELECT created_at
        FROM otp_codes
        WHERE destination IN (${placeholders})
          AND purpose = 'password_reset'
          AND verified_at IS NULL
          AND expires_at > NOW()
        ORDER BY created_at DESC
        LIMIT 1
      `,
      destinationVariants
    );

    if (recentOtps.length > 0) {
      const lastCreated = new Date(recentOtps[0].created_at).getTime();
      const elapsed = Date.now() - lastCreated;
      if (elapsed < RESEND_COOLDOWN_MS) {
        const waitSeconds = Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000);
        const error = new Error(
          `অনুগ্রহ করে নতুন কোড অনুরোধ করার আগে ${waitSeconds} সেকেন্ড অপেক্ষা করুন।`
        );
        error.statusCode = 429;
        error.waitSeconds = waitSeconds;
        throw error;
      }
    }
  }

  if (phone) {
    const placeholders = destinationVariants.map(() => "?").join(", ");
    const [users] = await db.execute(
      `SELECT id, email, phone, status FROM users WHERE phone IN (${placeholders}) LIMIT 1`,
      destinationVariants
    );
    if (users.length) user = users[0];
  } else if (email) {
    const [users] = await db.execute(
      `SELECT id, email, phone, status FROM users WHERE email = ? LIMIT 1`,
      [destination]
    );
    if (users.length) user = users[0];
  }

  // Security: do not disclose if user exists.
  // Both registered and unregistered flows perform equivalent cryptographic work (HMAC hashing + matched DB write operations)
  // to ensure identical timing distributions without disclosing existence.
  if (!user) {
    // Perform dummy OTP generation and hashing to match cryptographic computation time
    const dummyCode = generateOtp();
    const dummyHash = hashOtp(dummyCode);
    const dummyExpiry = getOtpExpiry();

    // Balanced database write activity to match registered branch I/O latency:
    // Invalidate previous unverified OTPs for this unregistered destination to mirror createAndSendOtp step 3
    if (destinationVariants.length > 0) {
      const placeholders = destinationVariants.map(() => "?").join(", ");
      await db.execute(
        `
          UPDATE otp_codes
          SET expires_at = DATE_SUB(NOW(), INTERVAL 1 SECOND)
          WHERE destination IN (${placeholders})
            AND purpose = 'password_reset'
            AND verified_at IS NULL
        `,
        destinationVariants
      );
    }

    // Insert active dummy record with normal expiry (so cooldown throttling applies identically)
    // but with NULL user_id and non-redeemable hash, ensuring OTP can never be validated for an account
    await db.execute(
      `
        INSERT INTO otp_codes
        (
          user_id,
          destination,
          purpose,
          code_hash,
          expires_at,
          attempts,
          created_at
        )
        VALUES (NULL, ?, 'password_reset', ?, ?, 0, NOW())
      `,
      [destination || "01700000000", dummyHash, dummyExpiry]
    );

    return {
      success: true,
      message: genericMessage,
      destination: destination || "",
      cooldownSeconds: 60,
    };
  }

  // Use createAndSendOtp directly with purpose = 'password_reset'
  const result = await createAndSendOtp(
    db,
    user.id,
    user.phone || destination,
    "password_reset"
  );

  return {
    success: true,
    message: genericMessage,
    destination: result.destination,
    cooldownSeconds: result.cooldownSeconds || 60,
  };
}

export async function verifyResetToken({ token }) {
  if (!token || typeof token !== "string" || token.trim().length < 10) {
    return {
      valid: false,
      message: "ভেরিফিকেশন লিঙ্কটি সঠিক নয়।",
    };
  }

  // 1. Check if token is a password reset challenge JWT token
  const challenge = verifyPasswordResetChallengeToken(token.trim());
  if (challenge) {
    const [uRows] = await db.execute(
      `SELECT id, email, phone FROM users WHERE id = ? LIMIT 1`,
      [challenge.sub]
    );
    if (!uRows.length) {
      return { valid: false, message: "ব্যবহারকারীর অ্যাকাউন্ট পাওয়া যায়নি।" };
    }
    return {
      valid: true,
      phone: uRows[0].phone,
      email: uRows[0].email,
      message: "Reset challenge token is valid.",
    };
  }

  // 2. Otherwise check password_resets table for legacy reset tokens
  const tokenHash = hashResetToken(token.trim());

  const [rows] = await db.execute(
    `
      SELECT id, user_id, email, expires_at, used_at
      FROM password_resets
      WHERE token_hash = ?
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [tokenHash]
  );

  if (!rows.length) {
    return {
      valid: false,
      message: "পাসওয়ার্ড রিসেট লিঙ্কটি সঠিক নয় বা বাতিল করা হয়েছে।",
    };
  }

  const resetRecord = rows[0];

  if (resetRecord.used_at !== null) {
    return {
      valid: false,
      message: "এই রিসেট লিঙ্কটি ইতিমধ্যে ব্যবহার করা হয়েছে। নতুন লিঙ্ক অনুরোধ করুন।",
    };
  }

  if (new Date(resetRecord.expires_at) < new Date()) {
    return {
      valid: false,
      message: "পাসওয়ার্ড রিসেট লিঙ্কটির মেয়াদ শেষ হয়ে গেছে। নতুন লিঙ্ক অনুরোধ করুন।",
    };
  }

  return {
    valid: true,
    email: resetRecord.email,
    message: "Reset token is valid.",
  };
}

export async function resetPassword({ token, newPassword }) {
  if (!token || typeof token !== "string" || token.trim().length < 10) {
    const error = new Error("Invalid password reset token.");
    error.statusCode = 400;
    throw error;
  }

  // Check if token is a password reset challenge JWT
  const challenge = verifyPasswordResetChallengeToken(token.trim());
  if (challenge) {
    const userId = challenge.sub;
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      // Check single-use reset challenge if jti is present
      if (challenge.jti) {
        const [otpRows] = await connection.execute(
          `SELECT id, reset_challenge_jti FROM otp_codes WHERE reset_challenge_jti = ? FOR UPDATE`,
          [challenge.jti]
        );
        if (!otpRows.length) {
          const err = new Error("This password reset link or challenge has already been used or expired.");
          err.statusCode = 400;
          throw err;
        }

        // Consume challenge JTI immediately
        await connection.execute(
          `UPDATE otp_codes SET reset_challenge_jti = NULL WHERE id = ?`,
          [otpRows[0].id]
        );
      }

      const [uRows] = await connection.execute(
        `SELECT id, password_hash FROM users WHERE id = ? FOR UPDATE`,
        [userId]
      );
      if (!uRows.length) {
        const err = new Error("User record not found");
        err.statusCode = 404;
        throw err;
      }

      // Hash new password using bcryptjs
      const passwordHash = await hashPassword(newPassword);

      // Update password, record password_changed_at audit timestamp, and atomically increment token_version
      await connection.execute(
        `UPDATE users 
         SET password_hash = ?, 
             password_changed_at = NOW(), 
             token_version = token_version + 1, 
             must_change_password = 0, 
             updated_at = NOW() 
         WHERE id = ?`,
        [passwordHash, userId]
      );

      // Revoke all existing sessions for this user
      try {
        await connection.execute(`DELETE FROM sessions WHERE user_id = ?`, [userId]);
      } catch (_) {}

      await connection.commit();

      return {
        success: true,
        message: "আপনার পাসওয়ার্ড সফলভাবে পরিবর্তন করা হয়েছে! নতুন পাসওয়ার্ড দিয়ে লগইন করুন।",
      };
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  // Legacy reset token handling
  const tokenHash = hashResetToken(token.trim());

  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const [rows] = await connection.execute(
      `
        SELECT id, user_id, email, expires_at, used_at
        FROM password_resets
        WHERE token_hash = ?
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE
      `,
      [tokenHash]
    );

    if (!rows.length) {
      const error = new Error("Invalid or revoked password reset token.");
      error.statusCode = 400;
      throw error;
    }

    const resetRecord = rows[0];

    if (resetRecord.used_at !== null) {
      const error = new Error("This password reset link has already been used.");
      error.statusCode = 400;
      throw error;
    }

    if (new Date(resetRecord.expires_at) < new Date()) {
      const error = new Error("This password reset link has expired. Please request a new one.");
      error.statusCode = 400;
      throw error;
    }

    // Hash new password using bcryptjs
    const passwordHash = await hashPassword(newPassword);

    // Update user password in users table and increment token_version
    await connection.execute(
      `
        UPDATE users
        SET password_hash = ?, 
            password_changed_at = NOW(), 
            token_version = token_version + 1, 
            must_change_password = 0, 
            updated_at = NOW()
        WHERE id = ?
      `,
      [passwordHash, resetRecord.user_id]
    );

    // Atomically mark reset token as consumed
    await connection.execute(
      `
        UPDATE password_resets
        SET used_at = NOW()
        WHERE id = ?
      `,
      [resetRecord.id]
    );

    // Invalidate any active sessions if sessions table exists
    try {
      await connection.execute(
        `DELETE FROM sessions WHERE user_id = ?`,
        [resetRecord.user_id]
      );
    } catch {}

    await connection.commit();

    return {
      success: true,
      message: "আপনার পাসওয়ার্ড সফলভাবে পরিবর্তন করা হয়েছে! নতুন পাসওয়ার্ড দিয়ে লগইন করুন।",
    };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

export async function verifyInstitutionInvitation(rawToken) {
  if (!rawToken || typeof rawToken !== "string" || !rawToken.trim()) {
    const error = new Error("Invalid or missing invitation token");
    error.statusCode = 400;
    throw error;
  }

  const tokenHash = crypto.createHash("sha256").update(rawToken.trim()).digest("hex");

  const [rows] = await db.query(
    `
    SELECT
      inv.id,
      inv.institution_id,
      inv.email,
      inv.name,
      inv.phone,
      inv.role_id,
      inv.status,
      inv.expires_at,
      i.name AS institution_name,
      i.institution_code,
      i.logo_url AS institution_logo,
      i.status AS institution_status,
      r.name AS role_name,
      r.description AS role_description
    FROM institution_invitations inv
    JOIN institutions i ON i.id = inv.institution_id
    JOIN roles r ON r.id = inv.role_id
    WHERE inv.token_hash = ?
    LIMIT 1
    `,
    [tokenHash]
  );

  if (!rows.length) {
    const error = new Error("Invitation token is invalid or does not exist");
    error.statusCode = 404;
    throw error;
  }

  const inv = rows[0];

  if (inv.status === "accepted") {
    // The activation token is single-use and remains non-redeemable. Return only
    // the public institution routing context so the frontend can send the user
    // to the correct Institution login instead of a generic/Admin login route.
    return {
      valid: false,
      alreadyAccepted: true,
      institutionId: Number(inv.institution_id),
      institutionName: inv.institution_name,
      message: "This invitation has already been accepted. Please sign in to the Institution Portal.",
    };
  }

  if (inv.status === "revoked") {
    const error = new Error("This invitation has been revoked by an administrator.");
    error.statusCode = 400;
    throw error;
  }

  if (inv.status === "expired" || new Date(inv.expires_at) < new Date()) {
    if (inv.status !== "expired") {
      await db.execute(`UPDATE institution_invitations SET status = 'expired' WHERE id = ?`, [inv.id]);
    }
    const error = new Error("This invitation link has expired. Please contact your administrator for a new invitation.");
    error.statusCode = 400;
    throw error;
  }

  // Check if an existing account already exists
  const [userRows] = await db.query(
    `SELECT id, email, password_hash, status FROM users WHERE email = ? LIMIT 1`,
    [inv.email]
  );
  const isExistingUser = userRows.length > 0 && !!userRows[0].password_hash;

  return {
    valid: true,
    invitationId: inv.id,
    email: inv.email,
    name: inv.name,
    phone: inv.phone,
    institutionId: inv.institution_id,
    institutionName: inv.institution_name,
    institutionCode: inv.institution_code,
    institutionLogo: inv.institution_logo,
    roleName: inv.role_name,
    roleDescription: inv.role_description,
    expiresAt: inv.expires_at,
    isExistingUser,
  };
}

export async function acceptInstitutionInvitation({ token: rawToken, password, name, phone }) {
  const verified = await verifyInstitutionInvitation(rawToken);
  if (!verified?.valid) {
    const error = new Error(
      verified?.message || "This invitation is no longer available for activation."
    );
    error.statusCode = 400;
    throw error;
  }
  const tokenHash = crypto.createHash("sha256").update(rawToken.trim()).digest("hex");

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const [invRows] = await connection.query(
      `SELECT * FROM institution_invitations WHERE token_hash = ? FOR UPDATE`,
      [tokenHash]
    );
    if (!invRows.length || invRows[0].status !== "pending") {
      const err = new Error("Invitation is no longer pending or has already been used");
      err.statusCode = 400;
      throw err;
    }
    const inv = invRows[0];

    // Check if user already exists
    const [userRows] = await connection.query(
      `SELECT id, email, phone, password_hash, email_verified_at, status FROM users WHERE email = ? LIMIT 1 FOR UPDATE`,
      [inv.email]
    );

    let userId;
    let staffName = (name || inv.name || "").trim() || null;
    let staffPhone = (phone || inv.phone || "").trim() || null;

    if (userRows.length > 0) {
      const existingUser = userRows[0];
      userId = existingUser.id;

      // If user does NOT have a password set yet, set it now
      if (!existingUser.password_hash) {
        if (!password || password.length < 6) {
          const err = new Error("Password must be at least 6 characters");
          err.statusCode = 400;
          throw err;
        }
        const passwordHash = await hashPassword(password);
        await connection.execute(
          `UPDATE users SET password_hash = ?, email_verified_at = COALESCE(email_verified_at, NOW()), status = 'active', updated_at = NOW() WHERE id = ?`,
          [passwordHash, userId]
        );
      }
      // If user already has a password (e.g. existing merchant):
      // Do NOT overwrite password, email verification, or platform roles!
    } else {
      // New user
      if (!password || password.length < 6) {
        const err = new Error("Password must be at least 6 characters");
        err.statusCode = 400;
        throw err;
      }
      if (staffPhone) {
        const [phoneUsers] = await connection.query(
          `SELECT id FROM users WHERE phone = ? LIMIT 1`,
          [staffPhone]
        );
        if (phoneUsers.length > 0) {
          staffPhone = null;
        }
      }
      const passwordHash = await hashPassword(password);
      const [insertUser] = await connection.execute(
        `INSERT INTO users (email, phone, password_hash, email_verified_at, status, created_at, updated_at) VALUES (?, ?, ?, NOW(), 'active', NOW(), NOW())`,
        [inv.email, staffPhone, passwordHash]
      );
      userId = insertUser.insertId;
      // CRITICAL: Do NOT insert any Bank role into user_roles!
    }

    // Upsert institution_users membership
    const [existingMembership] = await connection.query(
      `SELECT id FROM institution_users WHERE user_id = ? AND institution_id = ? LIMIT 1`,
      [userId, inv.institution_id]
    );

    if (existingMembership.length > 0) {
      await connection.execute(
        `UPDATE institution_users SET role_id = ?, membership_status = 'active', staff_name = COALESCE(?, staff_name), updated_at = NOW() WHERE id = ?`,
        [inv.role_id, staffName, existingMembership[0].id]
      );
    } else {
      await connection.execute(
        `INSERT INTO institution_users (institution_id, user_id, staff_name, role_id, membership_status, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', NOW(), NOW())`,
        [inv.institution_id, userId, staffName, inv.role_id]
      );
    }

    // Mark invitation as accepted
    await connection.execute(
      `UPDATE institution_invitations SET status = 'accepted', accepted_at = NOW(), updated_at = NOW() WHERE id = ?`,
      [inv.id]
    );

    await connection.commit();

    return {
      success: true,
      message: "Account activated successfully. You can now log in to the institution portal.",
      email: inv.email,
      institutionId: inv.institution_id,
      targetPortal: "/institution/dashboard",
    };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

export async function changeUserPassword({ userId, currentPassword, newPassword }) {
  const [rows] = await db.query(
    `SELECT id, email, password_hash FROM users WHERE id = ? LIMIT 1`,
    [userId]
  );

  if (!rows.length) {
    const error = new Error("User not found");
    error.statusCode = 404;
    throw error;
  }

  const user = rows[0];

  const isValid = await verifyPassword(user.password_hash, currentPassword);
  if (!isValid) {
    const error = new Error("Current password is incorrect");
    error.statusCode = 400;
    throw error;
  }

  const newHash = await hashPassword(newPassword);

  await db.execute(
    `UPDATE users 
     SET password_hash = ?, 
         password_changed_at = NOW(), 
         token_version = token_version + 1, 
         must_change_password = 0, 
         updated_at = NOW() 
     WHERE id = ?`,
    [newHash, userId]
  );

  // Invalidate active sessions
  try {
    await db.execute(`DELETE FROM sessions WHERE user_id = ?`, [userId]);
  } catch (_) {}

  return {
    success: true,
    message: "Password updated successfully",
  };
}