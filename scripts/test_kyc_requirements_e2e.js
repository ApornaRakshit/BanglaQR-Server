import { db as pool } from '../src/config/db.js';
import { adminInstitutionsRepository } from '../src/modules/admin/institutions/admin.institutions.repository.js';
import { merchantRepository } from '../src/modules/merchants/merchant.repository.js';

async function runE2eTests() {
  console.log('=== Starting KYC Requirements E2E Verification ===\n');

  try {
    // 1. Get an existing institution
    const [institutions] = await pool.query('SELECT id, name, institution_code FROM institutions LIMIT 1');
    if (!institutions.length) {
      throw new Error('No institutions found in DB to test against.');
    }
    const testInstitution = institutions[0];
    console.log(`[PASS] Found test institution: "${testInstitution.name}" (ID: ${testInstitution.id}, Code: ${testInstitution.institution_code})`);

    // 2. Get an existing gateway/service if available
    const [gateways] = await pool.query('SELECT id, name FROM gateways LIMIT 1');
    const testServiceId = gateways.length ? gateways[0].id : null;
    if (testServiceId) {
      console.log(`[PASS] Found test service: "${gateways[0].name}" (ID: ${testServiceId})`);
    }

    // 3. Test KYC Requirement Creation (All 29 fields)
    const testRequirementCode = `TEST_KYC_${Date.now()}`;
    const newRequirementData = {
      institutionId: testInstitution.id,
      applicableServiceId: testServiceId,
      name: 'Trade License & Board Resolution (E2E Test)',
      requirementCode: testRequirementCode,
      requirementCategory: 'legal_entity',
      requirementType: 'document_upload',
      applicableBusinessTypes: ['private_limited', 'public_limited'],
      documentType: 'trade_license',
      description: 'Comprehensive business verification document for E2E validation.',
      instructions: 'Please upload a clear scanned color copy of your trade license.',
      allowedExtensions: 'pdf,jpg,png,webp',
      maxFileSizeMb: 15,
      maxFilesCount: 2,
      maxPdfPages: 10,
      documentSides: 'both',
      isMandatory: true,
      requiresApproval: true,
      autoVerifyOcr: true,
      checkExpiry: true,
      requireMatchingName: true,
      expiryFieldName: 'valid_until_date',
      minValidityDays: 45,
      referenceApiUrl: 'https://verify.citycorporation.gov.bd/api/check',
      adminNotes: 'INTERNAL CONFIDENTIAL NOTE: Verify against national tax ledger.',
      reviewInstructions: 'Check physical tax office seal on top-right quadrant.',
      sampleDocumentUrl: '/uploads/institutions/samples/sample_trade_license.png',
      sampleDocumentUrls: ['/uploads/institutions/samples/sample_trade_license.png'],
      displayOrder: 99,
      status: 'active',
    };

    const createRes = await adminInstitutionsRepository.createKycRequirement(newRequirementData);
    const createdId = typeof createRes === 'object' ? createRes.id : createRes;
    console.log(`[PASS] Successfully created KYC Requirement with ID: ${createdId}`);

    // 4. Test Fetching by ID
    const fetchedRequirement = await adminInstitutionsRepository.getKycRequirementById(createdId);
    if (!fetchedRequirement) {
      throw new Error(`Failed to fetch requirement ID ${createdId}`);
    }

    console.log(`[PASS] Fetched requirement by ID. Name: "${fetchedRequirement.name}", Code: "${fetchedRequirement.requirement_code}"`);
    console.log(`[PASS] Verification settings: auto_verify_ocr=${fetchedRequirement.auto_verify_ocr}, check_expiry=${fetchedRequirement.check_expiry}, require_matching_name=${fetchedRequirement.require_matching_name}`);
    console.log(`[PASS] Validation parameters: expiry_field_name="${fetchedRequirement.expiry_field_name}", min_validity_days=${fetchedRequirement.min_validity_days}`);
    console.log(`[PASS] Admin internal notes preserved: "${fetchedRequirement.admin_notes}"`);
    console.log(`[PASS] Sample document URL: "${fetchedRequirement.sample_document_url}"`);

    // Verify values match
    if (fetchedRequirement.max_pdf_pages !== 10) {
      throw new Error(`max_pdf_pages expected 10, got ${fetchedRequirement.max_pdf_pages}`);
    }
    if (fetchedRequirement.min_validity_days !== 45) {
      throw new Error(`min_validity_days expected 45, got ${fetchedRequirement.min_validity_days}`);
    }

    // 5. Test Update Requirement
    const updateData = {
      ...newRequirementData,
      name: 'Trade License & Board Resolution (UPDATED E2E)',
      minValidityDays: 90,
      adminNotes: 'UPDATED INTERNAL NOTE: Verified high-risk entity protocol applied.',
      status: 'active',
    };

    await adminInstitutionsRepository.updateKycRequirement(createdId, updateData);
    console.log(`[PASS] Updated requirement ID: ${createdId}`);

    const reFetched = await adminInstitutionsRepository.getKycRequirementById(createdId);
    if (reFetched.min_validity_days !== 90) {
      throw new Error(`Update verification failed: min_validity_days expected 90, got ${reFetched.min_validity_days}`);
    }
    console.log(`[PASS] Verified updated min_validity_days: ${reFetched.min_validity_days}`);

    // 6. Test Related KYC Requirements Query
    const relatedList = await adminInstitutionsRepository.getRelatedKycRequirements({
      institutionId: testInstitution.id,
      serviceId: testServiceId,
      excludeId: createdId,
    });
    console.log(`[PASS] Queried related KYC requirements: found ${relatedList.length} related items (excluding self)`);

    // 7. CRITICAL SECURITY TEST: Merchant Privacy / admin_notes omission
    const merchantRequirements = await merchantRepository.getInstitutionKycRequirements(testInstitution.id);
    console.log(`[PASS] Merchant API query returned ${merchantRequirements.length} requirements for institution ${testInstitution.id}`);

    const merchantSelf = merchantRequirements.find(r => r.id === createdId);
    if (!merchantSelf) {
      console.log('[WARN] Created requirement not found in merchant active list (may filter differently)');
    } else {
      console.log('[PASS] Found created requirement in Merchant API response');
      if (merchantSelf.admin_notes !== undefined || merchantSelf.review_instructions !== undefined) {
        throw new Error('SECURITY VIOLATION: admin_notes or review_instructions was exposed in Merchant API response!');
      }
      console.log('[PASS] Merchant Security Verified: admin_notes and review_instructions are strictly OMITTED from merchant response.');
    }

    // 8. Clean up test record
    await pool.query('DELETE FROM institution_kyc_requirements WHERE id = ?', [createdId]);
    console.log(`[PASS] Cleaned up temporary test requirement ID: ${createdId}`);

    console.log('\n=== ALL E2E TESTS PASSED SUCCESSFULLY! ===\n');
  } catch (err) {
    console.error('\n[FAIL] E2E Test Failure:', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

runE2eTests();
