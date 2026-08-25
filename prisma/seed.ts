/**
 * CLI wrapper for the demo dataset.
 * Run: npm run db:seed
 * The same data can be loaded on a fresh deployment via the /setup page.
 */
import { db } from "../src/lib/db";
import { seedDemoData } from "../src/services/demo-seed";

seedDemoData()
  .then(({ demoKey }) => {
    console.log("\nDemo voice-integration API key (also documented in README):");
    console.log(`  ${demoKey}`);
    console.log("Use it as: Authorization: Bearer <key> on POST /api/integrations/voice/call-completed");
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
