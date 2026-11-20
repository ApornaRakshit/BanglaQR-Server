import { exec } from "child_process";
import { promisify } from "util";
import { merchantCleanupService } from "../database/seeders/merchant.cleanup.js";

const execAsync = promisify(exec);

/**
 * Dedicated runner for db:refresh.
 * Forwards arguments properly to ensure --confirm=banglaqr_db is passed to reset,
 * runs safe reset with backup, and then runs master reference data verification.
 * NEVER creates demo merchants by default.
 */
async function main() {
  await merchantCleanupService.validateEnvironment();

  const args = process.argv.slice(2);
  let confirmDb = null;

  for (const arg of args) {
    if (arg.startsWith("--confirm=")) {
      confirmDb = arg.split("=")[1];
    }
  }

  if (confirmDb !== "banglaqr_db") {
    console.error("Error: Database refresh requires explicit confirmation.");
    console.error("Usage: npm run db:refresh -- --confirm=banglaqr_db");
    process.exit(1);
  }

  try {
    console.log("=================================================");
    console.log("      BANGLAQR DATABASE REFRESH EXECUTION        ");
    console.log("=================================================\n");

    console.log("Step 1: Running safe database reset with automated backup...");
    await merchantCleanupService.executeCleanup({ confirmDatabase: confirmDb });

    console.log("\nStep 2: Restoring & verifying master reference data...");
    await execAsync("node scripts/runSeeder.js", { cwd: process.cwd() });

    console.log("\n=================================================");
    console.log("SUCCESS: Database refresh completed.");
    console.log("All master catalogues, administration, and forms verified.");
    console.log("Note: Zero demo merchants generated.");
    console.log("=================================================\n");

    process.exit(0);
  } catch (err) {
    console.error("\nREFRESH FAILED / ABORTED:", err.message);
    process.exit(1);
  }
}

main();
