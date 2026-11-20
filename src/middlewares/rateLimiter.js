import rateLimit from "express-rate-limit";

// Rate limiter for password reset requests (request OTP): 5 requests per 15 minutes per IP
export const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.BENCHMARK_MODE === "true" ? 10000 : 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many password recovery requests from this IP. Please try again after 15 minutes.",
  },
});

// Rate limiter for OTP verification endpoints: 10 attempts per 15 minutes per IP
export const otpVerificationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.BENCHMARK_MODE === "true" ? 10000 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many verification attempts from this IP. Please try again after 15 minutes.",
  },
});

// Rate limiter for OTP resend: 5 requests per 15 minutes per IP
export const otpResendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.BENCHMARK_MODE === "true" ? 10000 : 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many OTP resend requests from this IP. Please try again after 15 minutes.",
  },
});

