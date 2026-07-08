# 46 — Deterministic E2E Scenario Suites

> Part of the deterministic E2E harness (subsystem 3 of 3). Provides four end-to-end scenario suites that exercise the full Nexus stack — API, queues, runner containers, Kanban — using scripted fake LLM responses and no real AI inference. Each scenario starts from a known Kanban state, drives it through status transitions, and asserts the final work-item status and workflow run outcome.

Cross-links: [44-fake-llm-server.md](44-fake-llm-server.md) · [45-stack-harness.md](45-stack-harness.md) · [22-kanban-lifecycle.md](22-kanban-lifecycle.md) · [10-workflow-repair.md](10-workflow-repair.md)

---

## Architecture overview

```
vitest.e2e.config.ts
  └─ globalSetup: global-setup.ts  ← starts stack once, writes context to tmp file
  └─ teardown: global-teardown.ts  ← stops stack after all specs

  ┌───────────────────────────────────┐
  │  Test worker process (each spec)  │
  │  readStackContext() → tmp file    │
  │  POST fakeLlmControlPort/scenario │
  │  ApiClient / KanbanClient calls   │
  └───────────────────────────────────┘
         ↕ HTTP
  ┌──────────────────────────┐
  │  globalSetup process     │
  │  StackContext + FakeLLM  │
  │  Control server :port+1  │ ← POST /scenario, POST /reset
  └──────────────────────────┘
```

The key design challenge is that Vitest's `globalSetup` runs in a separate Node.js process from the test workers. The `FakeLlmServer` instance is therefore **not directly accessible** from specs. The harness solves this with a tiny HTTP **control server** that listens on `fakeLlmPort + 1` and accepts `POST /scenario` to load a new scenario and `POST /reset` to clear recorded requests.

---

## File structure

```
packages/e2e-tests/src/
  scenarios/
    setup/
      global-setup.ts           # startStack + control server; writes context JSON
      global-teardown.ts        # stops the teardown fn returned by global-setup
      stack-context-file.ts     # SerializedStackContext serialise/deserialise
    generic-workflow.e2e-spec.ts
    qa-review.e2e-spec.ts
    kanban-lifecycle.e2e-spec.ts
    repair-paths.e2e-spec.ts
  driver/
    kanban-client.ts            # KanbanClient — project + work item helpers
    api-client.ts               # ApiClient — generic typed HTTP client
    auth.ts                     # buildAdminToken / buildAgentToken
    polling.ts                  # pollUntil
  vitest.e2e.config.ts          # globalSetup, long timeouts, sequential execution
```

---

## Global setup lifecycle

### `global-setup.ts`

Called once before any spec file runs. Starts the full container stack via `startStack()` (subsystem 2), then starts the control server:

```typescript
export default async function setup(): Promise<() => Promise<void>> {
  const stack = await startStack();
  const controlServer = await startControlServer(stack.fakeLlm);

  writeStackContext({
    apiHttp: stack.apiHttp,
    kanbanHttp: stack.kanbanHttp,
    jwtSecret: stack.jwtSecret,
    fakeLlmPort: stack.fakeLlm.port,
    fakeLlmControlPort: controlServer.port, // fakeLlmPort + 1
    // …
  });

  return async () => {
    await controlServer.close();
    await stack.stop();
  };
}
```

The returned function is the teardown token. Vitest passes it to `global-teardown.ts`.

### `SerializedStackContext`

All spec files call `readStackContext()` at module load time to get the live URLs:

```typescript
// At top of every spec file
const ctx = readStackContext();

beforeAll(() => {
  api = new ApiClient({
    baseUrl: `${ctx.apiHttp}/api`,
    token: buildAdminToken(ctx.jwtSecret),
  });
  kanban = new KanbanClient(ctx.kanbanHttp, token);
});
```

The context JSON is written to `os.tmpdir()/nexus-e2e-stack-context.json` and is valid for the duration of the test run.

---

## The control server

The control server runs at `fakeLlmControlPort` (= `fakeLlmPort + 1`) and is the bridge between test workers and the `FakeLlmServer` instance in the setup process.

| Endpoint         | Body                      | Effect                                                               |
| ---------------- | ------------------------- | -------------------------------------------------------------------- |
| `POST /scenario` | `{ name, rules: Rule[] }` | Calls `fakeLlm.loadScenario(...)`                                    |
| `POST /reset`    | none                      | Calls `fakeLlm.reset()` — clears recorded requests and unmatched log |

Specs use a thin helper to load scenarios:

```typescript
async function loadScenario(name: string, rules: Rule[]): Promise<void> {
  await fetch(`http://127.0.0.1:${ctx.fakeLlmControlPort}/scenario`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, rules }),
  });
}
```

The `Rule[]` format matches `packages/e2e-tests/src/fake-llm/types.ts` exactly — use the `scenario()` builder locally in the spec to construct rules, then call `.build().rules` to extract them for the control POST.

---

## Vitest configuration

`vitest.e2e.config.ts`:

```typescript
export default defineConfig({
  test: {
    include: [
      "src/scenarios/**/*.e2e-spec.ts",
      "src/__tests__/**/*.e2e-spec.ts",
    ],
    globals: true,
    environment: "node",
    fileParallelism: false, // must be sequential — shared stack state
    testTimeout: 300_000, // 5 min per test
    hookTimeout: 600_000, // 10 min for beforeAll (container startup)
    teardownTimeout: 60_000,
    passWithNoTests: true,
    globalSetup: ["src/scenarios/setup/global-setup.ts"],
  },
});
```

`fileParallelism: false` is required. All specs share one stack instance; parallel spec workers would race on Kanban state.

---

## Driver helpers

### `ApiClient`

A thin `fetch` wrapper with `Authorization: Bearer <token>` injected on every request:

```typescript
const api = new ApiClient({ baseUrl: "http://localhost:3010/api", token });

const run = await api.post<{ success: boolean; data: { runId: string } }>(
  `/workflows/${workflowId}/execute`,
  { trigger_data: { prompt: "hello" } },
);
```

Throws on non-2xx responses. Respects an optional `timeoutMs` (default 30 s).

### `KanbanClient`

Wraps `ApiClient` with Kanban-domain operations:

```typescript
const kanban = new KanbanClient(ctx.kanbanHttp, token);

const project = await kanban.createProject("my-project");
const workItem = await kanban.createWorkItem(project.id, "implement feature X");
await kanban.transitionWorkItem(project.id, workItem.id, "in-progress");
const item = await kanban.getWorkItem(project.id, workItem.id);
```

### `pollUntil`

Polls an async function until a predicate holds or a timeout fires:

```typescript
const finalRun = await pollUntil(
  () => api.get<{ status: string }>(`/workflows/runs/${runId}`),
  (r) => r.status === "COMPLETED" || r.status === "FAILED",
  { timeoutMs: 120_000, intervalMs: 3_000, label: "run completes" },
);
```

### `buildAdminToken` / `buildAgentToken`

Mint signed JWTs for testing:

```typescript
const adminToken = buildAdminToken(ctx.jwtSecret); // role: Admin
const agentToken = buildAgentToken(ctx.jwtSecret, {
  workflowRunId,
  jobId,
  stepId, // role: Agent
});
```

---

## The four scenario suites

### 1. Generic workflow (`generic-workflow.e2e-spec.ts`)

**What it tests:** A single-step `execution` tier workflow triggered manually. If `E2E Test Generic` does not exist in the DB it is created via `POST /api/workflows` with an inline YAML definition. Two describe blocks verify:

- A plain text response → run reaches `COMPLETED`
- A tool-call response → run reaches `COMPLETED`

The fake LLM scenario is loaded via the control server before each test. Because this is the entry-point spec, it also creates the generic workflow that `repair-paths.e2e-spec.ts` depends on.

**Key assertions:** `run.status === 'COMPLETED'`.

---

### 2. QA review (`qa-review.e2e-spec.ts`)

**What it tests:** The `Work Item In-Review Default Code Review` workflow that fires when a Kanban work item transitions to `in-review`. Two paths:

| Test        | LLM returns                              | Expected outcome                             |
| ----------- | ---------------------------------------- | -------------------------------------------- |
| Accept path | `set_job_output` with `decision: accept` | Work item → `ready-to-merge`                 |
| Reject path | `set_job_output` with `decision: reject` | Work item stays `in-review` or `in-progress` |

**Setup pattern:**

```typescript
// 1. Load scenario via control server
await loadScenario("qa-accept", [
  {
    match: { hasTool: "set_job_output" },
    respond: [
      toolCall("set_job_output", { decision: "accept", summary: "LGTM" }),
    ],
  },
]);

// 2. Create work item and transition to in-review
const project = await kanban.createProject("qa-test");
const workItem = await kanban.createWorkItem(project.id, "e2e: qa review");
await kanban.transitionWorkItem(project.id, workItem.id, "in-review");

// 3. Poll for the triggered workflow run
const run = await waitForWorkflowTriggeredByWorkItem(project.id, workItem.id);

// 4. Wait for completion
await waitForRunFinalStatus(run.id);

// 5. Assert Kanban state
const finalItem = await kanban.getWorkItem(project.id, workItem.id);
expect(finalItem.status).toBe("ready-to-merge");
```

---

### 3. Kanban lifecycle (`kanban-lifecycle.e2e-spec.ts`)

**What it tests:** The full pipeline: `todo → in-progress → in-review → ready-to-merge → done`. Each status transition fires a seeded workflow; the fake LLM scripts each step to complete with the minimum required tool call.

**Workflow-to-step mapping:**

| Transition       | Workflow                                           | LLM must return                          |
| ---------------- | -------------------------------------------------- | ---------------------------------------- |
| → in-progress    | `Work Item In-Progress Default Implementation`     | `step_complete` tool call                |
| → in-review      | `Work Item In-Review Default Code Review`          | `set_job_output` with `decision: accept` |
| → ready-to-merge | `Work Item Ready-to-Merge Default Auto-Merge`      | `step_complete` or text                  |
| → done           | No workflow (direct transition or post-merge spec) | N/A                                      |

The test waits for each workflow run to complete before polling for the next status, using `waitForWorkflowByWorkItem(workItemId, afterRunId?)` to detect the next run after the one already seen.

**Duration:** Up to 10 minutes (each container step takes 30–60 s). The test timeout is 600 s.

---

### 4. Repair paths (`repair-paths.e2e-spec.ts`)

**What it tests:** The `WorkflowRepairModule` failure classification and repair delegation audit trail.

| Test            | Setup                                               | Expected outcome                                                         |
| --------------- | --------------------------------------------------- | ------------------------------------------------------------------------ |
| Step failure    | Load empty scenario (no rules → unmatched sentinel) | Run `status === 'FAILED'` + `step.failed` event in ledger                |
| Repair dispatch | Same empty scenario                                 | `workflow.repair-delegation.decided` event appears in ledger within 60 s |

**Important note:** The repair system dispatches to internal doctor/sysadmin executors, not a new workflow run with `metadata.isRepair`. The assertion targets the event ledger (`GET /api/workflows/runs/:id/events`), which is always populated regardless of whether repair dispatch is enabled by the `workflow_repair_delegation_enabled` system setting.

---

## Running the suites

### Unit tests (no Docker)

```bash
npm run test --workspace=packages/e2e-tests
```

Runs fake-llm unit tests and typechecks. No containers needed.

### Full e2e suite (Docker required)

```bash
# Prerequisites: build images once
docker compose build api kanban   # from repo root, ~5–10 min first time

# Run all scenarios
npm run test:e2e                   # from repo root
# or directly:
npm run test:e2e:harness --workspace=packages/e2e-tests
```

### Single spec

```bash
npm run test:e2e:harness --workspace=packages/e2e-tests -- src/scenarios/generic-workflow.e2e-spec.ts
```

### Networking spike (fastest sanity check)

```bash
npm run test:e2e:harness --workspace=packages/e2e-tests -- src/__tests__/spike.e2e-spec.ts
```

---

## Writing new scenarios

1. **Create `src/scenarios/my-feature.e2e-spec.ts`**  
   It matches the glob in `vitest.e2e.config.ts` automatically.

2. **Read the context at module load time:**

   ```typescript
   const ctx = readStackContext();
   let api: ApiClient;
   beforeAll(() => {
     api = new ApiClient({
       baseUrl: `${ctx.apiHttp}/api`,
       token: buildAdminToken(ctx.jwtSecret),
     });
   });
   ```

3. **Load a scenario via the control server before your test:**

   ```typescript
   await fetch(`http://127.0.0.1:${ctx.fakeLlmControlPort}/scenario`, {
     method: "POST",
     headers: { "content-type": "application/json" },
     body: JSON.stringify({
       name: "my-scenario",
       rules: [
         {
           match: { hasTool: "some_tool" },
           respond: [
             { kind: "tool_call", toolName: "some_tool", arguments: {} },
           ],
         },
         { match: {}, respond: [{ kind: "text", text: "done" }] },
       ],
     }),
   });
   ```

4. **Use `pollUntil` for async state assertions.** Never `setTimeout` — the system is fast when healthy and slow when broken; polling with a timeout gives the right behaviour in both cases.

5. **Set per-test timeouts** on `it(...)` calls for tests that touch containers (min 120 s, lifecycle test 600 s).

---

## Debugging failures

When a test fails, the `afterAll` in the spec captures container logs:

```typescript
afterAll(async () => {
  if (stack && testFailed) {
    const logs = await stack.containerLogs();
    console.error("=== API logs ===\n", logs.api.slice(-5_000));
    console.error("=== Kanban logs ===\n", logs.kanban.slice(-5_000));
  }
  await stack?.stop();
});
```

Common failure modes:

| Symptom                                                   | Likely cause                                                                                        |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `pollUntil timed out waiting for …`                       | Container startup slow or crashed — check Docker resources                                          |
| `run.status === 'FAILED'`                                 | LLM scenario not loaded or wrong rule — check control server response                               |
| `work item status === 'in-review'` (not `ready-to-merge`) | `set_job_output` rule missing or tool name typo in scenario                                         |
| `repair-delegation.decided` event missing                 | Repair module not running or `workflow_repair_delegation_enabled = false` (OK for audit event test) |
| Auth 403 on `/me/permissions`                             | Admin user not seeded in DB — check `seed.ts` `seedAdminUser`                                       |

---

## Stale test cleanup (what was removed)

As part of shipping subsystem 3, the following legacy real-LLM test infrastructure was deleted:

| Path                                                | Reason                                                 |
| --------------------------------------------------- | ------------------------------------------------------ |
| `packages/e2e-tests/src/kanban-lifecycle/`          | Replaced by `scenarios/kanban-lifecycle.e2e-spec.ts`   |
| `packages/e2e-tests/src/review-workflow/`           | Replaced by `scenarios/qa-review.e2e-spec.ts`          |
| `packages/e2e-tests/src/workflow-execution/`        | Replaced by `scenarios/generic-workflow.e2e-spec.ts`   |
| `packages/e2e-tests/src/split-service-kanban-core/` | Superseded by integration tests                        |
| `packages/e2e-tests/src/infra/`                     | Replaced by `src/driver/`                              |
| `packages/e2e-tests/src/run-workflow*.ts`           | Standalone scripts, not needed                         |
| `apps/api/test/helpers/fake-llm-server.ts`          | Replaced by `packages/e2e-tests/src/fake-llm/`         |
| `apps/api/test/helpers/fake-llm-server.types.ts`    | Replaced by `packages/e2e-tests/src/fake-llm/types.ts` |

`apps/api/test/helpers/tool-array-serialization-harness.ts` was updated to import from the new fake LLM module.
