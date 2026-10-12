import { ZodError } from "zod";

export function errorHandler(
  error,
  req,
  res,
  next
) {
  console.error(error);

  if (error instanceof ZodError) {
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  const statusCode =
    error.statusCode || 500;

  const payload = {
    success: false,
    message:
      error.message ||
      "Internal server error",
  };

  if (error.emailVerified !== undefined) payload.emailVerified = error.emailVerified;
  if (error.phoneVerified !== undefined) payload.phoneVerified = error.phoneVerified;
  if (error.email !== undefined) payload.email = error.email;
  if (error.phone !== undefined) payload.phone = error.phone;
  if (error.waitSeconds !== undefined) payload.waitSeconds = error.waitSeconds;

  res.status(statusCode).json(payload);
}