import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { db } from "../src/config/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function runPhase1MigrationAndSeed() {
  console.log("Starting Phase 1 Migration & Seed on Local Database...");
  const conn = await db.getConnection();

  try {
    // 1. Check if column already exists on merchants
    const [cols] = await conn.query("SHOW COLUMNS FROM merchants LIKE 'merchant_segment'");
    if (cols.length === 0) {
      console.log("Adding merchant_segment to merchants table...");
      await conn.query(`
        ALTER TABLE merchants
        ADD COLUMN merchant_segment ENUM('micro', 'big') NULL DEFAULT NULL AFTER merchant_code,
        ADD INDEX idx_merchant_segment (merchant_segment)
      `);
      console.log("✓ merchant_segment column added.");
    } else {
      console.log("✓ merchant_segment column already exists.");
    }

    // 2. Read and execute remaining DDL from migration file
    const migrationSqlPath = path.resolve(__dirname, "../migrations/024_phase1_database_foundation.sql");
    const migrationSql = fs.readFileSync(migrationSqlPath, "utf-8");

    // Split statements safely: clean SQL comments first
    const cleanSql = migrationSql
      .replace(/--.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");

    const statements = cleanSql
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith("ALTER TABLE merchants"));

    for (const sql of statements) {
      if (sql.toUpperCase().includes("CREATE TABLE")) {
        console.log("Executing table creation...");
        await conn.query(sql);
      }
    }
    console.log("✓ DDL statements executed successfully.");

    // 3. Read and execute seed data
    const seedSqlPath = path.resolve(__dirname, "../seeds/002_phase1_catalogues_seed.sql");
    const seedSql = fs.readFileSync(seedSqlPath, "utf-8");
    const cleanSeedSql = seedSql
      .replace(/--.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");

    const seedStatements = cleanSeedSql
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const sql of seedStatements) {
      if (sql.toUpperCase().includes("INSERT")) {
        await conn.query(sql);
      }
    }
    console.log("✓ Seed data executed successfully.");

    // 4. Verify record counts
    const [legalCount] = await conn.query("SELECT COUNT(*) as c FROM business_legal_structures");
    const [catCount] = await conn.query("SELECT COUNT(*) as c FROM industry_categories");
    const [actCount] = await conn.query("SELECT COUNT(*) as c FROM trade_license_activities");
    const [mapCount] = await conn.query("SELECT COUNT(*) as c FROM industry_activity_mapping");
    const [ruleCount] = await conn.query("SELECT COUNT(*) as c FROM business_activity_segment_rules");
    const [merchants] = await conn.query("SELECT id, merchant_code, merchant_segment FROM merchants");

    console.log("\n=== Phase 1 Verification Summary ===");
    console.log("Legal structures count:", legalCount[0].c);
    console.log("Industry categories count:", catCount[0].c);
    console.log("Trade license activities count:", actCount[0].c);
    console.log("Industry-activity mappings count:", mapCount[0].c);
    console.log("Segment rules count:", ruleCount[0].c);
    console.log("Existing merchants and segments:", merchants);

    console.log("\n✓ All Phase 1 database tables and seeds verified successfully.");
  } catch (err) {
    console.error("Migration/Seed failed:", err);
    process.exit(1);
  } finally {
    conn.release();
    process.exit(0);
  }
}

runPhase1MigrationAndSeed();
