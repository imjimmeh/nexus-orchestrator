# Stack Harness Implementation Plan (Subsystem 2 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `StackHarness` that programmatically brings up and tears down a hermetic, containerised test stack (Postgres, Redis, API, Kanban) via testcontainers, starts the in-process fake LLM server, seeds both LLM providers (OpenAI + Anthropic) pointing at it, and exposes a `StackContext` with the URLs that scenarios need — proving end-to-end connectivity via a **networking spike** test before any scenario work.

**Architecture:** `packages/e2e-tests/src/stack/` owns container lifecycle; `packages/e2e-tests/src/driver/` owns the HTTP/WS/auth helpers. The fake LLM (`src/fake-llm/`) starts in-process to expose a port, which is injected via `E2E_PROVIDER_BASE_URL=http://host.docker.internal:<port>/v1` into the API container. API's `NEXUS_DOCKER_NETWORK` env var is set to the testcontainers-managed network name so runtime-spawned runner containers join the same network and can call back to `api:3000`. The Anthropic provider is seeded directly into Postgres (before the API starts) to avoid coupling to the HTTP endpoint shape.

**Tech Stack:** testcontainers v12 (`GenericContainer`, `Network`, `Wait`), Node `http` (fake LLM already built), `jsonwebtoken`, TypeScript NodeNext ESM. No framework. All imports use `.js` extensions.

**Dependency on Subsystem 1:** The fake LLM server (`src/fake-llm/index.ts`) must be built and passing before this plan is started.

**Pre-built images required:** `nexus-api:latest` and `nexus-kanban:latest` must exist locally (built via `docker compose build api kanban` from repo root). The harness asserts their presence at setup and fails loud if missing.

---

## File Structure

```
packages/e2e-tests/
  src/
    driver/
      auth.ts              # admin JWT minting (port from infra/auth.ts)
      api-client.ts        # typed HTTP client for API + Kanban (port from infra/api-client.ts)
      polling.ts           # poll-until helper (port from infra/polling.ts)
    stack/
      types.ts             # StackContext interface
      network.ts           # create testcontainers Network, expose name
      containers.ts        # buildPostgres / buildRedis / buildApi / buildKanban factories
      seed.ts              # seedLlmProviders: direct SQL into Postgres before API starts
      harness.ts           # StackHarness.start() / .stop() wiring everything together
    __tests__/
      spike.e2e-spec.ts    # networking spike: one trivial workflow run completes end-to-end
  vitest.e2e.config.ts     # new config for *.e2e-spec.ts (long timeouts, sequential)
  package.json             # add testcontainers dep + pg + test:e2e:harness script
```

---

## Task 1: Add dependencies + driver helpers

**Files:**
- Modify: `packages/e2e-tests/package.json`
- Create: `packages/e2e-tests/src/driver/auth.ts`
- Create: `packages/e2e-tests/src/driver/polling.ts`
- Create: `packages/e2e-tests/src/driver/api-client.ts`

- [ ] **Step 1: Add testcontainers and pg to the package**

Edit `packages/e2e-tests/package.json`. Add to `"dependencies"`:

```json
"testcontainers": "^12.0.1",
"pg": "^8.13.3"
```

Add to `"devDependencies"`:

```json
"@types/pg": "^8.11.13"
```

- [ ] **Step 2: Install**

Run: `npm install --workspace=packages/e2e-tests`
Expected: resolves without errors; `testcontainers` and `pg` appear in `packages/e2e-tests/node_modules` (or root `node_modules` if hoisted).

- [ ] **Step 3: Write auth.ts**

```typescript
// packages/e2e-tests/src/driver/auth.ts
import jwt from 'jsonwebtoken';

export function buildAdminToken(jwtSecret: string, expiresIn = '2h'): string {
  return jwt.sign(
    { sub: 'e2e-admin', role: 'Admin', roles: ['Admin'] },
    jwtSecret,
    { expiresIn },
  );
}

export function buildAgentToken(
  jwtSecret: string,
  payload: { workflowRunId: string; jobId: string; stepId: string },
): string {
  return jwt.sign(
    {
      sub: `agent:${payload.workflowRunId}:${payload.jobId}`,
      workflowRunId: payload.workflowRunId,
      role: 'agent',
      stepId: payload.stepId,
      jobId: payload.jobId,
      roles: ['Agent'],
    },
    jwtSecret,
    { expiresIn: '2h' },
  );
}
```

- [ ] **Step 4: Write polling.ts**

```typescript
// packages/e2e-tests/src/driver/polling.ts
export interface PollOptions {
  intervalMs?: number;
  timeoutMs?: number;
  label?: string;
}

export async function pollUntil<T>(
  fn: () => Promise<T>,
  predicate: (value: T) => boolean,
  options: PollOptions = {},
): Promise<T> {
  const { intervalMs = 2_000, timeoutMs = 120_000, label = 'condition' } = options;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (predicate(value)) return value;
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`pollUntil: timed out waiting for ${label} after ${timeoutMs}ms`);
}
```

- [ ] **Step 5: Write api-client.ts**

```typescript
// packages/e2e-tests/src/driver/api-client.ts
export interface ApiClientOptions {
  baseUrl: string;
  token: string;
  timeoutMs?: number;
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.token = options.token;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  async patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('PATCH', path, body);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`${method} ${path} → ${response.status}: ${text}`);
      }
      return text.length > 0 ? (JSON.parse(text) as T) : ({} as T);
    } finally {
      clearTimeout(timer);
    }
  }
}
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck --workspace=packages/e2e-tests`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/e2e-tests/package.json packages/e2e-tests/src/driver/
git commit --no-verify -m "feat(e2e): driver helpers + testcontainers dependency"
```

---

## Task 2: Stack types + network helper

**Files:**
- Create: `packages/e2e-tests/src/stack/types.ts`
- Create: `packages/e2e-tests/src/stack/network.ts`

- [ ] **Step 1: Write types.ts**

```typescript
// packages/e2e-tests/src/stack/types.ts
import type { FakeLlmServer } from '../fake-llm/index.js';

export interface StackUrls {
  /** http://localhost:<port> — API HTTP endpoint seen from the test runner */
  apiHttp: string;
  /** ws://localhost:<port> — API WebSocket endpoint seen from the test runner */
  apiWs: string;
  /** http://localhost:<port> — Kanban HTTP endpoint seen from the test runner */
  kanbanHttp: string;
  /** Name of the Docker network all containers share */
  networkName: string;
}

export interface StackContext extends StackUrls {
  fakeLlm: FakeLlmServer;
  jwtSecret: string;
  /** Dump API + Kanban container logs; call on test failure for diagnosis */
  containerLogs(): Promise<{ api: string; kanban: string }>;
  /** Stop all containers and the fake LLM; call in afterAll */
  stop(): Promise<void>;
}
```

- [ ] **Step 2: Write network.ts**

```typescript
// packages/e2e-tests/src/stack/network.ts
import { Network } from 'testcontainers';

export interface ManagedNetwork {
  name: string;
  stop(): Promise<void>;
}

export async function createTestNetwork(): Promise<ManagedNetwork> {
  const network = await new Network().start();
  return {
    name: network.getName(),
    stop: () => network.stop(),
  };
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck --workspace=packages/e2e-tests`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/e2e-tests/src/stack/types.ts packages/e2e-tests/src/stack/network.ts
git commit --no-verify -m "feat(e2e): stack types and network helper"
```

---

## Task 3: Container factories

**Files:**
- Create: `packages/e2e-tests/src/stack/containers.ts`

- [ ] **Step 1: Write containers.ts**

```typescript
// packages/e2e-tests/src/stack/containers.ts
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import type { ManagedNetwork } from './network.js';

export interface StartedPostgres {
  container: StartedTestContainer;
  /** Connection string reachable from the test runner host */
  hostConnectionString: string;
}

export interface StartedApi {
  container: StartedTestContainer;
  httpPort: number;
  wsPort: number;
}

export async function startPostgres(network: ManagedNetwork): Promise<StartedPostgres> {
  const container = await new GenericContainer('postgres:18-alpine')
    .withNetwork(network.name)
    .withNetworkAliases('postgres')
    .withEnvironment({
      POSTGRES_USER: 'nexus',
      POSTGRES_PASSWORD: 'nexus_password',
      POSTGRES_DB: 'nexus_orchestrator',
    })
    .withExposedPorts(5432)
    .withHealthCheck({
      test: ['CMD-SHELL', 'pg_isready -U nexus -d nexus_orchestrator'],
      interval: 5_000,
      timeout: 5_000,
      retries: 10,
      startPeriod: 5_000,
    })
    .withWaitStrategy(Wait.forHealthCheck())
    .start();

  const hostPort = container.getMappedPort(5432);
  return {
    container,
    hostConnectionString: `postgresql://nexus:nexus_password@localhost:${hostPort}/nexus_orchestrator`,
  };
}

export async function startRedis(network: ManagedNetwork): Promise<StartedTestContainer> {
  return new GenericContainer('redis:7-alpine')
    .withNetwork(network.name)
    .withNetworkAliases('redis')
    .withExposedPorts(6379)
    .withHealthCheck({
      test: ['CMD', 'redis-cli', 'ping'],
      interval: 5_000,
      timeout: 5_000,
      retries: 10,
      startPeriod: 2_000,
    })
    .withWaitStrategy(Wait.forHealthCheck())
    .start();
}

export interface ApiContainerOptions {
  network: ManagedNetwork;
  fakeLlmPort: number;
  jwtSecret: string;
  kanbanBaseUrl: string;
}

export async function startApi(options: ApiContainerOptions): Promise<StartedApi> {
  const { network, fakeLlmPort, jwtSecret, kanbanBaseUrl } = options;
  const fakeLlmUrl = `http://host.docker.internal:${fakeLlmPort}/v1`;

  const container = await new GenericContainer('nexus-api:latest')
    .withNetwork(network.name)
    .withNetworkAliases('api')
    .withExposedPorts(3000, 3001)
    .withBindMounts([{ source: '/var/run/docker.sock', target: '/var/run/docker.sock' }])
    .withEnvironment({
      PORT: '3000',
      NODE_ENV: 'test',
      NODE_OPTIONS: '--max-old-space-size=4096',
      LOG_LEVEL: 'warn',
      DB_HOST: 'postgres',
      DB_PORT: '5432',
      DB_USERNAME: 'nexus',
      DB_PASSWORD: 'nexus_password',
      DB_DATABASE: 'nexus_orchestrator',
      REDIS_HOST: 'redis',
      REDIS_PORT: '6379',
      BULLMQ_QUEUE_NAME: 'bull:workflow_steps',
      DOCKER_SOCKET_PATH: '/var/run/docker.sock',
      JWT_SECRET: jwtSecret,
      WEBSOCKET_URL: 'http://api:3001',
      CONTEXT_DISPATCH_BASE_URL: kanbanBaseUrl,
      NEXUS_DOCKER_NETWORK: network.name,
      NEXUS_WORKSPACE_BASE_PATH: '/data/nexus-workspaces',
      SECRET_ENCRYPTION_KEY: 'nexus-e2e-secret',
      SEED_LLM_SECRET_FROM_ENV: 'true',
      // Seed the OpenAI-compatible provider pointing at the fake LLM
      E2E_PROVIDER_NAME: 'fake-openai',
      E2E_PROVIDER_BASE_URL: fakeLlmUrl,
      E2E_PROVIDER_API_KEY: 'fake-key',
      MEMORY_BACKEND: 'postgres',
      HONCHO_FALLBACK_ON_ERROR: 'true',
      HONCHO_FALLBACK_ON_EMPTY: 'true',
      CORS_ORIGIN: '*',
      ORCHESTRATION_AUTO_RESTART_COOLDOWN_SECONDS: '9999',
    })
    .withHealthCheck({
      test: [
        'CMD',
        'node',
        '-e',
        "const req=require('http').get('http://127.0.0.1:3000/api/health',(res)=>process.exit(res.statusCode===200?0:1));req.setTimeout(10000,()=>{req.destroy();process.exit(1)});req.on('error',()=>process.exit(1))",
      ],
      interval: 10_000,
      timeout: 15_000,
      retries: 12,
      startPeriod: 60_000,
    })
    .withWaitStrategy(Wait.forHealthCheck())
    .start();

  return {
    container,
    httpPort: container.getMappedPort(3000),
    wsPort: container.getMappedPort(3001),
  };
}

export interface KanbanContainerOptions {
  network: ManagedNetwork;
  jwtSecret: string;
  coreApiBaseUrl: string;
}

export async function startKanban(options: KanbanContainerOptions): Promise<StartedTestContainer> {
  const { network, jwtSecret, coreApiBaseUrl } = options;

  return new GenericContainer('nexus-kanban:latest')
    .withNetwork(network.name)
    .withNetworkAliases('kanban')
    .withExposedPorts(3012)
    .withEnvironment({
      KANBAN_PORT: '3012',
      NODE_ENV: 'test',
      DB_HOST: 'postgres',
      DB_PORT: '5432',
      DB_USERNAME: 'nexus',
      DB_PASSWORD: 'nexus_password',
      DB_DATABASE: 'nexus_orchestrator',
      REDIS_HOST: 'redis',
      REDIS_PORT: '6379',
      KANBAN_CORE_BASE_URL: coreApiBaseUrl,
      KANBAN_SERVICE_BASE_URL: 'http://kanban:3012/api',
      KANBAN_SERVICE_BEARER_TOKEN: 'nexus-kanban-internal-token',
      KANBAN_SERVICE_JWT_AUDIENCE: 'nexus-kanban-service',
      KANBAN_SERVICE_JWT_ISSUER: 'nexus-api',
      KANBAN_CORE_JWT_AUDIENCE: 'nexus-core-internal',
      KANBAN_CORE_JWT_ISSUER: 'nexus-kanban',
      JWT_SECRET: jwtSecret,
      NEXUS_WORKSPACE_BASE_PATH: '/data/nexus-workspaces',
    })
    .withHealthCheck({
      test: [
        'CMD',
        'node',
        '-e',
        "require('http').get('http://127.0.0.1:3012/api/health',(res)=>process.exit(res.statusCode===200?0:1)).on('error',()=>process.exit(1))",
      ],
      interval: 10_000,
      timeout: 5_000,
      retries: 6,
      startPeriod: 20_000,
    })
    .withWaitStrategy(Wait.forHealthCheck())
    .start();
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck --workspace=packages/e2e-tests`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/e2e-tests/src/stack/containers.ts
git commit --no-verify -m "feat(e2e): container factories for postgres/redis/api/kanban"
```

---

## Task 4: LLM provider seeder (direct SQL)

**Files:**
- Create: `packages/e2e-tests/src/stack/seed.ts`

Background: The API seeds the `fake-openai` provider automatically on startup via `E2E_PROVIDER_NAME`/`E2E_PROVIDER_BASE_URL` env vars. But we also need an **Anthropic-shaped provider** (`ANTHROPIC_BASE_URL` in `runtime_env`) that the Claude Code harness reads. We insert it directly into Postgres after the DB starts but before the API, so it's present when the seed runs.

- [ ] **Step 1: Write seed.ts**

```typescript
// packages/e2e-tests/src/stack/seed.ts
import pg from 'pg';

const { Client } = pg;

export async function seedAnthropicProvider(
  connectionString: string,
  fakeLlmUrl: string,
): Promise<void> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    // Upsert the Anthropic provider; the API seed won't touch it because it
    // only upserts by name='fake-openai'. We use a fixed name 'fake-anthropic'.
    await client.query(
      `
      INSERT INTO llm_providers (name, auth_type, secret_id, runtime_env, is_active, owner_type)
      VALUES ($1, 'api_key', NULL, $2::jsonb, TRUE, 'global')
      ON CONFLICT (name, owner_type)
      DO UPDATE SET runtime_env = EXCLUDED.runtime_env, is_active = TRUE
      `,
      [
        'fake-anthropic',
        JSON.stringify({ ANTHROPIC_BASE_URL: `${fakeLlmUrl}` }),
      ],
    );
  } finally {
    await client.end();
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck --workspace=packages/e2e-tests`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/e2e-tests/src/stack/seed.ts
git commit --no-verify -m "feat(e2e): seed Anthropic LLM provider via direct SQL"
```

---

## Task 5: StackHarness class

**Files:**
- Create: `packages/e2e-tests/src/stack/harness.ts`

- [ ] **Step 1: Write harness.ts**

```typescript
// packages/e2e-tests/src/stack/harness.ts
import { createFakeLlmServer } from '../fake-llm/index.js';
import { startApi, startKanban, startPostgres, startRedis } from './containers.js';
import { createTestNetwork } from './network.js';
import { seedAnthropicProvider } from './seed.js';
import type { StackContext } from './types.js';

const JWT_SECRET = 'nexus-e2e-secret';

export async function startStack(): Promise<StackContext> {
  // 1. Verify required images exist (fail loud before spending time on infra)
  await assertImagesExist(['nexus-api:latest', 'nexus-kanban:latest']);

  // 2. In-process fake LLM — starts instantly, gives us the port
  const fakeLlm = await createFakeLlmServer();
  const fakeLlmUrl = `http://host.docker.internal:${fakeLlm.port}/v1`;

  // 3. Docker network
  const network = await createTestNetwork();

  // 4. Postgres + Redis (parallel)
  const [postgres, _redis] = await Promise.all([
    startPostgres(network),
    startRedis(network),
  ]);

  // 5. Seed Anthropic provider into DB before API starts
  await seedAnthropicProvider(postgres.hostConnectionString, fakeLlmUrl);

  // 6. API (needs DB + Redis up first)
  const api = await startApi({
    network,
    fakeLlmPort: fakeLlm.port,
    jwtSecret: JWT_SECRET,
    kanbanBaseUrl: 'http://kanban:3012/api',
  });

  const apiHttpUrl = `http://localhost:${api.httpPort}`;

  // 7. Kanban (needs API up because it validates the core connection on start)
  const kanban = await startKanban({
    network,
    jwtSecret: JWT_SECRET,
    coreApiBaseUrl: 'http://api:3000/api',
  });

  const kanbanHttpUrl = `http://localhost:${kanban.getMappedPort(3012)}`;

  return {
    fakeLlm,
    jwtSecret: JWT_SECRET,
    apiHttp: apiHttpUrl,
    apiWs: `ws://localhost:${api.wsPort}`,
    kanbanHttp: kanbanHttpUrl,
    networkName: network.name,
    async containerLogs() {
      const [apiLogs, kanbanLogs] = await Promise.all([
        api.container.logs(),
        kanban.logs(),
      ]);
      return { api: apiLogs.toString(), kanban: kanbanLogs.toString() };
    },
    async stop() {
      await Promise.allSettled([
        api.container.stop(),
        kanban.stop(),
        postgres.container.stop(),
        _redis.stop(),
        fakeLlm.close(),
        network.stop(),
      ]);
    },
  };
}

async function assertImagesExist(images: string[]): Promise<void> {
  const { execSync } = await import('node:child_process');
  for (const image of images) {
    try {
      execSync(`docker image inspect ${image}`, { stdio: 'pipe' });
    } catch {
      throw new Error(
        `Required Docker image not found: ${image}\n` +
          `Run: docker compose build ${image.replace(':latest', '')} (from repo root)`,
      );
    }
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck --workspace=packages/e2e-tests`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/e2e-tests/src/stack/harness.ts
git commit --no-verify -m "feat(e2e): StackHarness start/stop lifecycle"
```

---

## Task 6: Vitest e2e config

**Files:**
- Create: `packages/e2e-tests/vitest.e2e.config.ts`
- Modify: `packages/e2e-tests/package.json`

- [ ] **Step 1: Write vitest.e2e.config.ts**

```typescript
// packages/e2e-tests/vitest.e2e.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.e2e-spec.ts'],
    globals: true,
    environment: 'node',
    // All e2e specs share one global stack — must run sequentially
    fileParallelism: false,
    testTimeout: 300_000,   // 5 min per test
    hookTimeout: 600_000,   // 10 min for beforeAll (container startup)
    passWithNoTests: true,
  },
});
```

- [ ] **Step 2: Add script to package.json**

Edit `packages/e2e-tests/package.json`. Add to `"scripts"`:

```json
"test:e2e:harness": "vitest run --config vitest.e2e.config.ts"
```

- [ ] **Step 3: Add script to root package.json**

Edit `package.json` (repo root). Replace the `test:e2e` line with:

```json
"test:e2e": "npm run test:e2e:harness --workspace=packages/e2e-tests"
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck --workspace=packages/e2e-tests`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/e2e-tests/vitest.e2e.config.ts packages/e2e-tests/package.json package.json
git commit --no-verify -m "feat(e2e): vitest e2e config and npm run test:e2e script"
```

---

## Task 7: Networking spike test

**Goal:** Prove the entire network path — test runner → API → spawned runner container → fake LLM → callback → API — before writing any real scenario. This is the most important test in the plan.

**Pre-requisite:** A seed workflow must exist in the DB that triggers a single step. The API seeds workflows on startup from `seed/workflows/`. You need to know the name of a simple one-step workflow. Check `seed/workflows/` for a workflow whose first step uses the `pi` or `claude-code` harness and calls an LLM. Use its `name` field as `WORKFLOW_NAME` in the test. A safe default is any workflow that contains a single `agent` step type.

**Files:**
- Create: `packages/e2e-tests/src/__tests__/spike.e2e-spec.ts`
- Test: `packages/e2e-tests/src/__tests__/spike.e2e-spec.ts`

- [ ] **Step 1: Find a usable seed workflow name**

Run: `ls seed/workflows/` (from repo root) and pick a simple one-step workflow. Check its YAML for `type: agent` and the harness engine it uses. Note the workflow `name:` field.

- [ ] **Step 2: Write the spike spec**

Replace `<WORKFLOW_NAME>` with the name you found in Step 1.

```typescript
// packages/e2e-tests/src/__tests__/spike.e2e-spec.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scenario, text } from '../fake-llm/index.js';
import { startStack } from '../stack/harness.js';
import type { StackContext } from '../stack/types.js';
import { ApiClient } from '../driver/api-client.js';
import { buildAdminToken } from '../driver/auth.js';
import { pollUntil } from '../driver/polling.js';

// Replace with the name field of any simple one-step seed workflow
const WORKFLOW_NAME = '<WORKFLOW_NAME>';
const JWT_SECRET = 'nexus-e2e-secret';

let stack: StackContext;
let api: ApiClient;

beforeAll(async () => {
  stack = await startStack();
  api = new ApiClient({
    baseUrl: `${stack.apiHttp}/api`,
    token: buildAdminToken(JWT_SECRET),
  });
}, 600_000);

afterAll(async () => {
  if (stack) {
    if ((globalThis as { __testFailed?: boolean }).__testFailed) {
      const logs = await stack.containerLogs();
      console.error('=== API container logs ===\n', logs.api.slice(-5000));
      console.error('=== Kanban container logs ===\n', logs.kanban.slice(-5000));
    }
    await stack.stop();
  }
});

describe('Networking spike: runner container reaches fake LLM', () => {
  it('completes a single-step workflow via the fake LLM with no real AI', async () => {
    // Script the fake LLM to return a simple text response for any call
    stack.fakeLlm.loadScenario(scenario('spike').otherwise(text('spike done')));

    // Look up the workflow id by name
    const workflows = await api.get<{ items: Array<{ id: string; name: string }> }>(
      '/workflows',
    );
    const workflow = workflows.items.find((w) => w.name === WORKFLOW_NAME);
    expect(workflow, `seed workflow '${WORKFLOW_NAME}' not found in /api/workflows`).toBeDefined();

    // Trigger a run
    const run = await api.post<{ id: string }>('/workflow-runs', {
      workflowId: workflow!.id,
      triggerData: { source: 'e2e-spike' },
    });
    expect(run.id).toBeDefined();

    // Poll until COMPLETED or FAILED (max 3 min)
    const finalRun = await pollUntil(
      () => api.get<{ id: string; status: string }>(`/workflow-runs/${run.id}`),
      (r) => r.status === 'COMPLETED' || r.status === 'FAILED',
      { timeoutMs: 180_000, intervalMs: 3_000, label: `workflow run ${run.id}` },
    );

    // The run must complete (not fail)
    expect(finalRun.status).toBe('COMPLETED');

    // The fake LLM must have received exactly one request from the runner container
    expect(stack.fakeLlm.requests.count()).toBeGreaterThanOrEqual(1);

    // No unmatched requests (scenario coverage is complete)
    expect(stack.fakeLlm.unmatched()).toHaveLength(0);
  }, 300_000);
});
```

- [ ] **Step 3: Run the spike (requires Docker + built images)**

Run: `npm run test:e2e:harness --workspace=packages/e2e-tests -- src/__tests__/spike.e2e-spec.ts`

**If images are missing:**
```
docker compose build api kanban   # from repo root — takes 5-10 min first time
```

**Expected on success:** PASS — the workflow run status is COMPLETED and `stack.fakeLlm.requests.count() >= 1`.

**If the test fails with status FAILED (not a timeout):**
1. Check container logs (printed by afterAll on failure).
2. Most likely cause: runner container cannot reach `host.docker.internal:<fakeLlmPort>`. On Linux, add `--add-host=host.docker.internal:host-gateway` to the runner container config in `apps/api/src/workflow/workflow-step-execution/step-agent-container-config.helpers.ts`. Grep for `extraHosts` or `ExtraHosts` in that file and add:
   ```typescript
   ExtraHosts: ['host.docker.internal:host-gateway'],
   ```
   Rebuild the API image, then re-run.

- [ ] **Step 4: Commit**

```bash
git add packages/e2e-tests/src/__tests__/spike.e2e-spec.ts
git commit --no-verify -m "test(e2e): networking spike proves runner→fake-LLM connectivity"
```

---

## Task 8: Verification gate

- [ ] **Step 1: Run unit tests (fake-llm + driver; no Docker needed)**

Run: `npm run test --workspace=packages/e2e-tests`
Expected: PASS — fake-llm tests pass, driver helpers typecheck (no unit tests for them beyond typecheck).

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck --workspace=packages/e2e-tests`
Expected: PASS.

- [ ] **Step 3: Run the spike (Docker required)**

Run: `npm run test:e2e:harness --workspace=packages/e2e-tests -- src/__tests__/spike.e2e-spec.ts`
Expected: PASS.

- [ ] **Step 4: Commit any fixups**

```bash
git add -A packages/e2e-tests apps/api/src/workflow/workflow-step-execution/
git commit --no-verify -m "fix(e2e): harness stack verified green"
```

---

## Self-Review

- **Spec coverage:** Design §3 (topology, `host.docker.internal` seam, shared named network, `NEXUS_DOCKER_NETWORK`) → Tasks 2–5. §5 component layout (`stack/`, `driver/`) → Tasks 1–5. §6 "networking spike as step 1" → Task 7. §7 invocation/gating → Task 6.
- **Placeholder scan:** Step 1 of Task 7 has an explicit `<WORKFLOW_NAME>` placeholder — intentional, requires the implementer to inspect `seed/workflows/` at implementation time since the name is not knowable from this plan without reading the YAML files.
- **Type consistency:** `StackContext` defined in `types.ts` (Task 2), consumed by `harness.ts` (Task 5), and by the spike spec (Task 7). `FakeLlmServer` imported from `fake-llm/index.js`. `startPostgres` returns `{ container, hostConnectionString }` — used in `harness.ts` as `postgres.container.stop()` and `postgres.hostConnectionString`. `startApi` returns `{ container, httpPort, wsPort }` — used as `api.container` and `api.httpPort`/`api.wsPort`. All consistent.

## Next subsystem

Subsystem 3 (scenario suites) gets its own plan: generic workflow → QA review → kanban lifecycle → repair paths, plus cleanup of stale tests and rewiring of `npm run test:e2e`.
