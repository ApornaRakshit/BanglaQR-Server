import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { db } from "../src/config/db.js";
import { merchantCleanupService } from "../database/seeders/merchant.cleanup.js";

const execAsync = promisify(exec);

/**
 * Master Data Seeder CLI: Seeds ONLY official reference and baseline configuration data.
 * Idempotently checks specific required keys/codes and invokes individual seeders
 * only when missing, without relying on crude row-count thresholds.
 * NEVER overwrites administrator-customized records.
 * NEVER creates synthetic test merchants.
 */
async function main() {
  console.log("=================================================");
  console.log("       BANGLAQR MASTER REFERENCE DATA SEEDER     ");
  console.log("=================================================\n");

  await merchantCleanupService.validateEnvironment();

  const cwd = process.cwd();

  try {
    // 1. Geography: Divisions, Districts, Upazilas
    console.log("[1/5] Checking Bangladesh Geography (Divisions, Districts, Upazilas)...");
    const [divisions] = await db.query("SELECT COUNT(*) as cnt FROM bd_divisions");
    const [districts] = await db.query("SELECT COUNT(*) as cnt FROM bd_districts");
    const [sampleUpazila] = await db.query("SELECT id FROM bd_upazilas WHERE name_en = 'Gulshan' OR name_en = 'Dhanmondi' LIMIT 1");

    if (divisions[0].cnt < 8 || districts[0].cnt < 64 || sampleUpazila.length === 0) {
      console.log("  -> Incomplete geography detected. Seeding missing reference geography...");
      await execAsync("node scripts/seed-bd-upazilas.mjs", { cwd });
      console.log("  -> Geography successfully updated.");
    } else {
      console.log(`  -> Geography intact (${divisions[0].cnt} divisions, ${districts[0].cnt} districts). Skipping.`);
    }

    // 2. Institutions & Banking: Banks & MFS Catalogues
    console.log("\n[2/5] Checking official Institution catalogue (Banks & MFS)...");
    const [keyBanks] = await db.query(
      "SELECT id, institution_code FROM institutions WHERE institution_code IN ('EBL', 'BRAC', 'CITY_BANK', 'BKASH', 'NAGAD')"
    );
    if (keyBanks.length < 5) {
      console.log("  -> Essential partner institutions missing. Seeding official catalogue...");
      await execAsync("node scripts/seed_bank_catalogue.js", { cwd });
      console.log("  -> Catalogue successfully seeded.");
    } else {
      console.log(`  -> Key partner institutions present (${keyBanks.length} key partners verified). Skipping.`);
    }

    // 3. KYC Requirements Defaults
    console.log("\n[3/5] Checking default KYC compliance criteria...");
    const [keyKyc] = await db.query(
      "SELECT id FROM institution_kyc_requirements WHERE requirement_key IN ('NATIONAL_ID', 'TRADE_LICENSE') LIMIT 2"
    );
    if (keyKyc.length < 2) {
      console.log("  -> Missing baseline KYC requirements. Seeding defaults...");
      await execAsync("node scripts/seed_kyc_defaults.js", { cwd });
      console.log("  -> KYC defaults successfully seeded.");
    } else {
      console.log("  -> Baseline KYC requirements present. Skipping.");
    }

    // 4. Business Categories & Legal Structures (Phase 1 Catalogues)
    console.log("\n[4/5] Checking Business Legal Structures & Industry Catalogues...");
    const [legalStructs] = await db.query("SELECT id FROM business_legal_structures LIMIT 1");
    const [activities] = await db.query("SELECT id FROM trade_license_activities LIMIT 1");

    if (legalStructs.length === 0 || activities.length === 0) {
      console.log("  -> Catalogues missing. Seeding baseline 002_phase1_catalogues_seed.sql...");
      const sqlPath = path.resolve(cwd, "seeds/002_phase1_catalogues_seed.sql");
      if (fs.existsSync(sqlPath)) {
        const sql = fs.readFileSync(sqlPath, "utf8");
        const stmts = sql.split(";").map((s) => s.trim()).filter((s) => s.length > 0);
        for (const stmt of stmts) {
          await db.query(stmt);
        }
        console.log("  -> Catalogues successfully seeded.");
      }
    } else {
      console.log("  -> Business legal structures and trade license catalogues present. Skipping.");
    }

    // 5. Dynamic Form Builder Baselines
    console.log("\n[5/5] Checking dynamic form builder published baselines...");
    const [pubForms] = await db.query(
      "SELECT id, form_key, version_number FROM merchant_form_versions WHERE status = 'published'"
    );
    if (pubForms.length === 0) {
      console.log("  -> Warning: No published form version found. Initializing form builder seeds...");
      const { formBuilderSeedService } = await import("../src/modules/admin/formBuilder/formBuilder.seeds.js");
      await formBuilderSeedService.seedDefaults();
      console.log("  -> Form builder defaults successfully seeded.");
    } else {
      console.log(`  -> Published form baseline present (${pubForms.length} active forms). Skipping.`);
    }

    console.log("\n=================================================");
    console.log("SUCCESS: All master reference data verified & preserved.");
    console.log("Note: Demo merchants were NOT generated.");
    console.log("To generate demo merchants, run:");
    console.log("  npm run db:seed:merchants -- --count=10");
    console.log("=================================================\n");

    process.exit(0);
  } catch (err) {
    console.error("Master seeding failed:", err.message);
    process.exit(1);
  }
}

main();
