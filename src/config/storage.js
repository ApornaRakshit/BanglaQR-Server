import fs from "fs";
import path from "path";
import crypto from "crypto";

// Abstracted Secure Storage Driver
const STORAGE_ROOT = path.resolve(process.cwd(), "storage", "secure_documents");

// Ensure base storage directory exists
if (!fs.existsSync(STORAGE_ROOT)) {
  fs.mkdirSync(STORAGE_ROOT, { recursive: true });
}

export const secureStorage = {
  /**
   * Save buffer or file into secure storage
   * @param {Object} file - Multer file object or { buffer, originalname, mimetype }
   * @param {string|number} merchantId - Owner merchant ID
   * @returns {Promise<{ storageKey: string, filePath: string, size: number, mimeType: string }>}
   */
  async saveFile(file, merchantId) {
    const merchantFolder = path.join(STORAGE_ROOT, `merchant_${merchantId}`);
    if (!fs.existsSync(merchantFolder)) {
      await fs.promises.mkdir(merchantFolder, { recursive: true });
    }

    const fileExt = path.extname(file.originalname).toLowerCase();
    const randomHex = crypto.randomBytes(16).toString("hex");
    const safeFilename = `${Date.now()}_${randomHex}${fileExt}`;
    const destinationPath = path.join(merchantFolder, safeFilename);

    if (file.buffer) {
      await fs.promises.writeFile(destinationPath, file.buffer);
    } else if (file.path) {
      // If multer stored it temporarily in tmp
      await fs.promises.copyFile(file.path, destinationPath);
      await fs.promises.unlink(file.path).catch(() => {});
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
   * Retrieve file path from storage key
   * @param {string} storageKey 
   * @param {string|number} merchantId 
   * @returns {string} Absolute file path
   */
  getFilePath(storageKey, merchantId) {
    // Prevent path traversal
    const normalizedKey = path.normalize(storageKey).replace(/^(\.\.[\/\\])+/, "");
    const expectedPrefix = `merchant_${merchantId}`;
    
    if (!normalizedKey.startsWith(expectedPrefix)) {
      throw new Error("Access denied: File does not belong to merchant");
    }

    const absolutePath = path.join(STORAGE_ROOT, normalizedKey);
    return absolutePath;
  },

  /**
   * Delete file from secure storage
   * @param {string} storageKey 
   * @param {string|number} merchantId 
   */
  async deleteFile(storageKey, merchantId) {
    try {
      const filePath = this.getFilePath(storageKey, merchantId);
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
      }
    } catch (err) {
      // Ignore file-not-found errors during delete
    }
  },
};

