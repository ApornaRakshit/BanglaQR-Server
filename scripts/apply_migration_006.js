import { db } from "../src/config/db.js";

async function applyMigration() {
  try {
    console.log("Applying Migration 006...");
    const [cols] = await db.query(`DESCRIBE contact_inquiries`);
    const colNames = cols.map(c => c.Field);

    if (!colNames.includes("company_name")) {
      console.log("Adding company_name column...");
      await db.query(`ALTER TABLE contact_inquiries ADD COLUMN company_name VARCHAR(150) NULL AFTER email`);
    }

    if (!colNames.includes("inquiry_reference")) {
      console.log("Adding inquiry_reference column...");
      await db.query(`ALTER TABLE contact_inquiries ADD COLUMN inquiry_reference VARCHAR(60) NULL AFTER company_name`);
    }

    if (!colNames.includes("admin_notes")) {
      console.log("Adding admin_notes column...");
      await db.query(`ALTER TABLE contact_inquiries ADD COLUMN admin_notes TEXT NULL AFTER message`);
    }

    // Check if unique index exists
    const [indexes] = await db.query(`SHOW INDEX FROM contact_inquiries WHERE Key_name = 'uq_contact_inquiries_ref'`);
    if (indexes.length === 0) {
      console.log("Adding unique index on inquiry_reference...");
      await db.query(`ALTER TABLE contact_inquiries ADD UNIQUE INDEX uq_contact_inquiries_ref (inquiry_reference)`);
    }

    // Populate existing rows with reference numbers if null
    const [rows] = await db.query(`SELECT id FROM contact_inquiries WHERE inquiry_reference IS NULL`);
    for (const row of rows) {
      const ref = `INQ-${String(row.id).padStart(5, '0')}`;
      await db.query(`UPDATE contact_inquiries SET inquiry_reference = ? WHERE id = ?`, [ref, row.id]);
    }

    const [updatedCols] = await db.query(`DESCRIBE contact_inquiries`);
    console.log("Migration 006 applied successfully. Columns:", updatedCols.map(c => c.Field));
    process.exit(0);
  } catch (err) {
    console.error("Migration error:", err);
    process.exit(1);
  }
}

applyMigration();

