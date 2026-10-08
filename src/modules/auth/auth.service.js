import argon2 from "argon2";

import { db } from "../../config/db.js";
import { env } from "../../config/env.js";

import {
  generateOtp,
  hashOtp,
  createAccessToken,
} from "./auth.utils.js";

function getOtpExpiry() {
  return new Date(
    Date.now() + 10 * 60 * 1000
  );
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

async function createOtp(
  connection,
  userId,
  destination,
  purpose
) {
  const code = generateOtp();

  const codeHash = hashOtp(code);

  const expiresAt = getOtpExpiry();

  await connection.execute(
    `
      UPDATE otp_codes
      SET verified_at = NOW()
      WHERE
        destination = ?
        AND purpose = ?
        AND verified_at IS NULL
    `,
    [destination, purpose]
  );

  await connection.execute(
    `
      INSERT INTO otp_codes
      (
        user_id,
        destination,
        purpose,
        code_hash,
        expires_at
      )
      VALUES (?, ?, ?, ?, ?)
    `,
    [
      userId,
      destination,
      purpose,
      codeHash,
      expiresAt,
    ]
  );

  if (env.nodeEnv === "development") {
    console.log(
      `[DEV OTP] ${purpose} → ${destination}: ${code}`
    );
  }
}

import { merchantRepository } from "../merchants/merchant.repository.js";

export async function registerUser({
  fullName,
  name,
  email,
  phone,
  password,
}) {
  const connection = await db.getConnection();
  const contactName = (fullName || name || "").trim();

  try {
    await connection.beginTransaction();

    const [existing] =
      await connection.execute(
        `
          SELECT id
          FROM users
          WHERE email = ? OR phone = ?
          LIMIT 1
        `,
        [email, phone]
      );

    if (existing.length) {
      const error = new Error(
        "An account already exists with this email or phone"
      );

      error.statusCode = 409;

      throw error;
    }

    const passwordHash =
      await argon2.hash(password);

    const [result] =
      await connection.execute(
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
          email,
          phone,
          passwordHash,
        ]
      );

    const userId = result.insertId;

    const roleId =
      await getMerchantRoleId(connection);

    await connection.execute(
      `
        INSERT INTO user_roles
        (user_id, role_id)
        VALUES (?, ?)
      `,
      [userId, roleId]
    );

    await createOtp(
      connection,
      userId,
      email,
      "email_verification"
    );

    await createOtp(
      connection,
      userId,
      phone,
      "phone_verification"
    );

    await connection.commit();

    try {
      const merchant = await merchantRepository.findOrCreateMerchantByUserId(userId);
      if (contactName) {
        await merchantRepository.upsertContact(merchant.id, {
          name: contactName,
          email,
          phone,
          designation: "Authorized Signatory",
        });
      }
    } catch (e) {
      console.warn("Could not pre-populate merchant contact during register:", e.message);
    }

    return {
      userId,
      fullName: contactName,
      email,
      phone,
      status: "pending",
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function verifyOtp({
  destination,
  code,
  purpose,
}) {
  const [rows] = await db.execute(
    `
      SELECT *
      FROM otp_codes
      WHERE
        destination = ?
        AND purpose = ?
        AND verified_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [destination, purpose]
  );

  if (!rows.length) {
    const error = new Error(
      "Verification code not found"
    );

    error.statusCode = 400;

    throw error;
  }

  const otp = rows[0];

  if (
    new Date(otp.expires_at) <
    new Date()
  ) {
    const error = new Error(
      "Verification code has expired"
    );

    error.statusCode = 400;

    throw error;
  }

  if (otp.attempts >= 5) {
    const error = new Error(
      "Too many verification attempts"
    );

    error.statusCode = 429;

    throw error;
  }

  const incomingHash = hashOtp(code);

  if (incomingHash !== otp.code_hash) {
    await db.execute(
      `
        UPDATE otp_codes
        SET attempts = attempts + 1
        WHERE id = ?
      `,
      [otp.id]
    );

    const error = new Error(
      "Invalid verification code"
    );

    error.statusCode = 400;

    throw error;
  }

  await db.execute(
    `
      UPDATE otp_codes
      SET verified_at = NOW()
      WHERE id = ?
    `,
    [otp.id]
  );

  if (purpose === "email_verification") {
    await db.execute(
      `
        UPDATE users
        SET email_verified_at = NOW()
        WHERE id = ?
      `,
      [otp.user_id]
    );
  }

  if (purpose === "phone_verification") {
    await db.execute(
      `
        UPDATE users
        SET phone_verified_at = NOW()
        WHERE id = ?
      `,
      [otp.user_id]
    );
  }

  const [users] = await db.execute(
    `
      SELECT
        email_verified_at,
        phone_verified_at
      FROM users
      WHERE id = ?
    `,
    [otp.user_id]
  );

  const user = users[0];

  if (
    user.email_verified_at &&
    user.phone_verified_at
  ) {
    await db.execute(
      `
        UPDATE users
        SET status = 'active'
        WHERE id = ?
      `,
      [otp.user_id]
    );
  }

  return {
    verified: true,
    userId: otp.user_id,
  };
}

export async function loginUser({
  email,
  password,
}) {
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
        r.name AS role
      FROM users u
      LEFT JOIN user_roles ur
        ON ur.user_id = u.id
      LEFT JOIN roles r
        ON r.id = ur.role_id
      WHERE u.email = ?
      LIMIT 1
    `,
    [email]
  );

  if (!rows.length) {
    const error = new Error(
      "Invalid email or password"
    );

    error.statusCode = 401;

    throw error;
  }

  const user = rows[0];

  const passwordValid =
    await argon2.verify(
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

  if (
    !user.email_verified_at ||
    !user.phone_verified_at
  ) {
    const error = new Error(
      "Please verify your email and phone number first"
    );

    error.statusCode = 403;

    throw error;
  }

  if (user.status !== "active") {
    const error = new Error(
      `Account is ${user.status}`
    );

    error.statusCode = 403;

    throw error;
  }

  const accessToken =
    createAccessToken(user);

  return {
    accessToken,
    user: {
      id: user.id,
      email: user.email,
      phone: user.phone,
      role: user.role,
    },
  };
}

export async function resendOtp({ destination, purpose }) {
  const [rows] = await db.execute(
    `
      SELECT id, email, phone
      FROM users
      WHERE email = ? OR phone = ?
      LIMIT 1
    `,
    [destination, destination]
  );

  if (!rows.length) {
    const error = new Error("User not found with this destination");
    error.statusCode = 404;
    throw error;
  }

  const user = rows[0];
  const connection = await db.getConnection();

  try {
    await createOtp(connection, user.id, destination, purpose);
    return {
      success: true,
      message: "Verification code resent successfully",
    };
  } finally {
    connection.release();
  }
}