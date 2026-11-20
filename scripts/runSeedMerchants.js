import { merchantSeeder } from "../database/seeders/merchant.seeder.js";
import { seedBatchService } from "../database/seeders/seedBatch.service.js";
import { merchantCleanupService } from "../database/seeders/merchant.cleanup.js";

/**
 * Test Merchants Seeder CLI: Generates synthetic merchants with complete relational graph
 * (Users -> Roles -> Merchants -> Profiles -> KYC -> Contacts -> Applications)
 * Tracked by seed batches for granular lifecycle and safe rollback.
 */
async function main() {
  await merchantCleanupService.validateEnvironment();

  const args = process.argv.slice(2);
  let count = 10;
  let batchName = null;
  let rollbackBatchId = null;
  let password = null;

  for (const arg of args) {
    if (arg.startsWith("--count=")) {
      count = parseInt(arg.split("=")[1], 10);
    } else if (arg.startsWith("--batch=")) {
      batchName = arg.split("=")[1];
    } else if (arg.startsWith("--rollback=")) {
      rollbackBatchId = parseInt(arg.split("=")[1], 10);
    } else if (arg.startsWith("--password=")) {
      password = arg.split("=")[1];
    }
  }

  try {
    if (rollbackBatchId) {
      console.log(`Rolling back seed batch #${rollbackBatchId}...`);
      const result = await seedBatchService.rollbackBatch(rollbackBatchId);
      console.log("Batch successfully rolled back:", result);
      process.exit(0);
    }

    console.log(`Starting synthetic test merchant generation (count: ${count})...`);
    const result = await merchantSeeder.seed({ count, batchName, password });
    console.log("Synthetic merchant seeding complete!");
    console.log(`Batch ID: ${result.batchId}`);
    console.log(`Generated Merchants: ${result.breakdown.merchants}`);
    console.log(`Generated Users: ${result.breakdown.users}`);
    console.log(`To rollback this specific batch later:`);
    console.log(`  node scripts/runSeedMerchants.js --rollback=${result.batchId}`);
    process.exit(0);
  } catch (err) {
    console.error("Seeding operation failed:", err.message);
    process.exit(1);
  }
}

main();
