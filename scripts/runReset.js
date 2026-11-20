import { merchantCleanupService } from "../database/seeders/merchant.cleanup.js";

async function main() {
  const args = process.argv.slice(2);
  let confirmDb = null;

  for (const arg of args) {
    if (arg.startsWith("--confirm=")) {
      confirmDb = arg.split("=")[1];
    }
  }

  try {
    if (!confirmDb) {
      console.error("Error: Database reset requires explicit confirmation.");
      console.error("Usage: node scripts/runReset.js --confirm=banglaqr_db");
      process.exit(1);
    }

    console.log("=================================================");
    console.log("        BANGLAQR DATABASE RESET EXECUTION        ");
    console.log("=================================================\n");
    console.log("1. Validating local development environment...");
    console.log("2. Creating complete pre-reset SQL backup dump...");

    const result = await merchantCleanupService.executeCleanup({ confirmDatabase: confirmDb });

    console.log(`Backup successfully created at: ${result.backup.filePath} (${result.backup.size} bytes)\n`);
    console.log("3. Executing transactional reset in foreign-key dependency order...");
    console.log("\nCleanup summary (records deleted):");
    for (const [table, count] of Object.entries(result.deletedSummary)) {
      console.log(`  - ${table.padEnd(35)} : ${count}`);
    }

    console.log("\n=================================================");
    console.log("SUCCESS: Database reset completed safely.");
    console.log("All administrators, banks, MFS and form configurations preserved.");
    console.log("=================================================\n");

    process.exit(0);
  } catch (err) {
    console.error("\nRESET FAILED / ABORTED:", err.message);
    process.exit(1);
  }
}

main();
