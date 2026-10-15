import { db } from "../src/config/db.js";
import { adminInstitutionsRepository } from "../src/modules/admin/institutions/admin.institutions.repository.js";
import { adminInstitutionsService } from "../src/modules/admin/institutions/admin.institutions.service.js";

async function runTests() {
  console.log("================================================================================");
  console.log("   BanglaQR Phase 1: Preloaded Bank Master List & Dropdown Registration Test   ");
  console.log("================================================================================\n");

  let passed = 0;
  let failed = 0;

  function assert(condition, testName) {
    if (condition) {
      console.log(`  ✓ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${testName}`);
      failed++;
    }
  }

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Dropdown Options API
    // -------------------------------------------------------------------------
    console.log("[TEST 1] Testing getBankOptions repository/service...");
    const allOptions = await adminInstitutionsRepository.getBankOptions({ limit: 100 });
    assert(Array.isArray(allOptions) && allOptions.length >= 62, `Dropdown options returned ${allOptions.length} banks (>= 62)`);

    const bracBank = allOptions.find((b) => b.institution_code === "BRAC" || b.name.includes("BRAC"));
    assert(Boolean(bracBank), "BRAC Bank PLC exists in options");
    assert(bracBank?.swift_code === "BRAKBDDH", `BRAC Bank has official SWIFT code (${bracBank?.swift_code})`);
    assert(Boolean(bracBank?.name_bn), `BRAC Bank has Bengali name (${bracBank?.name_bn})`);
    assert(Boolean(bracBank?.website_url), `BRAC Bank has website URL (${bracBank?.website_url})`);

    // Search filter
    const sonaliSearch = await adminInstitutionsRepository.getBankOptions({ search: "Sonali" });
    assert(
      sonaliSearch.length >= 1 && sonaliSearch.some((b) => b.institution_code === "SONALI"),
      `Search for "Sonali" returned Sonali Bank PLC`
    );

    // Unregistered only filter
    const unregisteredOnly = await adminInstitutionsRepository.getBankOptions({ unregisteredOnly: true });
    assert(
      unregisteredOnly.every((b) => !b.is_registered),
      `unregisteredOnly returned ${unregisteredOnly.length} strictly unregistered catalogue banks`
    );

    // -------------------------------------------------------------------------
    // TEST 2: Tab Filtering in List
    // -------------------------------------------------------------------------
    console.log("\n[TEST 2] Testing tab filtering in list API...");
    const registeredList = await adminInstitutionsRepository.list({ tab: "registered", limit: 100 });
    const catalogueList = await adminInstitutionsRepository.list({ tab: "catalogue", limit: 100 });
    const activeList = await adminInstitutionsRepository.list({ tab: "active", limit: 100 });

    assert(
      registeredList.pagination.total < catalogueList.pagination.total,
      `Registered tab (${registeredList.pagination.total}) < Catalogue tab (${catalogueList.pagination.total})`
    );
    assert(catalogueList.pagination.total >= 62, `Full catalogue lists all ${catalogueList.pagination.total} banks`);
    assert(activeList.pagination.total >= 3, `Active tab lists active partner banks (${activeList.pagination.total})`);

    // Verify category & ownership returned in list rows
    const firstRow = catalogueList.institutions[0];
    assert(firstRow?.bank_category !== undefined, `List row contains bank_category (${firstRow?.bank_category})`);
    assert(firstRow?.ownership_type !== undefined, `List row contains ownership_type (${firstRow?.ownership_type})`);

    // -------------------------------------------------------------------------
    // TEST 3: Dropdown Registration Flow with Zero Duplicates
    // -------------------------------------------------------------------------
    console.log("\n[TEST 3] Testing registration of a catalogue bank with zero duplicate rows...");
    const [countBeforeRows] = await db.query("SELECT COUNT(*) AS total FROM institutions");
    const countBefore = Number(countBeforeRows[0].total);

    // Find an unregistered catalogue bank (e.g. Agrani Bank or BASIC Bank)
    const targetBank = unregisteredOnly.find(
      (b) => b.institution_code === "AGRANI" || b.institution_code === "BASIC" || b.institution_code === "EBL"
    ) || unregisteredOnly[0];

    assert(Boolean(targetBank), `Found unregistered target bank: ${targetBank?.name} (ID: ${targetBank?.id})`);

    const mockAdminUser = { id: 1, email: "superadmin@banglaqr.com" };
    const registrationPayload = {
      name: targetBank.name,
      nameBn: targetBank.name_bn,
      legalName: targetBank.legal_name,
      code: targetBank.institution_code,
      institutionCode: targetBank.institution_code,
      type: targetBank.institution_type || "commercial_bank",
      status: "active",
      partnershipStatus: "active_partner",
      directoryStatus: "verified",
      logoUrl: targetBank.logo_url || "https://logo.clearbit.com/test.bank",
      contactEmail: targetBank.support_email || "test_acquiring@bank.com",
      contactPhone: targetBank.support_phone || "16555",
      websiteUrl: targetBank.website_url,
      headOfficeAddress: targetBank.head_office_address,
      division: targetBank.division,
      district: targetBank.district,
      upazila: targetBank.upazila,
      postalCode: "1000",
      adminNotes: "Automated Phase 1 verification registration",
      swiftCode: targetBank.swift_code,
      officialBankCode: targetBank.official_bank_code,
      bankCategory: targetBank.bank_category,
      ownershipType: targetBank.ownership_type,
      bankingModel: targetBank.banking_model || "conventional",
      regulatoryReference: "BB-TEST-REG-2026",
      officialContactPerson: "Test Acquiring Officer",
      contactDesignation: "AVP, Digital Banking",
    };

    const registeredResult = await adminInstitutionsService.registerBank(
      targetBank.id,
      registrationPayload,
      mockAdminUser,
      { ip: "127.0.0.1", userAgent: "AutomatedTestRunner" }
    );

    const [countAfterRows] = await db.query("SELECT COUNT(*) AS total FROM institutions");
    const countAfter = Number(countAfterRows[0].total);

    assert(countBefore === countAfter, `Row count before (${countBefore}) equals row count after (${countAfter}) - ZERO duplicate institutions created!`);
    assert(registeredResult.id === targetBank.id, `Updated the exact canonical bank record (ID: ${registeredResult.id})`);
    assert(registeredResult.partnership_status === "active_partner", `Partnership status updated to 'active_partner'`);
    assert(registeredResult.status === "active", `Operational status updated to 'active'`);
    assert(registeredResult.postal_code === "1000", `Postal code persisted (${registeredResult.postal_code})`);

    // Verify bank profile updated
    const bankProfile = await adminInstitutionsRepository.getBankProfile(targetBank.id);
    assert(Boolean(bankProfile), `Bank profile exists for registered institution`);
    assert(bankProfile.regulatory_reference === "BB-TEST-REG-2026", `Regulatory reference saved (${bankProfile.regulatory_reference})`);
    assert(bankProfile.official_contact_person === "Test Acquiring Officer", `Contact person saved`);

    // -------------------------------------------------------------------------
    // TEST 4: Re-registration idempotency & Edit Flow
    // -------------------------------------------------------------------------
    console.log("\n[TEST 4] Testing re-registration & update persistence...");
    const updatedPayload = {
      ...registrationPayload,
      adminNotes: "Updated admin note verification",
    };
    await adminInstitutionsService.update(targetBank.id, updatedPayload, mockAdminUser);
    const refreshed = await adminInstitutionsRepository.getById(targetBank.id);
    assert(refreshed.admin_notes === "Updated admin note verification", `Admin notes updated and persisted cleanly`);

    // Verify Stats KPI reflects the new registered bank
    const stats = await adminInstitutionsRepository.getStats();
    assert(stats.totalCatalogue >= 62, `Total catalogue in stats (${stats.totalCatalogue}) >= 62`);
    assert(stats.activeInstitutions >= 4, `Active institutions in stats (${stats.activeInstitutions}) >= 4`);

    console.log("\n================================================================================");
    console.log(`   Phase 1 Test Results: ${passed} Passed, ${failed} Failed`);
    console.log("================================================================================\n");

    if (failed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (err) {
    console.error("Test execution error:", err);
    process.exit(1);
  }
}

runTests();

