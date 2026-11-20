
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import mysql from "mysql2/promise";

const dataFile = path.resolve(
  process.argv[2] ||
    path.join(process.cwd(), "data", "bangladesh-geo.json")
);

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

function normalizeName(value) {
  const name = String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

  return aliases.get(name) ?? name;
}

function ensure(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

let connection;
let transactionStarted = false;

try {
  // 1. Read the source JSON file.
  console.log("Reading location data:", dataFile);

  const jsonText = await fs.readFile(dataFile, "utf8");
  const divisions = JSON.parse(jsonText);

  ensure(
    Array.isArray(divisions) && divisions.length > 0,
    "The JSON must contain a non-empty array of divisions."
  );

  // 2. Validate database connection configuration.
  const databaseName = process.env.DB_NAME || "banglaqr_db";

  console.log("Connecting to MySQL database:", databaseName);

  connection = await mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 3306),
    database: databaseName,
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    charset: "utf8mb4",
  });

  const [[database]] = await connection.query(
    "SELECT DATABASE() AS database_name"
  );

  ensure(
    database.database_name === databaseName,
    `Wrong database selected. Expected: ${databaseName}`
  );

  // 3. Verify required tables exist.
  const [tables] = await connection.execute(
    `SELECT TABLE_NAME
       FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN ('bd_divisions', 'bd_districts', 'bd_upazilas')`
  );

  const tableNames = new Set(tables.map((row) => row.TABLE_NAME));

  for (const tableName of [
    "bd_divisions",
    "bd_districts",
    "bd_upazilas",
  ]) {
    ensure(
      tableNames.has(tableName),
      `Missing table: ${tableName}. Check the database migration first.`
    );
  }

  // 4. Check existing Upazila table columns.
  const [columnRows] = await connection.execute(
    `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'bd_upazilas'`
  );

  const columns = new Set(columnRows.map((row) => row.COLUMN_NAME));

  for (const column of [
    "id",
    "district_id",
    "upazila_name",
    "location_type",
  ]) {
    ensure(
      columns.has(column),
      `bd_upazilas is missing required column: ${column}`
    );
  }

  // Add Bangla display name column if it does not already exist.
  if (!columns.has("upazila_name_bn")) {
    console.log("Adding missing column: upazila_name_bn");

    await connection.query(
      `ALTER TABLE bd_upazilas
       ADD COLUMN upazila_name_bn VARCHAR(150) NULL
       AFTER upazila_name`
    );
  }

  // 5. Build a map of existing districts.
  const [districtRows] = await connection.execute(
    "SELECT id, district_name FROM bd_districts"
  );

  ensure(
    districtRows.length === 64,
    `Expected 64 districts, but found ${districtRows.length}.`
  );

  const districtMap = new Map();

  for (const row of districtRows) {
    const key = normalizeName(row.district_name);

    ensure(
      !districtMap.has(key),
      `District name collision after normalization: ${row.district_name}`
    );

    districtMap.set(key, Number(row.id));
  }

  // 6. Prepare source records before writing to MySQL.
  const planned = [];
  const unmatchedDistricts = [];
  const seen = new Set();

  for (const division of divisions) {
    if (!Array.isArray(division.districts)) {
      throw new Error(
        `Invalid dataset structure: districts array missing for ${division.name}`
      );
    }

    for (const district of division.districts) {
      const districtId = districtMap.get(
        normalizeName(district.name)
      );

      if (!districtId) {
        unmatchedDistricts.push(
          `${division.name || "Unknown division"} / ${district.name}`
        );
        continue;
      }

      if (!Array.isArray(district.upazilas)) {
        throw new Error(
          `Upazilas array missing for district: ${district.name}`
        );
      }

      for (const upazila of district.upazilas) {
        const englishName = String(upazila.name ?? "").trim();

        if (!englishName) {
          continue;
        }

        const key = `${districtId}:${normalizeName(englishName)}`;

        if (seen.has(key)) {
          continue;
        }

        seen.add(key);

        planned.push({
          districtId,
          name: englishName,
          nameBn: String(upazila.bn_name ?? "").trim() || null,
        });
      }
    }
  }

  if (unmatchedDistricts.length > 0) {
    console.error("Districts that did not match the database:");

    for (const name of unmatchedDistricts) {
      console.error(" -", name);
    }

    throw new Error(
      "Import stopped because district mappings are incomplete. " +
      "No Upazila records have been written."
    );
  }

  ensure(
    planned.length > 0,
    "No Upazila records were found in the source JSON."
  );

  console.log("Source Upazila records prepared:", planned.length);

  // 7. Insert/update records inside a transaction.
  await connection.beginTransaction();
  transactionStarted = true;

  let inserted = 0;
  let updated = 0;

  for (const item of planned) {
    const [existingRows] = await connection.execute(
      `SELECT id
         FROM bd_upazilas
        WHERE district_id = ?
          AND LOWER(upazila_name) = LOWER(?)
        LIMIT 1`,
      [item.districtId, item.name]
    );

    if (existingRows.length > 0) {
      await connection.execute(
        `UPDATE bd_upazilas
            SET upazila_name = ?,
                upazila_name_bn = ?,
                location_type = 'upazila'
          WHERE id = ?`,
        [
          item.name,
          item.nameBn,
          existingRows[0].id,
        ]
      );

      updated += 1;
    } else {
      await connection.execute(
        `INSERT INTO bd_upazilas
          (district_id, upazila_name, upazila_name_bn, location_type)
         VALUES (?, ?, ?, 'upazila')`,
        [
          item.districtId,
          item.name,
          item.nameBn,
        ]
      );

      inserted += 1;
    }
  }

  await connection.commit();
  transactionStarted = false;

  // 8. Verify final database counts.
  const [[upazilaCount]] = await connection.query(
    "SELECT COUNT(*) AS total FROM bd_upazilas"
  );

  const [[districtCount]] = await connection.query(
    "SELECT COUNT(*) AS total FROM bd_districts"
  );

  const [[divisionCount]] = await connection.query(
    "SELECT COUNT(*) AS total FROM bd_divisions"
  );

  console.log("");
  console.log("======================================");
  console.log("BanglaQR Upazila import completed.");
  console.log("======================================");
  console.log("Divisions in database:", divisionCount.total);
  console.log("Districts in database:", districtCount.total);
  console.log("Source records matched:", planned.length);
  console.log("Inserted:", inserted);
  console.log("Updated:", updated);
  console.log("Total Upazila rows:", upazilaCount.total);
  console.log("======================================");
  console.log(
    "Verify administrative names against official sources before production."
  );

} catch (error) {
  if (connection && transactionStarted) {
    try {
      await connection.rollback();
      console.error("Transaction rolled back.");
    } catch (rollbackError) {
      console.error("Rollback error:", rollbackError.message);
    }
  }

  console.error("");
  console.error("UPAZILA IMPORT FAILED");
  console.error(error.message);
  process.exitCode = 1;

} finally {
  if (connection) {
    try {
      await connection.end();
    } catch (closeError) {
      console.error("Database connection close error:", closeError.message);
    }
  }
}
