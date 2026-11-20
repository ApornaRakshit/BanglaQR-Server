import { merchantCleanupService } from "../database/seeders/merchant.cleanup.js";

async function main() {
  try {
    console.log("=================================================");
    console.log("    BANGLAQR LOCAL DATABASE CLEANUP PREVIEW      ");
    console.log("=================================================\n");

    const preview = await merchantCleanupService.previewCleanup();

    console.log("Environment verification passed: Local Development DB only.\n");

    console.log("VERIFIED TEST MERCHANT USER IDS TO BE REMOVED:");
    console.log(preview.testUserIds.length ? preview.testUserIds.join(", ") : "None found.");
    console.log("Associated Merchant IDs:", preview.merchantIds.length ? preview.merchantIds.join(", ") : "None found.");
    console.log("\n-------------------------------------------------");
    console.log("ROW COUNTS SCHEDULED FOR RESET (TEST FIXTURES):");
    console.log("-------------------------------------------------");
    for (const [table, count] of Object.entries(preview.counts)) {
      console.log(`  - ${table.padEnd(35)} : ${count}`);
    }

    console.log("\n-------------------------------------------------");
    console.log("CORE PLATFORM DATA PRESERVED (ZERO DELETION):");
    console.log("-------------------------------------------------");
    for (const [item, count] of Object.entries(preview.preservedSummary)) {
      console.log(`  - ${item.padEnd(35)} : ${count} records safe`);
    }

    console.log("\n=================================================");
    console.log("NOTICE: This was a non-destructive dry-run preview.");
    console.log("To execute reset with backup, run:");
    console.log("  npm run db:reset -- --confirm=banglaqr_db");
    console.log("=================================================\n");

    process.exit(0);
  } catch (err) {
    console.error("Preview failed:", err.message);
    process.exit(1);
  }
}

main();
