import crypto from "crypto";
import { db } from "../../src/config/db.js";
import { hashPassword } from "../../src/utils/password.js";
import { seedBatchService } from "./seedBatch.service.js";
import { merchantCleanupService } from "./merchant.cleanup.js";

/**
 * Generator for synthetic test merchants with complete relational graph
 * (Users -> Roles -> Merchants -> Profiles -> KYC -> Contacts -> Gateway Applications).
 *
 * Security & Integrity Guarantees:
 * 1. Strict environment checks (NODE_ENV=development & DB_NAME=banglaqr_db).
 * 2. Count validation (positive integer, max 200).
 * 3. Atomic database transaction: generated records and seed_batch_records
 *    are committed together, or completely rolled back on error.
 * 4. Password required via parameter or SEED_TEST_PASSWORD environment variable.
 * 5. Collision-resistant unique identifiers (crypto.randomUUID / randomBytes).
 * 6. Valid foreign keys: checks and fails if role, institutions, or form versions are missing.
 * 7. Correct status mapping: merchant 'submitted' maps to gateway application 'applied'.
 */
export const merchantSeeder = {
  async seed({ count = 10, batchName = null, password = null } = {}) {
    // 1. Environment validation
    await merchantCleanupService.validateEnvironment();

    // 2. Count validation
    const parsedCount = parseInt(count, 10);
    if (isNaN(parsedCount) || parsedCount <= 0 || parsedCount > 200) {
      throw new Error(`Invalid count '${count}'. Must be a positive integer between 1 and 200.`);
    }

    // 3. Password handling (no weak fallback)
    const effectivePassword = password || process.env.SEED_TEST_PASSWORD;
    if (!effectivePassword || effectivePassword.length < 8) {
      throw new Error(
        "Seeding requires a password of at least 8 characters via option --password=... or SEED_TEST_PASSWORD env."
      );
    }
    const passwordHash = await hashPassword(effectivePassword);

    const effectiveBatchName =
      batchName || `Test Merchants (${parsedCount}) - ${new Date().toISOString()}`;

    // 4. Validate existence of mandatory master reference data
    const [roles] = await db.query(`SELECT id FROM roles WHERE name = 'merchant' LIMIT 1`);
    if (roles.length === 0) {
      throw new Error("Missing required reference role 'merchant' in database.");
    }
    const merchantRoleId = roles[0].id;

    // Explicit allowlist of valid bank institution types from database enum (only active commercial and specialized banks)
    const [bankInstitutions] = await db.query(
      `SELECT id, name, institution_type FROM institutions
       WHERE status = 'active' AND institution_type IN ('commercial_bank', 'specialized_bank')
       LIMIT 20`
    );
    if (bankInstitutions.length === 0) {
      throw new Error("No active bank institutions found in catalogue for supported bank types.");
    }

    // Explicit MFS institution selection
    const [mfsInstitutions] = await db.query(
      `SELECT id, name, institution_type FROM institutions
       WHERE status = 'active' AND institution_type = 'mfs'
       LIMIT 10`
    );
    if (mfsInstitutions.length === 0) {
      throw new Error("No active MFS institutions found in catalogue.");
    }

    const [formVersions] = await db.query(
      `SELECT id FROM merchant_form_versions WHERE status = 'published' ORDER BY version_number DESC LIMIT 1`
    );
    if (formVersions.length === 0) {
      throw new Error("No published merchant form version found in database.");
    }
    const formVersionId = formVersions[0].id;

    const [upazilas] = await db.query(
      `SELECT u.id, u.upazila_name AS upazila, d.district_name AS district, divi.division_name AS division
       FROM bd_upazilas u
       JOIN bd_districts d ON d.id = u.district_id
       JOIN bd_divisions divi ON divi.id = d.division_id
       LIMIT 50`
    );
    if (upazilas.length === 0) {
      throw new Error("No upazila master geography data found in bd_upazilas database.");
    }

    const generated = {
      users: [],
      merchants: [],
      merchant_profiles: [],
      merchant_kyc: [],
      merchant_contacts: [],
      merchant_gateway_applications: [],
    };

    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      // Create seed batch inside transaction
      const batchId = await seedBatchService.createBatchWithConnection(connection, {
        batchName: effectiveBatchName,
        seederType: "merchant",
        metadata: { requestedCount: parsedCount },
      });

      for (let i = 1; i <= parsedCount; i++) {
        const uniqueHex = crypto.randomBytes(4).toString("hex");
        const uniqueNid = `199${crypto.randomInt(10000000, 99999999)}`;
        const email = `seed_merchant_${Date.now()}_${uniqueHex}@test.banglaqr.local`;
        const phone = `017${crypto.randomInt(10000000, 99999999)}`;
        const businessName = `Synthetic Enterprise ${uniqueHex.toUpperCase()}`;
        const merchantCode = `BQR-M-SEED-${uniqueHex.toUpperCase()}`;

        const isMicro = i % 2 === 0;
        const segment = isMicro ? "micro" : "big";
        const channel = i % 3 === 0 ? "mfs" : "bank";

        // Select from correct institution pool (never cross-map MFS as bank fallback)
        const instPool = channel === "mfs" ? mfsInstitutions : bankInstitutions;
        const inst = instPool[i % instPool.length];
        const geo = upazilas[i % upazilas.length];

        // Status mapping: 'submitted' merchant maps to 'applied' gateway application
        const accountStatus = i % 3 === 0 ? "submitted" : i % 3 === 1 ? "under_review" : "approved";
        const applicationStatus = accountStatus === "submitted" ? "applied" : accountStatus;
        const kycStatus = accountStatus === "approved" ? "approved" : "under_review";

        // 1. Insert User
        const [uRes] = await connection.query(
          `INSERT INTO users (email, phone, password_hash, email_verified_at, phone_verified_at, status)
           VALUES (?, ?, ?, NOW(), NOW(), 'active')`,
          [email, phone, passwordHash]
        );
        const userId = uRes.insertId;
        generated.users.push(userId);

        // 2. Insert User Role (user_roles is managed by FK CASCADE from users on rollback)
        await connection.query(
          `INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)`,
          [userId, merchantRoleId]
        );

        // 3. Insert Merchant Root
        const [mRes] = await connection.query(
          `INSERT INTO merchants (user_id, merchant_code, merchant_segment, account_status, kyc_status, onboarding_step, submitted_at, approved_at)
           VALUES (?, ?, ?, ?, ?, 7, NOW(), ?)`,
          [
            userId,
            merchantCode,
            segment,
            accountStatus,
            kycStatus,
            accountStatus === "approved" ? new Date() : null,
          ]
        );
        const merchantId = mRes.insertId;
        generated.merchants.push(merchantId);

        // 4. Insert Profile
        const [pRes] = await connection.query(
          `INSERT INTO merchant_profiles (merchant_id, company_name, business_type, address, city, state, country, institution_id, channel, form_version_id, bank_name, has_existing_account, apply_new_account)
           VALUES (?, ?, 'Sole Proprietorship', ?, ?, ?, 'Bangladesh', ?, ?, ?, ?, 1, 0)`,
          [
            merchantId,
            businessName,
            `${geo.upazila}, ${geo.district}`,
            geo.district,
            geo.division,
            inst.id,
            channel,
            formVersionId,
            inst.name,
          ]
        );
        generated.merchant_profiles.push(pRes.insertId);

        // 5. Insert KYC
        const [kRes] = await connection.query(
          `INSERT INTO merchant_kyc (merchant_id, legal_business_name, nid_number, bank_name, institution_id, division, district, upazila, business_entity_type)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Sole Proprietorship')`,
          [
            merchantId,
            businessName,
            uniqueNid,
            inst.name,
            inst.id,
            geo.division,
            geo.district,
            geo.upazila,
          ]
        );
        generated.merchant_kyc.push(kRes.insertId);

        // 6. Insert Contact
        const [cRes] = await connection.query(
          `INSERT INTO merchant_contacts (merchant_id, name, email, phone, designation)
           VALUES (?, ?, ?, ?, 'Proprietor')`,
          [merchantId, `Owner of ${businessName}`, email, phone]
        );
        generated.merchant_contacts.push(cRes.insertId);

        // 7. Insert Gateway Application (proper status mapping)
        const [gaRes] = await connection.query(
          `INSERT INTO merchant_gateway_applications (application_number, application_type, merchant_id, institution_id, status, applied_at, approved_at, gateway_name)
           VALUES (?, 'onboarding_kyc', ?, ?, ?, NOW(), ?, ?)`,
          [
            `APP-SEED-${uniqueHex.toUpperCase()}`,
            merchantId,
            inst.id,
            applicationStatus,
            accountStatus === "approved" ? new Date() : null,
            inst.name,
          ]
        );
        generated.merchant_gateway_applications.push(gaRes.insertId);
      }

      // Record items inside the transaction
      for (const [table, ids] of Object.entries(generated)) {
        await seedBatchService.recordBatchItemsWithConnection(connection, batchId, table, ids);
      }

      await seedBatchService.completeBatchWithConnection(connection, batchId, parsedCount);

      // Single atomic commit for both merchant entities and tracking records
      await connection.commit();

      return {
        success: true,
        batchId,
        seededCount: parsedCount,
        breakdown: {
          merchants: generated.merchants.length,
          users: generated.users.length,
        },
      };
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  },
};
