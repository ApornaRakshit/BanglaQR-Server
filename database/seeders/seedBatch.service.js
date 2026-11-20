import { db } from "../../src/config/db.js";

/**
 * Whitelist of permissible tables for rollback operations.
 * Prevents arbitrary or unauthorized table deletions.
 */
const ROLLBACK_TABLE_WHITELIST = new Set([
  "merchant_profile_custom_values",
  "merchant_profile_activities",
  "merchant_document_versions",
  "merchant_documents",
  "merchant_form_step_versions",
  "kyc_field_issues",
  "kyc_submission_versions",
  "merchant_kyc_assignments",
  "merchant_gateway_services",
  "merchant_gateway_applications",
  "merchant_addons",
  "addon_payments",
  "addon_orders",
  "invoice_payments",
  "invoice_history",
  "invoices",
  "invoice_customers",
  "support_ticket_messages",
  "support_tickets",
  "merchant_commercial_details",
  "merchant_contacts",
  "merchant_kyc",
  "merchant_onboarding_history",
  "merchant_profiles",
  "merchants",
  "notifications",
  "otp_codes",
  "password_resets",
  "user_devices",
  "sessions",
  "login_attempts",
  "users",
]);

/**
 * Strict Foreign Key deletion order for rollbacks.
 * Note: user_roles has composite PK (user_id, role_id) and is automatically
 * deleted via ON DELETE CASCADE from users(id).
 */
const ROLLBACK_DELETION_ORDER = [
  "merchant_profile_custom_values",
  "merchant_profile_activities",
  "merchant_document_versions",
  "merchant_documents",
  "merchant_form_step_versions",
  "kyc_field_issues",
  "kyc_submission_versions",
  "merchant_kyc_assignments",
  "merchant_gateway_services",
  "merchant_gateway_applications",
  "merchant_addons",
  "addon_payments",
  "addon_orders",
  "invoice_payments",
  "invoice_history",
  "invoices",
  "invoice_customers",
  "support_ticket_messages",
  "support_tickets",
  "merchant_commercial_details",
  "merchant_contacts",
  "merchant_kyc",
  "merchant_onboarding_history",
  "merchant_profiles",
  "merchants",
  "notifications",
  "otp_codes",
  "password_resets",
  "user_devices",
  "sessions",
  "login_attempts",
  "users",
];

export const seedBatchService = {
  /**
   * Create a new seed batch tracking record within an existing connection/transaction
   */
  async createBatchWithConnection(connection, { batchName, seederType = "merchant", createdByUserId = null, metadata = {} }) {
    const [res] = await connection.query(
      `INSERT INTO seed_batches (batch_name, seeder_type, status, metadata, created_by_user_id)
       VALUES (?, ?, 'active', ?, ?)`,
      [batchName, seederType, JSON.stringify(metadata), createdByUserId]
    );
    return res.insertId;
  },

  /**
   * Record generated item IDs within the same connection/transaction
   */
  async recordBatchItemsWithConnection(connection, batchId, tableName, recordIds) {
    if (!recordIds || recordIds.length === 0) return;
    if (!ROLLBACK_TABLE_WHITELIST.has(tableName)) {
      throw new Error(`Security Violation: Table '${tableName}' is not in the seed batch whitelist.`);
    }
    const values = recordIds.map((id) => [batchId, tableName, String(id)]);
    await connection.query(
      `INSERT INTO seed_batch_records (batch_id, table_name, record_id) VALUES ?`,
      [values]
    );
  },

  /**
   * Complete batch creation within the same connection/transaction
   */
  async completeBatchWithConnection(connection, batchId, recordCount) {
    await connection.query(
      `UPDATE seed_batches SET record_count = ?, status = 'active' WHERE id = ?`,
      [recordCount, batchId]
    );
  },

  /**
   * List all batches
   */
  async listBatches({ limit = 50 } = {}) {
    const [rows] = await db.query(
      `SELECT id, batch_name, seeder_type, record_count, status, metadata, created_by_user_id, created_at, cleaned_up_at
       FROM seed_batches ORDER BY id DESC LIMIT ?`,
      [Number(limit)]
    );
    return rows;
  },

  /**
   * Get batch details with breakdown of records per table
   */
  async getBatchDetails(batchId) {
    const [batches] = await db.query(`SELECT * FROM seed_batches WHERE id = ?`, [batchId]);
    if (batches.length === 0) return null;
    const batch = batches[0];

    const [counts] = await db.query(
      `SELECT table_name, COUNT(*) AS count
       FROM seed_batch_records WHERE batch_id = ? GROUP BY table_name`,
      [batchId]
    );
    return { ...batch, breakdown: counts };
  },

  /**
   * Rollback a specific batch of seeded records safely using FK dependency order and whitelist
   */
  async rollbackBatch(batchId) {
    const details = await this.getBatchDetails(batchId);
    if (!details) {
      throw new Error(`Seed batch #${batchId} not found.`);
    }

    if (details.status === "cleaned_up") {
      throw new Error(`Seed batch #${batchId} is already cleaned up.`);
    }

    const [records] = await db.query(
      `SELECT table_name, record_id FROM seed_batch_records WHERE batch_id = ? ORDER BY id DESC`,
      [batchId]
    );

    const recordsByTable = {};
    for (const r of records) {
      if (!ROLLBACK_TABLE_WHITELIST.has(r.table_name)) {
        throw new Error(`Security Violation: Found non-whitelisted table '${r.table_name}' in batch records.`);
      }
      if (!recordsByTable[r.table_name]) recordsByTable[r.table_name] = [];
      recordsByTable[r.table_name].push(r.record_id);
    }

    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      const deletedSummary = {};
      for (const table of ROLLBACK_DELETION_ORDER) {
        const ids = recordsByTable[table];
        if (ids && ids.length > 0) {
          const [res] = await connection.query(
            `DELETE FROM \`${table}\` WHERE id IN (?)`,
            [ids]
          );
          deletedSummary[table] = res.affectedRows;
        }
      }

      await connection.query(
        `UPDATE seed_batches SET status = 'cleaned_up', cleaned_up_at = NOW() WHERE id = ?`,
        [batchId]
      );

      await connection.commit();
      return { success: true, batchId, deletedSummary };
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  },
};
