import multer from "multer";

const storage = multer.memoryStorage();

const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/svg+xml",
];

const fileFilter = (req, file, cb) => {
  if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    const error = new Error(
      "Invalid file format. Only PDF, JPG, JPEG, PNG, and WEBP files are allowed."
    );
    error.statusCode = 400;
    cb(error, false);
  }
};

const MAX_FILE_SIZE = Number(process.env.MAX_UPLOAD_SIZE_MB || 10) * 1024 * 1024; // 10MB default

export const uploadDocument = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE,
  },
  fileFilter,
});
