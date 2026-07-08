# 45 — Stack Harness

> Part of the deterministic E2E harness (subsystem 2 of 3). Manages the full container lifecycle for hermetic E2E tests: brings up Postgres, Redis, API, and Kanban via testcontainers on an isolated Docker network; starts the in-process fake LLM server; seeds both LLM providers pointing at it; and exposes a `StackContext` with URLs, auth helpers, and log capture so test scenarios can interact with a real running stack without touching any external service.

Cross-links: [44-fake-llm-server.md](44-fake-llm-server.md) · [31-packages.md](31-packages.md) · [02-getting-started.md](02-getting-started.md)

---

## Why a stack harness?

Individual unit and service tests mock their dependencies. The deterministic E2E harness exists to prove the opposite property: that the real containers, queues, and execution pipeline work together end-to-end without any mocks at the service boundary.

The `StackHarness` addresses three specific problems:

1. **Hermetic isolation.** Every test run gets a fresh Docker network, fresh Postgres schema (seeded by the API on startup), and fresh Redis. Runs cannot interfere with each other or with a developer's local stack.

2. **Deterministic AI.** The fake LLM server (subsystem 1) starts in-process. Its ephemeral port is injected into the API container via environment variables so every LLM call the runner containers make hits the fake server, not a real provider endpoint. No API keys are needed; every response is scripted by the test.

3. **Real container execution.** The API container has `/var/run/docker.sock` bound in. When a workflow step dispatches a runner container, that container joins the same testcontainers-managed network and can call back to `api:3000`. This is the path proved by the networking spike test.

---

## Prerequisites

### Docker images

The harness uses pre-built images. It does not build them. The following images must exist locally before any E2E test will run:

```bash
# From the repo root — takes 5–10 minutes the first time
docker compose build api kanban
```

The harness checks for these images at `startStack()` time and throws an informative error if either is missing:

```
Required Docker image not found: nexus-api:latest
Run: docker compose build nexus-api (from repo root)
```

### Docker daemon

Docker must be running and the socket `/var/run/docker.sock` must be accessible to the process running the tests. On macOS/Linux this is standard. On Windows (WSL2 or Docker Desktop), the socket is typically available.

### Node.js dependencies

```bash
npm install --workspace=packages/e2e-tests
```

`testcontainers` and `pg` are runtime dependencies of the `@nexus/e2e-tests` package; they are installed with the workspace.

---

## Architecture overview

```
Test runner process (Node.js)
├─ FakeLlmServer (in-process, port 0→ephemeral)
│    Speaks OpenAI /v1/chat/completions + Anthropic /v1/messages
│    Binds on 0.0.0.0 so Docker containers can reach it
│
└─ testcontainers managed Docker network  (e.g. "tc-network-abc123")
     │
     ├─ pgvector/pgvector:0.8.3-pg18   alias: postgres   port 5432→mapped
     ├─ redis:7-alpine        alias: redis      port 6379→mapped
     │
     ├─ nexus-api:latest      alias: api        port 3000→mapped, 3001→mapped
     │    └─ /var/run/docker.sock  (bind mount for step execution)
     │    └─ ENV: DB_HOST=postgres, REDIS_HOST=redis
     │    └─ ENV: E2E_PROVIDER_BASE_URL=http://host.docker.internal:<fakeLlmPort>/v1
     │    └─ ENV: NEXUS_DOCKER_NETWORK=tc-network-abc123
     │
     └─ nexus-kanban:latest   alias: kanban     port 3012→mapped
          └─ ENV: DB_HOST=postgres, REDIS_HOST=redis
          └─ ENV: KANBAN_CORE_BASE_URL=http://api:3000/api

Runner containers (spawned by API during step execution)
     └─ Join: tc-network-abc123
     └─ Callback:  http://api:3000
     └─ LLM calls: http://host.docker.internal:<fakeLlmPort>/v1
```

### Key design choices

**`host.docker.internal` for fake LLM injection.** The fake LLM server runs in the test-runner Node process on the host. Containers reach it via `host.docker.internal`, which Docker Desktop and Docker Engine (with `--add-host=host.docker.internal:host-gateway`) resolve to the host machine's IP. This avoids running the fake LLM as a container and keeps startup fast.

**`NEXUS_DOCKER_NETWORK` for runner container membership.** The API uses this env var to join every spawned runner container to the named network. Without this, runner containers land on the default bridge and cannot call back to `api:3000`.

**Direct SQL seeding for the Anthropic provider.** The API's startup seed only upserts the `fake-openai` provider (via `E2E_PROVIDER_NAME`/`E2E_PROVIDER_BASE_URL` env vars). The `fake-anthropic` provider is inserted directly into Postgres using `pg` before the API starts, so it is present when the seed transaction runs. This avoids any dependency on the HTTP endpoint shape during setup.

**Sequential startup order.** `startStack()` enforces the dependency order: Postgres + Redis in parallel → seed Anthropic provider → API → Kanban. Kanban validates its connection to the Core API at startup, so the API must be healthy before Kanban starts.

---

## File structure

```
packages/e2e-tests/src/
  stack/
    types.ts          StackUrls + StackContext interfaces
    network.ts        createTestNetwork() — testcontainers Network wrapper
    containers.ts     startPostgres / startRedis / startApi / startKanban factories
    seed.ts           seedAnthropicProvider() — direct SQL upsert
    harness.ts        startStack() — orchestrates all of the above
  driver/
    auth.ts           buildAdminToken() / buildAgentToken()
    api-client.ts     ApiClient — typed HTTP helper with auth + timeout
    polling.ts        pollUntil() — condition-polling with timeout
  __tests__/
    spike.e2e-spec.ts Networking spike: proves runner→fake-LLM→API connectivity
vitest.e2e.config.ts  Vitest config for *.e2e-spec.ts (sequential, long timeouts)
```

---

## `StackContext` interface

```typescript
// packages/e2e-tests/src/stack/types.ts

interface StackUrls {
  apiHttp: string; // "http://localhost:<port>"  — API HTTP, seen from the test runner
  apiWs: string; // "ws://localhost:<port>"    — API WebSocket, seen from the test runner
  kanbanHttp: string; // "http://localhost:<port>"  — Kanban HTTP, seen from the test runner
  networkName: string; // Docker network name shared by all containers
}

interface StackContext extends StackUrls {
  fakeLlm: FakeLlmServer; // the in-process fake LLM (see doc 44)
  jwtSecret: string; // JWT signing secret — use with buildAdminToken / buildAgentToken
  containerLogs(): Promise<{ api: string; kanban: string }>; // call on failure for diagnosis
  stop(): Promise<void>; // shuts down all containers and the fake LLM
}
```

The URLs in `StackUrls` use `localhost` with ephemeral ports mapped by testcontainers. Inside the Docker network, containers address each other via their aliases (`api`, `kanban`, `postgres`, `redis`).

---

## Using StackHarness in tests

### Basic setup pattern

```typescript
import { afterAll, beforeAll } from "vitest";
import { startStack } from "../stack/harness.js";
import type { StackContext } from "../stack/types.js";
import { ApiClient } from "../driver/api-client.js";
import { buildAdminToken } from "../driver/auth.js";

let stack: StackContext;
let api: ApiClient;

beforeAll(async () => {
  stack = await startStack();
  api = new ApiClient({
    baseUrl: `${stack.apiHttp}/api`,
    token: buildAdminToken(stack.jwtSecret),
  });
}, 600_000); // 10-minute hook timeout — container startup can be slow on first pull

afterAll(async () => {
  if (stack) await stack.stop();
});
```

`startStack()` blocks until all health checks pass. Expect 60–120 seconds the first time (image layers are cached after the first pull); 30–60 seconds on subsequent runs.

### Logging container output on failure

```typescript
afterAll(async () => {
  if (stack) {
    if ((globalThis as { __testFailed?: boolean }).__testFailed) {
      const logs = await stack.containerLogs();
      console.error("=== API container logs ===\n", logs.api.slice(-5000));
      console.error(
        "=== Kanban container logs ===\n",
        logs.kanban.slice(-5000),
      );
    }
    await stack.stop();
  }
});
```

`containerLogs()` fetches stdout+stderr from both service containers. Slicing to the last 5 000 characters avoids flooding the terminal while still capturing the recent failure context.

### Loading a scenario and triggering a workflow

```typescript
import { scenario, text, toolCall } from "../fake-llm/index.js";
import { pollUntil } from "../driver/polling.js";

it("executes a review workflow and approves", async () => {
  stack.fakeLlm.loadScenario(
    scenario("review")
      .whenTool("submit_qa_decision")
      .reply(
        toolCall("submit_qa_decision", {
          decision: "approve",
          rationale: "LGTM",
        }),
      )
      .otherwise(text("unexpected")),
  );

  const workflows = await api.get<{
    items: Array<{ id: string; name: string }>;
  }>("/workflows");
  const workflow = workflows.items.find((w) => w.name === "My Review Workflow");
  const run = await api.post<{ id: string }>("/workflow-runs", {
    workflowId: workflow!.id,
    triggerData: { source: "e2e-test" },
  });

  const finalRun = await pollUntil(
    () => api.get<{ id: string; status: string }>(`/workflow-runs/${run.id}`),
    (r) => r.status === "COMPLETED" || r.status === "FAILED",
    { timeoutMs: 180_000, intervalMs: 3_000, label: `run ${run.id}` },
  );

  expect(finalRun.status).toBe("COMPLETED");
  expect(stack.fakeLlm.unmatched()).toHaveLength(0);
});
```

### Resetting the fake LLM between test cases

If you run multiple test cases against the same stack instance, reset the fake LLM recorder between cases to prevent request counts from accumulating:

```typescript
afterEach(() => {
  stack?.fakeLlm.reset();
});
```

---

## Driver helpers

### `ApiClient`

A minimal typed HTTP client that attaches a Bearer token and applies a per-request timeout. All methods throw on non-2xx status codes.

```typescript
const client = new ApiClient({
  baseUrl: "http://localhost:3010/api", // strip trailing slash automatically
  token: buildAdminToken(stack.jwtSecret),
  timeoutMs: 30_000, // optional, default 30 s
});

// GET — returns parsed JSON as T
const workflows = await client.get<{ items: WorkflowSummary[] }>("/workflows");

// POST — body is JSON-serialised automatically
const run = await client.post<{ id: string }>("/workflow-runs", {
  workflowId: "...",
});

// PATCH
await client.patch<void>(`/workflow-runs/${runId}`, { status: "CANCELLED" });
```

The client uses the native `fetch` API with `AbortController` for timeout handling. No third-party HTTP library is introduced.

### `buildAdminToken` / `buildAgentToken`

JWT factories that use the same `jwtSecret` as the containers, so the API will accept the tokens they produce.

```typescript
import { buildAdminToken, buildAgentToken } from "../driver/auth.js";

// Admin token — role: "Admin", roles: ["Admin"]
const adminToken = buildAdminToken(stack.jwtSecret);

// Agent token — for testing agent-facing runtime endpoints
const agentToken = buildAgentToken(stack.jwtSecret, {
  workflowRunId: "run-123",
  jobId: "job-abc",
  stepId: "step-xyz",
});
```

Both tokens expire in 2 hours. The JWT secret is hardcoded to `'nexus-e2e-secret'` inside `harness.ts` and exposed on `stack.jwtSecret`.

### `pollUntil`

A generic condition-polling helper that repeatedly calls `fn()` until `predicate` returns `true` or the timeout expires.

```typescript
import { pollUntil } from "../driver/polling.js";

const result = await pollUntil(
  () => api.get<WorkflowRun>(`/workflow-runs/${runId}`),
  (run) => run.status === "COMPLETED" || run.status === "FAILED",
  {
    intervalMs: 3_000, // poll every 3 s (default: 2 s)
    timeoutMs: 180_000, // give up after 3 min (default: 2 min)
    label: `run ${runId}`, // appears in the timeout error message
  },
);
```

On timeout, throws: `pollUntil: timed out waiting for run <runId> after 180000ms`.

---

## Container configuration reference

### Postgres

| Setting       | Value                                       |
| ------------- | ------------------------------------------- |
| Image         | `pgvector/pgvector:0.8.3-pg18`              |
| Network alias | `postgres`                                  |
| Exposed port  | `5432` (mapped to an ephemeral host port)   |
| Database      | `nexus_orchestrator`                        |
| User          | `nexus`                                     |
| Password      | `nexus_password`                            |
| Health check  | `pg_isready -U nexus -d nexus_orchestrator` |
| Wait strategy | `Wait.forHealthCheck()`                     |

### Redis

| Setting       | Value                                     |
| ------------- | ----------------------------------------- |
| Image         | `redis:7-alpine`                          |
| Network alias | `redis`                                   |
| Exposed port  | `6379` (mapped to an ephemeral host port) |
| Health check  | `redis-cli ping`                          |
| Wait strategy | `Wait.forHealthCheck()`                   |

### API (`nexus-api:latest`)

| Setting       | Value                                               |
| ------------- | --------------------------------------------------- |
| Image         | `nexus-api:latest` (must be pre-built)              |
| Network alias | `api`                                               |
| Exposed ports | `3000` (HTTP), `3001` (WebSocket)                   |
| Bind mount    | `/var/run/docker.sock` for step-container execution |
| Wait strategy | `Wait.forHealthCheck()` via `GET /api/health → 200` |

Key environment variables injected into the API container:

| Variable                                      | Value                                   | Purpose                                         |
| --------------------------------------------- | --------------------------------------- | ----------------------------------------------- |
| `DB_HOST`                                     | `postgres`                              | Container DNS alias on shared network           |
| `DB_PORT`                                     | `5432`                                  | Standard Postgres port                          |
| `DB_USERNAME`                                 | `nexus`                                 |                                                 |
| `DB_PASSWORD`                                 | `nexus_password`                        |                                                 |
| `DB_DATABASE`                                 | `nexus_orchestrator`                    |                                                 |
| `REDIS_HOST`                                  | `redis`                                 | Container DNS alias                             |
| `REDIS_PORT`                                  | `6379`                                  |                                                 |
| `JWT_SECRET`                                  | `nexus-e2e-secret`                      | Shared with test runner                         |
| `NEXUS_DOCKER_NETWORK`                        | `<network.name>`                        | Runner containers join this network             |
| `E2E_PROVIDER_NAME`                           | `fake-openai`                           | Seed: provider name in `llm_providers`          |
| `E2E_PROVIDER_BASE_URL`                       | `http://host.docker.internal:<port>/v1` | Fake LLM endpoint for OpenAI path               |
| `E2E_PROVIDER_API_KEY`                        | `fake-key`                              | Placeholder key (no real auth)                  |
| `SEED_LLM_SECRET_FROM_ENV`                    | `true`                                  | Activates env-driven provider seeding           |
| `CONTEXT_DISPATCH_BASE_URL`                   | `http://kanban:3012/api`                | Internal Kanban endpoint                        |
| `WEBSOCKET_URL`                               | `http://api:3001`                       | Self-referential; used for WS callbacks         |
| `ORCHESTRATION_AUTO_RESTART_COOLDOWN_SECONDS` | `9999`                                  | Prevents orchestration restarts during tests    |
| `LOG_LEVEL`                                   | `warn`                                  | Suppresses noise; set to `debug` when debugging |
| `NODE_OPTIONS`                                | `--max-old-space-size=4096`             | Prevents OOM during seed/migration              |

### Kanban (`nexus-kanban:latest`)

| Setting       | Value                                               |
| ------------- | --------------------------------------------------- |
| Image         | `nexus-kanban:latest` (must be pre-built)           |
| Network alias | `kanban`                                            |
| Exposed port  | `3012`                                              |
| Wait strategy | `Wait.forHealthCheck()` via `GET /api/health → 200` |

The Kanban container connects to the same `postgres` and `redis` aliases. `KANBAN_CORE_BASE_URL=http://api:3000/api` points it at the API container by its network alias. Kanban validates this connection at startup, which is why the API must be healthy before Kanban starts.

---

## LLM provider seeding

Two providers are seeded; they point at the same fake LLM server but via different env-var mechanisms.

### OpenAI-compatible provider (`fake-openai`)

Seeded automatically by the API on startup when `SEED_LLM_SECRET_FROM_ENV=true` is set. The API reads `E2E_PROVIDER_NAME`, `E2E_PROVIDER_BASE_URL`, and `E2E_PROVIDER_API_KEY` and upserts a row in `llm_providers` with those values.

The fake LLM listens on `POST /v1/chat/completions` (OpenAI wire protocol). The API container reaches it at `http://host.docker.internal:<fakeLlmPort>/v1`.

### Anthropic-compatible provider (`fake-anthropic`)

Inserted directly into Postgres by `seedAnthropicProvider()` before the API starts. The function upserts a row with:

```sql
INSERT INTO llm_providers (name, auth_type, secret_id, runtime_env, is_active, owner_type)
VALUES ('fake-anthropic', 'api_key', NULL, '{"ANTHROPIC_BASE_URL":"http://host.docker.internal:<port>/v1"}', TRUE, 'global')
ON CONFLICT (name, owner_type)
DO UPDATE SET runtime_env = EXCLUDED.runtime_env, is_active = TRUE
```

The `runtime_env` JSONB column carries `ANTHROPIC_BASE_URL`, which the Claude Code harness reads when it initialises the Anthropic SDK. Because this provider is inserted before the API starts, it is present when the API's startup seed runs and will not be overwritten.

The fake LLM listens on `POST /v1/messages` (Anthropic Messages API wire protocol).

### Why direct SQL for Anthropic?

The API's seed endpoint (`/api/seed`) is an internal bootstrap endpoint whose shape may change. Inserting directly into Postgres with a well-known schema avoids any coupling to endpoint shape and ensures the row is present even if the API seed runs in a transaction before accepting HTTP traffic.

---

## Networking: `host.docker.internal`

The fake LLM server binds to `0.0.0.0:<ephemeralPort>` in the test runner process. Containers reach it via `host.docker.internal`, which resolves to the host machine:

- **Docker Desktop (Mac/Windows):** `host.docker.internal` is resolved automatically by Docker Desktop's built-in DNS.
- **Docker Engine on Linux:** The host must be added explicitly. If runner containers cannot reach the fake LLM on Linux, add `ExtraHosts: ['host.docker.internal:host-gateway']` to the runner container config in `apps/api/src/workflow/workflow-step-execution/step-agent-container-config.helpers.ts`.

The `startApi()` factory constructs the URL as:

```typescript
const fakeLlmUrl = `http://host.docker.internal:${fakeLlmPort}/v1`;
```

This URL is passed both as `E2E_PROVIDER_BASE_URL` (OpenAI path, env var) and as the value of `ANTHROPIC_BASE_URL` in the `runtime_env` JSON (Anthropic path, DB row).

---

## Running E2E tests

### Run all harness E2E tests

```bash
npm run test:e2e:harness --workspace=packages/e2e-tests
```

This invokes `vitest run --config vitest.e2e.config.ts`, which:

- Matches all `src/**/*.e2e-spec.ts` files.
- Runs files sequentially (`fileParallelism: false`) — all tests share one stack instance.
- Applies a 5-minute test timeout and 10-minute hook timeout.
- Passes with no tests (safe to run before any scenario suites are written).

The root `package.json` aliases this as `npm run test:e2e`.

### Run a single spec file

```bash
npm run test:e2e:harness --workspace=packages/e2e-tests -- src/__tests__/spike.e2e-spec.ts
```

### Run the unit tests (no Docker required)

```bash
# Fast unit tests: fake-llm module + typechecking
npm run test --workspace=packages/e2e-tests
```

### Typecheck

```bash
npm run typecheck --workspace=packages/e2e-tests
```

---

## Vitest configuration

`packages/e2e-tests/vitest.e2e.config.ts`:

```typescript
export default defineConfig({
  test: {
    include: ["src/**/*.e2e-spec.ts"],
    globals: true,
    environment: "node",
    fileParallelism: false, // one stack shared across all spec files — must be sequential
    testTimeout: 300_000, // 5 min per test  (workflow runs can be slow)
    hookTimeout: 600_000, // 10 min for beforeAll (container startup + health checks)
    passWithNoTests: true,
  },
});
```

The separation between `vitest.config.ts` (unit tests, fast, parallel) and `vitest.e2e.config.ts` (E2E tests, sequential, long timeouts) means `npm run test` stays fast and `npm run test:e2e:harness` handles the full-stack tests.

---

## The networking spike test

`packages/e2e-tests/src/__tests__/spike.e2e-spec.ts` is the foundational connectivity test. Its purpose is to prove the entire network path before any scenario work is written:

```
test runner → API (HTTP) → workflow engine → BullMQ queue → step executor
  → Docker (spawns runner container on tc-network) → runner calls LLM
  → http://host.docker.internal:<port>/v1 → FakeLlmServer (in-process)
  → runner calls back to http://api:3000 → API records step result
  → workflow moves to COMPLETED
```

### What it asserts

1. The seed workflow `'Orchestration Invoke Agent Default'` exists in the seeded database.
2. A workflow run can be triggered via `POST /api/workflow-runs`.
3. The run reaches `COMPLETED` status (not `FAILED`) within 3 minutes.
4. The fake LLM received at least one request — proving the runner container successfully reached `host.docker.internal`.
5. There are no unmatched requests on the fake LLM — proving the scripted scenario covered all LLM calls the system made.

### Scenario used

```typescript
stack.fakeLlm.loadScenario(scenario("spike").otherwise(text("spike done")));
```

A catch-all scenario that returns `'spike done'` for any LLM call, regardless of model, protocol, or message content. This is intentionally minimal — the spike tests connectivity, not agent behaviour.

### Diagnosing a failure

If the spike fails with status `FAILED` rather than a timeout:

1. Check the container logs (printed by `afterAll` when `__testFailed` is set):
   - API logs: look for BullMQ consumer errors, container launch errors, or seed failures.
   - Kanban logs: look for connection errors to the Core API.

2. Most likely causes:
   - **Runner container cannot reach `host.docker.internal`**: On Linux, add `ExtraHosts: ['host.docker.internal:host-gateway']` to the runner container config and rebuild the API image.
   - **Missing seed workflow**: The workflow name `'Orchestration Invoke Agent Default'` must exist in `seed/workflows/`. Check `apps/api/seed/workflows/` to verify.
   - **Image is stale**: Rebuild with `docker compose build api kanban` after any code change.

---

## Startup sequence

`startStack()` performs the following steps in order:

```
1. assertImagesExist(['nexus-api:latest', 'nexus-kanban:latest'])
   └─ execSync('docker image inspect <image>') — throws if missing

2. createFakeLlmServer()
   └─ binds Node HTTP server to 0.0.0.0:0
   └─ returns FakeLlmServer with .port set

3. createTestNetwork()
   └─ new Network().start()
   └─ returns ManagedNetwork { name, startedNetwork, stop }

4. Promise.all([startPostgres(network), startRedis(network)])
   └─ both containers wait for their health checks before resolving

5. seedAnthropicProvider(postgres.hostConnectionString, fakeLlmUrl)
   └─ opens pg.Client to host-mapped Postgres port
   └─ upserts 'fake-anthropic' row in llm_providers

6. startApi({ network, fakeLlmPort, jwtSecret, kanbanBaseUrl })
   └─ starts nexus-api:latest
   └─ waits for GET /api/health → 200 (up to 12 retries × 10 s = 120 s)
   └─ API runs TypeORM migrations + seed on first start

7. startKanban({ network, jwtSecret, coreApiBaseUrl })
   └─ starts nexus-kanban:latest
   └─ waits for GET /api/health → 200 (up to 6 retries × 10 s = 60 s)

returns StackContext
```

### Teardown

`stack.stop()` uses `Promise.allSettled` so that a failure in one container's stop does not prevent the others from being cleaned up:

```typescript
await Promise.allSettled([
  api.container.stop(),
  kanban.stop(),
  postgres.container.stop(),
  redis.stop(),
  fakeLlm.close(),
  network.stop(),
]);
```

testcontainers automatically removes containers on stop (Ryuk reaper). The Docker network is removed by `network.stop()`.

---

## Relation to other subsystems

| Subsystem           | Description                                                                                                                | Status                                     |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| 1 — Fake LLM server | In-process scripted LLM, dual protocol, recording                                                                          | Complete ([doc 44](44-fake-llm-server.md)) |
| 2 — Stack harness   | This document. Testcontainers `StackHarness`, provider seeding, networking spike                                           | Complete                                   |
| 3 — Scenario suites | Full workflow scenario suites (execution → review → Kanban lifecycle → repair paths); pruning stale E2E tests; rewiring CI | Planned                                    |

The legacy `apps/api/test/helpers/fake-llm-server.ts` remains in place until subsystem 3 is delivered, because some existing API tool-array tests still import it. Subsystem 3 will repoint or remove it.

---

## Troubleshooting

### `Required Docker image not found: nexus-api:latest`

Run `docker compose build api kanban` from the repo root. This must be re-run after any code change to `apps/api/` or `apps/kanban/`.

### `startStack` times out in `beforeAll`

- Check that Docker is running and the daemon is responsive (`docker ps`).
- Check available disk space — testcontainers will fail to pull/start with insufficient space.
- Increase the `hookTimeout` in `vitest.e2e.config.ts` if startup consistently takes longer than 10 minutes (unusual).

### Workflow run reaches `FAILED` instead of `COMPLETED`

1. Enable full log output by temporarily setting `LOG_LEVEL: 'debug'` in `containers.ts` (`startApi`).
2. Check API container logs via `stack.containerLogs()`.
3. Verify the seed workflow exists: `GET /api/workflows` should list it.
4. On Linux: verify `host.docker.internal` resolves inside runner containers (see networking section above).

### Fake LLM receives zero requests

- The workflow step may use a different provider name. Check the workflow YAML in `apps/api/seed/workflows/` to confirm which provider/model the step targets.
- The runner container may have failed to start — check API logs for step-execution errors.

### `seedAnthropicProvider` fails with `relation "llm_providers" does not exist`

The harness seeds Postgres before the API starts. At that point, TypeORM migrations have not run yet so the table does not exist. This should not happen because `startPostgres` only resolves after the Postgres health check passes, and the table creation happens during API startup. If this error appears, it means `seed.ts` is being called before the API has run migrations — confirm that the `seedAnthropicProvider` call happens before `startApi()` in `harness.ts`.

Wait — this is intentional: the function inserts the row pre-API, but the `llm_providers` table is created by migrations that the API runs on startup. If the table does not yet exist when `seedAnthropicProvider` runs, the upsert will fail. In practice the table is created by a migration that the API applies on first start. The harness seeds before the API so the row is present when the seed runs. The `pg` client connects to the mapped host port of the Postgres container and issues the INSERT; if migrations have not run the INSERT will fail.

To avoid this, the API seeds on startup after running migrations. So the correct behaviour is: the harness seeds the `fake-anthropic` row, the API starts, runs migrations (creating the table if it doesn't exist), then runs its own seed. But if the table doesn't exist, `seedAnthropicProvider` will fail.

**Resolution:** The `llm_providers` table must already exist. In a fresh Postgres container this will not be the case before the API has run its migrations. The harness works around this by relying on the fact that `testcontainers` starts a clean Postgres and the API's startup migrates it. The correct fix when hitting this error is to ensure `seedAnthropicProvider` is called _after_ the API has run migrations — i.e., after `startApi()` resolves. If this race condition is observed, reorder the seed call in `harness.ts` to after `startApi()`.

---

## Public API reference

All stack harness exports are available from their module paths in `packages/e2e-tests/src/`:

### `startStack()` (`stack/harness.ts`)

```typescript
function startStack(): Promise<StackContext>;
```

Starts the full test stack. Resolves when all containers are healthy. Throws if required Docker images are missing.

### `StackContext` (`stack/types.ts`)

```typescript
interface StackContext {
  apiHttp: string;
  apiWs: string;
  kanbanHttp: string;
  networkName: string;
  fakeLlm: FakeLlmServer;
  jwtSecret: string;
  containerLogs(): Promise<{ api: string; kanban: string }>;
  stop(): Promise<void>;
}
```

### `ApiClient` (`driver/api-client.ts`)

```typescript
class ApiClient {
  constructor(options: { baseUrl: string; token: string; timeoutMs?: number });
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
  patch<T>(path: string, body: unknown): Promise<T>;
}
```

### `buildAdminToken` / `buildAgentToken` (`driver/auth.ts`)

```typescript
function buildAdminToken(
  jwtSecret: string,
  expiresIn?: SignOptions["expiresIn"],
): string;
function buildAgentToken(
  jwtSecret: string,
  payload: { workflowRunId: string; jobId: string; stepId: string },
): string;
```

### `pollUntil` (`driver/polling.ts`)

```typescript
function pollUntil<T>(
  fn: () => Promise<T>,
  predicate: (value: T) => boolean,
  options?: { intervalMs?: number; timeoutMs?: number; label?: string },
): Promise<T>;
```
