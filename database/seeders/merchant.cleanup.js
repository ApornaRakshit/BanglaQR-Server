import fs from "fs";
import path from "path";
import os from "os";
import { exec } from "child_process";
import { promisify } from "util";
import { db } from "../../src/config/db.js";

const execAsync = promisify(exec);

/**
 * Service to inspect, preview, and perform a complete safe local database cleanup
 * of merchant test fixtures and transactional records while strictly preserving
 * all administrators, roles, permissions, bank/MFS catalogues, and form builder configurations.
 */
export const merchantCleanupService = {
  /**
   * Environment security check:
   * 1. Requires NODE_ENV to be explicitly 'development' (no fallback).
   * 2. Requires DB_NAME to be explicitly 'banglaqr_db'.
   * 3. Blocks remote and production connections.
   * 4. Verifies the actual connected database using SELECT DATABASE().
   */
  async validateEnvironment() {
    const nodeEnv = process.env.NODE_ENV;
    if (nodeEnv !== "development") {
      throw new Error(
        `Execution blocked: NODE_ENV must be explicitly 'development'. Current value: ${JSON.stringify(nodeEnv)}`
      );
    }

    const configuredDb = process.env.DB_NAME;
    if (configuredDb !== "banglaqr_db") {
      throw new Error(
        `Execution blocked: DB_NAME must be explicitly 'banglaqr_db'. Current value: ${JSON.stringify(configuredDb)}`
      );
    }

    const dbHost = (process.env.DB_HOST || "").toLowerCase();
    const isLocalHost =
      dbHost === "localhost" ||
      dbHost === "127.0.0.1" ||
      dbHost.startsWith("127.") ||
      dbHost === "::1";

    if (!isLocalHost) {
      throw new Error(
        `Execution blocked: DB_HOST must be local (localhost / 127.0.0.1). Current value: '${dbHost}'`
      );
    }

    // Verify actual connected database on MySQL server
    const [rows] = await db.query("SELECT DATABASE() AS current_db");
    const activeDb = rows[0]?.current_db;
    if (activeDb !== "banglaqr_db") {
      throw new Error(
        `Execution blocked: Active connected database is '${activeDb}', expected 'banglaqr_db'`
      );
    }
  },

  /**
   * Safe merchant user identification:
   * - Target users are strictly limited to verified test accounts:
   *     * User 17:  email 'reset_test_merchant@banglaqr.com' (legacy test account, zero linked merchants, zero roles)
   *     * User 471: email 'shakhawat9083@gmail.com' (exactly merchant ID 358, role 'merchant' only)
   *     * User 472: email 'aporna.rakshit@gmail.com' (exactly merchant ID 359, role 'merchant' only)
   * - Strict Fail-Closed Identity Rules:
   *     * Verify exact ID AND exact expected email.
   *     * Verify ALL merchant IDs linked to the candidate user (no LIMIT 1).
   *     * Verify that users have ONLY permitted roles without GROUP_CONCAT truncation risk.
   *     * Must NOT have platform_admin_users or institution_users memberships.
   *     * If any identity, email, role, or relationship mismatch occurs, the account is excluded.
   */
  async getVerifiedTestMerchantUserIds() {
    const expectedAccounts = [
      {
        id: 17,
        expectedEmail: "reset_test_merchant@banglaqr.com",
        expectedMerchantIds: [],
        allowedRoles: [],
      },
      {
        id: 471,
        expectedEmail: "shakhawat9083@gmail.com",
        expectedMerchantIds: [358],
        allowedRoles: ["merchant"],
      },
      {
        id: 472,
        expectedEmail: "aporna.rakshit@gmail.com",
        expectedMerchantIds: [359],
        allowedRoles: ["merchant"],
      },
    ];

    const candidateIds = expectedAccounts.map((a) => a.id);

    // 1. Fetch user base identities
    const [users] = await db.query(
      `SELECT u.id, u.email, u.phone FROM users u WHERE u.id IN (?)`,
      [candidateIds]
    );

    // 2. Fetch platform admin memberships
    const [admins] = await db.query(
      `SELECT user_id FROM platform_admin_users WHERE user_id IN (?)`,
      [candidateIds]
    );
    const adminUserIds = new Set(admins.map((a) => a.user_id));

    // 3. Fetch institution staff memberships
    const [staff] = await db.query(
      `SELECT user_id FROM institution_users WHERE user_id IN (?)`,
      [candidateIds]
    );
    const staffUserIds = new Set(staff.map((s) => s.user_id));

    // 4. Fetch ALL linked merchant relationships per candidate (no LIMIT 1)
    const [merchants] = await db.query(
      `SELECT id, user_id FROM merchants WHERE user_id IN (?)`,
      [candidateIds]
    );
    const merchantsByUser = {};
    for (const m of merchants) {
      if (!merchantsByUser[m.user_id]) merchantsByUser[m.user_id] = [];
      merchantsByUser[m.user_id].push(Number(m.id));
    }

    // 5. Fetch ALL role memberships without GROUP_CONCAT truncation risk
    const [roles] = await db.query(
      `SELECT ur.user_id, r.name AS role_name
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       WHERE ur.user_id IN (?)`,
      [candidateIds]
    );
    const rolesByUser = {};
    for (const r of roles) {
      if (!rolesByUser[r.user_id]) rolesByUser[r.user_id] = [];
      rolesByUser[r.user_id].push(r.role_name);
    }

    const verifiedIds = [];
    for (const expected of expectedAccounts) {
      const u = users.find((user) => user.id === expected.id);
      if (!u) continue; // Account does not exist

      // A. Exact email match (case-insensitive trim)
      if ((u.email || "").trim().toLowerCase() !== expected.expectedEmail.toLowerCase()) {
        continue;
      }

      // B. Must not be platform admin or institution staff
      if (adminUserIds.has(u.id) || staffUserIds.has(u.id)) {
        continue;
      }

      // C. Exact merchant relationship match: verify ALL merchant IDs
      const actualMerchantIds = (merchantsByUser[u.id] || []).sort((a, b) => a - b);
      const expectedMerchantIds = [...expected.expectedMerchantIds].sort((a, b) => a - b);
      if (actualMerchantIds.length !== expectedMerchantIds.length) {
        continue;
      }
      const merchantsMatch = actualMerchantIds.every((id, idx) => id === expectedMerchantIds[idx]);
      if (!merchantsMatch) {
        continue;
      }

      // D. Role validation: Must have ONLY permitted roles without truncation risk
      const actualRoles = rolesByUser[u.id] || [];

      // Disallow any role not in allowedRoles
      const hasDisallowedRole = actualRoles.some((r) => !expected.allowedRoles.includes(r));
      if (hasDisallowedRole) {
        continue;
      }

      // Ensure all expected roles are present
      const missingExpectedRole = expected.allowedRoles.some((r) => !actualRoles.includes(r));
      if (missingExpectedRole) {
        continue;
      }

      verifiedIds.push(u.id);
    }

    return verifiedIds;
  },

  /**
   * Resolves the exact cleanup target entity IDs based on verified test users
   */
  async resolveCleanupEntities() {
    const testUserIds = await this.getVerifiedTestMerchantUserIds();

    let merchantIds = [];
    if (testUserIds.length > 0) {
      const [mRows] = await db.query(
        `SELECT id FROM merchants WHERE user_id IN (?)`,
        [testUserIds]
      );
      merchantIds = mRows.map((r) => r.id);
    }

    let merchantDocIds = [];
    if (merchantIds.length > 0) {
      const [docRows] = await db.query(
        `SELECT id FROM merchant_documents WHERE merchant_id IN (?)`,
        [merchantIds]
      );
      merchantDocIds = docRows.map((r) => r.id);
    }

    let testOtpIds = [];
    if (testUserIds.length > 0) {
      const [otpRows] = await db.query(
        `SELECT id FROM otp_codes WHERE user_id IN (?)`,
        [testUserIds]
      );
      testOtpIds = otpRows.map((r) => r.id);
    }

    return {
      testUserIds,
      merchantIds,
      merchantDocIds,
      testOtpIds,
    };
  },

  /**
   * Central definition of cleanup queries used by both preview and execution.
   * Ensures 100% parity between preview counts and deleted rows.
   * Proper Foreign-Key child dependency order.
   */
  getCleanupPlan(entities) {
    const { testUserIds, merchantIds, merchantDocIds, testOtpIds } = entities;

    const hasUsers = testUserIds.length > 0;
    const hasMerchants = merchantIds.length > 0;
    const hasDocs = merchantDocIds.length > 0;
    const hasOtps = testOtpIds.length > 0;

    return [
      // --- Layer 1: Deep Leaf Transactional Children ---
      {
        table: "merchant_profile_custom_values",
        where: hasMerchants ? "merchant_id IN (?)" : null,
        params: hasMerchants ? [merchantIds] : [],
      },
      {
        table: "merchant_profile_activities",
        where: hasMerchants ? "merchant_id IN (?)" : null,
        params: hasMerchants ? [merchantIds] : [],
      },
      {
        table: "merchant_document_versions",
        where: hasDocs ? "document_id IN (?)" : null,
        params: hasDocs ? [merchantDocIds] : [],
      },
      {
        table: "merchant_documents",
        where: hasMerchants ? "merchant_id IN (?)" : null,
        params: hasMerchants ? [merchantIds] : [],
      },
      {
        table: "merchant_form_step_versions",
        where: hasMerchants ? "merchant_id IN (?)" : null,
        params: hasMerchants ? [merchantIds] : [],
      },
      {
        table: "kyc_field_issues",
        where: hasMerchants ? "merchant_id IN (?)" : null,
        params: hasMerchants ? [merchantIds] : [],
      },
      {
        table: "kyc_submission_versions",
        where: hasMerchants ? "merchant_id IN (?)" : null,
        params: hasMerchants ? [merchantIds] : [],
      },
      {
        table: "merchant_kyc_assignments",
        where: hasMerchants ? "kyc_id IN (SELECT id FROM merchant_kyc WHERE merchant_id IN (?))" : null,
        params: hasMerchants ? [merchantIds] : [],
      },
      {
        table: "merchant_gateway_services",
        where: hasMerchants ? "merchant_id IN (?)" : null,
        params: hasMerchants ? [merchantIds] : [],
      },
      {
        table: "merchant_gateway_applications",
        where: hasMerchants ? "merchant_id IN (?)" : null,
        params: hasMerchants ? [merchantIds] : [],
      },
      {
        table: "addon_payments",
        where: hasMerchants
          ? "(merchant_id IN (?)) OR (order_id IN (SELECT id FROM addon_orders WHERE merchant_id IN (?)))"
          : null,
        params: hasMerchants ? [merchantIds, merchantIds] : [],
      },
      {
        table: "addon_orders",
        where: hasMerchants ? "merchant_id IN (?)" : null,
        params: hasMerchants ? [merchantIds] : [],
      },
      {
        table: "merchant_addons",
        where: hasMerchants ? "merchant_id IN (?)" : null,
        params: hasMerchants ? [merchantIds] : [],
      },
      {
        table: "invoice_payments",
        where: hasMerchants
          ? "(merchant_id IN (?)) OR (invoice_id IN (SELECT id FROM invoices WHERE merchant_id IN (?)))"
          : null,
        params: hasMerchants ? [merchantIds, merchantIds] : [],
      },
      {
        table: "invoice_history",
        where: hasMerchants
          ? "(merchant_id IN (?)) OR (invoice_id IN (SELECT id FROM invoices WHERE merchant_id IN (?)))"
          : null,
        params: hasMerchants ? [merchantIds, merchantIds] : [],
      },
      {
        table: "invoices",
        where: hasMerchants ? "merchant_id IN (?)" : null,
        params: hasMerchants ? [merchantIds] : [],
      },
      {
        table: "invoice_customers",
        where: hasMerchants ? "merchant_id IN (?)" : null,
        params: hasMerchants ? [merchantIds] : [],
      },
      {
        table: "support_ticket_messages",
        where: hasMerchants ? "ticket_id IN (SELECT id FROM support_tickets WHERE merchant_id IN (?))" : null,
        params: hasMerchants ? [merchantIds] : [],
      },
      {
        table: "support_tickets",
        where: hasMerchants ? "merchant_id IN (?)" : null,
        params: hasMerchants ? [merchantIds] : [],
      },

      // --- Layer 2: Intermediate Merchant Extensions ---
      {
        table: "merchant_commercial_details",
        where: hasMerchants ? "merchant_id IN (?)" : null,
        params: hasMerchants ? [merchantIds] : [],
      },
      {
        table: "merchant_contacts",
        where: hasMerchants ? "merchant_id IN (?)" : null,
        params: hasMerchants ? [merchantIds] : [],
      },
      {
        table: "merchant_kyc",
        where: hasMerchants ? "merchant_id IN (?)" : null,
        params: hasMerchants ? [merchantIds] : [],
      },
      {
        table: "merchant_onboarding_history",
        where: hasMerchants ? "merchant_id IN (?)" : null,
        params: hasMerchants ? [merchantIds] : [],
      },
      {
        table: "merchant_profiles",
        where: hasMerchants ? "merchant_id IN (?)" : null,
        params: hasMerchants ? [merchantIds] : [],
      },

      // --- Layer 3: Merchant Master Root ---
      {
        table: "merchants",
        where: hasMerchants ? "id IN (?)" : null,
        params: hasMerchants ? [merchantIds] : [],
      },

      // --- Layer 4: Ephemeral User Logs & Sessions ---
      {
        table: "notifications",
        where: hasUsers ? "recipient_type = 'merchant' AND recipient_id IN (?)" : null,
        params: hasUsers ? [testUserIds] : [],
      },
      {
        // SMS outbox: Strictly delete only SMS records linked to OTPs belonging to verified test users
        table: "sms_outbox",
        where: hasOtps ? "otp_code_id IN (?)" : null,
        params: hasOtps ? [testOtpIds] : [],
      },
      {
        table: "otp_codes",
        where: hasUsers ? "user_id IN (?)" : null,
        params: hasUsers ? [testUserIds] : [],
      },
      {
        table: "password_resets",
        where: hasUsers ? "user_id IN (?)" : null,
        params: hasUsers ? [testUserIds] : [],
      },
      {
        table: "user_devices",
        where: hasUsers ? "user_id IN (?)" : null,
        params: hasUsers ? [testUserIds] : [],
      },
      {
        table: "sessions",
        where: hasUsers ? "user_id IN (?)" : null,
        params: hasUsers ? [testUserIds] : [],
      },
      {
        table: "login_attempts",
        where: hasUsers ? "email IN (SELECT email FROM users WHERE id IN (?))" : null,
        params: hasUsers ? [testUserIds] : [],
      },
      {
        table: "user_roles",
        where: hasUsers ? "user_id IN (?)" : null,
        params: hasUsers ? [testUserIds] : [],
      },

      // --- Layer 5: Test Merchant User Identities ---
      {
        table: "users",
        where: hasUsers ? "id IN (?)" : null,
        params: hasUsers ? [testUserIds] : [],
      },

      // --- Layer 6: Test Audit Logs ---
      {
        table: "audit_logs",
        where: hasMerchants ? "merchant_id IS NOT NULL AND merchant_id IN (?)" : null,
        params: hasMerchants ? [merchantIds] : [],
      },
    ];
  },

  /**
   * Previews row counts that would be cleaned up across all transactional tables.
   * If any SQL query fails, it throws the actual error (no swallow or fake zero).
   */
  async previewCleanup() {
    await this.validateEnvironment();

    const entities = await this.resolveCleanupEntities();
    const plan = this.getCleanupPlan(entities);

    const counts = {};

    for (const step of plan) {
      if (!step.where) {
        counts[step.table] = 0;
        continue;
      }

      // Check if table exists; if not, throw clear error
      const [tableCheck] = await db.query(
        "SELECT COUNT(*) AS exists_cnt FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
        [step.table]
      );
      if (tableCheck[0].exists_cnt === 0) {
        throw new Error(`Target table '${step.table}' does not exist in the database.`);
      }

      const sql = `SELECT COUNT(*) AS cnt FROM \`${step.table}\` WHERE ${step.where}`;
      const [res] = await db.query(sql, step.params);
      counts[step.table] = Number(res[0]?.cnt || 0);
    }

    // Preservation verification counts
    const countPreserved = async (table) => {
      const [res] = await db.query(`SELECT COUNT(*) AS cnt FROM \`${table}\``);
      return Number(res[0]?.cnt || 0);
    };

    return {
      testUserIds: entities.testUserIds,
      merchantIds: entities.merchantIds,
      counts,
      preservedSummary: {
        platform_admin_users: await countPreserved("platform_admin_users"),
        roles: await countPreserved("roles"),
        permissions: await countPreserved("permissions"),
        institutions: await countPreserved("institutions"),
        institution_branches: await countPreserved("institution_branches"),
        institution_users: await countPreserved("institution_users"),
        gateways: await countPreserved("gateways"),
        addons: await countPreserved("addons"),
        merchant_form_fields: await countPreserved("merchant_form_fields"),
        merchant_form_sections: await countPreserved("merchant_form_sections"),
        bd_upazilas: await countPreserved("bd_upazilas"),
        bd_districts: await countPreserved("bd_districts"),
        bd_divisions: await countPreserved("bd_divisions"),
        business_legal_structures: await countPreserved("business_legal_structures"),
        trade_license_activities: await countPreserved("trade_license_activities"),
        industry_categories: await countPreserved("industry_categories"),
        cms_homepage: await countPreserved("cms_homepage"),
        admin_settings: await countPreserved("admin_settings"),
        operational_audit_logs: await countPreserved("audit_logs"),
        operational_sms_logs: await countPreserved("sms_outbox"),
      },
    };
  },

  /**
   * Creates a full timestamped SQL dump before any deletion.
   * SECURITY: Uses a temporary MySQL configuration file (--defaults-extra-file)
   * so passwords are NEVER exposed in CLI strings, process lists, or logs.
   * Guaranteed cleanup in finally block.
   */
  async createBackup() {
    await this.validateEnvironment();

    const backupDir = path.resolve(process.cwd(), "backups");
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const dbName = process.env.DB_NAME;
    const dbUser = process.env.DB_USER || "root";
    const dbPass = process.env.DB_PASSWORD || "";
    const dbHost = process.env.DB_HOST || "localhost";
    const dbPort = process.env.DB_PORT || "3306";

    const fileName = `pre_reset_${dbName}_${timestamp}.sql`;
    const filePath = path.join(backupDir, fileName);

    const tempConfigPath = path.join(
      os.tmpdir(),
      `my_${Date.now()}_${Math.random().toString(36).substring(7)}.cnf`
    );
    const configContent = `[client]\nhost=${dbHost}\nport=${dbPort}\nuser=${dbUser}\npassword="${dbPass.replace(/"/g, '\\"')}"\n`;

    fs.writeFileSync(tempConfigPath, configContent, { mode: 0o600 });

    try {
      const cmd = `mysqldump --defaults-extra-file="${tempConfigPath}" ${dbName} > "${filePath}"`;
      await execAsync(cmd);

      if (fs.existsSync(filePath) && fs.statSync(filePath).size > 1000) {
        return { success: true, filePath, fileName, size: fs.statSync(filePath).size };
      }
      throw new Error(`Backup file created but appears incomplete (size: ${fs.statSync(filePath)?.size} bytes)`);
    } catch (err) {
      throw new Error(`Database backup failed before reset: ${err.message}`);
    } finally {
      if (fs.existsSync(tempConfigPath)) {
        try {
          fs.unlinkSync(tempConfigPath);
        } catch {}
      }
    }
  },

  /**
   * Executes the deletion in strictly controlled Foreign Key dependency order.
   * Uses an atomic MySQL transaction with automatic rollback on error.
   */
  async executeCleanup({ confirmDatabase }) {
    await this.validateEnvironment();

    if (confirmDatabase !== "banglaqr_db") {
      throw new Error(`Confirmation mismatch: Pass --confirm=banglaqr_db to authorize reset.`);
    }

    // Step 1: Create Backup
    const backupInfo = await this.createBackup();

    // Step 2: Resolve entities and execution plan
    const entities = await this.resolveCleanupEntities();
    const plan = this.getCleanupPlan(entities);

    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      const deletedSummary = {};

      for (const step of plan) {
        if (!step.where) {
          deletedSummary[step.table] = 0;
          continue;
        }

        const sql = `DELETE FROM \`${step.table}\` WHERE ${step.where}`;
        const [res] = await connection.query(sql, step.params);
        deletedSummary[step.table] = res.affectedRows;
      }

      await connection.commit();
      return {
        success: true,
        backup: backupInfo,
        deletedSummary,
      };
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  },
};
