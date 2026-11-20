import multer from "multer";
import path from "path";
import crypto from "crypto";
import fs from "fs";
import { secureStorage } from "../config/storage.js";

const tmpUploadsDir = secureStorage.getTmpUploadsDir();

// Temporary disk storage in private staging directory (outside public web root)
// Avoids Node.js heap/process memory pressure during concurrent large uploads
const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, tmpUploadsDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const safeName = `tmp_${Date.now()}_${crypto.randomBytes(12).toString("hex")}${ext}`;
    cb(null, safeName);
  },
});

const ALLOWED_EXTENSIONS = [".pdf", ".jpg", ".jpeg", ".png", ".webp"];
const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
];

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname || "").toLowerCase();

  // Fast pre-check: quick rejection for known unsupported/executable files
  if (!ALLOWED_EXTENSIONS.includes(ext) && !ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    // Check if client tried to upload HEIC/HEIF
    if (ext === ".heic" || ext === ".heif" || file.mimetype?.includes("heic") || file.mimetype?.includes("heif")) {
      const error = new Error(
        "HEIC/HEIF ফরম্যাট বর্তমানে সমর্থিত নয়। অনুগ্রহ করে ফাইলটিকে JPEG অথবা PNG ফরম্যাটে রূপান্তর করে আপলোড করুন (HEIC/HEIF is not supported directly. Please convert to JPG/PNG before upload)."
      );
      error.statusCode = 415;
      return cb(error, false);
    }

    const error = new Error(
      "ফাইল ফরম্যাট গ্রহণযোগ্য নয়। শুধুমাত্র PDF, JPG, JPEG, PNG এবং WEBP ফাইল আপলোড করা যাবে (Invalid format. Only PDF, JPG, PNG allowed)."
    );
    error.statusCode = 400;
    return cb(error, false);
  }

  cb(null, true);
};

const MAX_FILE_SIZE = Number(process.env.MAX_UPLOAD_SIZE_MB || 10) * 1024 * 1024; // 10MB default

export const uploadDocument = multer({
  storage: diskStorage,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1, // Single file per upload
    fields: 10, // Reasonable field count
  },
  fileFilter,
});

export const uploadDocumentArray = multer({
  storage: diskStorage,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 10,
    fields: 20,
  },
  fileFilter,
});
