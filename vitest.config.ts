import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    // The integration suites share one scratch database and each resets it in
    // beforeEach, so they must not run in parallel workers.
    fileParallelism: process.env.TEST_DATABASE_RESET !== "1",
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
