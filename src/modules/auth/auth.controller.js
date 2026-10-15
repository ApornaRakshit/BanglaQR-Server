import {
  registerUser,
  verifyOtp,
  loginUser,
  resendOtp,
  requestPasswordReset,
  verifyResetToken,
  resetPassword,
  verifyInstitutionInvitation,
  acceptInstitutionInvitation,
  changeUserPassword,
} from "./auth.service.js";

import {
  registerSchema,
  loginSchema,
  verifyOtpSchema,
  resendOtpSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
} from "./auth.validation.js";

export async function register(req, res, next) {
  try {
    const data = registerSchema.parse(req.body);

    const result = await registerUser(data);

    if (result.verificationBypassed && result.accessToken) {
      res.cookie("bq_access", result.accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite:
          process.env.NODE_ENV === "production"
            ? "strict"
            : "lax",
        signed: true,
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });
    }

    res.status(201).json({
      success: true,
      message: result.message || "Account created.",
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
        maxAge: 7 * 24 * 60 * 60 * 1000,
      })
      .json({
        success: true,
        message: "Login successful",
        data: {
          user: result.user,
          token: result.accessToken,
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
          roles: req.user.roles || (req.user.role ? [req.user.role] : []),
          isMerchant: Boolean(req.user.isMerchant),
          permissions: req.user.permissions || [],
          emailVerified: Boolean(
            req.user.email_verified_at
          ),
          phoneVerified: Boolean(
            req.user.phone_verified_at
          ),
          twoFactorEnabled:
            Boolean(req.user.two_factor_enabled),
          mustChangePassword: Boolean(req.user.must_change_password),
          institution: req.user.institution || null,
          institutionId: req.user.institutionId || null,
          institutionRole: req.user.institutionRole || null,
          institutionMemberships: req.user.institutionMemberships || [],
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
      message: result.message || "Verification code sent successfully",
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

export async function verificationStatus(req, res, next) {
  try {
    const destination = req.query.destination || req.query.email || req.query.phone;
    if (!destination) {
      return res.status(400).json({ success: false, message: "Destination is required" });
    }

    const { getVerificationStatus } = await import("./auth.service.js");
    const result = await getVerificationStatus({ destination });

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

export async function forgotPassword(req, res, next) {
  try {
    const data = forgotPasswordSchema.parse(req.body);
    const result = await requestPasswordReset(data);

    res.json({
      success: true,
      message: result.message,
    });
  } catch (error) {
    next(error);
  }
}

export async function verifyResetTokenController(req, res, next) {
  try {
    const token = req.query.token || req.body?.token;
    const result = await verifyResetToken({ token });

    if (!result.valid) {
      return res.status(400).json({
        success: false,
        message: result.message,
      });
    }

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

export async function resetPasswordController(req, res, next) {
  try {
    const data = resetPasswordSchema.parse(req.body);
    const result = await resetPassword(data);

    res.json({
      success: true,
      message: result.message,
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

export async function verifyInstitutionInvitationController(req, res, next) {
  try {
    const token = req.query.token || req.body?.token;
    if (!token) {
      return res.status(400).json({ success: false, message: "Invitation token is required" });
    }
    const result = await verifyInstitutionInvitation(token);
    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

export async function acceptInstitutionInvitationController(req, res, next) {
  try {
    const { token, password, name, phone } = req.body;
    if (!token) {
      return res.status(400).json({ success: false, message: "Invitation token is required" });
    }
    const result = await acceptInstitutionInvitation({ token, password, name, phone });
    res.json({
      success: true,
      message: result.message,
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

export async function changePassword(req, res, next) {
  try {
    const validated = changePasswordSchema.parse(req.body);
    const result = await changeUserPassword({
      userId: req.user.id,
      currentPassword: validated.currentPassword,
      newPassword: validated.newPassword,
    });

    res.json({
      success: true,
      message: result.message,
    });
  } catch (error) {
    if (error.name === "ZodError") {
      const issues = error.issues || error.errors || [];
      const errorDetails = issues.map((e) => `${(e.path || []).join(".")}: ${e.message}`).join(", ");
      return res.status(400).json({
        success: false,
        message: `Validation failed: ${errorDetails}`,
        errors: issues,
      });
    }
    next(error);
  }
}