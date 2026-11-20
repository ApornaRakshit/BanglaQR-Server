import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, "../.env") });

import { db } from "../src/config/db.js";
import { adminInstitutionsService } from "../src/modules/admin/institutions/admin.institutions.service.js";
import { adminInstitutionsRepository } from "../src/modules/admin/institutions/admin.institutions.repository.js";
import { merchantService } from "../src/modules/merchants/merchant.service.js";
import { merchantRepository } from "../src/modules/merchants/merchant.repository.js";

async function runTests() {
  console.log("================================================================================");
  console.log("🚀 STARTING BANGLAQR REAL BRANCH MANAGEMENT & MERCHANT KYC E2E TESTS");
  console.log("================================================================================");

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${message}`);
      failed++;
    }
  }

  try {
    // --------------------------------------------------------------------------
    // Test 1: Bangladesh Geographic Master Data (bd_divisions, bd_districts, bd_upazilas)
    // --------------------------------------------------------------------------
    console.log("\n[TEST GROUP 1] Bangladesh Geographic Master Data Lookups");
    const divisions = await adminInstitutionsRepository.getGeoDivisions();
    assert(divisions.length >= 8, `Found ${divisions.length} divisions (expected >= 8)`);
    const dhakaDiv = divisions.find((d) => d.name.toLowerCase() === "dhaka");
    assert(dhakaDiv && (dhakaDiv.name_bn || dhakaDiv.division_name_bn), "Dhaka division has Bengali name");

    const districts = await adminInstitutionsRepository.getGeoDistricts("Dhaka");
    assert(districts.length > 0, `Found ${districts.length} districts under Dhaka division`);
    const dhakaDist = districts.find((d) => d.name.toLowerCase() === "dhaka");
    assert(dhakaDist && dhakaDist.name_bn, "Dhaka district has Bengali name");

    const upazilas = await adminInstitutionsRepository.getGeoUpazilas("Dhaka");
    assert(upazilas.length > 0, `Found ${upazilas.length} upazilas/thanas under Dhaka district`);

    // --------------------------------------------------------------------------
    // Test 2: Geo Parent-Child Hierarchy Validation
    // --------------------------------------------------------------------------
    console.log("\n[TEST GROUP 2] Geographic Parent-Child Hierarchy Integrity");
    const validHierarchy = await adminInstitutionsRepository.validateGeoHierarchy("Dhaka", "Dhaka", "Gulshan");
    assert(validHierarchy.valid === true, "Valid hierarchy Dhaka -> Dhaka -> Gulshan passed validation");

    const invalidDistrict = await adminInstitutionsRepository.validateGeoHierarchy("Dhaka", "Chittagong", "Gulshan");
    assert(invalidDistrict.valid === false, "Invalid District under Division correctly rejected");

    const invalidUpazila = await adminInstitutionsRepository.validateGeoHierarchy("Dhaka", "Dhaka", "InvalidUpazilaXYZ");
    assert(invalidUpazila.valid === false, "Invalid Upazila under District correctly rejected");

    // --------------------------------------------------------------------------
    // Test 3: Institution & Real Branch Creation with 9-digit Routing Number
    // --------------------------------------------------------------------------
    console.log("\n[TEST GROUP 3] Real Institution & Branch Persistence");
    const testInstCode = `TEST_BANK_${Date.now()}`;
    const newInst = await adminInstitutionsService.create(
      {
        institutionCode: testInstCode,
        name: "Test Automated Commercial Bank PLC",
        institutionType: "commercial_bank",
        headOfficeAddress: "Plot 15, Motijheel C/A, Dhaka",
        division: "Dhaka",
        district: "Dhaka",
        upazila: "Motijheel",
        status: "active",
      },
      { id: 1, name: "Admin" }
    );
    assert(newInst && newInst.id, `Created test institution with ID: ${newInst.id}`);

    // Create branch with 9-digit routing number
    const testBranchCode = "TEST_MOTI_01";
    const newBranch = await adminInstitutionsService.createBranch(
      {
        institutionId: newInst.id,
        branchName: "Motijheel Corporate Branch",
        branchCode: testBranchCode,
        routingNumber: "060271234", // 9 digits
        division: "Dhaka",
        district: "Dhaka",
        upazila: "Motijheel",
        postOffice: "Motijheel",
        postalCode: "1000",
        address: "71 Dilkusha C/A, Motijheel, Dhaka-1000",
        phone: "+8802223388111",
        email: "motijheel@testbank.com",
        managerName: "Farhan Ahmed",
        status: "active",
        isDemo: 0,
      },
      { id: 1, name: "Admin" }
    );
    assert(newBranch && newBranch.id, `Created real branch with ID: ${newBranch.id}`);
    assert(newBranch.routing_number === "060271234", "9-digit routing number correctly persisted");
    assert(newBranch.is_demo === 0, "Real branch has is_demo = 0");

    // --------------------------------------------------------------------------
    // Test 4: Validation Constraints (Invalid routing number & duplicate code)
    // --------------------------------------------------------------------------
    console.log("\n[TEST GROUP 4] Routing Number & Uniqueness Constraints");
    let invalidRoutingFailed = false;
    try {
      await adminInstitutionsService.createBranch(
        {
          institutionId: newInst.id,
          branchName: "Bad Routing Branch",
          branchCode: "BAD_ROUTE_01",
          routingNumber: "12345", // Only 5 digits - must fail
          division: "Dhaka",
          district: "Dhaka",
          upazila: "Motijheel",
          status: "active",
        },
        { id: 1, name: "Admin" }
      );
    } catch (err) {
      invalidRoutingFailed = true;
    }
    assert(invalidRoutingFailed, "Branch with non-9-digit routing number correctly rejected with 400 error");

    let duplicateCodeFailed = false;
    try {
      await adminInstitutionsService.createBranch(
        {
          institutionId: newInst.id,
          branchName: "Duplicate Code Branch",
          branchCode: testBranchCode, // Duplicate
          routingNumber: "060279999",
          division: "Dhaka",
          district: "Dhaka",
          upazila: "Motijheel",
          status: "active",
        },
        { id: 1, name: "Admin" }
      );
    } catch (err) {
      duplicateCodeFailed = true;
    }
    assert(duplicateCodeFailed, "Duplicate branch code under same institution correctly rejected");

    // --------------------------------------------------------------------------
    // Test 5: Branch Status Toggle, Archive, and Demo Toggle
    // --------------------------------------------------------------------------
    console.log("\n[TEST GROUP 5] Branch Status, Demo Toggle & Archiving");
    // Toggle demo
    await adminInstitutionsService.toggleDemoBranch(newBranch.id, true, { id: 1, name: "Admin" });
    let fetched = await adminInstitutionsRepository.getBranchById(newBranch.id);
    assert(fetched.is_demo === 1, "Branch successfully toggled to is_demo = 1");

    await adminInstitutionsService.toggleDemoBranch(newBranch.id, false, { id: 1, name: "Admin" });
    fetched = await adminInstitutionsRepository.getBranchById(newBranch.id);
    assert(fetched.is_demo === 0, "Branch successfully toggled back to is_demo = 0");

    // Status toggle to suspended
    await adminInstitutionsService.updateBranchStatus(newBranch.id, "suspended", { id: 1, name: "Admin" });
    fetched = await adminInstitutionsRepository.getBranchById(newBranch.id);
    assert(fetched.status === "suspended", "Branch status updated to 'suspended'");

    // Restore to active
    await adminInstitutionsService.updateBranchStatus(newBranch.id, "active", { id: 1, name: "Admin" });

    // --------------------------------------------------------------------------
    // Test 6: Merchant KYC Lookups & Dynamic Auto-fill
    // --------------------------------------------------------------------------
    console.log("\n[TEST GROUP 6] Merchant Active Institutions & Branch Lookups");
    const activeInstitutions = await adminInstitutionsService.getActiveInstitutions();
    assert(activeInstitutions.length > 0, `Merchant retrieved ${activeInstitutions.length} active institutions`);
    const foundInst = activeInstitutions.find((i) => i.id === newInst.id);
    assert(foundInst && foundInst.name === "Test Automated Commercial Bank PLC", "Test Bank present in merchant active institutions");

    const activeBranches = await adminInstitutionsService.getActiveBranchesForInstitution(newInst.id);
    assert(activeBranches.length === 1, `Found 1 active branch for Test Bank`);
    assert(activeBranches[0].routing_number === "060271234", "Active branch returns 9-digit routing number to merchant");

    // --------------------------------------------------------------------------
    // Test 7: Merchant KYC Upsert with Relational Branch Auto-Sync
    // --------------------------------------------------------------------------
    console.log("\n[TEST GROUP 7] Merchant KYC Relational Branch Linkage");
    // Find or create a test merchant
    const [testMerchants] = await db.query("SELECT * FROM merchants LIMIT 1");
    if (testMerchants.length > 0) {
      const merchant = testMerchants[0];
      const merchantUserId = merchant.user_id;

      // Update merchant KYC with branchId
      await merchantService.updateKyc(merchantUserId, {
        legalBusinessName: "BanglaQR Automated Test Enterprise Ltd",
        businessEntityType: "Private Limited Company",
        tradeLicenseNumber: "TRAD/TEST/2026/01",
        tin: "123456789012",
        bin: "123456789",
        authorizedPersonName: "Tanvir Rahman",
        designation: "Managing Director",
        nidNumber: "1234567890",
        institutionId: newInst.id,
        branchId: newBranch.id,
        accountHolderName: "BanglaQR Automated Test Enterprise Ltd",
        accountNumber: "150120987654321",
        routingNumber: "060271234",
        accountType: "Current",
      });

      const updatedKyc = await merchantService.getKyc(merchantUserId);
      assert(updatedKyc.institutionId === newInst.id, "Merchant KYC persisted institution_id");
      assert(updatedKyc.branchId === newBranch.id, "Merchant KYC persisted branch_id");
      assert(updatedKyc.branchName === "Motijheel Corporate Branch", "Merchant KYC auto-synced canonical branch name from DB");
      assert(updatedKyc.branchCode === "TEST_MOTI_01", "Merchant KYC auto-synced canonical branch code from DB");
      assert(updatedKyc.routingNumber === "060271234", "Merchant KYC auto-synced 9-digit routing number from DB");
      assert(updatedKyc.district === "Dhaka", "Merchant KYC auto-synced district from DB");
    }

    // --------------------------------------------------------------------------
    // Test 8: Safe Branch Archiving & Delete Reference Protection
    // --------------------------------------------------------------------------
    console.log("\n[TEST GROUP 8] Safe Archiving and Deletion Protection");
    // Attempt to delete branch referenced in merchant_kyc
    let deleteFailed = false;
    try {
      await adminInstitutionsService.deleteBranch(newBranch.id, { id: 1, name: "Admin" });
    } catch (err) {
      deleteFailed = true;
    }
    assert(deleteFailed, "Branch referenced in merchant KYC cannot be deleted (Foreign key safety enforced)");

    // Safe Archive
    await adminInstitutionsService.archiveBranch(newBranch.id, { id: 1, name: "Admin" });
    fetched = await adminInstitutionsRepository.getBranchById(newBranch.id);
    assert(fetched.is_archived === 1 && fetched.status === "inactive", "Branch successfully archived and deactivated");

    // Clean up test institution & KYC references safely
    if (testMerchants.length > 0) {
      await db.execute(
        "UPDATE merchant_kyc SET institution_id = NULL, branch_id = NULL WHERE branch_id = ?",
        [newBranch.id]
      );
    }
    await db.execute("DELETE FROM institution_branches WHERE id = ?", [newBranch.id]);
    await db.execute("DELETE FROM institutions WHERE id = ?", [newInst.id]);
    console.log("  🧹 Test artifacts cleaned up safely.");

  } catch (error) {
    console.error("Unhandled error during test run:", error);
    failed++;
  } finally {
    console.log("\n================================================================================");
    console.log(`📊 TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log("================================================================================");
    process.exit(failed > 0 ? 1 : 0);
  }
}

runTests();
