import { db } from "../src/config/db.js";

async function testFormImmutability() {
  console.log("=== TASK 2: VERIFYING DYNAMIC FORM IMMUTABILITY & VERSION RETENTION ===\n");
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

  try {
    // 1. Create a published form version with a unique test form key
    const testKey = `test_immutability_${Date.now()}`;
    const [verResult] = await db.query(`
      INSERT INTO merchant_form_versions (form_key, version_number, status, published_at)
      VALUES (?, 1, 'published', NOW())
    `, [testKey]);
    const versionId = verResult.insertId;

    // 2. Insert section for this published version
    const [secResult] = await db.query(`
      INSERT INTO merchant_form_sections (form_version_id, section_key, title_bn, title_en, display_order)
      VALUES (?, 'sec_test', 'টেস্ট সেকশন', 'Test Section', 1)
    `, [versionId]);
    const sectionId = secResult.insertId;

    // 3. Test modifying section on published form -> Must fail
    let sectionModBlocked = false;
    try {
      await db.query(`UPDATE merchant_form_sections SET title_en = 'Modified Title' WHERE id = ?`, [sectionId]);
    } catch (err) {
      sectionModBlocked = err.message.includes("Immutable Published Form");
    }
    assert(sectionModBlocked, "Modification of section on published form blocked by database trigger");

    // 4. Test deleting section on published form -> Must fail
    let sectionDelBlocked = false;
    try {
      await db.query(`DELETE FROM merchant_form_sections WHERE id = ?`, [sectionId]);
    } catch (err) {
      sectionDelBlocked = err.message.includes("Immutable Published Form");
    }
    assert(sectionDelBlocked, "Deletion of section on published form blocked by database trigger");

    // 5. Test reverting published version to draft -> Must fail
    let revertBlocked = false;
    try {
      await db.query(`UPDATE merchant_form_versions SET status = 'draft' WHERE id = ?`, [versionId]);
    } catch (err) {
      revertBlocked = err.message.includes("Immutable Published Form");
    }
    assert(revertBlocked, "Reverting published form version to draft blocked by database trigger");

    // 6. Test historical retention & deletion restriction:
    // If an application references this form version, deleting the form version must be rejected by foreign key constraint
    const [appResult] = await db.query(`
      INSERT INTO merchant_gateway_applications (
        application_number, application_type, merchant_id, form_version_id, status, applied_at, created_at, updated_at
      ) VALUES (
        'TEST-APP-001', 'onboarding_kyc', 319, ?, 'applied', NOW(), NOW(), NOW()
      )
    `, [versionId]);
    const appId = appResult.insertId;

    let verDelBlocked = false;
    try {
      await db.query(`DELETE FROM merchant_form_versions WHERE id = ?`, [versionId]);
    } catch (err) {
      verDelBlocked = err.code === 'ER_ROW_IS_REFERENCED_2' || err.message.includes("foreign key constraint fails");
    }
    assert(verDelBlocked, "Deleting form version referenced by submitted application blocked by FK RESTRICT");

    // Cleanup test records
    await db.query("DELETE FROM merchant_gateway_applications WHERE id = ?", [appId]);
    // To clean up test version, archive it first then remove test rows
    await db.query("UPDATE merchant_form_versions SET status = 'archived' WHERE id = ?", [versionId]);
    await db.query("DELETE FROM merchant_form_sections WHERE id = ?", [sectionId]);
    await db.query("DELETE FROM merchant_form_versions WHERE id = ?", [versionId]);

    console.log(`\n=== RESULT: ${passed} PASSED, ${failed} FAILED ===`);
  } catch (err) {
    console.error("FATAL ERROR IN TEST:", err);
  } finally {
    process.exit(0);
  }
}

testFormImmutability();
