import { db } from "../../../config/db.js";

export async function createTrashBinTable() {
  const sql = `
    CREATE TABLE IF NOT EXISTS admin_trash_bin (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      section VARCHAR(50) NOT NULL,
      original_id VARCHAR(100) NOT NULL,
      title VARCHAR(255) NOT NULL,
      description TEXT NULL,
      scope VARCHAR(50) DEFAULT 'both',
      deleted_by VARCHAR(255) DEFAULT 'Admin',
      payload LONGTEXT NOT NULL,
      deleted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      INDEX idx_section (section),
      INDEX idx_deleted_at (deleted_at),
      INDEX idx_expires_at (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;
  await db.query(sql);
}
