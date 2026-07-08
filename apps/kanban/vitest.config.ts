import path from "node:path";
import { defineConfig } from "vitest/config";
import swc from "unplugin-swc";

// Each test file runs in its own worker fork. Vitest defaults the fork count to
// the CPU core count, which oversubscribes the machine when something else is
// competing for resources — most notably the pre-push gate (Docker VM + image
// build + lint running alongside). Under that starvation a NestJS module
// compiled in a `beforeAll`/`beforeEach` hook can exceed the hook timeout, or a
// worker gets OOM-killed, surfacing as a flaky failure even though every test
// passes on a retry. Capping the fork count via VITEST_MAX_FORKS bounds the
// contention; left unset, local runs keep full parallelism. Mirrors the
// apps/api and apps/web configs.
const maxForksEnv = Number.parseInt(process.env.VITEST_MAX_FORKS ?? "", 10);
const maxForks =
  Number.isFinite(maxForksEnv) && maxForksEnv > 0 ? maxForksEnv : undefined;

export default defineConfig({
  esbuild: false,
  plugins: [
    swc.vite({
      jsc: {
        parser: {
          syntax: "typescript",
          decorators: true,
        },
        transform: {
          legacyDecorator: true,
          decoratorMetadata: true,
        },
        target: "es2023",
      },
    }),
  ],
  resolve: {
    alias: [
      {
        find: "@nexus/core",
        replacement: path.resolve(
          __dirname,
          "../../packages/core/src/index.ts",
        ),
      },
      {
        find: /^@nexus\/core\/(.*)$/,
        replacement: path.resolve(__dirname, "../../packages/core/src/$1"),
      },
      {
        find: "@nexus/kanban-contracts",
        replacement: path.resolve(
          __dirname,
          "../../packages/kanban-contracts/src/index.ts",
        ),
      },
      {
        find: /^@nexus\/kanban-contracts\/(.*)$/,
        replacement: path.resolve(
          __dirname,
          "../../packages/kanban-contracts/src/$1",
        ),
      },
    ],
  },
  test: {
    globals: true,
    environment: "node",
    include: [
      "src/**/*.spec.ts",
      "src/**/*.test.ts",
      "test/**/*.integration-spec.ts",
    ],
    // 30s (double the former 15s) leaves headroom for the heaviest
    // integration setup — a full NestJS module compile in a hook — to survive
    // CPU/disk starvation from a concurrent build without tipping over. On an
    // idle machine the slowest file is well under 4s, so this never slows a
    // healthy run; it only widens the margin before a starved hook flakes.
    testTimeout: 30000,
    hookTimeout: 30000,
    ...(maxForks
      ? { pool: "forks" as const, maxWorkers: maxForks }
      : {}),
  },
});
