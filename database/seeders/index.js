import { merchantSeeder } from "./merchant.seeder.js";
import { merchantCleanupService } from "./merchant.cleanup.js";
import { seedBatchService } from "./seedBatch.service.js";

/**
 * Unified entry point for Database Seeding & Reset operations
 */
export const seederSystem = {
  seedMerchants: (options) => merchantSeeder.seed(options),
  cleanupPreview: () => merchantCleanupService.previewCleanup(),
  executeReset: (options) => merchantCleanupService.executeCleanup(options),
  listBatches: (options) => seedBatchService.listBatches(options),
  rollbackBatch: (batchId) => seedBatchService.rollbackBatch(batchId),
};

export default seederSystem;
