import fs from "fs";

const filePath = "src/modules/merchants/merchant.service.js";
let content = fs.readFileSync(filePath, "utf-8").replace(/\r\n/g, "\n");

const oldStr = `      await conn.execute(
        \`INSERT INTO kyc_submission_versions
         (merchant_id, kyc_id, version_no, snapshot_data, submitted_by_user_id, change_summary, submitted_at)
         VALUES (?, ?, ?, ?, ?, ?, NOW())\`,
        [
          merchant.id,
          kyc.id,
          nextVersion,
          JSON.stringify(snapshotData),
          userId,
          "Initial merchant onboarding application submission",
        ]
      );`;

const newStr = `      const [publishedFormRows] = await conn.query(
        "SELECT id FROM merchant_form_versions WHERE status = 'published' ORDER BY version_number DESC LIMIT 1"
      );
      const activeFormVersionId = publishedFormRows.length > 0 ? publishedFormRows[0].id : null;

      await conn.execute(
        \`INSERT INTO kyc_submission_versions
         (merchant_id, kyc_id, version_no, form_version_id, snapshot_data, submitted_by_user_id, change_summary, submitted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW())\`,
        [
          merchant.id,
          kyc.id,
          nextVersion,
          activeFormVersionId,
          JSON.stringify(snapshotData),
          userId,
          "Initial merchant onboarding application submission",
        ]
      );`;

if (content.includes(oldStr)) {
  content = content.replace(oldStr, newStr);

  // Also bind activeFormVersionId to merchant_gateway_applications insert
  const oldMga = `            \`INSERT INTO merchant_gateway_applications
             (application_number, application_type, merchant_id, institution_id, branch_id, status, gateway_name, submitted_data_snapshot, applied_at)
             VALUES (?, 'onboarding_kyc', ?, ?, ?, 'applied', ?, ?, NOW())\`,
            [
              \`APP-\${Date.now().toString().slice(-6)}\`,
              merchant.id,
              Number(selectedInstId),
              kyc?.branch_id || null,
              resolvedInstName,
              JSON.stringify(applicationSnapshot),
            ]`;

  const newMga = `            \`INSERT INTO merchant_gateway_applications
             (application_number, application_type, merchant_id, institution_id, branch_id, form_version_id, status, gateway_name, submitted_data_snapshot, applied_at)
             VALUES (?, 'onboarding_kyc', ?, ?, ?, ?, 'applied', ?, ?, NOW())\`,
            [
              \`APP-\${Date.now().toString().slice(-6)}\`,
              merchant.id,
              Number(selectedInstId),
              kyc?.branch_id || null,
              activeFormVersionId,
              resolvedInstName,
              JSON.stringify(applicationSnapshot),
            ]`;

  if (content.includes(oldMga)) {
    content = content.replace(oldMga, newMga);
  }

  fs.writeFileSync(filePath, content, "utf-8");
  console.log("Successfully bound activeFormVersionId to submission!");
} else {
  console.error("Could not find oldStr in merchant.service.js");
  process.exit(1);
}

