import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { db } from "../src/config/db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, "../.env") });

async function columnExists(table, column) {
  const [rows] = await db.query(
    "SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
    [table, column]
  );
  return rows[0].c > 0;
}

async function run() {
  console.log("Applying Migration 012 cleanly via JS...");

  // 1. institutions table
  await db.query(`
    ALTER TABLE institutions 
    MODIFY COLUMN institution_type ENUM('bank', 'commercial_bank', 'specialized_bank', 'mfs', 'payment_gateway', 'other') NOT NULL DEFAULT 'bank'
  `);

  if (!(await columnExists("institutions", "head_office_address"))) {
    await db.query("ALTER TABLE institutions ADD COLUMN head_office_address TEXT NULL AFTER website_url");
    console.log("✓ Added head_office_address to institutions");
  }
  if (!(await columnExists("institutions", "division"))) {
    await db.query("ALTER TABLE institutions ADD COLUMN division VARCHAR(50) NULL AFTER head_office_address");
    console.log("✓ Added division to institutions");
  }
  if (!(await columnExists("institutions", "district"))) {
    await db.query("ALTER TABLE institutions ADD COLUMN district VARCHAR(50) NULL AFTER division");
    console.log("✓ Added district to institutions");
  }
  if (!(await columnExists("institutions", "upazila"))) {
    await db.query("ALTER TABLE institutions ADD COLUMN upazila VARCHAR(100) NULL AFTER district");
    console.log("✓ Added upazila to institutions");
  }
  if (!(await columnExists("institutions", "services_offered"))) {
    await db.query("ALTER TABLE institutions ADD COLUMN services_offered TEXT NULL AFTER description");
    console.log("✓ Added services_offered to institutions");
  }

  // 2. institution_branches table
  await db.query(`
    ALTER TABLE institution_branches
    MODIFY COLUMN status ENUM('active', 'inactive', 'suspended') NOT NULL DEFAULT 'active'
  `);

  if (!(await columnExists("institution_branches", "routing_number"))) {
    await db.query("ALTER TABLE institution_branches ADD COLUMN routing_number VARCHAR(50) NULL AFTER branch_code, ADD INDEX idx_branch_routing (routing_number)");
    console.log("✓ Added routing_number to institution_branches");
  }
  if (!(await columnExists("institution_branches", "division_id"))) {
    await db.query("ALTER TABLE institution_branches ADD COLUMN division_id BIGINT UNSIGNED NULL AFTER upazila");
    console.log("✓ Added division_id to institution_branches");
  }
  if (!(await columnExists("institution_branches", "district_id"))) {
    await db.query("ALTER TABLE institution_branches ADD COLUMN district_id BIGINT UNSIGNED NULL AFTER division_id");
    console.log("✓ Added district_id to institution_branches");
  }
  if (!(await columnExists("institution_branches", "upazila_id"))) {
    await db.query("ALTER TABLE institution_branches ADD COLUMN upazila_id BIGINT UNSIGNED NULL AFTER district_id");
    console.log("✓ Added upazila_id to institution_branches");
  }
  if (!(await columnExists("institution_branches", "is_demo"))) {
    await db.query("ALTER TABLE institution_branches ADD COLUMN is_demo TINYINT(1) NOT NULL DEFAULT 0 AFTER status, ADD INDEX idx_branch_demo (is_demo)");
    console.log("✓ Added is_demo to institution_branches");
  }
  if (!(await columnExists("institution_branches", "is_archived"))) {
    await db.query("ALTER TABLE institution_branches ADD COLUMN is_archived TINYINT(1) NOT NULL DEFAULT 0 AFTER is_demo");
    console.log("✓ Added is_archived to institution_branches");
  }
  if (!(await columnExists("institution_branches", "archived_at"))) {
    await db.query("ALTER TABLE institution_branches ADD COLUMN archived_at DATETIME NULL AFTER is_archived");
    console.log("✓ Added archived_at to institution_branches");
  }
  if (!(await columnExists("institution_branches", "archived_by"))) {
    await db.query("ALTER TABLE institution_branches ADD COLUMN archived_by VARCHAR(100) NULL AFTER archived_at");
    console.log("✓ Added archived_by to institution_branches");
  }

  // 3. bd_divisions & bd_districts
  if (!(await columnExists("bd_divisions", "division_name_bn"))) {
    await db.query("ALTER TABLE bd_divisions ADD COLUMN division_name_bn VARCHAR(100) NULL AFTER division_name");
    console.log("✓ Added division_name_bn to bd_divisions");
  }
  if (!(await columnExists("bd_districts", "district_name_bn"))) {
    await db.query("ALTER TABLE bd_districts ADD COLUMN district_name_bn VARCHAR(100) NULL AFTER district_name");
    console.log("✓ Added district_name_bn to bd_districts");
  }

  // 4. merchant_kyc table
  if (!(await columnExists("merchant_kyc", "institution_id"))) {
    await db.query("ALTER TABLE merchant_kyc ADD COLUMN institution_id BIGINT UNSIGNED NULL AFTER bank_name, ADD CONSTRAINT fk_mkyc_institution FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE SET NULL");
    console.log("✓ Added institution_id to merchant_kyc");
  }
  if (!(await columnExists("merchant_kyc", "branch_id"))) {
    await db.query("ALTER TABLE merchant_kyc ADD COLUMN branch_id BIGINT UNSIGNED NULL AFTER branch_name, ADD CONSTRAINT fk_mkyc_branch FOREIGN KEY (branch_id) REFERENCES institution_branches(id) ON DELETE SET NULL");
    console.log("✓ Added branch_id to merchant_kyc");
  }
  if (!(await columnExists("merchant_kyc", "branch_code"))) {
    await db.query("ALTER TABLE merchant_kyc ADD COLUMN branch_code VARCHAR(50) NULL AFTER branch_id");
    console.log("✓ Added branch_code to merchant_kyc");
  }
  if (!(await columnExists("merchant_kyc", "division"))) {
    await db.query("ALTER TABLE merchant_kyc ADD COLUMN division VARCHAR(100) NULL AFTER routing_number");
    console.log("✓ Added division to merchant_kyc");
  }
  if (!(await columnExists("merchant_kyc", "district"))) {
    await db.query("ALTER TABLE merchant_kyc ADD COLUMN district VARCHAR(100) NULL AFTER division");
    console.log("✓ Added district to merchant_kyc");
  }
  if (!(await columnExists("merchant_kyc", "upazila"))) {
    await db.query("ALTER TABLE merchant_kyc ADD COLUMN upazila VARCHAR(100) NULL AFTER district");
    console.log("✓ Added upazila to merchant_kyc");
  }
  if (!(await columnExists("merchant_kyc", "branch_address"))) {
    await db.query("ALTER TABLE merchant_kyc ADD COLUMN branch_address TEXT NULL AFTER upazila");
    console.log("✓ Added branch_address to merchant_kyc");
  }

  // 5. Mark initial 6 branches as demo
  await db.query("UPDATE institution_branches SET is_demo = 1 WHERE id IN (1, 2, 3, 4, 5, 6)");
  console.log("✓ Initial 6 demo branches flagged as is_demo = 1.");

  // 6. Sync Bangla names for bd_divisions and bd_districts
  const geoPath = path.join(__dirname, "../data/bangladesh-geo.json");
  if (fs.existsSync(geoPath)) {
    const geoData = JSON.parse(fs.readFileSync(geoPath, "utf8"));
    const aliases = new Map([
      ["barisal", "barishal"],
      ["chattagram", "chattogram"],
      ["chittagong", "chattogram"],
      ["comilla", "cumilla"],
      ["bogra", "bogura"],
      ["jessore", "jashore"],
      ["maulvibazar", "moulvibazar"],
      ["jhalakathi", "jhalokati"],
      ["jhalokathi", "jhalokati"],
      ["nawabganj", "chapainawabganj"],
      ["chapainawabgonj", "chapainawabganj"],
      ["khagrachari", "khagrachhari"],
    ]);

    const normalize = (v) => {
      const str = String(v ?? "")
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
      return aliases.get(str) ?? str;
    };

    for (const div of geoData) {
      const normDiv = normalize(div.name);
      await db.execute(
        "UPDATE bd_divisions SET division_name_bn = ? WHERE LOWER(division_name) = ? OR LOWER(division_name) = ?",
        [div.bn_name, div.name.toLowerCase(), normDiv]
      );

      if (Array.isArray(div.districts)) {
        for (const dist of div.districts) {
          const normDist = normalize(dist.name);
          await db.execute(
            "UPDATE bd_districts SET district_name_bn = ? WHERE LOWER(district_name) = ? OR LOWER(district_name) = ?",
            [dist.bn_name, dist.name.toLowerCase(), normDist]
          );
        }
      }
    }
    console.log("✓ Division and District Bangla names synced successfully from bangladesh-geo.json.");
  }

  // Print summary check
  const [divCheck] = await db.query("SELECT id, division_name, division_name_bn FROM bd_divisions LIMIT 3");
  console.log("Divisions sample:", divCheck);

  const [distCheck] = await db.query("SELECT id, district_name, district_name_bn FROM bd_districts LIMIT 3");
  console.log("Districts sample:", distCheck);

  const [upzCheck] = await db.query("SELECT id, upazila_name, upazila_name_bn FROM bd_upazilas LIMIT 3");
  console.log("Upazilas sample:", upzCheck);

  console.log("=== MIGRATION 012 VERIFIED & APPLIED ===");
  process.exit(0);
}

run().catch((err) => {
  console.error("Migration 012 failed:", err);
  process.exit(1);
});
