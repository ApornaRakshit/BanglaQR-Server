import { db } from "../src/config/db.js";

async function verifyAll14Operations() {
  console.log("=== TASK 1: VERIFYING ALL 14 OPERATIONS ON PUBLISHED FORM VERSION ===\n");
  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`✓ PASS: ${message}`);
      passed++;
    } else {
      console.error(`✗ FAIL: ${message}`);
      failed++;
    }
  }

  // Set up a draft form version first, populate all children, then publish it
  const formKey = "immutability_verify_" + Date.now();
  const [vRes] = await db.query(`
    INSERT INTO merchant_form_versions (form_key, version_number, status)
    VALUES (?, 1, 'draft')
  `, [formKey]);
  const versionId = vRes.insertId;

  const [sRes] = await db.query(`
    INSERT INTO merchant_form_sections (form_version_id, section_key, title_bn, title_en, display_order)
    VALUES (?, 'sec_imm', 'সেকশন', 'Section', 1)
  `, [versionId]);
  const sectionId = sRes.insertId;

  const [fRes] = await db.query(`
    INSERT INTO merchant_form_fields (form_version_id, section_id, field_key, field_type, label_bn, label_en, display_order)
    VALUES (?, ?, 'field_imm', 'text', 'ফিল্ড', 'Field', 1)
  `, [versionId, sectionId]);
  const fieldId = fRes.insertId;

  const [oRes] = await db.query(`
    INSERT INTO merchant_form_field_options (field_id, option_value, label_bn, label_en, display_order)
    VALUES (?, 'opt_val', 'অপশন', 'Option', 1)
  `, [fieldId]);
  const optionId = oRes.insertId;

  const [rRes] = await db.query(`
    INSERT INTO merchant_form_field_rules (field_id, merchant_segment, channel, is_visible, is_required)
    VALUES (?, 'micro', 'bank', 1, 1)
  `, [fieldId]);
  const ruleId = rRes.insertId;

  // NOW PUBLISH THE FORM VERSION
  await db.query(`
    UPDATE merchant_form_versions SET status = 'published', published_at = NOW() WHERE id = ?
  `, [versionId]);
  console.log(`Form Version ${versionId} is now officially PUBLISHED.\n`);

  async function testBlocked(opName, queryFn) {
    let blocked = false;
    let msg = "";
    try {
      await queryFn();
    } catch (err) {
      blocked = err.message.includes("Immutable Published Form");
      msg = err.message;
    }
    assert(blocked, `Op: ${opName} -> Blocked: "${msg}"`);
  }

  // 1. UPDATE merchant_form_versions (revert to draft)
  await testBlocked("1. UPDATE merchant_form_versions (revert to draft)", async () => {
    await db.query(`UPDATE merchant_form_versions SET status = 'draft' WHERE id = ?`, [versionId]);
  });

  // 2. DELETE merchant_form_versions
  await testBlocked("2. DELETE merchant_form_versions", async () => {
    await db.query(`DELETE FROM merchant_form_versions WHERE id = ?`, [versionId]);
  });

  // 3. INSERT a new section
  await testBlocked("3. INSERT a new section", async () => {
    await db.query(`
      INSERT INTO merchant_form_sections (form_version_id, section_key, title_bn, title_en, display_order)
      VALUES (?, 'sec_new', 'নতুন', 'New', 2)
    `, [versionId]);
  });

  // 4. UPDATE an existing section
  await testBlocked("4. UPDATE an existing section", async () => {
    await db.query(`UPDATE merchant_form_sections SET title_en = 'Updated' WHERE id = ?`, [sectionId]);
  });

  // 5. DELETE a section
  await testBlocked("5. DELETE a section", async () => {
    await db.query(`DELETE FROM merchant_form_sections WHERE id = ?`, [sectionId]);
  });

  // 6. INSERT a new field
  await testBlocked("6. INSERT a new field", async () => {
    await db.query(`
      INSERT INTO merchant_form_fields (form_version_id, section_id, field_key, field_type, label_bn, label_en, display_order)
      VALUES (?, ?, 'field_new', 'text', 'নতুন', 'New', 2)
    `, [versionId, sectionId]);
  });

  // 7. UPDATE an existing field
  await testBlocked("7. UPDATE an existing field", async () => {
    await db.query(`UPDATE merchant_form_fields SET label_en = 'Updated' WHERE id = ?`, [fieldId]);
  });

  // 8. DELETE a field
  await testBlocked("8. DELETE a field", async () => {
    await db.query(`DELETE FROM merchant_form_fields WHERE id = ?`, [fieldId]);
  });

  // 9. INSERT a new field option
  await testBlocked("9. INSERT a new field option", async () => {
    await db.query(`
      INSERT INTO merchant_form_field_options (field_id, option_value, label_bn, label_en, display_order)
      VALUES (?, 'opt_new', 'নতুন', 'New', 2)
    `, [fieldId]);
  });

  // 10. UPDATE an existing field option
  await testBlocked("10. UPDATE an existing field option", async () => {
    await db.query(`UPDATE merchant_form_field_options SET label_en = 'Updated' WHERE id = ?`, [optionId]);
  });

  // 11. DELETE a field option
  await testBlocked("11. DELETE a field option", async () => {
    await db.query(`DELETE FROM merchant_form_field_options WHERE id = ?`, [optionId]);
  });

  // 12. INSERT a new field rule
  await testBlocked("12. INSERT a new field rule", async () => {
    await db.query(`
      INSERT INTO merchant_form_field_rules (field_id, merchant_segment, channel, is_visible, is_required)
      VALUES (?, 'big', 'bank', 1, 1)
    `, [fieldId]);
  });

  // 13. UPDATE an existing field rule
  await testBlocked("13. UPDATE an existing field rule", async () => {
    await db.query(`UPDATE merchant_form_field_rules SET is_required = 0 WHERE id = ?`, [ruleId]);
  });

  // 14. DELETE a field rule
  await testBlocked("14. DELETE a field rule", async () => {
    await db.query(`DELETE FROM merchant_form_field_rules WHERE id = ?`, [ruleId]);
  });

  // Cleanup: Archive to allow clean removal
  await db.query(`UPDATE merchant_form_versions SET status = 'archived' WHERE id = ?`, [versionId]);
  await db.query(`DELETE FROM merchant_form_field_rules WHERE id = ?`, [ruleId]);
  await db.query(`DELETE FROM merchant_form_field_options WHERE id = ?`, [optionId]);
  await db.query(`DELETE FROM merchant_form_fields WHERE id = ?`, [fieldId]);
  await db.query(`DELETE FROM merchant_form_sections WHERE id = ?`, [sectionId]);
  await db.query(`DELETE FROM merchant_form_versions WHERE id = ?`, [versionId]);

  console.log(`\n=== SUMMARY OF TASK 1: ${passed}/14 OPERATIONS BLOCKED, ${failed} FAILED ===`);
  process.exit(0);
}

verifyAll14Operations().catch(e => {
  console.error("FATAL ERROR IN TASK 1 VERIFICATION:", e);
  process.exit(1);
});
