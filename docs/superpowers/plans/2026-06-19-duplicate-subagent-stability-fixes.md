# Duplicate-Subagent & False-Reap Stability Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop a single workflow step from ending up with two live subagents doing the same work, and stop the watchdog/supervisor from falsely reaping healthy long-running fire-and-poll steps.

**Architecture:** Three layers of defence. (P0) Don't let a graceful API shutdown schedule retries on its way down. (P1) Make step re-dispatch and recovery authoritatively terminate every in-flight subagent of the prior attempt, backed by a DB idempotency guard and a startup orphan-reconciler. (P2) Stop the two false-positive reaps (`stale-run` and `container_lost`) that fire against a `workflow_step` parent which is intentionally idle while awaiting a live child subagent.

**Tech Stack:** NestJS (apps/api), TypeORM (Postgres), BullMQ, Vitest (SWC decorator metadata). Container lifecycle via Dockerode.

## Background — the incident this fixes

Run `ff9bfa0e` (step `implement`) spawned three subagents for one step; #2 and #3 ran concurrently:

1. Subagent #1 ran ~43 min, then the **stale-run watchdog** false-positived and cancelled it + scheduled a retry (`Run stalled: RUNNING with no active or queued step job`).
2. The retry spawned subagent #2.
3. A mid-run **API redeploy** tore down the parent step container → `workflow.host_mount.removed` → `container_lost` retry. Subagent #2's _child_ container survived the restart.
4. The restarted API spawned subagent #3 for the retry **without terminating the orphaned #2** → #2 and #3 ran the same work concurrently.

Confirmed structural causes (all present on `main`):

| ID  | Cause                                                                                                                                                                    | Evidence                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| RC1 | Watchdog immunity is heartbeat-dependent; `workflow_step` parents never heartbeat (`last_heartbeat_at` falls back to `created_at`).                                      | `execution-supervision.helpers.ts:90-96`; `workflow-run-reconciliation.service.ts:328-334` |
| RC2 | `supersedePriorExecutions` matches prior executions by `context_id = jobId`, which only catches `workflow_step` rows — never subagents (keyed by `parent_container_id`). | `step-execution-supersede.helpers.ts:20-23`; `execution.repository.ts:99-106`              |
| RC3 | Subagent cancel is best-effort and unverified; no reconciler terminates orphaned subagents after an API restart.                                                         | `subagent-orchestrator.coordination.operations.ts:57-58`                                   |
| RC4 | `container_lost` reaps fire-and-poll parents whose container is intentionally gone while a long child subagent runs; 90s grace is too short.                             | `execution-supervision.helpers.ts:12,52-70`                                                |
| RC5 | No idempotency guard against two non-terminal subagents for the same logical step.                                                                                       | `subagent-orchestrator.spawn.operations.ts:135-161`                                        |

## Global Constraints

- **No lint suppression** — never add `eslint-disable`, `@ts-ignore`, `@ts-nocheck`, or rule downgrades. Fix findings in code.
- **Strong typing** — shared contracts in `@nexus/core`; no `any`.
- **Core/Kanban boundary** — all changes are in `apps/api` execution/workflow internals; introduce no kanban/work-item identifiers.
- **NestJS build** — use `nest build`, not `tsc`. Tests rely on SWC decorator metadata; keep Vitest/SWC config unchanged.
- **TDD** — Red → Green → Refactor for every task. Run targeted tests: `npm run test --workspace=apps/api -- <file>`.
- **Migrations** — new DB constraints go through a TypeORM migration (see `adding-entity-migration` skill); migrations must be reversible.
- **Build `@nexus/core` first** if any contract changes: `npm run build --workspace=packages/core`.

---

## File Structure

| File                                                                                     | Responsibility                                         | Change                                                                           |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `apps/api/src/execution-lifecycle/execution-supervisor.service.ts`                       | Periodic supervisor sweep                              | Add shutdown gate (P0); skip `container_lost` for fire-and-poll parents (P2)     |
| `apps/api/src/workflow/workflow-run-operations/workflow-run-reconciliation.service.ts`   | Stale-run watchdog                                     | Add shutdown gate (P0); structural immunity for steps awaiting a live child (P2) |
| `apps/api/src/shutdown/shutdown-state.service.ts` _(new)_                                | Single source of truth for "API is shutting down"      | Create (P0)                                                                      |
| `apps/api/src/workflow/workflow-step-execution/step-execution-supersede.helpers.ts`      | Supersede prior step attempts                          | Return prior container ids so subagents can be cancelled (P1)                    |
| `apps/api/src/workflow/workflow-step-execution/step-execution-orchestrator.service.ts`   | Step dispatch                                          | Cancel prior attempts' subagents on redispatch (P1)                              |
| `apps/api/src/execution-lifecycle/database/repositories/execution.repository.ts`         | Execution persistence                                  | Add `findNonTerminalSubagentsByRun` (P1, P1-orphan)                              |
| `apps/api/src/workflow/workflow-subagents/subagent-coordination.service.ts`              | Subagent cancel                                        | Verify container death after cancel (P1)                                         |
| `apps/api/src/workflow/workflow-subagents/subagent-orphan-reconciler.service.ts` _(new)_ | Terminate orphaned subagents on startup + periodically | Create (P1)                                                                      |
| `apps/api/src/database/migrations/<ts>-subagent-active-uniqueness.ts` _(new)_            | DB idempotency guard                                   | Create (P1)                                                                      |
| `apps/api/src/execution-lifecycle/execution-supervision.helpers.ts`                      | Pure reaping classifier                                | Exempt fire-and-poll parents from `container_lost` (P2)                          |

---

# Phase P0 — Stop retries during graceful shutdown

### Task 1: Shutdown-state service

**Files:**

- Create: `apps/api/src/shutdown/shutdown-state.service.ts`
- Create: `apps/api/src/shutdown/shutdown-state.module.ts`
- Test: `apps/api/src/shutdown/shutdown-state.service.spec.ts`

**Interfaces:**

- Produces: `ShutdownStateService` with `isShuttingDown(): boolean` and `onApplicationShutdown(): void` (sets the flag).

- [ ] **Step 1: Write the failing test**

```typescript
import { ShutdownStateService } from "./shutdown-state.service";

describe("ShutdownStateService", () => {
  it("reports false until shutdown begins, true after", () => {
    const svc = new ShutdownStateService();
    expect(svc.isShuttingDown()).toBe(false);
    svc.onApplicationShutdown();
    expect(svc.isShuttingDown()).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- shutdown-state.service.spec.ts`
Expected: FAIL — cannot find module `./shutdown-state.service`.

- [ ] **Step 3: Write minimal implementation**

```typescript
import { Injectable, OnApplicationShutdown } from "@nestjs/common";

@Injectable()
export class ShutdownStateService implements OnApplicationShutdown {
  private shuttingDown = false;

  isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  onApplicationShutdown(): void {
    this.shuttingDown = true;
  }
}
```

```typescript
// shutdown-state.module.ts
import { Global, Module } from "@nestjs/common";
import { ShutdownStateService } from "./shutdown-state.service";

@Global()
@Module({
  providers: [ShutdownStateService],
  exports: [ShutdownStateService],
})
export class ShutdownStateModule {}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=apps/api -- shutdown-state.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Register the module and enable shutdown hooks**

Import `ShutdownStateModule` in `apps/api/src/app.module.ts` imports array, and confirm `app.enableShutdownHooks()` is called in `apps/api/src/main.ts` (add it if missing — required for `onApplicationShutdown` to fire).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/shutdown apps/api/src/app.module.ts apps/api/src/main.ts
git commit -m "feat(shutdown): add ShutdownStateService tracking graceful shutdown"
```

### Task 2: Gate the supervisor sweep and stale-run watchdog on shutdown

**Files:**

- Modify: `apps/api/src/execution-lifecycle/execution-supervisor.service.ts` (`sweepOnce`)
- Modify: `apps/api/src/workflow/workflow-run-operations/workflow-run-reconciliation.service.ts` (`reconcileOnce`/tick entrypoint)
- Test: `apps/api/src/execution-lifecycle/execution-supervisor.service.spec.ts`
- Test: `apps/api/src/workflow/workflow-run-operations/workflow-run-reconciliation.service.spec.ts`

**Interfaces:**

- Consumes: `ShutdownStateService.isShuttingDown()` from Task 1.

- [ ] **Step 1: Write the failing test (supervisor)**

```typescript
it("skips the sweep entirely when the API is shutting down", async () => {
  shutdownState.isShuttingDown.mockReturnValue(true);
  await service.sweepOnce();
  expect(executionRepo.findNonTerminal).not.toHaveBeenCalled();
});
```

(Mirror it for the watchdog: `reconcileOnce` returns early and `runRepo.findByStatus` is not called when `isShuttingDown()` is true.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace=apps/api -- execution-supervisor.service.spec.ts workflow-run-reconciliation.service.spec.ts`
Expected: FAIL — the sweep still queries the repo.

- [ ] **Step 3: Inject `ShutdownStateService` and guard both entrypoints**

In each service constructor add `private readonly shutdownState: ShutdownStateService`. At the top of `sweepOnce()` and the watchdog tick:

```typescript
if (this.shutdownState.isShuttingDown()) {
  this.logger.log("Skipping reap/reconcile: API is shutting down");
  return;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace=apps/api -- execution-supervisor.service.spec.ts workflow-run-reconciliation.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/execution-lifecycle/execution-supervisor.service.ts apps/api/src/workflow/workflow-run-operations/workflow-run-reconciliation.service.ts apps/api/src/**/*.spec.ts
git commit -m "fix(execution): suppress reap and stale-run retries during graceful shutdown"
```

---

# Phase P1 — Eliminate the duplicate-subagent class

### Task 3: Repository finder for a run's non-terminal subagents

**Files:**

- Modify: `apps/api/src/execution-lifecycle/database/repositories/execution.repository.ts`
- Test: `apps/api/src/execution-lifecycle/database/repositories/execution.repository.spec.ts`

**Interfaces:**

- Produces: `findNonTerminalSubagentsByRun(workflowRunId: string): Promise<ExecutionEntity[]>` — returns executions where `kind = 'subagent'`, `workflow_run_id = :id`, and `state NOT IN (terminal states)`. Used by Tasks 4 and 7.

- [ ] **Step 1: Write the failing test**

```typescript
it("returns only non-terminal subagent executions for the run", async () => {
  // seed: subagent running (run A), subagent completed (run A), workflow_step running (run A), subagent running (run B)
  const rows = await repo.findNonTerminalSubagentsByRun(runA);
  expect(rows.map((r) => r.id)).toEqual([subagentRunningA.id]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- execution.repository.spec.ts`
Expected: FAIL — `findNonTerminalSubagentsByRun is not a function`.

- [ ] **Step 3: Implement the finder**

```typescript
import { TERMINAL_EXECUTION_STATES } from '../../execution-transition.helpers';
import { Not, In } from 'typeorm';

async findNonTerminalSubagentsByRun(
  workflowRunId: string,
): Promise<ExecutionEntity[]> {
  return this.repository.find({
    where: {
      workflow_run_id: workflowRunId,
      kind: 'subagent',
      state: Not(In([...TERMINAL_EXECUTION_STATES])),
    },
  });
}
```

If `TERMINAL_EXECUTION_STATES` does not already exist, add it next to `isTerminalState` in `execution-transition.helpers.ts` as `export const TERMINAL_EXECUTION_STATES = ['completed', 'failed', 'cancelled', 'reaped'] as const;` and refactor `isTerminalState` to use it (keeps the list DRY).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=apps/api -- execution.repository.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/execution-lifecycle
git commit -m "feat(execution): add findNonTerminalSubagentsByRun finder"
```

### Task 4: Cascade supersession to in-flight subagents on redispatch

**Files:**

- Modify: `apps/api/src/workflow/workflow-step-execution/step-execution-supersede.helpers.ts`
- Modify: `apps/api/src/workflow/workflow-step-execution/step-execution-orchestrator.service.ts:236-243`
- Test: `apps/api/src/workflow/workflow-step-execution/step-execution-supersede.helpers.spec.ts`

**Interfaces:**

- Consumes: `ExecutionRepository.findByWorkflowRunAndJob`, `applyTransition` (existing); `SubagentCoordinationService.cancelActiveForParent(parentContainerId, { workflowRunId, reason })` → `{ cancelled_execution_ids: string[] }` (existing, `subagent-coordination.service.ts:187`).
- Produces: `supersedePriorExecutions(...)` now returns `string[]` — the `container_id`s of the prior `workflow_step` executions it superseded.

- [ ] **Step 1: Write the failing test**

```typescript
it("returns superseded workflow_step container ids so callers can cancel their subagents", async () => {
  executionRepo.findByWorkflowRunAndJob.mockResolvedValue([
    { id: "e1", state: "running", container_id: "c1" },
    { id: "e2", state: "completed", container_id: "c2" }, // terminal — skipped
  ]);
  const containers = await supersedePriorExecutions({
    executionRepo,
    workflowRunId: "r1",
    jobId: "j1",
    log: () => {},
  });
  expect(containers).toEqual(["c1"]);
  expect(executionRepo.applyTransition).toHaveBeenCalledWith(
    "e1",
    "cancelled",
    expect.anything(),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- step-execution-supersede.helpers.spec.ts`
Expected: FAIL — function returns `void`.

- [ ] **Step 3: Make the helper return prior container ids**

```typescript
export async function supersedePriorExecutions(params: {
  executionRepo: Pick<
    ExecutionRepository,
    "findByWorkflowRunAndJob" | "applyTransition"
  >;
  workflowRunId: string;
  jobId: string;
  log: (message: string) => void;
}): Promise<string[]> {
  const { executionRepo, workflowRunId, jobId, log } = params;
  const priorExecutions = await executionRepo.findByWorkflowRunAndJob(
    workflowRunId,
    jobId,
  );
  const supersededContainerIds: string[] = [];
  for (const prior of priorExecutions) {
    if (isTerminalState(prior.state)) continue;
    await executionRepo.applyTransition(prior.id, "cancelled", {
      failure_reason: "superseded",
      error_message: `Superseded by a newer execution for job ${jobId}`,
    });
    if (prior.container_id) supersededContainerIds.push(prior.container_id);
    log(
      `Superseded prior execution ${prior.id} for job ${jobId} in run ${workflowRunId}`,
    );
  }
  return supersededContainerIds;
}
```

- [ ] **Step 4: Cancel subagents under each superseded container in the orchestrator**

In `step-execution-orchestrator.service.ts`, replace the call at line 236 with:

```typescript
const supersededContainerIds = await supersedePriorExecutions({
  executionRepo: this.executionRepo,
  workflowRunId,
  jobId,
  log: (message) => this.logger.log(message),
});
for (const parentContainerId of supersededContainerIds) {
  const { cancelled_execution_ids } =
    await this.subagentCoordination.cancelActiveForParent(parentContainerId, {
      workflowRunId,
      reason: "parent step superseded by retry",
    });
  if (cancelled_execution_ids.length > 0) {
    this.logger.warn(
      `Cancelled ${cancelled_execution_ids.length} in-flight subagent(s) under superseded container ${parentContainerId} (run ${workflowRunId} job ${jobId})`,
    );
  }
}
```

Inject `SubagentCoordinationService` into the orchestrator constructor (import from `workflow-subagents`; the orchestrator is in `WorkflowStepExecutionModule`, which must import `WorkflowSubagentsModule` — add it to the module `imports` if not already present, and export `SubagentCoordinationService` from `WorkflowSubagentsModule`).

- [ ] **Step 5: Write the orchestrator test**

```typescript
it("cancels in-flight subagents of the superseded attempt before dispatching the retry", async () => {
  executionRepo.findByWorkflowRunAndJob.mockResolvedValue([
    { id: "e1", state: "running", container_id: "c1" },
  ]);
  subagentCoordination.cancelActiveForParent.mockResolvedValue({
    cancelled_execution_ids: ["s1"],
  });
  await orchestrator.dispatchJob(/* run r1, job j1 */);
  expect(subagentCoordination.cancelActiveForParent).toHaveBeenCalledWith(
    "c1",
    expect.objectContaining({ workflowRunId: "r1" }),
  );
});
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test --workspace=apps/api -- step-execution-supersede.helpers.spec.ts step-execution-orchestrator.service.spec.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/workflow/workflow-step-execution
git commit -m "fix(workflow): cancel prior attempt's in-flight subagents on step redispatch"
```

### Task 5: Make subagent cancellation verify container death

**Files:**

- Modify: `apps/api/src/workflow/workflow-subagents/subagent-orchestrator.coordination.operations.ts:42-70`
- Test: `apps/api/src/workflow/workflow-subagents/subagent-orchestrator.coordination.operations.spec.ts`

**Interfaces:**

- Consumes: `SubagentContainerLivenessProbe.isContainerLost(containerId): Promise<boolean>` (`subagent-container-liveness.probe.ts:16`); `containerOrchestrator.removeContainer(containerId)` (existing).

- [ ] **Step 1: Write the failing test**

```typescript
it("re-issues removeContainer when the child container is still alive after the first removal", async () => {
  liveness.isContainerLost
    .mockResolvedValueOnce(false)
    .mockResolvedValueOnce(true); // alive, then gone
  await cancelSubagentExecutionOperation(context, {
    execution: { child_container_id: "cc1" } /* ... */,
  });
  expect(context.containerOrchestrator.removeContainer).toHaveBeenCalledTimes(
    2,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- subagent-orchestrator.coordination.operations.spec.ts`
Expected: FAIL — `removeContainer` called once, no liveness re-check.

- [ ] **Step 3: Add post-removal verification with bounded retries**

After the existing `removeContainer` call, add (constant at top of file: `const CANCEL_VERIFY_ATTEMPTS = 3;`):

```typescript
for (let attempt = 0; attempt < CANCEL_VERIFY_ATTEMPTS; attempt++) {
  if (await context.liveness.isContainerLost(childContainerId))
    return cancelled;
  await context.containerOrchestrator.removeContainer(childContainerId);
}
context.logger.warn(
  `Subagent ${execution.id} container ${childContainerId} still alive after ${CANCEL_VERIFY_ATTEMPTS} removal attempts; leaving for orphan reconciler`,
);
```

Thread `liveness` and `logger` into `SubagentCoordinationOperationsContext` (add to the context factory in `subagent-coordination.service.ts`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=apps/api -- subagent-orchestrator.coordination.operations.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/workflow/workflow-subagents
git commit -m "fix(subagents): verify child container death on cancel, retry removal"
```

### Task 6: Startup + periodic orphan-subagent reconciler

**Files:**

- Create: `apps/api/src/workflow/workflow-subagents/subagent-orphan-reconciler.service.ts`
- Modify: `apps/api/src/workflow/workflow-subagents/workflow-subagents.module.ts` (register provider)
- Test: `apps/api/src/workflow/workflow-subagents/subagent-orphan-reconciler.service.spec.ts`

**Interfaces:**

- Consumes: `ExecutionRepository.findNonTerminalSubagentsByRun` (Task 3); `WorkflowRunRepository.findById`; `SubagentCoordinationService.cancelActiveForParent`; `ShutdownStateService.isShuttingDown` (Task 1).
- Produces: `reconcileOrphans(): Promise<number>` — cancels every non-terminal subagent whose run is in a terminal status (`COMPLETED`/`FAILED`/`CANCELLED`) or whose parent `workflow_step` execution is terminal/superseded. Returns count cancelled. Runs `onApplicationBootstrap` and on a 60s interval.

- [ ] **Step 1: Write the failing test**

```typescript
it("cancels a non-terminal subagent whose run has already finished", async () => {
  executionRepo.findNonTerminalSubagentsByRun.mockResolvedValue([
    { id: "s1", parent_container_id: "c1", workflow_run_id: "r1" },
  ]);
  runRepo.findById.mockResolvedValue({ id: "r1", status: "COMPLETED" });
  const count = await reconciler.reconcileOrphans();
  expect(count).toBe(1);
  expect(subagentCoordination.cancelActiveForParent).toHaveBeenCalledWith(
    "c1",
    expect.objectContaining({ reason: expect.stringContaining("orphan") }),
  );
});
```

Note: the reconciler must enumerate candidate runs first. Add `ExecutionRepository.findRunIdsWithNonTerminalSubagents(): Promise<string[]>` (a `SELECT DISTINCT workflow_run_id`) if no equivalent exists, and test it in Task 3's spec file as a small addition.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- subagent-orphan-reconciler.service.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the reconciler**

```typescript
import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";

const RECONCILE_INTERVAL_MS = 60_000;
const ORPHAN_REASON = "orphaned subagent reconciled (run/parent terminal)";

@Injectable()
export class SubagentOrphanReconcilerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SubagentOrphanReconcilerService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly executionRepo: ExecutionRepository,
    private readonly runRepo: WorkflowRunRepository,
    private readonly subagentCoordination: SubagentCoordinationService,
    private readonly shutdownState: ShutdownStateService,
  ) {}

  onApplicationBootstrap(): void {
    void this.reconcileOrphans();
    this.timer = setInterval(
      () => void this.reconcileOrphans(),
      RECONCILE_INTERVAL_MS,
    );
    this.timer.unref?.();
  }

  async reconcileOrphans(): Promise<number> {
    if (this.shutdownState.isShuttingDown()) return 0;
    let cancelled = 0;
    const runIds =
      await this.executionRepo.findRunIdsWithNonTerminalSubagents();
    for (const runId of runIds) {
      const run = await this.runRepo.findById(runId);
      const runFinished =
        !run || ["COMPLETED", "FAILED", "CANCELLED"].includes(run.status);
      if (!runFinished) continue;
      const subs =
        await this.executionRepo.findNonTerminalSubagentsByRun(runId);
      const parents = new Set(
        subs.map((s) => s.parent_container_id).filter(Boolean),
      );
      for (const parentContainerId of parents) {
        const { cancelled_execution_ids } =
          await this.subagentCoordination.cancelActiveForParent(
            parentContainerId,
            { workflowRunId: runId, reason: ORPHAN_REASON },
          );
        cancelled += cancelled_execution_ids.length;
      }
    }
    if (cancelled > 0)
      this.logger.warn(`Reconciled ${cancelled} orphaned subagent(s)`);
    return cancelled;
  }
}
```

Register it in `workflow-subagents.module.ts` providers.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=apps/api -- subagent-orphan-reconciler.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/workflow/workflow-subagents
git commit -m "feat(subagents): orphan reconciler terminates subagents of finished runs"
```

### Task 7: DB idempotency guard — at most one active subagent per (run, parent, role)

**Files:**

- Create: `apps/api/src/database/migrations/<timestamp>-subagent-active-uniqueness.ts`
- Modify: `apps/api/src/workflow/workflow-subagents/subagent-orchestrator.spawn.operations.ts:135-161` (`resolveActiveExecutions`)
- Test: `apps/api/src/workflow/workflow-subagents/subagent-orchestrator.spawn.operations.spec.ts`

**Interfaces:**

- Consumes: existing concurrency check; `SubagentExecutionReadModel.findByParentContainerId`.

- [ ] **Step 1: Write the failing test (application-level guard)**

```typescript
it("rejects a spawn when a non-terminal subagent already exists for the same parent + role", async () => {
  readModel.findByParentContainerId.mockResolvedValue([
    { id: "s1", status: "Running", role: "implement" },
  ]);
  await expect(
    spawnSubagent(context, { parentContainerId: "c1", role: "implement" }),
  ).rejects.toMatchObject({
    response: { code: "duplicate_subagent_for_step" },
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- subagent-orchestrator.spawn.operations.spec.ts`
Expected: FAIL — duplicate spawn currently allowed.

- [ ] **Step 3: Add the application guard in `resolveActiveExecutions`**

```typescript
const duplicateForRole = activeExecutions.find((e) => e.role === params.role);
if (duplicateForRole) {
  throw new BadRequestException({
    code: "duplicate_subagent_for_step",
    message: `A non-terminal subagent (${duplicateForRole.id}) already exists for parent ${parentContainerId} role ${params.role}`,
  });
}
```

- [ ] **Step 4: Add the DB backstop migration**

Partial unique index on the satellite/executions join so the race can never persist two active rows. Use the consolidated `executions` table filtered to `kind='subagent'` joined logically to `subagent_details(parent_container_id, role)`; since a partial index can't span tables, add `parent_container_id` + `role` columns onto a view or store them on `executions` if available — otherwise create the partial unique index on `subagent_details` keyed by `(parent_container_id, role)` filtered to rows whose `execution_id` is non-terminal via a trigger-maintained `is_active` boolean. Simplest reversible form:

```typescript
export class SubagentActiveUniqueness<timestamp> implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE subagent_details ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true`,
    );
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_subagent_active_per_parent_role
      ON subagent_details(parent_container_id, role) WHERE is_active`);
  }
  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS uq_subagent_active_per_parent_role`);
    await q.query(
      `ALTER TABLE subagent_details DROP COLUMN IF EXISTS is_active`,
    );
  }
}
```

Set `is_active = false` wherever a subagent reaches a terminal state (in the cancel/complete write path — `cancelSubagentExecutionOperation` and the completion writer). Add `role` to `subagent_details` in the same migration if it is not already persisted there.

- [ ] **Step 5: Run test + migration**

Run: `npm run test --workspace=apps/api -- subagent-orchestrator.spawn.operations.spec.ts`
Expected: PASS. Then apply the migration against the local stack and confirm it is reversible (`migration:run` then `migration:revert`).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/workflow/workflow-subagents apps/api/src/database/migrations
git commit -m "feat(subagents): reject and DB-guard duplicate active subagent per step"
```

---

# Phase P2 — Stop the false reaps that trigger retries

### Task 8: Exempt fire-and-poll parents from `container_lost`

**Files:**

- Modify: `apps/api/src/execution-lifecycle/execution-supervision.helpers.ts:61-102`
- Modify: `apps/api/src/execution-lifecycle/execution-supervision.helpers.types.ts` (extend `SupervisionInput`)
- Modify: `apps/api/src/execution-lifecycle/execution-supervisor.service.ts` (populate the new field)
- Test: `apps/api/src/execution-lifecycle/execution-supervision.helpers.spec.ts`

**Interfaces:**

- Produces: `SupervisionInput.hasLiveChildSubagent?: boolean`. When a `workflow_step` parent has a live child subagent, `classifyExecutionForReaping` must NOT return `container_lost` (its container is intentionally gone). `max_runtime_exceeded` still applies as a hard ceiling.

- [ ] **Step 1: Write the failing test**

```typescript
it("does not reap a workflow_step container_lost while a child subagent is live", () => {
  const input = {
    kind: "workflow_step",
    state: "running",
    createdAtMs: now - 60_000,
    lastHeartbeatAtMs: now - 60_000,
    containerLost: true,
    containerLostForMs: 999_999,
    hasLiveChildSubagent: true,
  };
  expect(classifyExecutionForReaping(input, now)).toBeNull();
});

it("still reaps a workflow_step container_lost when no child subagent is live", () => {
  const input = {
    kind: "workflow_step",
    state: "running",
    createdAtMs: now - 60_000,
    lastHeartbeatAtMs: now - 60_000,
    containerLost: true,
    containerLostForMs: 999_999,
    hasLiveChildSubagent: false,
  };
  expect(classifyExecutionForReaping(input, now)).toBe("container_lost");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- execution-supervision.helpers.spec.ts`
Expected: FAIL — field not honoured.

- [ ] **Step 3: Implement the exemption**

In `classifyExecutionForReaping`, replace the leading container-lost check:

```typescript
if (isContainerLostBeyondGrace(input, containerLostGraceMs)) {
  const isFireAndPollParentAwaitingChild =
    input.kind === "workflow_step" && input.hasLiveChildSubagent === true;
  if (!isFireAndPollParentAwaitingChild) {
    return "container_lost";
  }
}
```

Add `hasLiveChildSubagent?: boolean;` to `SupervisionInput`. In `execution-supervisor.service.ts`, when building the input for a `workflow_step` row, set it by checking the run's non-terminal subagents (reuse Task 3's finder, batched per sweep to avoid N+1).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=apps/api -- execution-supervision.helpers.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/execution-lifecycle
git commit -m "fix(execution): don't reap fire-and-poll parent as container_lost while child subagent is live"
```

### Task 9: Structural watchdog immunity for steps awaiting a live child

**Files:**

- Modify: `apps/api/src/workflow/workflow-run-operations/workflow-run-reconciliation.service.ts:279-341` (`findNonTerminalExecutionIndex`)
- Test: `apps/api/src/workflow/workflow-run-operations/workflow-run-reconciliation.service.spec.ts`

**Interfaces:**

- Consumes: `ExecutionRepository.findNonTerminal()` (already loaded in the index). The fix uses the already-fetched list — no new query.

- [ ] **Step 1: Write the failing test**

```typescript
it("immunises a run whose only fresh activity is a live child subagent, even when the parent step row looks stale", async () => {
  executionRepo.findNonTerminal.mockResolvedValue([
    {
      id: "parent",
      kind: "workflow_step",
      workflow_run_id: "r1",
      container_id: "c1",
      created_at: ageMs(45 * 60_000),
    }, // stale parent, no heartbeat
    {
      id: "child",
      kind: "subagent",
      workflow_run_id: "r1",
      parent_container_id: "c1",
      last_heartbeat_at: ageMs(10_000),
    }, // fresh child
  ]);
  const { activeRunIds } = await service.findNonTerminalExecutionIndex(now);
  expect(activeRunIds.has("r1")).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- workflow-run-reconciliation.service.spec.ts`
Expected: FAIL — only the never-heartbeating parent is considered, so the run is not immunised.

- [ ] **Step 3: Make any fresh child subagent immunise its run**

Within the existing loop over `executions` in `findNonTerminalExecutionIndex`, the freshness check (`lastActivity` within grace → `activeRunIds.add(runId)`) already runs for every non-terminal execution including subagents. The failing case occurs when the child's `last_heartbeat_at` is itself stale because subagent heartbeats aren't being persisted. Add a structural fallback: a non-terminal `workflow_step` with a non-terminal child subagent in the same run immunises the run regardless of heartbeat age. After building the maps, before returning:

```typescript
const runsWithLiveChild = new Set<string>();
for (const execution of executions) {
  if (execution.kind === "subagent" && execution.workflow_run_id) {
    runsWithLiveChild.add(execution.workflow_run_id);
  }
}
for (const runId of runsWithLiveChild) {
  if (parentContainerIdsByRunId.has(runId)) {
    activeRunIds.add(runId); // step is awaiting a live child — never "stalled"
  }
}
```

This is intentionally heartbeat-independent: a non-terminal child subagent means real work is in flight (or, if the child is itself dead, the orphan reconciler from Task 6 cleans it up — the watchdog should not also race to retry).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=apps/api -- workflow-run-reconciliation.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/workflow/workflow-run-operations
git commit -m "fix(workflow): immunise stale-run watchdog for steps awaiting a live child subagent"
```

---

# Verification (whole-suite gate)

- [ ] **Build core + API:** `npm run build --workspace=packages/core && npm run build:api`
- [ ] **Lint:** `npm run lint:api`
- [ ] **Full API unit suite:** `npm run test:api`
- [ ] **Rebuild + redeploy the stack** (the incident's proximate trigger was a stale image): `docker compose up -d --build`
- [ ] **Live re-verify:** launch a workflow with a long-running `implement` step (>10 min). Confirm: (a) no `stale-run` reap fires while the subagent is active; (b) forcing an API restart mid-step does not produce a second concurrent subagent — the orphan reconciler cancels the survivor; (c) the debug bundle for the run shows exactly one non-terminal subagent per step at any time. Use the `retrieve-debug-bundle` skill on the new run id.

# Docs

- [ ] Update `docs/architecture/` (execution-lifecycle / workflow runtime section) to document: fire-and-poll parents are exempt from `container_lost` while a child is live; the orphan reconciler; the shutdown gate; the active-subagent uniqueness guard.
- [ ] Update `docs/guide/README.md` if it describes subagent lifecycle or reaping behaviour.

# Self-review notes

- Spec coverage: RC1→Task 9; RC2→Tasks 3,4; RC3→Tasks 5,6; RC4→Task 8; RC5→Task 7; operational trigger→Tasks 1,2 + redeploy step.
- Type consistency: `findNonTerminalSubagentsByRun` (Task 3) is reused verbatim in Tasks 6 and 8; `supersedePriorExecutions` returns `string[]` (Task 4) consumed in the orchestrator; `hasLiveChildSubagent` (Task 8) added to `SupervisionInput` once.
- Open decision for Task 7: whether `role` already exists on `subagent_details`. If a per-step role/identifier is absent, the implementer must add it in the same migration; the uniqueness semantics depend on it. Flag to reviewer.
