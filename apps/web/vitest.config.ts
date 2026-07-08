import path from "node:path";
import { defineConfig } from "vitest/config";

// React 19 strips `React.act` from its production build, which breaks
// @testing-library/react's render() when NODE_ENV=production is inherited
// from the shell. Force the test environment so the development build of
// React (and `act`) is loaded.
process.env.NODE_ENV =
  process.env.NODE_ENV === "production"
    ? "test"
    : (process.env.NODE_ENV ?? "test");

// Each test file runs in its own jsdom-backed worker fork. Vitest defaults the
// fork count to the CPU core count, which spikes memory when many heavy jsdom
// environments spin up at once. On an idle machine that is fine, but inside the
// pre-push gate (Docker VM + build/lint competing for RAM) a worker can be
// OOM-killed — surfacing as a flaky "Worker exited unexpectedly" error even
// though every test passes. Capping the fork count via VITEST_MAX_FORKS bounds
// peak memory; left unset, local runs keep full parallelism.
const maxForksEnv = Number.parseInt(process.env.VITEST_MAX_FORKS ?? "", 10);
const maxForks =
  Number.isFinite(maxForksEnv) && maxForksEnv > 0 ? maxForksEnv : undefined;

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@nexus/core": path.resolve(
        __dirname,
        "../../packages/core/src/browser.ts",
      ),
      "@nexus/kanban-contracts": path.resolve(
        __dirname,
        "../../packages/kanban-contracts/src/index.ts",
      ),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.spec.{ts,tsx}"],
    exclude: ["e2e/**", "dist/**", "node_modules/**"],
    ...(maxForks
      ? { pool: "forks" as const, maxWorkers: maxForks }
      : {}),
  },
});
