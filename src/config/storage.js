import fs from "fs";
import path from "path";
import crypto from "crypto";

const BASE_DIR = process.env.SECURE_STORAGE_PATH
  ? path.resolve(process.env.SECURE_STORAGE_PATH)
  : path.resolve(process.cwd(), "storage");

const SECURE_DOCS_DIR = path.join(BASE_DIR, "secure_documents");
const TMP_UPLOADS_DIR = path.join(BASE_DIR, "tmp_uploads");

// Ensure directories exist
if (!fs.existsSync(SECURE_DOCS_DIR)) {
  fs.mkdirSync(SECURE_DOCS_DIR, { recursive: true });
}
if (!fs.existsSync(TMP_UPLOADS_DIR)) {
  fs.mkdirSync(TMP_UPLOADS_DIR, { recursive: true });
}

export const secureStorage = {
  getStorageRoot() {
    return SECURE_DOCS_DIR;
  },

  getTmpUploadsDir() {
    return TMP_UPLOADS_DIR;
  },

  /**
   * Save a temporary or buffered file into permanent secure storage under merchant folder.
   * Cleans up the temporary file if file.path was supplied.
   *
   * @param {Object} file - Multer file object or { path, buffer, originalname, mimetype, size }
   * @param {string|number} merchantId - Owner merchant ID
   * @returns {Promise<{ storageKey: string, filePath: string, size: number, mimeType: string }>}
   */
  async saveFile(file, merchantId) {
    const merchantFolder = path.join(SECURE_DOCS_DIR, `merchant_${merchantId}`);
    if (!fs.existsSync(merchantFolder)) {
      await fs.promises.mkdir(merchantFolder, { recursive: true });
    }

    const fileExt = path.extname(file.originalname || "").toLowerCase() || ".dat";
    const randomHex = crypto.randomBytes(16).toString("hex");
    const safeFilename = `${Date.now()}_${randomHex}${fileExt}`;
    const destinationPath = path.join(merchantFolder, safeFilename);

    if (file.path) {
      // Move from temporary disk staging to permanent storage
      await fs.promises.copyFile(file.path, destinationPath);
      await fs.promises.unlink(file.path).catch(() => {});
    } else if (file.buffer) {
      await fs.promises.writeFile(destinationPath, file.buffer);
    } else {
      throw new Error("No file content or path provided to saveFile");
    }

    const storageKey = path.join(`merchant_${merchantId}`, safeFilename).replace(/\\/g, "/");

    return {
      storageKey,
      filePath: destinationPath,
      size: file.size,
      mimeType: file.mimetype,
    };
  },

  /**
   * Retrieve file path from storage key with strict traversal prevention and merchant isolation.
   *
   * @param {string} storageKey
   * @param {string|number} merchantId
   * @returns {string} Absolute file path
   */
  getFilePath(storageKey, merchantId) {
    if (!storageKey || typeof storageKey !== "string") {
      throw new Error("Invalid storage key");
    }

    // Path traversal defense: normalize and strip any leading dots/slashes
    const normalizedKey = path.normalize(storageKey).replace(/^(\.\.[\/\\])+/, "").replace(/^[/\\]+/, "");
    const expectedPrefix = `merchant_${merchantId}`;

    if (!normalizedKey.startsWith(expectedPrefix)) {
      throw new Error("Access denied: File does not belong to merchant");
    }

    const absolutePath = path.join(SECURE_DOCS_DIR, normalizedKey);

    // Verify canonical path still resides within SECURE_DOCS_DIR
    const resolvedPath = path.resolve(absolutePath);
    if (!resolvedPath.startsWith(path.resolve(SECURE_DOCS_DIR))) {
      throw new Error("Access denied: Path traversal detected");
    }

    return absolutePath;
  },

  /**
   * Safely delete file from secure storage.
   *
   * @param {string} storageKey
   * @param {string|number} merchantId
   */
  async deleteFile(storageKey, merchantId) {
    if (!storageKey) return;
    try {
      const filePath = this.getFilePath(storageKey, merchantId);
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
      }
    } catch (err) {
      // Ignore not found or log non-critical deletion errors
      console.warn(`[SecureStorage] Safe delete warning for ${storageKey}:`, err.message);
    }
  },

  /**
   * Safely delete an uncommitted or orphaned physical file path
   * @param {string} filePath
   */
  /**
   * Safely delete an uncommitted or orphaned physical file path
   * @param {string} filePath
   */
  async deletePhysicalFile(filePath) {
    if (!filePath) return;
    try {
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
      }
    } catch (err) {
      console.warn(`[SecureStorage] Failed to unlink physical file ${filePath}:`, err.message);
    }
  },

  /**
   * Clean up stale temporary upload files older than maxAgeMs (default 1 hour)
   * to ensure tmp directory never grows unbounded.
   *
   * @param {number} maxAgeMs
   */
  async cleanStaleTmpFiles(maxAgeMs = 60 * 60 * 1000) {
    try {
      if (!fs.existsSync(TMP_UPLOADS_DIR)) return 0;
      const files = await fs.promises.readdir(TMP_UPLOADS_DIR);
      const now = Date.now();
      let cleaned = 0;

      for (const file of files) {
        const fullPath = path.join(TMP_UPLOADS_DIR, file);
        try {
          const stats = await fs.promises.stat(fullPath);
          if (now - stats.mtimeMs > maxAgeMs) {
            await fs.promises.unlink(fullPath);
            cleaned++;
          }
        } catch {
          // Ignore files that disappeared
        }
      }
      return cleaned;
    } catch (err) {
      console.warn("[SecureStorage] cleanStaleTmpFiles error:", err.message);
      return 0;
    }
  },
};
