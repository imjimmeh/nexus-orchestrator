// packages/e2e-tests/vitest.e2e.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "src/scenarios/**/*.e2e-spec.ts",
      "src/__tests__/**/*.e2e-spec.ts",
    ],
    globals: true,
    environment: "node",
    fileParallelism: false,
    testTimeout: 300_000,
    hookTimeout: 600_000,
    passWithNoTests: true,
    globalSetup: ["src/scenarios/setup/global-setup.ts"],
    // Docker container teardown can take 2+ minutes — give it plenty of room.
    teardownTimeout: 180_000,
  },
});
