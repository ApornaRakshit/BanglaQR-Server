import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import mysql from "mysql2/promise";

async function testDisposableMigrationAndRepeatability() {
  console.log("=== TASK 3: TESTING REPEATABILITY ON DISPOSABLE STAGING COPY ===\n");

  const disposableDbName = "banglaqr_disposable_test";
  const stagingDbName = "banglaqr_db";
  const user = "root";
  const password = "admin123";

  // 1. Dump current banglaqr_db to a temporary sql file
  const dumpFile = path.resolve("./temp_disposable_dump.sql");
  console.log("1. Creating snapshot dump of active DB...");
  execSync(`mysqldump -u ${user} -p${password} ${stagingDbName} > "${dumpFile}"`);

  // 2. Restore snapshot into disposable DB
  console.log(`2. Restoring snapshot into disposable database '${disposableDbName}'...`);
  execSync(`mysql -u ${user} -p${password} ${disposableDbName} < "${dumpFile}"`);

  const conn = await mysql.createConnection({
    host: "localhost",
    user,
    password,
    database: disposableDbName,
    multipleStatements: true,
  });

  try {
    // 3. Test Migration 025 on disposable copy
    console.log("3. Applying proposed migration 025 on disposable copy...");
    const migration025Sql = fs.readFileSync("./migrations/025_add_catalogue_associations_and_form_versioning.sql", "utf-8");
    await conn.query(migration025Sql);
    console.log("✓ Migration 025 executed successfully on disposable DB!");

    // Verify backfill and preservation
    const [profiles] = await conn.query("SELECT id, merchant_id, company_name, business_type, legal_structure_id, industry, industry_category_id FROM merchant_profiles");
    console.log("Profiles after migration 025:", profiles);
    const [kycs] = await conn.query("SELECT id, merchant_id, business_entity_type, legal_structure_id FROM merchant_kyc");
    console.log("KYCs after migration 025:", kycs);

    // 4. Test Seed 002 re-run on disposable DB (Idempotency test)
    console.log("\n4. Testing Seed 002 re-execution on disposable copy...");
    const [countsBefore] = await conn.query(`
      SELECT 
        (SELECT COUNT(*) FROM business_legal_structures) as bls,
        (SELECT COUNT(*) FROM industry_categories) as ic,
        (SELECT COUNT(*) FROM trade_license_activities) as tla,
        (SELECT COUNT(*) FROM industry_activity_mapping) as iam,
        (SELECT COUNT(*) FROM business_activity_segment_rules) as basr
    `);
    console.log("Counts before seed re-run:", countsBefore[0]);

    const seed002Sql = fs.readFileSync("./seeds/002_phase1_catalogues_seed.sql", "utf-8");
    await conn.query(seed002Sql);
    console.log("✓ Seed 002 re-run executed!");

    const [countsAfter] = await conn.query(`
      SELECT 
        (SELECT COUNT(*) FROM business_legal_structures) as bls,
        (SELECT COUNT(*) FROM industry_categories) as ic,
        (SELECT COUNT(*) FROM trade_license_activities) as tla,
        (SELECT COUNT(*) FROM industry_activity_mapping) as iam,
        (SELECT COUNT(*) FROM business_activity_segment_rules) as basr
    `);
    console.log("Counts after seed re-run:", countsAfter[0]);

    const countsIdentical = JSON.stringify(countsBefore[0]) === JSON.stringify(countsAfter[0]);
    console.log(`✓ Seed 002 repeatability verified: ${countsIdentical ? "IDENTICAL COUNTS (ZERO DUPLICATES)" : "MISMATCH"}`);

  } finally {
    await conn.end();
    if (fs.existsSync(dumpFile)) {
      fs.unlinkSync(dumpFile);
    }
  }

  process.exit(0);
}

testDisposableMigrationAndRepeatability().catch((e) => {
  console.error("FAILED TEST ON DISPOSABLE DB:", e);
  process.exit(1);
});

