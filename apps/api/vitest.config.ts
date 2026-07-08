import path from 'node:path';
import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

const swcPlugin = swc.vite({
  jsc: {
    parser: {
      syntax: 'typescript',
      decorators: true,
    },
    transform: {
      legacyDecorator: true,
      decoratorMetadata: true,
    },
    target: 'es2023',
  },
});

const alias = [
  {
    find: /^@nexus\/core\/(.*)$/,
    replacement: path.resolve(__dirname, '../../packages/core/src/$1'),
  },
  {
    find: '@nexus/core',
    replacement: path.resolve(__dirname, '../../packages/core/src/index.ts'),
  },
  {
    find: /^@nexus\/chat\/(.*)$/,
    replacement: path.resolve(__dirname, '../chat/src/$1'),
  },
  {
    find: '@nexus/chat',
    replacement: path.resolve(__dirname, '../chat/src'),
  },
  {
    find: '@nexus/plugin-sdk',
    replacement: path.resolve(
      __dirname,
      '../../packages/plugin-sdk/src/index.ts',
    ),
  },
  {
    find: '@nexus/kanban-contracts',
    replacement: path.resolve(
      __dirname,
      '../../packages/kanban-contracts/src/index.ts',
    ),
  },
  {
    find: '@nexus/harness-engine-pi',
    replacement: path.resolve(
      __dirname,
      '../../packages/harness-engine-pi/src/index.ts',
    ),
  },
];

// The pre-push hook runs build + lint + test:api sequentially alongside the
// Docker VM, so the default core-count fork pool can OOM-kill a worker
// ("Worker exited unexpectedly") even though every test passes. Capping the
// fork count via VITEST_MAX_FORKS bounds peak memory; unset locally = fast.
// Mirrors apps/web/vitest.config.ts.
const maxForksEnv = Number.parseInt(process.env.VITEST_MAX_FORKS ?? '', 10);
const maxForks =
  Number.isFinite(maxForksEnv) && maxForksEnv > 0 ? maxForksEnv : undefined;

const sharedTest = {
  globals: true,
  environment: 'node' as const,
  setupFiles: ['./test/vitest.setup.ts'],
  ...(maxForks
    ? { pool: 'forks' as const, maxWorkers: maxForks }
    : {}),
};

export default defineConfig({
  esbuild: false,
  plugins: [swcPlugin],
  resolve: { alias },
  test: {
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,js}'],
    },
    projects: [
      {
        extends: true,
        test: {
          ...sharedTest,
          name: 'unit',
          include: ['src/**/*.spec.ts'],
          exclude: ['src/**/*.integration.spec.ts'],
          testTimeout: 15000,
          hookTimeout: 15000,
        },
      },
      {
        extends: true,
        test: {
          ...sharedTest,
          name: 'integration',
          // Exclude the boot test — it requires a separate process (forks pool)
          // to resolve circular module chains that NestJS handles via forwardRef().
          include: ['src/**/*.integration.spec.ts'],
          exclude: ['src/app-module-boot.integration.spec.ts'],
          testTimeout: 30000,
          hookTimeout: 30000,
        },
      },
      {
        extends: true,
        test: {
          ...sharedTest,
          name: 'boot',
          include: ['src/app-module-boot.integration.spec.ts'],
          // Must run in a forked process: the in-process Vitest module runner
          // cannot resolve circular import chains (which NestJS handles at runtime
          // via forwardRef()). A forked Node.js process uses CommonJS require()
          // caching that tolerates circular references.
          pool: 'forks',
          testTimeout: 60000,
          hookTimeout: 60000,
        },
      },
      {
        extends: true,
        test: {
          ...sharedTest,
          name: 'e2e',
          include: ['test/**/*.e2e-spec.ts'],
          fileParallelism: false,
          testTimeout: 720000,
          hookTimeout: 120000,
        },
      },
    ],
  },
});
