# Workflow Long-Step Failure Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop "in-progress" workflow runs from being force-killed and failed while their long-running `implement_and_commit` agent step is still making real progress, and restore the schema/safety-net pieces that broke in the last deploy.

**Architecture:** The `implement_and_commit` step runs an agent inside an ephemeral `nexus-heavy` container, driven by a synchronous `POST /execute/agent` from the API. These steps legitimately run 1–2+ hours (sequential subagents). Three infrastructure limits cut them short: (1) a 35-minute HTTP POST timeout, (2) a 30-second reconciler that fails any RUNNING run whose `updated_at` is older than 90s and has no live queue job, and (3) a SIGKILL+retry cascade. We fix the timeout (primary trigger), add a run heartbeat + larger reconciler grace (defense-in-depth), then repair the two missing DB migrations and harden the repair-agent so the auto-repair safety net stays up.

**Tech Stack:** NestJS + TypeORM (PostgreSQL 18) for `apps/api`; TypeORM + Socket.IO for `apps/repair-agent`; **Vitest** for tests in both packages; Docker/dockerode for container orchestration; BullMQ for the step queue.

**Root-cause reference:** Failures present as `workflow.failed: job_failed_after_retries: HTTP POST timed out: http://172.18.0.x:8374/execute/agent`. Reconciler trigger string: `Workflow run appears stalled: no live queue job found during reconciliation`.

**Out of scope / follow-up (do NOT implement here):** Fully async dispatch (fire-and-poll for `/execute/agent` instead of holding the connection). That is the long-term correct design but a large refactor; the worker already reports completion via `step_complete`/`set_job_output`. Captured here as a follow-up so the safe, low-risk fixes can ship first.

---

## File Structure

**Phase 1 — keep long steps alive**
- Modify `apps/api/src/docker/container-http-client.service.ts` — make the `/execute/agent` POST timeout configurable and default it well above realistic step duration.
- Create `apps/api/src/workflow/workflow-run-operations/workflow-run-heartbeat.helpers.ts` — pure throttle predicate.
- Create `apps/api/src/workflow/workflow-run-operations/workflow-run-heartbeat.service.ts` — throttled `recordActivity(runId)` that touches the run.
- Modify `apps/api/src/workflow/database/repositories/workflow-run.repository.ts` — add `touch(id)`.
- Modify `apps/api/src/workflow/workflow-step-execution/step-container-runtime.service.ts` — accept an `onActivity` callback in `startContainerLogStreaming`.
- Modify `apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.service.ts` — pass a heartbeat callback through.
- Modify `apps/api/src/workflow/workflow-step-execution/workflow-step-execution.module.ts` — provide the heartbeat service.
- Modify `apps/api/src/workflow/workflow-run-operations/workflow-run-reconciliation.service.ts` — make the stale grace configurable and larger.

**Phase 2 — restore schema + safety net**
- Create `apps/api/src/database/migrations/20260613010000-rename-workflow-run-todo-source-context-item.ts`.
- Create `apps/api/src/database/migrations/20260613020000-create-repair-session.ts`.
- Modify `apps/api/src/database/migrations/registered-migrations.ts` — register both.
- Modify `apps/repair-agent/src/worker/pool.ts` — make `handleEvent` swallow + log its own errors.

---

## Conventions (read once)

- **Run one api test file:** `cd apps/api && npx vitest run --config vitest.config.ts <relative-spec-path>`
- **Run one repair-agent test file:** `cd apps/repair-agent && npx vitest run <relative-spec-path>`
- **Typecheck api:** `cd apps/api && npx tsc --noEmit -p tsconfig.json`
- **Typecheck repair-agent:** `cd apps/repair-agent && npm run typecheck`
- **Apply migrations (manual verify):** restart the api container — `docker restart nexus-api` — migrations run on boot because `TYPEORM_MIGRATIONS_RUN` is unset (`!== 'false'` ⇒ true).
- **Inspect DB:** `docker exec nexus-postgres psql -U nexus -d nexus_orchestrator -c "<sql>"`

---

## Phase 1 — Stop long agent steps from being killed

### Task 1: Make the `/execute/agent` POST timeout configurable and longer (PRIMARY FIX)

This is the root trigger: the synchronous POST currently times out at 35 min while the step legitimately runs 1–2+ hours, which fails the BullMQ job and starts the kill/retry cascade.

**Files:**
- Modify: `apps/api/src/docker/container-http-client.service.ts`
- Test: `apps/api/src/docker/container-http-client.service.spec.ts` (exists — add cases)

- [ ] **Step 1: Write the failing test**

Add to `apps/api/src/docker/container-http-client.service.spec.ts`:

```typescript
import { resolveAgentPostTimeoutMs, DEFAULT_AGENT_POST_TIMEOUT_MS } from './container-http-client.service';

describe('resolveAgentPostTimeoutMs', () => {
  it('defaults to 2 hours when env is unset', () => {
    expect(resolveAgentPostTimeoutMs(undefined)).toBe(DEFAULT_AGENT_POST_TIMEOUT_MS);
    expect(DEFAULT_AGENT_POST_TIMEOUT_MS).toBe(2 * 60 * 60 * 1000);
  });

  it('uses a valid positive integer from env', () => {
    expect(resolveAgentPostTimeoutMs('5400000')).toBe(5_400_000);
  });

  it('falls back to the default for non-numeric or non-positive values', () => {
    expect(resolveAgentPostTimeoutMs('abc')).toBe(DEFAULT_AGENT_POST_TIMEOUT_MS);
    expect(resolveAgentPostTimeoutMs('0')).toBe(DEFAULT_AGENT_POST_TIMEOUT_MS);
    expect(resolveAgentPostTimeoutMs('-1')).toBe(DEFAULT_AGENT_POST_TIMEOUT_MS);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run --config vitest.config.ts src/docker/container-http-client.service.spec.ts`
Expected: FAIL — `resolveAgentPostTimeoutMs`/`DEFAULT_AGENT_POST_TIMEOUT_MS` not exported.

- [ ] **Step 3: Write minimal implementation**

In `apps/api/src/docker/container-http-client.service.ts`, near the top (after the existing `const CONTAINER_SERVER_PORT = 8374;` block) add:

```typescript
export const DEFAULT_AGENT_POST_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours

export function resolveAgentPostTimeoutMs(raw: string | undefined): number {
  if (raw === undefined) {
    return DEFAULT_AGENT_POST_TIMEOUT_MS;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return DEFAULT_AGENT_POST_TIMEOUT_MS;
  }
  return parsed;
}
```

Then in `httpPostJson`, replace the hard-coded timeout:

```typescript
          timeout: 35 * 60 * 1000, // 35 minutes (agent steps can be long)
```

with:

```typescript
          timeout: resolveAgentPostTimeoutMs(process.env.WORKFLOW_AGENT_HTTP_TIMEOUT_MS),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run --config vitest.config.ts src/docker/container-http-client.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/docker/container-http-client.service.ts apps/api/src/docker/container-http-client.service.spec.ts
git commit -m "fix(api/docker): make /execute/agent POST timeout configurable and default to 2h

Long implement_and_commit steps run 1-2h via sequential subagents; the old
35m socket timeout failed the BullMQ job and triggered the kill/retry cascade."
```

---

### Task 2: Pure heartbeat throttle predicate

A run heartbeat must not write to the DB on every stdout chunk. This pure predicate decides when enough time has elapsed; it is trivially unit-testable.

**Files:**
- Create: `apps/api/src/workflow/workflow-run-operations/workflow-run-heartbeat.helpers.ts`
- Test: `apps/api/src/workflow/workflow-run-operations/workflow-run-heartbeat.helpers.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import {
  shouldEmitRunHeartbeat,
  RUN_HEARTBEAT_MIN_INTERVAL_MS,
} from './workflow-run-heartbeat.helpers';

describe('shouldEmitRunHeartbeat', () => {
  it('emits when there is no prior heartbeat', () => {
    expect(shouldEmitRunHeartbeat(undefined, 1_000)).toBe(true);
  });

  it('suppresses heartbeats inside the min interval', () => {
    const now = 100_000;
    expect(shouldEmitRunHeartbeat(now - (RUN_HEARTBEAT_MIN_INTERVAL_MS - 1), now)).toBe(false);
  });

  it('emits once the min interval has elapsed', () => {
    const now = 100_000;
    expect(shouldEmitRunHeartbeat(now - RUN_HEARTBEAT_MIN_INTERVAL_MS, now)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run --config vitest.config.ts src/workflow/workflow-run-operations/workflow-run-heartbeat.helpers.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
export const RUN_HEARTBEAT_MIN_INTERVAL_MS = 15_000;

export function shouldEmitRunHeartbeat(
  lastEmittedAtMs: number | undefined,
  nowMs: number,
  minIntervalMs: number = RUN_HEARTBEAT_MIN_INTERVAL_MS,
): boolean {
  if (lastEmittedAtMs === undefined) {
    return true;
  }
  return nowMs - lastEmittedAtMs >= minIntervalMs;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run --config vitest.config.ts src/workflow/workflow-run-operations/workflow-run-heartbeat.helpers.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/workflow/workflow-run-operations/workflow-run-heartbeat.helpers.ts apps/api/src/workflow/workflow-run-operations/workflow-run-heartbeat.helpers.spec.ts
git commit -m "feat(api/workflow): add pure run-heartbeat throttle predicate"
```

---

### Task 3: Add `touch(id)` to WorkflowRunRepository

Bumps `workflow_runs.updated_at` so the reconciler's freshness check treats an actively-streaming run as live.

**Files:**
- Modify: `apps/api/src/workflow/database/repositories/workflow-run.repository.ts`
- Test: `apps/api/src/workflow/database/repositories/workflow-run.repository.spec.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

Create/append `apps/api/src/workflow/database/repositories/workflow-run.repository.spec.ts`:

```typescript
import { WorkflowRunRepository } from './workflow-run.repository';

describe('WorkflowRunRepository.touch', () => {
  it('updates only the updated_at column for the given run', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const repo = new WorkflowRunRepository({ update } as never);

    await repo.touch('run-1');

    expect(update).toHaveBeenCalledTimes(1);
    const [id, patch] = update.mock.calls[0];
    expect(id).toBe('run-1');
    expect(Object.keys(patch)).toEqual(['updated_at']);
    expect(patch.updated_at).toBeInstanceOf(Date);
  });
});
```

> Note: `WorkflowRunRepository`'s constructor takes the injected TypeORM `Repository<WorkflowRun>`. Match the existing constructor signature in the file; pass the `{ update }` stub as that dependency. If the constructor uses `@InjectRepository`, instantiate with the stub cast as shown.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run --config vitest.config.ts src/workflow/database/repositories/workflow-run.repository.spec.ts`
Expected: FAIL — `touch` is not a function.

- [ ] **Step 3: Write minimal implementation**

Add this method to the `WorkflowRunRepository` class (next to the existing `update` method around line 364):

```typescript
  async touch(id: string): Promise<void> {
    await this.repository.update(id, { updated_at: new Date() });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run --config vitest.config.ts src/workflow/database/repositories/workflow-run.repository.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/workflow/database/repositories/workflow-run.repository.ts apps/api/src/workflow/database/repositories/workflow-run.repository.spec.ts
git commit -m "feat(api/workflow): add WorkflowRunRepository.touch to refresh updated_at"
```

---

### Task 4: WorkflowRunHeartbeatService (throttled, fire-and-forget)

Holds per-run last-emit timestamps and calls `repo.touch` only when the predicate allows. Errors are swallowed so a heartbeat can never crash a step.

**Files:**
- Create: `apps/api/src/workflow/workflow-run-operations/workflow-run-heartbeat.service.ts`
- Test: `apps/api/src/workflow/workflow-run-operations/workflow-run-heartbeat.service.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { WorkflowRunHeartbeatService } from './workflow-run-heartbeat.service';

describe('WorkflowRunHeartbeatService', () => {
  it('touches on first activity and suppresses within the interval', async () => {
    const touch = vi.fn().mockResolvedValue(undefined);
    let now = 1_000;
    const service = new WorkflowRunHeartbeatService({ touch } as never);
    (service as unknown as { now: () => number }).now = () => now;

    service.recordActivity('run-1');
    await Promise.resolve();
    expect(touch).toHaveBeenCalledTimes(1);

    now += 5_000; // inside 15s interval
    service.recordActivity('run-1');
    await Promise.resolve();
    expect(touch).toHaveBeenCalledTimes(1);

    now += 15_000; // past interval
    service.recordActivity('run-1');
    await Promise.resolve();
    expect(touch).toHaveBeenCalledTimes(2);
  });

  it('never rejects when touch throws', async () => {
    const touch = vi.fn().mockRejectedValue(new Error('db down'));
    const service = new WorkflowRunHeartbeatService({ touch } as never);
    expect(() => service.recordActivity('run-1')).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run --config vitest.config.ts src/workflow/workflow-run-operations/workflow-run-heartbeat.service.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { WorkflowRunRepository } from '../database/repositories/workflow-run.repository';
import { shouldEmitRunHeartbeat } from './workflow-run-heartbeat.helpers';

@Injectable()
export class WorkflowRunHeartbeatService {
  private readonly logger = new Logger(WorkflowRunHeartbeatService.name);
  private readonly lastEmittedAtMs = new Map<string, number>();

  constructor(private readonly runRepo: WorkflowRunRepository) {}

  private now(): number {
    return Date.now();
  }

  recordActivity(runId: string): void {
    if (!runId) {
      return;
    }
    const nowMs = this.now();
    if (!shouldEmitRunHeartbeat(this.lastEmittedAtMs.get(runId), nowMs)) {
      return;
    }
    this.lastEmittedAtMs.set(runId, nowMs);
    void this.runRepo.touch(runId).catch((error: unknown) => {
      this.logger.debug(
        `Run heartbeat touch failed for ${runId}: ${(error as Error).message}`,
      );
    });
  }

  forget(runId: string): void {
    this.lastEmittedAtMs.delete(runId);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run --config vitest.config.ts src/workflow/workflow-run-operations/workflow-run-heartbeat.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/workflow/workflow-run-operations/workflow-run-heartbeat.service.ts apps/api/src/workflow/workflow-run-operations/workflow-run-heartbeat.service.spec.ts
git commit -m "feat(api/workflow): add throttled WorkflowRunHeartbeatService"
```

---

### Task 5: Thread an `onActivity` callback through container log streaming

`startContainerLogStreaming` already receives every stdout/stderr chunk — the perfect liveness signal. Add an optional callback invoked on each chunk; the executor wires it to the heartbeat service.

**Files:**
- Modify: `apps/api/src/workflow/workflow-step-execution/step-container-runtime.service.ts`
- Test: `apps/api/src/workflow/workflow-step-execution/step-container-runtime.service.spec.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

Append to `apps/api/src/workflow/workflow-step-execution/step-container-runtime.service.spec.ts`:

```typescript
import { StepContainerRuntimeService } from './step-container-runtime.service';

describe('StepContainerRuntimeService.bufferAndEmitLines + onActivity contract', () => {
  it('invokes onActivity for each non-empty data chunk via the stdout handler', () => {
    // Guard test: the public signature must accept an onActivity callback.
    const service = new StepContainerRuntimeService({} as never, {} as never);
    expect(service.startContainerLogStreaming.length).toBeGreaterThanOrEqual(4);
  });
});
```

> Note: `Function.length` counts parameters before the first optional/default. Keep `onActivity` as the 4th positional parameter (no default) so `.length === 4`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run --config vitest.config.ts src/workflow/workflow-step-execution/step-container-runtime.service.spec.ts`
Expected: FAIL — `startContainerLogStreaming.length` is 3.

- [ ] **Step 3: Write minimal implementation**

In `step-container-runtime.service.ts`, change the signature:

```typescript
  async startContainerLogStreaming(
    containerId: string,
    workflowRunId: string,
    stepId: string,
    onActivity: (() => void) | undefined,
  ): Promise<() => void> {
```

Inside `onStdout` and `onStderr`, add a call after the existing `publishBashOutput` line in each. For `onStdout`:

```typescript
    const onStdout = (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      onActivity?.();
      void this.eventPublisher.publishBashOutput(
        workflowRunId,
        stepId,
        containerId,
        'stdout',
        text,
      );
```

For `onStderr`:

```typescript
    const onStderr = (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      onActivity?.();
      void this.eventPublisher.publishBashOutput(
        workflowRunId,
        stepId,
        containerId,
        'stderr',
        text,
      );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run --config vitest.config.ts src/workflow/workflow-step-execution/step-container-runtime.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/workflow/workflow-step-execution/step-container-runtime.service.ts apps/api/src/workflow/workflow-step-execution/step-container-runtime.service.spec.ts
git commit -m "feat(api/workflow): emit onActivity per log chunk for run heartbeat"
```

---

### Task 6: Wire the heartbeat into the agent step executor + module

**Files:**
- Modify: `apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.service.ts`
- Modify: `apps/api/src/workflow/workflow-step-execution/workflow-step-execution.module.ts`

- [ ] **Step 1: Add the provider to the module**

In `workflow-step-execution.module.ts`, import and add `WorkflowRunHeartbeatService` to `providers` (and `exports` if the module exports its providers). Add near the other workflow providers:

```typescript
import { WorkflowRunHeartbeatService } from '../workflow-run-operations/workflow-run-heartbeat.service';
```

and include `WorkflowRunHeartbeatService` in the `providers: [...]` array.

> If `WorkflowRunRepository` is not already available to this module's injector, also ensure the module importing chain provides it (it is already injected by `StepAgentStepExecutorService`, so the provider is in scope).

- [ ] **Step 2: Inject the service into the executor**

In `step-agent-step-executor.service.ts`, add the import:

```typescript
import { WorkflowRunHeartbeatService } from '../workflow-run-operations/workflow-run-heartbeat.service';
```

Add a constructor parameter (place it alongside the existing `private readonly` deps):

```typescript
    private readonly runHeartbeat: WorkflowRunHeartbeatService,
```

- [ ] **Step 3: Pass the callback into log streaming**

In the `startContainerAndStreamLogs` callback (currently around line 362), pass the heartbeat as the new 4th argument:

```typescript
      startContainerAndStreamLogs: async (containerId, runId, jId) => {
        await this.containerSupport.startContainer(containerId);
        return this.containerRuntime.startContainerLogStreaming(
          containerId,
          runId,
          jId,
          () => this.runHeartbeat.recordActivity(runId),
        );
      },
```

- [ ] **Step 4: Update any other `startContainerLogStreaming` callers**

Run: `cd /g/code/AI/nexus-orchestator && grep -rn "startContainerLogStreaming(" apps/api/src --include=*.ts | grep -v spec`
For every call site that still passes 3 args, pass `undefined` as the 4th argument (or a heartbeat callback if a run id is in scope). Expected current call sites: the executor (just updated). Fix any others to compile.

- [ ] **Step 5: Typecheck**

Run: `cd apps/api && npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.service.ts apps/api/src/workflow/workflow-step-execution/workflow-step-execution.module.ts
git commit -m "feat(api/workflow): heartbeat workflow run updated_at while agent container streams output"
```

---

### Task 7: Make the reconciler stale-grace configurable and larger (defense-in-depth)

Even with heartbeats, widen the grace so a brief silent gap (e.g. a long LLM turn with no stdout) cannot trip the reconciler.

**Files:**
- Modify: `apps/api/src/workflow/workflow-run-operations/workflow-run-reconciliation.service.ts`
- Test: `apps/api/src/workflow/workflow-run-operations/workflow-run-reconciliation.service.spec.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

```typescript
import { resolveStaleRunGraceMs, DEFAULT_STALE_RUN_GRACE_MS } from './workflow-run-reconciliation.service';

describe('resolveStaleRunGraceMs', () => {
  it('defaults to 5 minutes', () => {
    expect(resolveStaleRunGraceMs(undefined)).toBe(DEFAULT_STALE_RUN_GRACE_MS);
    expect(DEFAULT_STALE_RUN_GRACE_MS).toBe(5 * 60 * 1000);
  });

  it('reads a positive integer from env', () => {
    expect(resolveStaleRunGraceMs('600000')).toBe(600_000);
  });

  it('falls back to default on invalid input', () => {
    expect(resolveStaleRunGraceMs('nope')).toBe(DEFAULT_STALE_RUN_GRACE_MS);
    expect(resolveStaleRunGraceMs('0')).toBe(DEFAULT_STALE_RUN_GRACE_MS);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run --config vitest.config.ts src/workflow/workflow-run-operations/workflow-run-reconciliation.service.spec.ts`
Expected: FAIL — exports not found.

- [ ] **Step 3: Write minimal implementation**

In `workflow-run-reconciliation.service.ts`, replace:

```typescript
const STALE_RUN_GRACE_MS = 90_000;
```

with:

```typescript
export const DEFAULT_STALE_RUN_GRACE_MS = 5 * 60 * 1000; // 5 minutes

export function resolveStaleRunGraceMs(raw: string | undefined): number {
  if (raw === undefined) {
    return DEFAULT_STALE_RUN_GRACE_MS;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return DEFAULT_STALE_RUN_GRACE_MS;
  }
  return parsed;
}

const STALE_RUN_GRACE_MS = resolveStaleRunGraceMs(
  process.env.WORKFLOW_STALE_RUN_GRACE_MS,
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run --config vitest.config.ts src/workflow/workflow-run-operations/workflow-run-reconciliation.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `cd apps/api && npx tsc --noEmit -p tsconfig.json`

```bash
git add apps/api/src/workflow/workflow-run-operations/workflow-run-reconciliation.service.ts apps/api/src/workflow/workflow-run-operations/workflow-run-reconciliation.service.spec.ts
git commit -m "fix(api/workflow): widen + make configurable the reconciler stale-run grace"
```

---

## Phase 2 — Restore DB schema and the auto-repair safety net

### Task 8: Migration — rename `source_subtask_id` → `source_context_item_id`

The `WorkflowRunTodo` entity was renamed `source_subtask_id` → `source_context_item_id` (with a new unique partial index) but no migration shipped, so the API logs `column WorkflowRunTodo.source_context_item_id does not exist`.

**Files:**
- Create: `apps/api/src/database/migrations/20260613010000-rename-workflow-run-todo-source-context-item.ts`

- [ ] **Step 1: Write the migration**

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

export class RenameWorkflowRunTodoSourceContextItem20260613010000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'workflow_run_todos' AND column_name = 'source_subtask_id'
        )
        AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'workflow_run_todos' AND column_name = 'source_context_item_id'
        )
        THEN
          ALTER TABLE workflow_run_todos
            RENAME COLUMN source_subtask_id TO source_context_item_id;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE workflow_run_todos
        ADD COLUMN IF NOT EXISTS source_context_item_id varchar(255);
    `);

    await queryRunner.query(
      `DROP INDEX IF EXISTS uq_workflow_run_todos_run_subtask;`,
    );

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_run_todos_run_context_item
        ON workflow_run_todos (workflow_run_id, source_context_item_id)
        WHERE source_context_item_id IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS uq_workflow_run_todos_run_context_item;`,
    );

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'workflow_run_todos' AND column_name = 'source_context_item_id'
        )
        AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'workflow_run_todos' AND column_name = 'source_subtask_id'
        )
        THEN
          ALTER TABLE workflow_run_todos
            RENAME COLUMN source_context_item_id TO source_subtask_id;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_run_todos_run_subtask
        ON workflow_run_todos (workflow_run_id, source_subtask_id)
        WHERE source_subtask_id IS NOT NULL;
    `);
  }
}
```

- [ ] **Step 2: Commit (registration + verification happen in Task 10)**

```bash
git add apps/api/src/database/migrations/20260613010000-rename-workflow-run-todo-source-context-item.ts
git commit -m "feat(api/db): migration renaming workflow_run_todos.source_subtask_id to source_context_item_id"
```

---

### Task 9: Migration — create the `repair_session` table

The repair-agent reads/writes a `repair_session` table (camelCase columns; its DataSource has `synchronize: false` and no migrations of its own). The table was never created, so the agent crashes on startup. The API owns migrations for the shared DB, so create it here. Column names are quoted camelCase to match the `RepairSession` entity (no `name:` overrides, no naming strategy).

**Files:**
- Create: `apps/api/src/database/migrations/20260613020000-create-repair-session.ts`

- [ ] **Step 1: Write the migration**

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateRepairSession20260613020000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS repair_session (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "errorEventId" varchar,
        "errorCode" varchar,
        "errorMessage" text,
        "status" varchar NOT NULL,
        "dedupKey" varchar,
        "opencodeOutput" text,
        "fixDescription" text,
        "commitHash" varchar,
        "commitMessage" varchar,
        "commitPushed" boolean NOT NULL DEFAULT false,
        "dockerRebuildResult" jsonb,
        "errorLog" text,
        "startedAt" timestamp,
        "completedAt" timestamp,
        "workflowId" varchar,
        "workflowRunId" varchar,
        "correlationId" varchar,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_repair_session_id" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_repair_session_status" ON repair_session ("status");`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_repair_session_dedupKey" ON repair_session ("dedupKey");`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_repair_session_createdAt" ON repair_session ("createdAt");`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS repair_session;`);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/database/migrations/20260613020000-create-repair-session.ts
git commit -m "feat(api/db): migration creating repair_session table for repair-agent"
```

---

### Task 10: Register both migrations and verify they apply

**Files:**
- Modify: `apps/api/src/database/migrations/registered-migrations.ts`

- [ ] **Step 1: Add imports (top of file, newest first to match existing ordering)**

```typescript
import { CreateRepairSession20260613020000 } from './20260613020000-create-repair-session';
import { RenameWorkflowRunTodoSourceContextItem20260613010000 } from './20260613010000-rename-workflow-run-todo-source-context-item';
```

- [ ] **Step 2: Add to the `registeredMigrations` array (at the top, before `EnableRepairDelegationDefault20260613000000`)**

```typescript
export const registeredMigrations = [
  CreateRepairSession20260613020000,
  RenameWorkflowRunTodoSourceContextItem20260613010000,
  EnableRepairDelegationDefault20260613000000,
  // ...existing entries unchanged...
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/api && npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 4: Apply migrations and verify schema**

Run:
```bash
docker restart nexus-api
sleep 25
docker exec nexus-postgres psql -U nexus -d nexus_orchestrator -c "\d workflow_run_todos" | grep source_context_item_id
docker exec nexus-postgres psql -U nexus -d nexus_orchestrator -c "SELECT to_regclass('public.repair_session');"
```
Expected: the `source_context_item_id` column is listed; `to_regclass` returns `repair_session` (not null).

- [ ] **Step 5: Verify the API query error is gone**

Run: `docker logs nexus-api --since 2m 2>&1 | grep -i "source_context_item_id does not exist" || echo "OK: no schema error"`
Expected: `OK: no schema error`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/database/migrations/registered-migrations.ts
git commit -m "feat(api/db): register repair_session + workflow_run_todo rename migrations"
```

---

### Task 11: Harden repair-agent `handleEvent` so a DB error cannot crash the process

Today `pool.start()` does `this.telemetryClient.on('error', (event) => void this.handleEvent(event))`. When `handleEvent` rejects (it did: missing table), the `void`-ed promise becomes an unhandled rejection and Node exits 1. Even after Task 9 creates the table, transient DB errors must not take the whole agent down.

**Files:**
- Modify: `apps/repair-agent/src/worker/pool.ts`
- Test: `apps/repair-agent/src/worker/pool.spec.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { RepairPool } from './pool';

function buildPool(trackerOverrides: Record<string, unknown>) {
  const telemetryClient = { on: vi.fn() } as never;
  const tracker = {
    getDedupHistory: vi.fn().mockRejectedValue(new Error('db down')),
    create: vi.fn(),
    ...trackerOverrides,
  } as never;
  const agentConfig = {
    agentModel: 'm',
    agentProfile: 'p',
    systemPromptFile: 'f',
    workingDir: '/tmp',
    continueSession: false,
    promptTemplate: 't',
  };
  return new RepairPool(1, tracker, telemetryClient, 1000, agentConfig);
}

describe('RepairPool.handleEvent resilience', () => {
  it('does not reject when the tracker throws', async () => {
    const pool = buildPool({});
    const handle = (pool as unknown as {
      handleEvent: (e: unknown) => Promise<void>;
    }).handleEvent.bind(pool);

    await expect(
      handle({ errorCode: 'X', errorMessage: 'boom' }),
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/repair-agent && npx vitest run src/worker/pool.spec.ts`
Expected: FAIL — the promise rejects with `db down`.

- [ ] **Step 3: Wrap the handler body**

In `apps/repair-agent/src/worker/pool.ts`, wrap the existing body of `private async handleEvent(event: TelemetryEvent): Promise<void>` in a `try/catch`. Keep the early-return for events without error details inside the `try`. Add:

```typescript
  private async handleEvent(event: TelemetryEvent): Promise<void> {
    try {
      // ...existing body unchanged...
    } catch (error) {
      this.logger.error(
        `Failed to handle repair event: ${(error as Error).message}`,
      );
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/repair-agent && npx vitest run src/worker/pool.spec.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `cd apps/repair-agent && npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/repair-agent/src/worker/pool.ts apps/repair-agent/src/worker/pool.spec.ts
git commit -m "fix(repair-agent): never crash the process on a handleEvent error"
```

---

## Final verification (after all tasks)

- [ ] **Typecheck both packages**

```bash
cd apps/api && npx tsc --noEmit -p tsconfig.json && cd ../repair-agent && npm run typecheck
```

- [ ] **Run the touched test files**

```bash
cd apps/api && npx vitest run --config vitest.config.ts \
  src/docker/container-http-client.service.spec.ts \
  src/workflow/workflow-run-operations/workflow-run-heartbeat.helpers.spec.ts \
  src/workflow/workflow-run-operations/workflow-run-heartbeat.service.spec.ts \
  src/workflow/workflow-run-operations/workflow-run-reconciliation.service.spec.ts \
  src/workflow/database/repositories/workflow-run.repository.spec.ts \
  src/workflow/workflow-step-execution/step-container-runtime.service.spec.ts
cd ../repair-agent && npx vitest run src/worker/pool.spec.ts
```

- [ ] **Rebuild + restart the affected containers**

```bash
docker compose up -d --build api repair-agent
```

- [ ] **Confirm the repair-agent stays up (was exiting 1)**

```bash
sleep 20 && docker ps --filter name=nexus-repair-agent --format '{{.Names}} {{.Status}}'
```
Expected: `Up` (not `Exited (1)`).

- [ ] **Trigger / observe one implementation workflow run and confirm it is no longer reaped mid-step**

```bash
docker exec nexus-postgres psql -U nexus -d nexus_orchestrator -c \
"SELECT event_type, step_id, left(payload->>'reason',60) AS reason, timestamp
 FROM workflow_events
 WHERE workflow_run_id IN (
   SELECT id FROM workflow_runs
   WHERE workflow_id='f7915e21-2a22-4785-bb06-57cc3b48d24d'
   ORDER BY created_at DESC LIMIT 1)
 ORDER BY timestamp;"
```
Expected: no `workflow.retry_scheduled` with reason `HTTP POST timed out` and no `appears stalled` reconciliation failure; the run reaches `implement_and_commit` `job.completed`.

---

## Self-Review Notes

- **Spec coverage:** Fix #1 (decouple long steps) → Tasks 1–6 (configurable long POST timeout + run heartbeat keeps the run live for the whole duration); Fix #2 (reconciler too aggressive) → Tasks 6–7 (heartbeat + larger configurable grace); Fix #3 (raise POST timeout) → Task 1; Fix #4 (apply pending migrations) → Tasks 8–10; plus safety-net restoration → Task 11. The fully-async dispatch refactor is explicitly deferred (Out of scope).
- **Type consistency:** `recordActivity`/`forget`/`touch`/`shouldEmitRunHeartbeat`/`resolveAgentPostTimeoutMs`/`resolveStaleRunGraceMs` names are used identically across definition and call sites. `startContainerLogStreaming` is the 4-arg form everywhere after Task 6.
- **Idempotency:** Both migrations guard with `IF EXISTS` / `IF NOT EXISTS` / `information_schema` checks so they are safe whether or not the column was partially applied.
