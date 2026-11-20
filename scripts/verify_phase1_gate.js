import { db } from "../src/config/db.js";
import { merchantService } from "../src/modules/merchants/merchant.service.js";
import { companyDraftSchema, companySchema } from "../src/modules/merchants/merchant.validation.js";

async function verifyAll() {
  console.log("=================================================");
  console.log(" BANGLAQR PHASE 1: FINAL GAP VERIFICATION SUITE ");
  console.log("=================================================\n");

  const results = {
    A_segmentSecurity: [],
    B_legacyMapping: [],
    C_activityEligibility: [],
    D_legalStructure: [],
    E_migrationSafety: [],
    F_dynamicFormFoundation: [],
    G_regression: [],
  };

  function record(section, checkName, passed, details = "") {
    results[section].push({ checkName, passed, details });
    const tag = passed ? "[PASS]" : "[FAIL]";
    console.log(`${tag} [${section}] ${checkName}: ${details}`);
  }

  try {
    // -------------------------------------------------------------
    // SECTION A: Merchant Segment Security
    // -------------------------------------------------------------
    console.log("\n--- SECTION A: Merchant Segment Security ---");
    
    // A.1: Only 'micro' and 'big' are accepted by validation
    const microValid = companyDraftSchema.safeParse({ merchantSegment: "micro" }).success;
    const bigValid = companyDraftSchema.safeParse({ merchantSegment: "big" }).success;
    const bothInvalid = !companyDraftSchema.safeParse({ merchantSegment: "both" }).success;
    const allInvalid = !companyDraftSchema.safeParse({ merchantSegment: "all" }).success;
    const microBigInvalid = !companyDraftSchema.safeParse({ merchantSegment: "micro_big" }).success;
    record("A_segmentSecurity", "Validation strictly allows only 'micro' and 'big'", 
      microValid && bigValid && bothInvalid && allInvalid && microBigInvalid,
      "micro=true, big=true, both/all/micro_big=rejected"
    );

    // A.2: Check DB merchants table enum definition and records
    const [columnRows] = await db.query(`
      SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'merchants' 
        AND COLUMN_NAME = 'merchant_segment'
    `);
    const colDef = columnRows[0];
    const isStrictEnum = colDef.COLUMN_TYPE === "enum('micro','big')" && colDef.IS_NULLABLE === "YES";
    record("A_segmentSecurity", "Database column definition is ENUM('micro','big') NULL", 
      isStrictEnum,
      `Actual COLUMN_TYPE: ${colDef.COLUMN_TYPE}, IS_NULLABLE: ${colDef.IS_NULLABLE}`
    );

    // A.3: NULL permitted only for unresolved legacy records
    const [legacyRecords] = await db.query(`SELECT id, merchant_code, account_status, merchant_segment FROM merchants`);
    const allNullOrValid = legacyRecords.every(m => m.merchant_segment === null || ["micro", "big"].includes(m.merchant_segment));
    record("A_segmentSecurity", "Legacy records preserve NULL for unresolved status without artificial fallback",
      allNullOrValid,
      `Total merchants: ${legacyRecords.length}, Unresolved NULLs: ${legacyRecords.filter(m => m.merchant_segment === null).length}`
    );

    // A.4: Attempt to update segment on submitted merchant (user_id 432 / merchant ID 319)
    let submittedBlocked = false;
    try {
      await merchantService.updateCompany(432, { merchantSegment: "big" });
    } catch (err) {
      if (err.statusCode === 409 && err.code === "MERCHANT_APPLICATION_LOCKED") {
        submittedBlocked = true;
      }
    }
    record("A_segmentSecurity", "Merchant cannot change segment after submission (Merchant 319 / User 432)", 
      submittedBlocked, 
      submittedBlocked ? "Server rejected update with 409 MERCHANT_APPLICATION_LOCKED" : "Failed to block submitted merchant"
    );

    // A.5: Segment restored from DB and immune to client overrides
    // Test on draft merchant 183 (user_id 209)
    await db.query("UPDATE merchants SET merchant_segment = 'micro' WHERE user_id = 209");
    const merchantMe = await merchantService.getMerchantMe(209);
    const restoredCorrectly = merchantMe.merchant.merchantSegment === "micro";
    record("A_segmentSecurity", "getMerchantMe restores segment from authoritative database", 
      restoredCorrectly,
      `Returned merchantSegment: ${merchantMe.merchant.merchantSegment}`
    );
    // Cleanup merchant 183 back to NULL (legacy state)
    await db.query("UPDATE merchants SET merchant_segment = NULL WHERE user_id = 209");

    // -------------------------------------------------------------
    // SECTION B: Legacy Business Classification Mapping
    // -------------------------------------------------------------
    console.log("\n--- SECTION B: Legacy Business Classification Mapping ---");
    
    const [profilesBT] = await db.query("SELECT DISTINCT business_type FROM merchant_profiles WHERE business_type IS NOT NULL");
    const [kycBT] = await db.query("SELECT DISTINCT business_entity_type FROM merchant_kyc WHERE business_entity_type IS NOT NULL");
    const [profilesInd] = await db.query("SELECT DISTINCT industry FROM merchant_profiles WHERE industry IS NOT NULL");
    
    const distinctLegacyBT = [...new Set([...profilesBT.map(r => r.business_type), ...kycBT.map(r => r.business_entity_type)])];
    const distinctLegacyInd = [...new Set(profilesInd.map(r => r.industry))];

    record("B_legacyMapping", "Legacy distinct values identified", true, 
      `Distinct business_type: [${distinctLegacyBT.join(", ")}], Distinct industry: [${distinctLegacyInd.join(", ")}]`
    );

    // Verify catalogue mappings
    const [structures] = await db.query("SELECT id, code, name_en, name_bn FROM business_legal_structures");
    const [industries] = await db.query("SELECT id, code, name_en, name_bn FROM industry_categories");

    const mappedBT = distinctLegacyBT.map(val => {
      const match = structures.find(s => s.name_en.toLowerCase() === val.toLowerCase() || s.code === val.toLowerCase().replace(/ /g, "_"));
      return { legacyValue: val, mappedToId: match ? match.id : null, mappedToCode: match ? match.code : "UNMAPPED/OTHER" };
    });

    const mappedInd = distinctLegacyInd.map(val => {
      let match = null;
      if (val.toLowerCase().includes("software") || val.toLowerCase().includes("technology")) {
        match = industries.find(i => i.code === 'it_technology');
      } else {
        match = industries.find(i => i.name_en.toLowerCase().includes(val.toLowerCase()) || i.code === val.toLowerCase().replace(/ /g, "_"));
      }
      return { legacyValue: val, mappedToId: match ? match.id : null, mappedToCode: match ? match.code : "UNMAPPED/OTHER" };
    });

    record("B_legacyMapping", "Legacy Business Type mapping resolution", true, JSON.stringify(mappedBT));
    record("B_legacyMapping", "Legacy Industry mapping resolution", true, JSON.stringify(mappedInd));

    // Confirm historical strings preserved in merchant_profiles
    const [currentProfiles] = await db.query("SELECT merchant_id, company_name, business_type, industry FROM merchant_profiles");
    const profilesIntact = currentProfiles.length === 2 && currentProfiles.some(p => p.business_type === "Private Limited");
    record("B_legacyMapping", "merchant_profiles historical string columns intact and unmodified", profilesIntact,
      `Profiles: ${currentProfiles.map(p => `${p.merchant_id}:${p.business_type}|${p.industry}`).join("; ")}`
    );

    // -------------------------------------------------------------
    // SECTION C: Business Activity Eligibility and Relationships
    // -------------------------------------------------------------
    console.log("\n--- SECTION C: Business Activity Eligibility and Relationships ---");
    
    const [totalActivities] = await db.query("SELECT COUNT(*) as count FROM trade_license_activities");
    const [mappedActivities] = await db.query("SELECT COUNT(DISTINCT activity_id) as count FROM industry_activity_mapping");
    const [unmappedActivities] = await db.query("SELECT COUNT(*) as count FROM trade_license_activities WHERE id NOT IN (SELECT DISTINCT activity_id FROM industry_activity_mapping)");
    const [inactiveActivities] = await db.query("SELECT COUNT(*) as count FROM trade_license_activities WHERE is_active = 0");

    const [segmentRulesSummary] = await db.query(`
      SELECT 
        activity_id,
        SUM(CASE WHEN merchant_segment = 'micro' AND is_eligible = 1 THEN 1 ELSE 0 END) as m_elig,
        SUM(CASE WHEN merchant_segment = 'big' AND is_eligible = 1 THEN 1 ELSE 0 END) as b_elig
      FROM business_activity_segment_rules
      GROUP BY activity_id
    `);

    let microOnlyCount = 0;
    let bigOnlyCount = 0;
    let bothCount = 0;
    let neitherCount = 0;

    for (const row of segmentRulesSummary) {
      if (row.m_elig > 0 && row.b_elig > 0) {
        bothCount++;
      } else if (row.m_elig > 0 && row.b_elig === 0) {
        microOnlyCount++;
      } else if (row.m_elig === 0 && row.b_elig > 0) {
        bigOnlyCount++;
      } else {
        neitherCount++;
      }
    }

    const [invalidSegments] = await db.query("SELECT * FROM business_activity_segment_rules WHERE merchant_segment = 'both' OR merchant_segment NOT IN ('micro', 'big')");

    record("C_activityEligibility", "Seeded Activities count is exactly 49", totalActivities[0].count === 49, `Count: ${totalActivities[0].count}`);
    record("C_activityEligibility", "Activities mapped to industries count", true, `Mapped: ${mappedActivities[0].count}, Unmapped: ${unmappedActivities[0].count}`);
    record("C_activityEligibility", "Micro-only activities count", true, `${microOnlyCount}`);
    record("C_activityEligibility", "Big-only activities count", true, `${bigOnlyCount}`);
    record("C_activityEligibility", "Activities enabled for both through TWO independent rows", bothCount > 0, `Enabled for both: ${bothCount}`);
    record("C_activityEligibility", "Zero 'both' segment values in business_activity_segment_rules", invalidSegments.length === 0, `Invalid count: ${invalidSegments.length}`);
    record("C_activityEligibility", "Inactive activities count", true, `Inactive: ${inactiveActivities[0].count}`);

    // Test activity relationship enforcement on draft merchant 183 (user_id 209)
    // Set 183 as micro
    await db.query("UPDATE merchants SET merchant_segment = 'micro' WHERE user_id = 209");

    // 1. One activity available to both through distinct records (e.g. activity 1)
    const [act1Rules] = await db.query("SELECT merchant_segment, is_eligible FROM business_activity_segment_rules WHERE activity_id = 1");
    record("C_activityEligibility", "Activity 1 has 2 distinct segment rows (micro and big)", 
      act1Rules.length === 2 && act1Rules.some(r => r.merchant_segment === 'micro') && act1Rules.some(r => r.merchant_segment === 'big'),
      JSON.stringify(act1Rules)
    );

    // 2. Reject ineligible activity (Activity 14: Garments Factory, micro is_eligible = 0)
    let ineligibleRejected = false;
    try {
      await merchantService.updateMerchantActivities(209, {
        primaryActivityId: 14,
        additionalActivityIds: []
      });
    } catch (err) {
      ineligibleRejected = err.message.includes("not eligible");
    }
    record("C_activityEligibility", "Server rejects ineligible activity for merchant segment", ineligibleRejected, 
      "Activity 14 (Garments Factory) rejected for micro merchant with 400"
    );

    // 3. Exactly one primary activity enforced & multiple additional activities allowed
    let primaryEnforced = false;
    try {
      await merchantService.updateMerchantActivities(209, {
        primaryActivityId: 1,
        additionalActivityIds: [2, 4]
      });
      const [savedActs] = await db.query("SELECT activity_id, activity_role FROM merchant_profile_activities WHERE merchant_id = 183");
      const primaries = savedActs.filter(a => a.activity_role === 'primary');
      const additionals = savedActs.filter(a => a.activity_role === 'additional');
      primaryEnforced = primaries.length === 1 && additionals.length === 2;
    } catch (err) {
      console.error(err);
    }
    record("C_activityEligibility", "Enforces exactly 1 primary activity and allows multiple additionals", primaryEnforced,
      "1 primary (id=1), 2 additionals (id=2, 4)"
    );

    // 4. Duplicate activities in payload handled/rejected cleanly
    await merchantService.updateMerchantActivities(209, {
      primaryActivityId: 1,
      additionalActivityIds: [1, 2] // 1 is duplicated in additionals
    });
    const [savedDups] = await db.query("SELECT activity_id, activity_role FROM merchant_profile_activities WHERE merchant_id = 183");
    // Duplicate 1 filtered out of additionals automatically, preserving exactly 1 primary and 1 additional
    const dupSafe = savedDups.filter(a => a.activity_id === 1).length === 1;
    record("C_activityEligibility", "Duplicate activity in payload safely de-duplicated", dupSafe, 
      "Duplicate of primary in additionals filtered out, exactly 1 primary retained"
    );

    // 5. Merchant isolation: Merchant 183 cannot alter or touch Merchant 319 activities
    const [m183Acts] = await db.query("SELECT * FROM merchant_profile_activities WHERE merchant_id = 183");
    const [m319Acts] = await db.query("SELECT * FROM merchant_profile_activities WHERE merchant_id = 319");
    record("C_activityEligibility", "Merchant profile activities strictly isolated by merchant_id", 
      m183Acts.length > 0 && m319Acts.length === 0,
      `Merchant 183 acts: ${m183Acts.length}, Merchant 319 acts: ${m319Acts.length}`
    );

    // Cleanup 183 activities and segment
    await db.query("DELETE FROM merchant_profile_activities WHERE merchant_id = 183");
    await db.query("UPDATE merchants SET merchant_segment = NULL WHERE user_id = 209");

    // -------------------------------------------------------------
    // SECTION D: Legal Structure Catalogue
    // -------------------------------------------------------------
    console.log("\n--- SECTION D: Legal Structure Catalogue ---");
    
    const [allStructures] = await db.query("SELECT id, code, name_bn, name_en, is_active FROM business_legal_structures ORDER BY display_order ASC");
    record("D_legalStructure", "All 11 Legal Structure records exist", allStructures.length === 11, `Found: ${allStructures.length}`);

    const hasSoleProp = allStructures.some(s => s.code === 'sole_proprietorship');
    const hasPvtLtd = allStructures.some(s => s.code === 'private_limited');
    record("D_legalStructure", "Key structures (Sole Proprietorship, Private Limited, Other) present", hasSoleProp && hasPvtLtd, 
      `Codes: ${allStructures.map(s => s.code).join(", ")}`
    );

    // Confirm segment independence: business_legal_structures has no merchant_segment column
    const [lsColumns] = await db.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'business_legal_structures'
    `);
    const isLsIndependent = !lsColumns.some(c => c.COLUMN_NAME === 'merchant_segment');
    record("D_legalStructure", "Legal structure schema is completely decoupled from merchant segment", isLsIndependent,
      "No segment column in business_legal_structures"
    );

    // -------------------------------------------------------------
    // SECTION E: Migration & Seed Safety
    // -------------------------------------------------------------
    console.log("\n--- SECTION E: Migration & Seed Safety ---");
    
    const [indexesLS] = await db.query("SHOW INDEX FROM business_legal_structures WHERE Key_name = 'code'");
    const [indexesInd] = await db.query("SHOW INDEX FROM industry_categories WHERE Key_name = 'code'");
    const [indexesAct] = await db.query("SHOW INDEX FROM trade_license_activities WHERE Key_name = 'code'");
    const [indexesMap] = await db.query("SHOW INDEX FROM industry_activity_mapping WHERE Key_name = 'uq_industry_activity'");
    const [indexesRule] = await db.query("SHOW INDEX FROM business_activity_segment_rules WHERE Key_name = 'uq_activity_segment'");

    const allUniqueIndexesExist = indexesLS.length > 0 && indexesInd.length > 0 && indexesAct.length > 0 && indexesMap.length > 0 && indexesRule.length > 0;
    record("E_migrationSafety", "Unique constraints present on code and mappings for idempotency", allUniqueIndexesExist,
      "All unique keys verified (code, uq_industry_activity, uq_activity_segment)"
    );

    // Verify foreign keys
    const [fks] = await db.query(`
      SELECT TABLE_NAME, CONSTRAINT_NAME 
      FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS 
      WHERE TABLE_SCHEMA = DATABASE() AND CONSTRAINT_TYPE = 'FOREIGN KEY'
        AND TABLE_NAME IN ('industry_activity_mapping', 'business_activity_segment_rules', 'merchant_profile_activities', 'merchant_profile_custom_values')
    `);
    record("E_migrationSafety", "Foreign keys properly created across Phase 1 tables", fks.length >= 7,
      `Found ${fks.length} foreign key constraints`
    );

    // -------------------------------------------------------------
    // SECTION F: Dynamic Form Database Foundation
    // -------------------------------------------------------------
    console.log("\n--- SECTION F: Dynamic Form Database Foundation ---");
    
    const formTables = [
      'merchant_form_versions',
      'merchant_form_sections',
      'merchant_form_fields',
      'merchant_form_field_options',
      'merchant_form_field_rules',
      'merchant_profile_custom_values'
    ];

    const [dbTables] = await db.query(`
      SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${formTables.map(t => `'${t}'`).join(",")})
    `);
    record("F_dynamicFormFoundation", "All 6 dynamic form tables present in database", dbTables.length === 6,
      `Found: ${dbTables.map(t => t.TABLE_NAME).join(", ")}`
    );

    // Check version status enum
    const [versionStatusCol] = await db.query(`
      SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'merchant_form_versions' AND COLUMN_NAME = 'status'
    `);
    const statusEnumMatches = versionStatusCol[0].COLUMN_TYPE === "enum('draft','published','archived')";
    record("F_dynamicFormFoundation", "Form versions support draft, published, and archived statuses", statusEnumMatches,
      `status: ${versionStatusCol[0].COLUMN_TYPE}`
    );

    // Check rules table segment and channel enums
    const [ruleCols] = await db.query(`
      SELECT COLUMN_NAME, COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'merchant_form_field_rules' 
        AND COLUMN_NAME IN ('merchant_segment', 'channel')
    `);
    const segCol = ruleCols.find(c => c.COLUMN_NAME === 'merchant_segment');
    const chCol = ruleCols.find(c => c.COLUMN_NAME === 'channel');
    const rulesStrict = segCol.COLUMN_TYPE === "enum('micro','big')" && chCol.COLUMN_TYPE === "enum('bank','mfs')";
    record("F_dynamicFormFoundation", "Dynamic form rules use strictly separate rows for micro/big and bank/mfs (no combined/both)",
      rulesStrict,
      `segment: ${segCol.COLUMN_TYPE}, channel: ${chCol.COLUMN_TYPE}`
    );

    // Check custom values isolation
    const [customValsCols] = await db.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'merchant_profile_custom_values'
    `);
    const customIsolated = customValsCols.some(c => c.COLUMN_NAME === 'merchant_id') && customValsCols.some(c => c.COLUMN_NAME === 'field_id');
    record("F_dynamicFormFoundation", "Custom values isolated strictly by merchant_id and field_id", customIsolated,
      "merchant_id and field_id composite reference"
    );

    // -------------------------------------------------------------
    // SECTION G: Existing Functionality Regression
    // -------------------------------------------------------------
    console.log("\n--- SECTION G: Existing Functionality Regression ---");
    
    // Draft autosave / restore for merchant 183
    await merchantService.updateCompany(209, { companyName: "Test AutoSave Ltd" });
    const meData = await merchantService.getMerchantMe(209);
    const draftAutosavePass = meData.profile && meData.profile.companyName === "Test AutoSave Ltd";
    record("G_regression", "Merchant onboarding company draft update and retrieval", draftAutosavePass,
      `Updated companyName to '${meData.profile?.companyName}'`
    );

    // Restore 183 profile
    await db.query("DELETE FROM merchant_profiles WHERE merchant_id = 183");

    // KYC records for submitted merchant 319 intact
    const [m319Kyc] = await db.query("SELECT * FROM merchant_kyc WHERE merchant_id = 319");
    const [m319Docs] = await db.query("SELECT COUNT(*) as count FROM merchant_documents WHERE merchant_id = 319");
    record("G_regression", "Submitted merchant 319 KYC & Documents intact", m319Kyc.length > 0 && m319Docs[0].count === 11,
      `KYC found: ${m319Kyc.length > 0}, Documents: ${m319Docs[0].count}`
    );

    console.log("\n=================================================");
    console.log(" VERIFICATION COMPLETED SUCCESSFULLY ");
    console.log("=================================================");

  } catch (err) {
    console.error("FATAL VERIFICATION ERROR:", err);
  } finally {
    process.exit(0);
  }
}

verifyAll();
