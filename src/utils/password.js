import bcrypt from "bcryptjs";

const SALT_ROUNDS = 10;

/**
 * Hash a plain password using bcryptjs with 10 salt rounds.
 * @param {string} password
 * @returns {Promise<string>}
 */
export async function hashPassword(password) {
  if (typeof password !== "string" || password.length === 0) {
    throw new Error("Password must be a non-empty string");
  }
  return bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * Verify a plain password against a stored hash using bcryptjs exclusively.
 * Strictly accepts only valid bcrypt hashes starting with $2a$ or $2b$.
 * Production password verification NEVER accepts plaintext or unknown hash formats.
 *
 * @param {string} storedHash
 * @param {string} plainPassword
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(storedHash, plainPassword) {
  if (
    typeof storedHash !== "string" ||
    typeof plainPassword !== "string" ||
    storedHash.length === 0 ||
    plainPassword.length === 0
  ) {
    return false;
  }

  // Strictly verify against standard bcrypt ($2a$, $2b$) hashes
  if (storedHash.startsWith("$2a$") || storedHash.startsWith("$2b$")) {
    try {
      return await bcrypt.compare(plainPassword, storedHash);
    } catch (_) {
      return false;
    }
  }

  // Reject all other formats, malformed hashes, and plaintext passwords
  return false;
}
