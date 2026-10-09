import {
  registerUser,
  verifyOtp,
  loginUser,
  resendOtp,
} from "./auth.service.js";

import {
  registerSchema,
  loginSchema,
  verifyOtpSchema,
  resendOtpSchema,
} from "./auth.validation.js";

export async function register(req, res, next) {
  try {
    const data = registerSchema.parse(req.body);

    const result = await registerUser(data);

    res.status(201).json({
      success: true,
      message:
        "Account created. Please verify your email and phone.",
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

export async function verify(req, res, next) {
  try {
    const data = verifyOtpSchema.parse(req.body);

    const result = await verifyOtp(data);

    res.json({
      success: true,
      message: "Verification successful",
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

export async function login(req, res, next) {
  try {
    const data = loginSchema.parse(req.body);

    const result = await loginUser({
      ...data,
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });

    res
      .cookie("bq_access", result.accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite:
          process.env.NODE_ENV === "production"
            ? "strict"
            : "lax",
        signed: true,
        maxAge: 15 * 60 * 1000,
      })
      .json({
        success: true,
        message: "Login successful",
        data: {
          user: result.user,
        },
      });
  } catch (error) {
    next(error);
  }
}

export async function me(req, res, next) {
  try {
    res.json({
      success: true,
      data: {
        user: {
          id: req.user.id,
          email: req.user.email,
          phone: req.user.phone,
          status: req.user.status,
          role: req.user.role,
          permissions: req.user.permissions || [],
          emailVerified: Boolean(
            req.user.email_verified_at
          ),
          phoneVerified: Boolean(
            req.user.phone_verified_at
          ),
          twoFactorEnabled:
            Boolean(req.user.two_factor_enabled),
        },
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function resend(req, res, next) {
  try {
    const data = resendOtpSchema.parse(req.body);

    const result = await resendOtp(data);

    res.json({
      success: true,
      message: "Verification code sent successfully",
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

export async function logout(req, res, next) {
  try {
    res
      .clearCookie("bq_access")
      .json({
        success: true,
        message: "Logout successful",
      });
  } catch (error) {
    next(error);
  }
}