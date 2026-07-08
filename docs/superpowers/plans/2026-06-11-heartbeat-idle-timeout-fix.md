# Heartbeat / Idle-Timeout Duplicate-Container Fix

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent the ExecutionSupervisorService from spuriously reaping `workflow_step` executions and triggering duplicate container launches.

**Architecture:** Three complementary fixes: (A) skip idle-timeout reaping for `workflow_step` kind executions entirely — they manage their own lifecycle; (B) wire container log activity into `ExecutionHeartbeatService` so `workflow_step` executions keep `last_heartbeat_at` fresh while running; (C) add a terminal-state guard in `StepExecutionCompletionListener` so a reaped event for a job that already completed can never schedule a retry.

**Tech Stack:** NestJS, TypeORM, Vitest, BullMQ. All changes are in `apps/api`.

---

## Root Cause (read before touching anything)

`workflow_step` executions never call `ExecutionHeartbeatService.recordActivity`. The supervisor's `classifyExecutionForReaping` falls back to `created_at` when `last_heartbeat_at` is null. After 15 minutes from `created_at` the execution is reaped — even if the job completed long ago — because the completion transition may have raced or a second execution entity was created by a BullMQ consumer retry.

When the execution is reaped, `StepExecutionCompletionListener.onExecutionFailed` blindly calls `handleJobFailed` → `scheduleWorkflowAutoRetry` → new container, giving two agents running simultaneously.

---

## File Map

| File                                                                                       | Change                                                                   |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `apps/api/src/execution-lifecycle/execution-supervision.helpers.types.ts`                  | Add `kind?: ExecutionKind` to `SupervisionInput`                         |
| `apps/api/src/execution-lifecycle/execution-supervision.helpers.ts`                        | Skip `idle_timeout` when `kind === 'workflow_step'`                      |
| `apps/api/src/execution-lifecycle/execution-supervisor.service.ts`                         | Pass `kind: row.kind` to `classifyExecutionForReaping`                   |
| `apps/api/src/execution-lifecycle/execution-supervision.helpers.spec.ts`                   | New tests for workflow_step exemption                                    |
| `apps/api/src/execution-lifecycle/execution-supervisor.service.spec.ts`                    | New test: workflow_step not idle-reaped                                  |
| `apps/api/src/execution-lifecycle/database/repositories/execution.repository.ts`           | Add `findByWorkflowRunAndJob`                                            |
| `apps/api/src/execution-lifecycle/database/repositories/execution.repository.spec.ts`      | Test new method                                                          |
| `apps/api/src/workflow/workflow-step-execution/step-execution-completion.listener.ts`      | Guard against retrying already-completed jobs                            |
| `apps/api/src/workflow/workflow-step-execution/step-execution-completion.listener.spec.ts` | Test guard                                                               |
| `apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.service.ts`        | Inject `ExecutionHeartbeatService`, accept `executionId`, wire heartbeat |
| `apps/api/src/workflow/workflow-step-execution/step-execution-orchestrator.service.ts`     | Pass `executionId` to `executeJob`                                       |

---

## Task 1: Fix A — Exclude `workflow_step` from idle-timeout reaping

**Files:**

- Modify: `apps/api/src/execution-lifecycle/execution-supervision.helpers.types.ts`
- Modify: `apps/api/src/execution-lifecycle/execution-supervision.helpers.ts`
- Modify: `apps/api/src/execution-lifecycle/execution-supervisor.service.ts`
- Test: `apps/api/src/execution-lifecycle/execution-supervision.helpers.spec.ts`
- Test: `apps/api/src/execution-lifecycle/execution-supervisor.service.spec.ts`

- [ ] **Step 1.1: Write failing tests**

Add to `apps/api/src/execution-lifecycle/execution-supervision.helpers.spec.ts`:

```typescript
it("does not idle-reap a workflow_step execution regardless of heartbeat age", () => {
  const now = 45 * 60_000;
  const verdict = classifyExecutionForReaping(
    {
      ...base,
      kind: "workflow_step",
      lastHeartbeatAtMs: 0, // no heartbeat ever — would normally reap
    },
    now,
  );
  expect(verdict).toBeNull();
});

it("still reaps workflow_step for container_lost", () => {
  const now = 60_000;
  const verdict = classifyExecutionForReaping(
    { ...base, kind: "workflow_step", containerLost: true },
    now,
  );
  expect(verdict).toBe("container_lost");
});

it("still reaps workflow_step for max_runtime_exceeded", () => {
  const now = DEFAULT_MAX_RUNTIME_MS + 1;
  const verdict = classifyExecutionForReaping(
    { ...base, kind: "workflow_step", createdAtMs: 0, lastHeartbeatAtMs: now },
    now,
  );
  expect(verdict).toBe("max_runtime_exceeded");
});
```

Add to `apps/api/src/execution-lifecycle/execution-supervisor.service.spec.ts`:

```typescript
it("does not reap a workflow_step execution even past the idle timeout", async () => {
  const now = 60 * 60_000;
  const repo = {
    findNonTerminal: vi.fn().mockResolvedValue([
      {
        id: "step-exec",
        kind: "workflow_step",
        state: "running",
        created_at: new Date(0),
        last_heartbeat_at: null,
        container_id: null,
      },
    ]),
  };
  const publisher = { reaped: vi.fn().mockResolvedValue(undefined) };
  const docker = { isContainerLost: vi.fn().mockResolvedValue(false) };
  const service = new ExecutionSupervisorService(
    repo as never,
    publisher as never,
    docker,
  );
  (service as unknown as { now: () => number }).now = () => now;

  await service.sweepOnce();

  expect(publisher.reaped).not.toHaveBeenCalled();
});
```

- [ ] **Step 1.2: Run to confirm tests fail**

```bash
npm run test --workspace=apps/api -- execution-supervision.helpers.spec
npm run test --workspace=apps/api -- execution-supervisor.service.spec
```

Expected: FAIL — `classifyExecutionForReaping` has no `kind` field yet.

- [ ] **Step 1.3: Add `kind` to `SupervisionInput`**

Full replacement for `apps/api/src/execution-lifecycle/execution-supervision.helpers.types.ts`:

```typescript
import type {
  ExecutionKind,
  ExecutionState,
} from "./execution-lifecycle.contracts";

export interface SupervisionInput {
  kind?: ExecutionKind;
  state: ExecutionState;
  createdAtMs: number;
  lastHeartbeatAtMs: number;
  containerLost: boolean;
}
```

- [ ] **Step 1.4: Add workflow_step guard in `classifyExecutionForReaping`**

In `apps/api/src/execution-lifecycle/execution-supervision.helpers.ts`, replace the function body:

```typescript
export function classifyExecutionForReaping(
  input: SupervisionInput,
  nowMs: number,
  idleTimeoutMs: number = DEFAULT_IDLE_TIMEOUT_MS,
  maxRuntimeMs: number = DEFAULT_MAX_RUNTIME_MS,
): ExecutionFailureReason | null {
  if (input.containerLost) {
    return "container_lost";
  }
  if (nowMs - input.createdAtMs > maxRuntimeMs) {
    return "max_runtime_exceeded";
  }
  if (input.state === "awaiting_input") {
    return null;
  }
  // workflow_step executions manage their own lifecycle via StepExecutionCompletionListener.
  // They never receive heartbeats through the telemetry gateway, so last_heartbeat_at
  // falls back to created_at — making every workflow_step trip idle_timeout after 15 min.
  // container_lost and max_runtime_exceeded still apply as hard safety nets.
  if (input.kind === "workflow_step") {
    return null;
  }
  if (nowMs - input.lastHeartbeatAtMs > idleTimeoutMs) {
    return "idle_timeout";
  }
  return null;
}
```

- [ ] **Step 1.5: Pass `kind` from the supervisor sweep**

In `apps/api/src/execution-lifecycle/execution-supervisor.service.ts`, update the `classifyExecutionForReaping` call inside `sweepOnce`:

```typescript
const reason = classifyExecutionForReaping(
  {
    kind: row.kind,
    state: row.state,
    createdAtMs: row.created_at.getTime(),
    lastHeartbeatAtMs: (row.last_heartbeat_at ?? row.created_at).getTime(),
    containerLost,
  },
  now,
  this.idleTimeoutMs,
  this.maxRuntimeMs,
);
```

- [ ] **Step 1.6: Run tests — confirm pass**

```bash
npm run test --workspace=apps/api -- execution-supervision.helpers.spec
npm run test --workspace=apps/api -- execution-supervisor.service.spec
```

Expected: all PASS.

- [ ] **Step 1.7: Type-check**

```bash
npm run build --workspace=packages/core && npx tsc --noEmit -p apps/api/tsconfig.json 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 1.8: Commit**

```bash
git add apps/api/src/execution-lifecycle/execution-supervision.helpers.types.ts \
        apps/api/src/execution-lifecycle/execution-supervision.helpers.ts \
        apps/api/src/execution-lifecycle/execution-supervisor.service.ts \
        apps/api/src/execution-lifecycle/execution-supervision.helpers.spec.ts \
        apps/api/src/execution-lifecycle/execution-supervisor.service.spec.ts
git commit -m "fix(execution): exempt workflow_step from idle-timeout reaping

workflow_step executions never receive heartbeats via the telemetry
gateway, so last_heartbeat_at is always null and the supervisor falls
back to created_at — reaping every step execution 15 min after creation
regardless of completion status. Exempt workflow_step from idle_timeout;
container_lost and max_runtime_exceeded still apply as hard safety nets."
```

---

## Task 2: Fix B — Wire container log activity into `ExecutionHeartbeatService`

**Files:**

- Modify: `apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.service.ts`
- Modify: `apps/api/src/workflow/workflow-step-execution/step-execution-orchestrator.service.ts`

> Note: No module changes needed — `ExecutionLifecycleModule` already exports `ExecutionHeartbeatService` and is already imported by `WorkflowStepExecutionModule`.

- [ ] **Step 2.1: Write the failing test**

`StepAgentStepExecutorService` is a complex class wired into a large dependency graph — testing the heartbeat call via a unit test of the executor itself would be heavy. Instead, we verify the contract via an integration-style spy on the `startContainerAndStreamLogs` callback. Add to a new `describe` block at the bottom of (or create) `apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.helpers.spec.ts` — but since the heartbeat is wired deep inside `createJobExecutionDependencies`, the simplest testable surface is the orchestrator forwarding `executionId`.

Add this test to `apps/api/src/workflow/workflow-step-execution/step-execution-orchestrator.service.spec.ts` (create the file if it doesn't exist — check first with `ls`):

```typescript
import { describe, expect, it, vi } from "vitest";

describe("StepExecutionOrchestratorService — executionId forwarding", () => {
  it("passes executionId to agentStepExecutor.executeJob", async () => {
    // We verify the forwarding contract by spying on executeJob
    // and checking the 5th argument is the executionId created for the execution.
    const executionId = "test-exec-uuid";
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => executionId) });

    const executeJobSpy = vi.fn().mockResolvedValue({ ok: true });
    const executionRepo = {
      create: vi.fn().mockResolvedValue({ id: executionId }),
      applyTransition: vi.fn().mockResolvedValue(null),
    };
    const executionEventPublisher = {
      created: vi.fn().mockResolvedValue(undefined),
      completed: vi.fn().mockResolvedValue(undefined),
      failed: vi.fn().mockResolvedValue(undefined),
    };
    const runRepo = {
      findById: vi
        .fn()
        .mockResolvedValue({ status: "running", state_variables: {} }),
    };

    // Minimal stub — we only test the executionId forwarding contract
    // Full orchestrator tests live in the integration suite
    const agentStepExecutor = { executeJob: executeJobSpy };

    // Import and instantiate via partial stub (constructor injection)
    const { StepExecutionOrchestratorService } =
      await import("./step-execution-orchestrator.service");

    const service = new StepExecutionOrchestratorService(
      runRepo as never,
      { publishBestEffort: vi.fn(), createEvent: vi.fn(() => ({})) } as never,
      { resolveJobInputs: vi.fn(() => ({})) } as never,
      { executeSpecialJob: vi.fn().mockResolvedValue(null) } as never,
      agentStepExecutor as never,
      {
        preflightJobExecution: vi.fn().mockResolvedValue({ ok: true }),
      } as never,
      { handleJobFailed: vi.fn() } as never,
      executionRepo as never,
      executionEventPublisher as never,
    );

    const data = {
      workflowRunId: "run-1",
      jobId: "job-1",
      job: { type: "execution", steps: [] },
      workflowPermissions: {},
    };

    await service.dispatchJob(data as never, undefined);

    expect(executeJobSpy).toHaveBeenCalledWith(
      expect.anything(), // data
      expect.anything(), // bullJobId
      expect.anything(), // stateVariables
      expect.anything(), // resolvedJobInputs
      executionId, // executionId — NEW 5th arg
    );

    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2.2: Run to confirm test fails**

```bash
npm run test --workspace=apps/api -- step-execution-orchestrator.service.spec
```

Expected: FAIL — `executeJob` is called without a 5th argument currently.

- [ ] **Step 2.3: Inject `ExecutionHeartbeatService` into `StepAgentStepExecutorService`**

In `apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.service.ts`:

1. Add import at the top:

```typescript
import { ExecutionHeartbeatService } from "../../execution-lifecycle/execution-heartbeat.service";
```

2. Add constructor parameter (after `runnerConfigStore`):

```typescript
private readonly executionHeartbeat: ExecutionHeartbeatService,
```

3. Update `executeJob` signature to accept an optional `executionId`:

```typescript
async executeJob(
  data: JobQueueData,
  bullJobId: string | number | undefined,
  stateVariables: Record<string, unknown>,
  resolvedJobInputs: Record<string, unknown>,
  executionId?: string,
): Promise<unknown> {
```

4. Pass `executionId` into `createJobExecutionDependencies`:

```typescript
const deps = this.createJobExecutionDependencies({
  data,
  workflowRunId,
  jobId,
  job,
  stateVariables,
  mountKey,
  stepId,
  executionId,
  captureUsageMetadata: (metadata) => {
    usageMetadata = metadata;
  },
});
```

5. Add `executionId?: string` to the params type of `createJobExecutionDependencies`:

```typescript
private createJobExecutionDependencies(params: {
  data: JobQueueData;
  workflowRunId: string;
  jobId: string;
  job: IJob;
  stateVariables: Record<string, unknown>;
  mountKey: string;
  stepId: string;
  executionId?: string;
  captureUsageMetadata: (metadata: StepUsageMetadata) => void;
}): JobExecutionDependencies {
```

6. In the `startContainerAndStreamLogs` callback (around line 241), add the heartbeat call alongside the existing `runHeartbeat` call:

```typescript
startContainerAndStreamLogs: async (containerId, runId, jId) => {
  await this.containerSupport.startContainer(containerId);
  return this.containerRuntime.startContainerLogStreaming(
    containerId,
    runId,
    jId,
    () => {
      this.runHeartbeat.recordActivity(runId);
      if (params.executionId) {
        this.executionHeartbeat.recordActivity(
          params.executionId,
          'container_log',
        );
      }
    },
  );
},
```

- [ ] **Step 2.4: Pass `executionId` from the orchestrator**

In `apps/api/src/workflow/workflow-step-execution/step-execution-orchestrator.service.ts`, inside `runAgentJobAndPublishResult`, update the `executeJob` call:

```typescript
const result = await this.agentStepExecutor.executeJob(
  data,
  bullJobId,
  stateVariables,
  resolvedJobInputs,
  executionId,
);
```

(The `executionId` is already in scope as the first parameter of `runAgentJobAndPublishResult`.)

- [ ] **Step 2.5: Run the test — confirm pass**

```bash
npm run test --workspace=apps/api -- step-execution-orchestrator.service.spec
```

Expected: PASS.

- [ ] **Step 2.6: Type-check**

```bash
npx tsc --noEmit -p apps/api/tsconfig.json 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 2.7: Commit**

```bash
git add apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.service.ts \
        apps/api/src/workflow/workflow-step-execution/step-execution-orchestrator.service.ts \
        apps/api/src/workflow/workflow-step-execution/step-execution-orchestrator.service.spec.ts
git commit -m "fix(execution): wire container log activity into ExecutionHeartbeatService for workflow_step

Log streaming callbacks now call executionHeartbeat.recordActivity so
last_heartbeat_at is updated on every log chunk, keeping workflow_step
executions alive in the supervisor's view while they are genuinely running."
```

---

## Task 3: Fix C — Terminal-state guard before retrying reaped jobs

**Files:**

- Modify: `apps/api/src/execution-lifecycle/database/repositories/execution.repository.ts`
- Modify: `apps/api/src/execution-lifecycle/database/repositories/execution.repository.spec.ts`
- Modify: `apps/api/src/workflow/workflow-step-execution/step-execution-completion.listener.ts`
- Modify: `apps/api/src/workflow/workflow-step-execution/step-execution-completion.listener.spec.ts`

- [ ] **Step 3.1: Add `findByWorkflowRunAndJob` to the repository**

In `apps/api/src/execution-lifecycle/database/repositories/execution.repository.ts`, add after `findNonTerminal`:

```typescript
async findByWorkflowRunAndJob(
  workflowRunId: string,
  jobId: string,
): Promise<ExecutionEntity[]> {
  return this.repository.find({
    where: { workflow_run_id: workflowRunId, context_id: jobId },
  });
}
```

- [ ] **Step 3.2: Write failing test for the repository method**

Add to `apps/api/src/execution-lifecycle/database/repositories/execution.repository.spec.ts`:

```typescript
describe("ExecutionRepository.findByWorkflowRunAndJob", () => {
  it("returns executions matching the run and job", async () => {
    const inner = {
      rows: new Map(),
      findOne: vi.fn(
        async ({ where: { id } }: { where: { id: string } }) =>
          inner.rows.get(id) ?? null,
      ),
      save: vi.fn(async (row: ExecutionEntity) => {
        inner.rows.set(row.id, row);
        return row;
      }),
      find: vi.fn().mockResolvedValue([
        {
          id: "e-match",
          kind: "workflow_step",
          state: "completed",
          workflow_run_id: "run-1",
          context_id: "job-1",
          version: 1,
        } as ExecutionEntity,
      ]),
    };
    const repo = new ExecutionRepository(inner as never);

    const results = await repo.findByWorkflowRunAndJob("run-1", "job-1");

    expect(inner.find).toHaveBeenCalledWith({
      where: { workflow_run_id: "run-1", context_id: "job-1" },
    });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("e-match");
  });
});
```

- [ ] **Step 3.3: Run to confirm test passes (method already added in 3.1)**

```bash
npm run test --workspace=apps/api -- execution.repository.spec
```

Expected: PASS — the method exists and the test should pass immediately after step 3.1.

- [ ] **Step 3.4: Write the failing listener test**

Add a new `describe` block to `apps/api/src/workflow/workflow-step-execution/step-execution-completion.listener.spec.ts`:

```typescript
describe("execution.reaped — terminal-state guard (Fix C)", () => {
  it("does NOT call handleJobFailed when the job already has a completed execution", async () => {
    // The reaped execution itself
    executionRepo.findById.mockResolvedValueOnce({
      id: "exec-reaped",
      kind: "workflow_step",
      workflow_run_id: "run-c",
      context_id: "job-c",
    });
    // findByWorkflowRunAndJob returns a completed execution for the same job
    executionRepo.findByWorkflowRunAndJob = vi.fn().mockResolvedValueOnce([
      {
        id: "exec-completed",
        kind: "workflow_step",
        state: "completed",
        workflow_run_id: "run-c",
        context_id: "job-c",
      },
    ]);

    await emit(
      EXECUTION_EVENT_TYPES.reaped,
      makeEnvelope(EXECUTION_EVENT_TYPES.reaped, "exec-reaped", {
        failure_reason: "idle_timeout",
        error_message: "No activity heartbeat within the idle timeout window",
      }),
    );

    expect(runJobExecution.handleJobFailed).not.toHaveBeenCalled();
  });

  it("calls handleJobFailed when no completed execution exists for the job", async () => {
    executionRepo.findById.mockResolvedValueOnce({
      id: "exec-reaped-2",
      kind: "workflow_step",
      workflow_run_id: "run-d",
      context_id: "job-d",
    });
    executionRepo.findByWorkflowRunAndJob = vi.fn().mockResolvedValueOnce([
      {
        id: "exec-reaped-2",
        kind: "workflow_step",
        state: "running",
        workflow_run_id: "run-d",
        context_id: "job-d",
      },
    ]);

    await emit(
      EXECUTION_EVENT_TYPES.reaped,
      makeEnvelope(EXECUTION_EVENT_TYPES.reaped, "exec-reaped-2", {
        failure_reason: "idle_timeout",
        error_message: "No activity heartbeat",
      }),
    );

    expect(runJobExecution.handleJobFailed).toHaveBeenCalledWith(
      "run-d",
      "job-d",
      "No activity heartbeat",
    );
  });
});
```

Also update the `executionRepo` mock in `beforeEach` to include the new method (it will be overridden per-test above):

```typescript
executionRepo = {
  findById: vi.fn(),
  findByWorkflowRunAndJob: vi.fn().mockResolvedValue([]),
};
```

And update the `ExecutionRepository` provider in the test module:

```typescript
{ provide: ExecutionRepository, useValue: executionRepo },
```

(Already present — just confirm `findByWorkflowRunAndJob` is on the mock object.)

- [ ] **Step 3.5: Run to confirm tests fail**

```bash
npm run test --workspace=apps/api -- step-execution-completion.listener.spec
```

Expected: FAIL — `findByWorkflowRunAndJob` is called but the listener doesn't use it yet.

- [ ] **Step 3.6: Implement the guard in `StepExecutionCompletionListener`**

In `apps/api/src/workflow/workflow-step-execution/step-execution-completion.listener.ts`, update `onExecutionFailed`:

```typescript
private async onExecutionFailed(event: DomainEventEnvelope): Promise<void> {
  try {
    const context = await this.resolveWorkflowStepContext(event.aggregateId);
    if (!context) {
      return;
    }

    const { workflowRunId, jobId } = context;

    // Fix C: If a reaped event arrives for a job that already has a completed
    // execution (e.g. the supervisor fired on a stale entity), skip the retry.
    // This prevents duplicate containers when idle-timeout fires after the job
    // succeeded but before the execution record was transitioned to terminal.
    if (event.eventType === EXECUTION_EVENT_TYPES.reaped) {
      const siblings = await this.executionRepo.findByWorkflowRunAndJob(
        workflowRunId,
        jobId,
      );
      const alreadyCompleted = siblings.some((e) => e.state === 'completed');
      if (alreadyCompleted) {
        this.logger.warn(
          `Skipping retry for reaped execution ${event.aggregateId}: job ${jobId} in run ${workflowRunId} already has a completed execution`,
        );
        return;
      }
    }

    const errorMessage = this.resolveFailureMessage(event);

    this.logger.warn(
      `Execution ${event.aggregateId} failed — failing workflow run ${workflowRunId} job ${jobId}: ${errorMessage}`,
    );

    await this.runJobExecution.handleJobFailed(
      workflowRunId,
      jobId,
      errorMessage,
    );
  } catch (error) {
    this.logger.error(
      `Failed to handle execution failure event for ${event.aggregateId}: ${(error as Error).message}`,
      (error as Error).stack,
    );
  }
}
```

Also add `EXECUTION_EVENT_TYPES` to the import from contracts (already imported — confirm it includes `reaped`).

- [ ] **Step 3.7: Run listener tests — confirm pass**

```bash
npm run test --workspace=apps/api -- step-execution-completion.listener.spec
```

Expected: all PASS.

- [ ] **Step 3.8: Run the full API test suite**

```bash
npm run test:api
```

Expected: all PASS (or pre-existing failures only — don't introduce new failures).

- [ ] **Step 3.9: Type-check**

```bash
npx tsc --noEmit -p apps/api/tsconfig.json 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3.10: Commit**

```bash
git add apps/api/src/execution-lifecycle/database/repositories/execution.repository.ts \
        apps/api/src/execution-lifecycle/database/repositories/execution.repository.spec.ts \
        apps/api/src/workflow/workflow-step-execution/step-execution-completion.listener.ts \
        apps/api/src/workflow/workflow-step-execution/step-execution-completion.listener.spec.ts
git commit -m "fix(execution): skip retry when reaped job already has a completed execution

Adds a terminal-state guard in StepExecutionCompletionListener: when an
execution.reaped event arrives, check whether another execution for the
same (workflow_run_id, context_id) pair is already in 'completed' state.
If so, skip handleJobFailed — the job succeeded and the reap was stale.
This is the last line of defence against duplicate container launches."
```

---

## Final Verification

- [ ] Run the full API test suite one more time from scratch:

```bash
npm run test:api
```

- [ ] Lint:

```bash
npm run lint:api
```

- [ ] Build:

```bash
npm run build:api
```

All three should pass cleanly before calling this done.
