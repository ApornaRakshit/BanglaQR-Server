import { z } from "zod";

export const registerSchema = z.object({
  fullName: z.string().trim().optional(),
  name: z.string().trim().optional(),

  email: z
    .string()
    .trim()
    .email("Valid email is required")
    .max(255),

  phone: z
    .string()
    .trim()
    .min(8, "Valid phone number is required")
    .max(30),

  password: z
    .string()
    .min(8, "Password must contain at least 8 characters")
    .max(128),
});

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .email("Valid email is required"),

  password: z.string().min(1),
});

export const verifyOtpSchema = z.object({
  destination: z
    .string()
    .trim()
    .min(3),

  code: z
    .string()
    .regex(/^\d{6}$/, "OTP must contain 6 digits"),

  purpose: z.enum([
    "email_verification",
    "phone_verification",
  ]),

  email: z
    .string()
    .trim()
    .email()
    .optional(),
});

export const resendOtpSchema = z.object({
  destination: z
    .string()
    .trim()
    .min(3),

  purpose: z.enum([
    "email_verification",
    "phone_verification",
  ]),

  email: z
    .string()
    .trim()
    .email()
    .optional(),
});

export const forgotPasswordSchema = z.object({
  email: z
    .string()
    .trim()
    .email("Valid email address is required")
    .max(255),
});

export const resetPasswordSchema = z.object({
  token: z
    .string()
    .trim()
    .min(10, "Valid reset token is required"),

  newPassword: z
    .string()
    .min(8, "Password must contain at least 8 characters")
    .max(128),
});