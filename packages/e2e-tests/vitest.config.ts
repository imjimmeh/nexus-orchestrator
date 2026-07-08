import { defineConfig } from "vitest/config";

const runE2E = process.env.RUN_E2E_TESTS === "true";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    globals: true,
    testTimeout: 10 * 60 * 1000,
    hookTimeout: 10 * 60 * 1000,
    passWithNoTests: true,
    env: {
      RUN_E2E_TESTS: runE2E ? "true" : "false",
    },
  },
});
