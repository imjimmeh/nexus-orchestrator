# Execution Provider/Model Observability — Implementation Plan (First Slice)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the _resolved_ AI provider + model on the `executions` record at execution time (for both chat and workflow-step paths) and surface it on the workflow run detail page, sourced from the persisted record rather than recomputed.

**Architecture:** The `executions` table is already created per dispatch for all execution kinds and already receives the resolved provider/model — it just discards them. We add nullable resolved-config columns, write them at the two creation/resolution points (chat `dispatch()`, workflow `executeJob`), expose them via two read endpoints, and render a "Models used" card on the run detail. This is the first vertical slice of the larger "executions as the canonical agent-execution record" architecture (see the design doc).

**Tech Stack:** NestJS + TypeORM (`apps/api`), Vitest, raw-SQL TypeORM migrations, React + Vite + Tailwind/shadcn (`apps/web`).

**Spec:** `docs/superpowers/specs/2026-06-13-execution-provider-model-observability-design.md`

**Scope notes:**

- This slice persists **provider**, **model**, and **harness_id** (workflow path). The columns `agent_profile_id`, `agent_profile_name`, `provider_source`, `input_tokens`, `output_tokens` are **created** in the migration but populated by later fast-follows (they need extra plumbing through `DispatchParams` / the step config helper). This avoids a second migration.
- UI surface for this slice is a **"Models used" card** on the run detail Graph & Steps tab. Per-step-row badges, chat-detail, and the events column are fast-follows.

---

## File Structure

**Create:**

- `apps/api/src/database/migrations/20260621000000-add-execution-resolved-config.ts` — adds resolved-config columns to `executions`.
- `apps/api/src/execution-lifecycle/executions.controller.ts` — `GET /executions/:id`.
- `apps/api/src/execution-lifecycle/executions.controller.spec.ts`
- `apps/api/src/execution-lifecycle/execution-read.types.ts` — read DTO shape.
- `apps/web/src/components/ai/ProviderModelBadge.tsx` — reusable badge.
- `apps/web/src/components/ai/ProviderModelBadge.test.tsx`

**Modify:**

- `apps/api/src/execution-lifecycle/database/entities/execution.entity.ts` — new columns.
- `apps/api/src/database/migrations/registered-migrations.ts` — register migration.
- `apps/api/src/execution-lifecycle/database/repositories/execution.repository.ts` — `updateResolvedConfig` + `findByWorkflowRun`.
- `apps/api/src/execution-lifecycle/database/repositories/execution.repository.spec.ts`
- `apps/api/src/execution-lifecycle/execution-dispatch.service.ts` — persist provider/model after create (chat path).
- `apps/api/src/execution-lifecycle/execution-dispatch.service.spec.ts`
- `apps/api/src/execution-lifecycle/execution-lifecycle.module.ts` — declare `ExecutionsController`.
- `apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.service.ts` — persist provider/model/harness after building runner config.
- `apps/api/src/workflow/workflow-run-operations/workflow-runs.controller.ts` — `GET /workflows/runs/:runId/executions`.
- `apps/web/src/lib/api/types.ts` — `ExecutionSummary` type.
- `apps/web/src/lib/api/client.workflow.types.ts` + the workflow client impl — `listRunExecutions(runId)`.
- `apps/web/src/pages/workflows/WorkflowRunDetailContent.tsx` — render the "Models used" card.

---

## Phase 1 — Persist resolved config (API)

### Task 1: Add resolved-config columns to the executions entity + migration

**Files:**

- Modify: `apps/api/src/execution-lifecycle/database/entities/execution.entity.ts`
- Create: `apps/api/src/database/migrations/20260621000000-add-execution-resolved-config.ts`
- Modify: `apps/api/src/database/migrations/registered-migrations.ts`
- Test: `apps/api/src/execution-lifecycle/database/entities/execution.entity.spec.ts`

- [ ] **Step 1: Write the failing test**

Append to `apps/api/src/execution-lifecycle/database/entities/execution.entity.spec.ts`:

```typescript
it("exposes resolved-config columns", () => {
  const row = new ExecutionEntity();
  row.provider = "anthropic";
  row.model = "claude-opus-4-8";
  row.harness_id = "pi";
  row.agent_profile_name = "ceo";
  row.provider_source = "scope";
  row.input_tokens = 100;
  row.output_tokens = 50;

  expect(row.provider).toBe("anthropic");
  expect(row.model).toBe("claude-opus-4-8");
  expect(row.harness_id).toBe("pi");
  expect(row.provider_source).toBe("scope");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- execution.entity.spec`
Expected: FAIL — `Property 'provider' does not exist on type 'ExecutionEntity'` (type error / compile failure).

- [ ] **Step 3: Add the columns to the entity**

In `apps/api/src/execution-lifecycle/database/entities/execution.entity.ts`, add these columns immediately after the `container_tier` column (line ~48) and before `state`:

```typescript
  @Column({ type: 'varchar', length: 64, nullable: true })
  provider?: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  model?: string | null;

  @Column({ type: 'uuid', nullable: true })
  agent_profile_id?: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  agent_profile_name?: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  harness_id?: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  provider_source?: string | null;

  @Column({ type: 'bigint', nullable: true })
  input_tokens?: number | null;

  @Column({ type: 'bigint', nullable: true })
  output_tokens?: number | null;
```

- [ ] **Step 4: Create the migration**

Create `apps/api/src/database/migrations/20260621000000-add-execution-resolved-config.ts`:

```typescript
import { MigrationInterface, QueryRunner } from "typeorm";

export class AddExecutionResolvedConfig20260621000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE executions
        ADD COLUMN IF NOT EXISTS provider varchar(64),
        ADD COLUMN IF NOT EXISTS model varchar(128),
        ADD COLUMN IF NOT EXISTS agent_profile_id uuid,
        ADD COLUMN IF NOT EXISTS agent_profile_name varchar(128),
        ADD COLUMN IF NOT EXISTS harness_id varchar(64),
        ADD COLUMN IF NOT EXISTS provider_source varchar(32),
        ADD COLUMN IF NOT EXISTS input_tokens bigint,
        ADD COLUMN IF NOT EXISTS output_tokens bigint;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE executions
        DROP COLUMN IF EXISTS provider,
        DROP COLUMN IF EXISTS model,
        DROP COLUMN IF EXISTS agent_profile_id,
        DROP COLUMN IF EXISTS agent_profile_name,
        DROP COLUMN IF EXISTS harness_id,
        DROP COLUMN IF EXISTS provider_source,
        DROP COLUMN IF EXISTS input_tokens,
        DROP COLUMN IF EXISTS output_tokens;
    `);
  }
}
```

- [ ] **Step 5: Register the migration**

In `apps/api/src/database/migrations/registered-migrations.ts`, add the import at the top (matching the existing newest-first ordering, above the `20260620010000` import on line 1):

```typescript
import { AddExecutionResolvedConfig20260621000000 } from "./20260621000000-add-execution-resolved-config";
```

Then add `AddExecutionResolvedConfig20260621000000` to the exported migrations array (find the array of migration classes in this file and add the new class as the newest entry, following the same ordering as the imports).

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test --workspace=apps/api -- execution.entity.spec`
Expected: PASS.

- [ ] **Step 7: Typecheck the api build**

Run: `npm run build:api`
Expected: builds without TypeScript errors.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/execution-lifecycle/database/entities/execution.entity.ts \
        apps/api/src/database/migrations/20260621000000-add-execution-resolved-config.ts \
        apps/api/src/database/migrations/registered-migrations.ts \
        apps/api/src/execution-lifecycle/database/entities/execution.entity.spec.ts
git commit -m "feat(executions): add resolved provider/model/harness columns"
```

---

### Task 2: Repository methods to persist + query resolved config

**Files:**

- Modify: `apps/api/src/execution-lifecycle/database/repositories/execution.repository.ts`
- Test: `apps/api/src/execution-lifecycle/database/repositories/execution.repository.spec.ts`

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/src/execution-lifecycle/database/repositories/execution.repository.spec.ts`:

```typescript
describe("ExecutionRepository.updateResolvedConfig", () => {
  it("patches only the provided resolved-config fields", async () => {
    const inner = {
      update: vi.fn().mockResolvedValue(undefined),
    };
    const repo = new ExecutionRepository(inner as never);

    await repo.updateResolvedConfig("exec-1", {
      provider: "anthropic",
      model: "claude-opus-4-8",
      harness_id: "pi",
    });

    expect(inner.update).toHaveBeenCalledWith(
      { id: "exec-1" },
      { provider: "anthropic", model: "claude-opus-4-8", harness_id: "pi" },
    );
  });
});

describe("ExecutionRepository.findByWorkflowRun", () => {
  it("queries executions for a run ordered by creation time", async () => {
    const rows = [{ id: "a" }];
    const inner = { find: vi.fn().mockResolvedValue(rows) };
    const repo = new ExecutionRepository(inner as never);

    const result = await repo.findByWorkflowRun("run-1");

    expect(inner.find).toHaveBeenCalledWith({
      where: { workflow_run_id: "run-1" },
      order: { created_at: "ASC" },
    });
    expect(result).toBe(rows);
  });
});
```

> Note: this spec file already constructs `new ExecutionRepository(inner as never)` and imports `vi` — follow the existing pattern at the top of the file.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace=apps/api -- execution.repository.spec`
Expected: FAIL — `updateResolvedConfig`/`findByWorkflowRun` is not a function.

- [ ] **Step 3: Implement the methods**

In `apps/api/src/execution-lifecycle/database/repositories/execution.repository.ts`, add a typed patch interface near `TransitionPatch` (after line 20):

```typescript
export interface ResolvedConfigPatch {
  provider?: string | null;
  model?: string | null;
  agent_profile_id?: string | null;
  agent_profile_name?: string | null;
  harness_id?: string | null;
  provider_source?: string | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
}
```

Then add these methods to the class (e.g. after `findByWorkflowRunAndJob`):

```typescript
  async findByWorkflowRun(workflowRunId: string): Promise<ExecutionEntity[]> {
    return this.repository.find({
      where: { workflow_run_id: workflowRunId },
      order: { created_at: 'ASC' },
    });
  }

  async updateResolvedConfig(
    id: string,
    patch: ResolvedConfigPatch,
  ): Promise<void> {
    await this.repository.update({ id }, patch);
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace=apps/api -- execution.repository.spec`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/execution-lifecycle/database/repositories/execution.repository.ts \
        apps/api/src/execution-lifecycle/database/repositories/execution.repository.spec.ts
git commit -m "feat(executions): repository updateResolvedConfig + findByWorkflowRun"
```

---

### Task 3: Persist provider/model on the chat dispatch path

**Files:**

- Modify: `apps/api/src/execution-lifecycle/execution-dispatch.service.ts`
- Test: `apps/api/src/execution-lifecycle/execution-dispatch.service.spec.ts`

- [ ] **Step 1: Write the failing test**

In `apps/api/src/execution-lifecycle/execution-dispatch.service.spec.ts`, add a test that asserts the resolved provider/model from `agentConfig` are written to the row at create time. Follow the existing `makeDispatchParams` helper used elsewhere in this spec:

```typescript
it("persists resolved provider/model from agentConfig on create", async () => {
  await service.dispatch(
    makeDispatchParams({
      kind: "adhoc_chat",
      chatSessionId: "chat-1",
      agentConfig: {
        provider: "anthropic",
        model: "claude-opus-4-8",
        auth: "api_key",
        systemPrompt: "hi",
      } as never,
    }),
  );

  expect(executionRepository.create).toHaveBeenCalledWith(
    expect.objectContaining({
      provider: "anthropic",
      model: "claude-opus-4-8",
    }),
  );
});
```

> Note: match how the existing tests obtain `service` and the mocked `executionRepository`. If `makeDispatchParams` does not currently accept an `agentConfig` override, extend it minimally to spread the override.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- execution-dispatch.service.spec`
Expected: FAIL — `create` called without `provider`/`model`.

- [ ] **Step 3: Add provider/model to the create payload**

In `apps/api/src/execution-lifecycle/execution-dispatch.service.ts`, extend the `this.executionRepository.create({ ... })` call (lines 43–52) with the resolved values from `agentConfig`:

```typescript
await this.executionRepository.create({
  id: executionId,
  kind: params.kind,
  state: "pending",
  chat_session_id: params.chatSessionId ?? null,
  workflow_run_id: params.workflowRunId ?? null,
  parent_execution_id: params.parentExecutionId ?? null,
  context_id: params.contextId ?? null,
  container_tier: params.containerTier,
  provider: params.agentConfig.provider,
  model: params.agentConfig.model,
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=apps/api -- execution-dispatch.service.spec`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/execution-lifecycle/execution-dispatch.service.ts \
        apps/api/src/execution-lifecycle/execution-dispatch.service.spec.ts
git commit -m "feat(executions): persist resolved provider/model on chat dispatch"
```

---

### Task 4: Persist provider/model/harness on the workflow-step path

**Background:** Workflow steps create the `executions` row in `StepExecutionOrchestratorService.dispatchAgentJobBackground` _before_ resolution. The resolved values only exist after `buildStepRunnerConfigPayload` runs inside `StepAgentStepExecutorService.executeJob` (the `executionId` is already passed into `executeJob`). So we write them there, keyed by `executionId`, using the returned `HarnessRuntimeConfig` (`harnessId`, `model.provider`, `model.model`).

**Files:**

- Modify: `apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.service.ts`
- Test: `apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.multistep.spec.ts` (or the executor's existing spec — use whichever already constructs `StepAgentStepExecutorService`)

- [ ] **Step 1: Read the executor to locate the integration point**

Open `apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.service.ts`. Find `executeJob(...)` and the call to `buildStepRunnerConfigPayload(...)` (it returns a `HarnessRuntimeConfig`). Confirm `executionId` is in scope inside `executeJob`. The write goes immediately after the runner config is built and before/while the container is provisioned.

- [ ] **Step 2: Write the failing test**

Add a test asserting that after building the runner config, `executionRepo.updateResolvedConfig` is called with the resolved provider/model/harness. Construct the executor with a mocked `ExecutionRepository` whose `updateResolvedConfig` is a `vi.fn()`, drive `executeJob` with a stubbed `buildStepRunnerConfigPayload` returning:

```typescript
{
  harnessId: 'pi',
  model: { provider: 'anthropic', model: 'claude-opus-4-8', auth: 'api_key' },
  prompt: { systemPrompt: 's', initialPrompt: 'i' },
}
```

and assert:

```typescript
expect(executionRepo.updateResolvedConfig).toHaveBeenCalledWith("exec-1", {
  provider: "anthropic",
  model: "claude-opus-4-8",
  harness_id: "pi",
});
```

> Match the executor's existing test setup for mocking dependencies. If the executor does not currently take `ExecutionRepository`, the next step adds it to the constructor — update the test's construction accordingly.

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- step-agent-step-executor`
Expected: FAIL — `updateResolvedConfig` not called / dependency missing.

- [ ] **Step 4: Inject the repository and write the resolved config**

In `apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.service.ts`:

1. Import the repository:

```typescript
import { ExecutionRepository } from "../../execution-lifecycle/database/repositories/execution.repository";
```

2. Add it to the constructor (follow the existing constructor-injection style in the file):

```typescript
    private readonly executionRepo: ExecutionRepository,
```

3. Immediately after the `buildStepRunnerConfigPayload(...)` call returns its `HarnessRuntimeConfig` (name it `runnerConfig` if it isn't already), persist the resolved fields:

```typescript
await this.executionRepo.updateResolvedConfig(executionId, {
  provider: runnerConfig.model.provider,
  model: runnerConfig.model.model,
  harness_id: runnerConfig.harnessId,
});
```

- [ ] **Step 5: Verify module wiring**

`StepAgentStepExecutorService` lives in `WorkflowStepExecutionModule`. Confirm `ExecutionLifecycleModule` (which exports `ExecutionRepository`) is imported by that module — `StepExecutionOrchestratorService` already injects `ExecutionRepository`, so the provider is already available. If the build complains it is not provided, add the export/import; otherwise no module change is needed.

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test --workspace=apps/api -- step-agent-step-executor`
Expected: PASS.

- [ ] **Step 7: Typecheck**

Run: `npm run build:api`
Expected: builds clean.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.service.ts \
        apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.multistep.spec.ts
git commit -m "feat(executions): persist resolved provider/model/harness on workflow step"
```

---

## Phase 2 — Expose resolved config (API)

### Task 5: Read DTO + `GET /executions/:id`

**Files:**

- Create: `apps/api/src/execution-lifecycle/execution-read.types.ts`
- Create: `apps/api/src/execution-lifecycle/executions.controller.ts`
- Create: `apps/api/src/execution-lifecycle/executions.controller.spec.ts`
- Modify: `apps/api/src/execution-lifecycle/execution-lifecycle.module.ts`

- [ ] **Step 1: Define the read DTO**

Create `apps/api/src/execution-lifecycle/execution-read.types.ts`:

```typescript
import type { ExecutionEntity } from "./database/entities/execution.entity";

export interface ExecutionReadModel {
  id: string;
  kind: string;
  state: string;
  provider: string | null;
  model: string | null;
  harnessId: string | null;
  agentProfileName: string | null;
  providerSource: string | null;
  workflowRunId: string | null;
  chatSessionId: string | null;
  contextId: string | null;
  createdAt: string;
  terminalAt: string | null;
}

export function toExecutionReadModel(row: ExecutionEntity): ExecutionReadModel {
  return {
    id: row.id,
    kind: row.kind,
    state: row.state,
    provider: row.provider ?? null,
    model: row.model ?? null,
    harnessId: row.harness_id ?? null,
    agentProfileName: row.agent_profile_name ?? null,
    providerSource: row.provider_source ?? null,
    workflowRunId: row.workflow_run_id ?? null,
    chatSessionId: row.chat_session_id ?? null,
    contextId: row.context_id ?? null,
    createdAt: row.created_at.toISOString(),
    terminalAt: row.terminal_at ? row.terminal_at.toISOString() : null,
  };
}
```

- [ ] **Step 2: Write the failing controller test**

Create `apps/api/src/execution-lifecycle/executions.controller.spec.ts`:

```typescript
import { NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { ExecutionsController } from "./executions.controller";

describe("ExecutionsController.getById", () => {
  it("returns the execution read model when found", async () => {
    const row = {
      id: "exec-1",
      kind: "workflow_step",
      state: "running",
      provider: "anthropic",
      model: "claude-opus-4-8",
      harness_id: "pi",
      agent_profile_name: null,
      provider_source: null,
      workflow_run_id: "run-1",
      chat_session_id: null,
      context_id: "job-1",
      created_at: new Date("2026-06-13T00:00:00Z"),
      terminal_at: null,
    };
    const repo = { findById: vi.fn().mockResolvedValue(row) };
    const controller = new ExecutionsController(repo as never);

    const result = await controller.getById("exec-1");

    expect(result.provider).toBe("anthropic");
    expect(result.model).toBe("claude-opus-4-8");
    expect(result.harnessId).toBe("pi");
  });

  it("throws NotFound when missing", async () => {
    const repo = { findById: vi.fn().mockResolvedValue(null) };
    const controller = new ExecutionsController(repo as never);

    await expect(controller.getById("nope")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- executions.controller.spec`
Expected: FAIL — cannot find `./executions.controller`.

- [ ] **Step 4: Implement the controller**

Create `apps/api/src/execution-lifecycle/executions.controller.ts`:

```typescript
import { Controller, Get, NotFoundException, Param } from "@nestjs/common";
import { ExecutionRepository } from "./database/repositories/execution.repository";
import {
  type ExecutionReadModel,
  toExecutionReadModel,
} from "./execution-read.types";

@Controller("executions")
export class ExecutionsController {
  constructor(private readonly executionRepository: ExecutionRepository) {}

  @Get(":id")
  async getById(@Param("id") id: string): Promise<ExecutionReadModel> {
    const row = await this.executionRepository.findById(id);
    if (!row) {
      throw new NotFoundException(`Execution ${id} not found`);
    }
    return toExecutionReadModel(row);
  }
}
```

- [ ] **Step 5: Register the controller**

In `apps/api/src/execution-lifecycle/execution-lifecycle.module.ts`, import `ExecutionsController` and add it to the module's `controllers: [...]` array (add the array if the module does not declare one).

- [ ] **Step 6: Run test + typecheck**

Run: `npm run test --workspace=apps/api -- executions.controller.spec`
Expected: PASS.
Run: `npm run build:api`
Expected: builds clean.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/execution-lifecycle/execution-read.types.ts \
        apps/api/src/execution-lifecycle/executions.controller.ts \
        apps/api/src/execution-lifecycle/executions.controller.spec.ts \
        apps/api/src/execution-lifecycle/execution-lifecycle.module.ts
git commit -m "feat(executions): GET /executions/:id read endpoint"
```

---

### Task 6: `GET /workflows/runs/:runId/executions`

**Files:**

- Modify: `apps/api/src/workflow/workflow-run-operations/workflow-runs.controller.ts`
- Test: the controller's existing spec (search for `workflow-runs.controller.spec.ts`; if none, create it next to the controller)

- [ ] **Step 1: Confirm dependency availability**

Open `apps/api/src/workflow/workflow-run-operations/workflow-runs.controller.ts`. Confirm whether `ExecutionRepository` is already injectable in this module (it belongs to `ExecutionLifecycleModule`). If `WorkflowRunOperationsModule` does not import `ExecutionLifecycleModule`, add it to the module's `imports`.

- [ ] **Step 2: Write the failing test**

Add to the controller spec:

```typescript
it("lists executions for a run as read models", async () => {
  const rows = [
    {
      id: "exec-1",
      kind: "workflow_step",
      state: "completed",
      provider: "anthropic",
      model: "claude-opus-4-8",
      harness_id: "pi",
      agent_profile_name: null,
      provider_source: null,
      workflow_run_id: "run-1",
      chat_session_id: null,
      context_id: "job-1",
      created_at: new Date("2026-06-13T00:00:00Z"),
      terminal_at: null,
    },
  ];
  executionRepository.findByWorkflowRun.mockResolvedValue(rows);

  const result = await controller.listRunExecutions("run-1");

  expect(executionRepository.findByWorkflowRun).toHaveBeenCalledWith("run-1");
  expect(result).toHaveLength(1);
  expect(result[0].model).toBe("claude-opus-4-8");
});
```

> Match the spec's existing construction of `controller` and its mocked dependencies; add a mocked `ExecutionRepository` ({ findByWorkflowRun: vi.fn() }) to that setup.

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- workflow-runs.controller.spec`
Expected: FAIL — `listRunExecutions` is not a function.

- [ ] **Step 4: Implement the endpoint**

In `apps/api/src/workflow/workflow-run-operations/workflow-runs.controller.ts`:

1. Add imports:

```typescript
import { ExecutionRepository } from "../../execution-lifecycle/database/repositories/execution.repository";
import {
  type ExecutionReadModel,
  toExecutionReadModel,
} from "../../execution-lifecycle/execution-read.types";
```

2. Inject `private readonly executionRepository: ExecutionRepository` into the constructor.

3. Add the route (place it next to the existing `:runId` routes):

```typescript
  @Get(':runId/executions')
  async listRunExecutions(
    @Param('runId') runId: string,
  ): Promise<ExecutionReadModel[]> {
    const rows = await this.executionRepository.findByWorkflowRun(runId);
    return rows.map(toExecutionReadModel);
  }
```

- [ ] **Step 5: Run test + typecheck**

Run: `npm run test --workspace=apps/api -- workflow-runs.controller.spec`
Expected: PASS.
Run: `npm run build:api`
Expected: builds clean.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/workflow/workflow-run-operations/workflow-runs.controller.ts \
        apps/api/src/workflow/workflow-run-operations/workflow-runs.controller.spec.ts
git commit -m "feat(executions): GET /workflows/runs/:runId/executions"
```

---

## Phase 3 — Surface on the web

### Task 7: `ProviderModelBadge` component

**Files:**

- Create: `apps/web/src/components/ai/ProviderModelBadge.tsx`
- Test: `apps/web/src/components/ai/ProviderModelBadge.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/ai/ProviderModelBadge.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProviderModelBadge } from "./ProviderModelBadge";

describe("ProviderModelBadge", () => {
  it("renders provider and model", () => {
    render(<ProviderModelBadge provider="anthropic" model="claude-opus-4-8" />);
    expect(screen.getByText(/anthropic/)).toBeInTheDocument();
    expect(screen.getByText(/claude-opus-4-8/)).toBeInTheDocument();
  });

  it("renders a fallback when model is missing", () => {
    render(<ProviderModelBadge provider={null} model={null} />);
    expect(screen.getByText(/unknown/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit:web -- ProviderModelBadge`
Expected: FAIL — cannot find `./ProviderModelBadge`.

- [ ] **Step 3: Implement the component**

Create `apps/web/src/components/ai/ProviderModelBadge.tsx`:

```tsx
import { Badge } from "@/components/ui/badge";

type ProviderModelBadgeProps = {
  provider?: string | null;
  model?: string | null;
  harnessId?: string | null;
  providerSource?: string | null;
};

export function ProviderModelBadge({
  provider,
  model,
  harnessId,
  providerSource,
}: Readonly<ProviderModelBadgeProps>) {
  const label =
    model || provider
      ? `${provider ?? "?"} · ${model ?? "?"}`
      : "unknown model";

  const titleParts = [
    harnessId ? `harness: ${harnessId}` : null,
    providerSource ? `source: ${providerSource}` : null,
  ].filter(Boolean);

  return (
    <Badge
      variant="outline"
      className="font-mono text-xs"
      title={titleParts.join(" · ") || undefined}
    >
      {label}
    </Badge>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit:web -- ProviderModelBadge`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ai/ProviderModelBadge.tsx \
        apps/web/src/components/ai/ProviderModelBadge.test.tsx
git commit -m "feat(web): ProviderModelBadge component"
```

---

### Task 8: Wire executions into run detail ("Models used" card)

**Files:**

- Modify: `apps/web/src/lib/api/types.ts`
- Modify: `apps/web/src/lib/api/client.workflow.types.ts` and the workflow client implementation
- Modify: `apps/web/src/pages/workflows/WorkflowRunDetailContent.tsx`

- [ ] **Step 1: Add the `ExecutionSummary` type**

In `apps/web/src/lib/api/types.ts`, add (mirror the API `ExecutionReadModel`):

```typescript
export type ExecutionSummary = {
  id: string;
  kind: string;
  state: string;
  provider: string | null;
  model: string | null;
  harnessId: string | null;
  agentProfileName: string | null;
  providerSource: string | null;
  workflowRunId: string | null;
  chatSessionId: string | null;
  contextId: string | null;
  createdAt: string;
  terminalAt: string | null;
};
```

- [ ] **Step 2: Add the client method**

In `apps/web/src/lib/api/client.workflow.types.ts`, add to the workflow client interface:

```typescript
  listRunExecutions(runId: string): Promise<ExecutionSummary[]>;
```

(import `ExecutionSummary` from `./types`). Then implement it in the workflow client file (find the file implementing the other `getWorkflowRun` methods and follow the existing fetch/parse pattern):

```typescript
  listRunExecutions(runId: string): Promise<ExecutionSummary[]> {
    return this.get<ExecutionSummary[]>(
      `/workflows/runs/${runId}/executions`,
    );
  }
```

> Use the same request helper (`this.get` / `request`) the sibling methods use — match the file's established style exactly.

- [ ] **Step 3: Render the "Models used" card**

In `apps/web/src/pages/workflows/WorkflowRunDetailContent.tsx`:

1. Add imports:

```typescript
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { ProviderModelBadge } from "@/components/ai/ProviderModelBadge";
```

> Use the same query-client/`apiClient` access pattern the rest of the page uses; if the page already receives data via props/hooks rather than calling `useQuery` directly, add a sibling hook in the page's hook file instead and pass `executions` down as a prop. Follow whatever pattern `WorkflowRunDetail.tsx` already uses to fetch run data.

2. Inside `WorkflowRunPanels`, in the `TabsContent value="graph"` block, add a card above `Step Results`:

```tsx
<Card>
  <CardHeader>
    <CardTitle>Models used</CardTitle>
  </CardHeader>
  <CardContent className="flex flex-wrap gap-2">
    {runExecutions.length === 0 ? (
      <span className="text-sm text-muted-foreground">
        No executions recorded yet.
      </span>
    ) : (
      runExecutions.map((execution) => (
        <ProviderModelBadge
          key={execution.id}
          provider={execution.provider}
          model={execution.model}
          harnessId={execution.harnessId}
          providerSource={execution.providerSource}
        />
      ))
    )}
  </CardContent>
</Card>
```

3. Source `runExecutions` from the query/hook in step 1, threading it through `WorkflowRunPanelsProps` (add `runExecutions: ExecutionSummary[]`) the same way `stepOutputs` is threaded.

- [ ] **Step 4: Typecheck + unit test the web build**

Run: `npm run build:web`
Expected: builds clean (no TS errors).
Run: `npm run test:unit:web -- WorkflowRunDetail`
Expected: existing run-detail tests still pass (update any snapshot/prop fixtures to include `runExecutions: []`).

- [ ] **Step 5: Lint**

Run: `npm run lint:web`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/api/types.ts \
        apps/web/src/lib/api/client.workflow.types.ts \
        apps/web/src/pages/workflows/WorkflowRunDetailContent.tsx
git commit -m "feat(web): show resolved provider/model on workflow run detail"
```

---

## Phase 4 — End-to-end verification

### Task 9: Verify the slice against a live run

- [ ] **Step 1: Apply the migration**

Run the API so the migration applies (or run the project's migration command). Confirm the `executions` table now has the new columns:

```bash
docker compose up -d --build
```

- [ ] **Step 2: Trigger a workflow run**

Launch any agent workflow run through the web UI or an existing E2E entry point.

- [ ] **Step 3: Confirm persistence**

Query the DB and confirm the run's executions have non-null `provider`, `model`, `harness_id`:

```sql
SELECT id, kind, provider, model, harness_id
FROM executions
WHERE workflow_run_id = '<run-id>';
```

Expected: rows show the actual provider/model the container ran with.

- [ ] **Step 4: Confirm the UI**

Open the run detail page → Graph & Steps tab. Confirm the "Models used" card shows a `provider · model` badge per execution, and the hover title shows the harness.

- [ ] **Step 5: Run the api + web unit suites once more**

Run: `npm run test:api`
Run: `npm run test:unit:web`
Expected: all green.

- [ ] **Step 6: Final commit (if any fixups)**

```bash
git add -A
git commit -m "test(executions): end-to-end verification fixups"
```

---

## Out of scope (recorded fast-follows — do NOT do in this slice)

- Populate `agent_profile_id` / `agent_profile_name` / `provider_source` (needs the step config helper to return resolved metadata, and `DispatchParams` to thread it for chat).
- Populate `input_tokens` / `output_tokens` from the telemetry gateway completion event; derive cost via the `llm_models` cost columns.
- Per-step-row badges in `StepResults` / `WorkflowRunDetailSupport`.
- Switch chat session detail to execution-sourced provider/model.
- Add `execution_id` to `event_ledger` + a provider/model column in the events feed.
- Architectural endgame: fold `subagent_executions` into `executions`; remove the legacy synchronous chat dispatch path.

```

```
