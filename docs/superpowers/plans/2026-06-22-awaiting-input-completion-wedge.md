# Awaiting-Input Completion Wedge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop human-in-the-loop workflow runs from being wedged `RUNNING` forever when a question-parked step is torn down, retried, and completed — so a genuine `step_complete`/`set_job_output` is honoured instead of being silently discarded by a stale `awaiting_input` flag.

**Architecture:** Three layered, independently-testable fixes, all in `apps/api`'s `WorkflowRunJobExecutionService`, keyed off durable state (`workflow_runs.awaiting_input` + the `user_question_awaits` table) rather than in-memory timers:

- **Fix A (trigger):** in `handleJobFailed`, do not schedule a transport-timeout retry for a run parked on an open user question — the "socket hang up" is the expected result of the idle-question container being torn down; leave the run cleanly parked.
- **Fix B (defense):** when any retry _is_ scheduled for a parked run, cancel its orphaned open question awaits and clear `awaiting_input`, because the fresh execution starts the step over.
- **Fix C (wedge):** in `handleJobComplete`, split the `awaiting_input || wait_reason` guard. Keep suppressing turn-end completion for `wait_reason` (durable dependency wait) unconditionally; for `awaiting_input`, suppress only when the job has **no persisted output** (a genuine question park). When output _was_ persisted (the agent finished via `set_job_output`), reconcile the stale question state and complete the run.

**Tech Stack:** NestJS, TypeScript, TypeORM, BullMQ, Vitest (+ SWC decorator metadata). Tests run with `npm run test --workspace=apps/api`.

## Global Constraints

- **Kanban-neutral:** API/core code must not reference `kanban`, work-item, or project-domain identifiers. These changes touch only neutral workflow-run/question-await plumbing — keep it that way.
- **No lint suppression:** never add `eslint-disable`, `@ts-ignore`, `@ts-nocheck`, or rule downgrades. Fix findings in code.
- **NestJS build:** build the API with `nest build`, not `tsc`. Build `packages/core` first if types changed (not required here).
- **TDD:** Red → Green → Refactor for every behavioural change. Write the failing test first and confirm it fails for the stated reason before implementing.
- **Strong typing:** no `any`. The service constructor uses constructor-injected providers; match the existing style.

## File Structure

| File                                                                            | Responsibility                                                                | Change                                                              |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `apps/api/src/workflow/workflow-run-job-execution.service.ts`                   | Owns `handleJobComplete` (the wedge) and `handleJobFailed` (the retry funnel) | Modify: inject `UserQuestionAwaitRepository`; Fixes A, B, C         |
| `apps/api/src/workflow/workflow-run-job-execution.service.spec.ts`              | Vitest unit suite for the service                                             | Modify: extend `createService` mocks; add Fix A/B/C tests           |
| `apps/api/src/workflow/database/repositories/user-question-await.repository.ts` | Durable question-await persistence                                            | Read-only — reuse `findOpenByRunId`, `cancelOpenForRun` (no change) |
| `apps/api/src/workflow/database/repositories/workflow-run.repository.ts`        | Workflow-run persistence                                                      | Read-only — reuse `setAwaitingInput` (no change)                    |

**Pre-wired facts (verified):**

- `UserQuestionAwaitRepository` is provided **and** exported by `DatabaseModule` (`apps/api/src/database/database.module.ts` — spread via `...repositories` into both `providers` and `exports`). `WorkflowRunJobExecutionService` already injects `WorkflowRunRepository` from the same module, so no new module imports are needed.
- `UserQuestionAwaitRepository.findOpenByRunId(runId): Promise<UserQuestionAwait | null>` returns the latest row with status `pending` or `failed_delivery`.
- `UserQuestionAwaitRepository.cancelOpenForRun(runId): Promise<void>` sets open rows to `cancelled`.
- `WorkflowRunRepository.setAwaitingInput(id: string, awaitingInput: boolean): Promise<void>`.
- `hasPersistedJobOutput(getVariable, jobId): Promise<boolean>` (already imported in the service, line ~51) reads `jobs.<jobId>.output` and returns `true` iff it is a non-empty object.
- `AGENT_TRANSPORT_TIMEOUT_PATTERN` (already imported, line ~44) matches `socket hang up`, `ECONNRESET`, `504`, etc.
- The current service constructor takes **12** parameters (ending with `sessionHydration`). Fix adds a **13th**.

---

## Task 1: Wire `UserQuestionAwaitRepository` into the service

**Files:**

- Modify: `apps/api/src/workflow/workflow-run-job-execution.service.ts` (imports + constructor)
- Modify: `apps/api/src/workflow/workflow-run-job-execution.service.spec.ts:20-170` (`createService` factory)

**Interfaces:**

- Consumes: `UserQuestionAwaitRepository` from `./database/repositories/user-question-await.repository`.
- Produces: `this.questionAwaitRepo` available to all methods of `WorkflowRunJobExecutionService` (used by Tasks 2–4).

This task is behaviour-neutral plumbing. Its deliverable is "the service constructs with the new dependency and the existing suite stays green." Fixes A/B/C depend on it.

- [ ] **Step 1: Add the import**

In `workflow-run-job-execution.service.ts`, next to the other repository imports (after line 7, `WorkflowRunRepository`):

```ts
import { UserQuestionAwaitRepository } from "./database/repositories/user-question-await.repository";
```

- [ ] **Step 2: Add the constructor parameter**

In the `constructor(...)` (currently ending with `sessionHydration`), append a new final parameter:

```ts
    @Inject(SESSION_HYDRATION_SERVICE)
    private readonly sessionHydration: ISessionHydrationService,
    private readonly questionAwaitRepo: UserQuestionAwaitRepository,
  ) {}
```

- [ ] **Step 3: Update the spec factory to pass a mock (13th arg)**

In `workflow-run-job-execution.service.spec.ts`, inside `createService`:

Add `setAwaitingInput` to the `runRepo` mock (around line 28-37):

```ts
const runRepo = {
  findById: vi.fn().mockResolvedValue({
    id: "run-1",
    workflow_id: "wf-1",
    status: "RUNNING",
    state_variables: {},
  }),
  update: vi.fn().mockResolvedValue(undefined),
  findOldestPendingByScope: vi.fn().mockResolvedValue(null),
  setAwaitingInput: vi.fn().mockResolvedValue(undefined),
};
```

Add a `questionAwaitRepo` mock just before `const service = new WorkflowRunJobExecutionService(` (around line 121):

```ts
const questionAwaitRepo = {
  findOpenByRunId: vi.fn().mockResolvedValue(null),
  cancelOpenForRun: vi.fn().mockResolvedValue(undefined),
};
```

Pass it as the 13th constructor argument (after `sessionHydration`):

```ts
const service = new WorkflowRunJobExecutionService(
  workflowRepo as never,
  runRepo as never,
  stateManager as never,
  stateMachine as never,
  dagResolver as never,
  parser as never,
  promptLoader as never,
  eventEmitter,
  stepQueue,
  systemSettings as never,
  terminalRunCloser as never,
  sessionHydration,
  questionAwaitRepo as never,
);
```

Expose it on the returned object (in the `return { ... }` block, alongside `runRepo`, `stateManager`, …):

```ts
      runRepo,
      questionAwaitRepo,
      stateManager,
```

- [ ] **Step 4: Run the existing suite to confirm no regression**

Run: `npm run test --workspace=apps/api -- workflow-run-job-execution.service.spec.ts`
Expected: PASS (same count as before; the constructor change compiles and existing tests are unaffected).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/workflow/workflow-run-job-execution.service.ts apps/api/src/workflow/workflow-run-job-execution.service.spec.ts
git commit -m "refactor(workflow): inject UserQuestionAwaitRepository into run-job-execution service

Plumbing for the awaiting-input completion-wedge fixes. Behaviour-neutral.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Fix C — honour a genuine completion through a stale `awaiting_input`

**Files:**

- Modify: `apps/api/src/workflow/workflow-run-job-execution.service.ts` (`handleJobComplete`, the guard at ~line 165-178)
- Test: `apps/api/src/workflow/workflow-run-job-execution.service.spec.ts`

**Interfaces:**

- Consumes: `this.questionAwaitRepo.cancelOpenForRun`, `this.runRepo.setAwaitingInput`, `hasPersistedJobOutput`, `this.stateManager.getVariable`.
- Produces: `handleJobComplete` no longer discards a turn-end completion when `awaiting_input` is stale-but-output-persisted.

- [ ] **Step 1: Write the failing tests**

Add a new `describe` block at the end of the spec file (before the final closing `});`):

```ts
describe("WorkflowRunJobExecutionService — awaiting_input completion reconciliation", () => {
  const RUN_ID = "run-1";
  const JOB_ID = "refine_charter";
  const OUTPUT = { charter_updated: true };

  // hasPersistedJobOutput reads `jobs.<jobId>.output`; return a non-empty
  // object there to simulate a persisted set_job_output.
  const withPersistedOutput = (stateManager: {
    getVariable: ReturnType<typeof vi.fn>;
  }) => {
    stateManager.getVariable.mockImplementation(
      async (_runId: string, path: string) =>
        path === `jobs.${JOB_ID}.output` ? OUTPUT : null,
    );
  };

  it("suppresses completion when parked awaiting input with no persisted output", async () => {
    const ctx = createService();
    ctx.runRepo.findById.mockResolvedValue({
      id: RUN_ID,
      workflow_id: "wf-1",
      status: WorkflowStatus.RUNNING,
      awaiting_input: true,
      wait_reason: null,
      state_variables: {},
    });

    await ctx.service.handleJobComplete(RUN_ID, JOB_ID, OUTPUT);

    expect(ctx.stateManager.tryMarkJobCompleted).not.toHaveBeenCalled();
    expect(ctx.questionAwaitRepo.cancelOpenForRun).not.toHaveBeenCalled();
    expect(ctx.runRepo.setAwaitingInput).not.toHaveBeenCalled();
  });

  it("completes and clears stale question state when output was persisted", async () => {
    const ctx = createService();
    ctx.runRepo.findById.mockResolvedValue({
      id: RUN_ID,
      workflow_id: "wf-1",
      status: WorkflowStatus.RUNNING,
      awaiting_input: true,
      wait_reason: null,
      state_variables: {},
    });
    withPersistedOutput(ctx.stateManager);

    await ctx.service.handleJobComplete(RUN_ID, JOB_ID, OUTPUT);

    expect(ctx.questionAwaitRepo.cancelOpenForRun).toHaveBeenCalledWith(RUN_ID);
    expect(ctx.runRepo.setAwaitingInput).toHaveBeenCalledWith(RUN_ID, false);
    // Proceeded past the parked guard into the completion claim.
    expect(ctx.stateManager.tryMarkJobCompleted).toHaveBeenCalledWith(
      RUN_ID,
      JOB_ID,
    );
  });

  it("always suspends a wait_reason (durable dependency) turn-end, even with output", async () => {
    const ctx = createService();
    ctx.runRepo.findById.mockResolvedValue({
      id: RUN_ID,
      workflow_id: "wf-1",
      status: WorkflowStatus.RUNNING,
      awaiting_input: false,
      wait_reason: "await_agent_workflow",
      state_variables: {},
    });
    withPersistedOutput(ctx.stateManager);

    await ctx.service.handleJobComplete(RUN_ID, JOB_ID, OUTPUT);

    expect(ctx.stateManager.tryMarkJobCompleted).not.toHaveBeenCalled();
    expect(ctx.questionAwaitRepo.cancelOpenForRun).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test --workspace=apps/api -- workflow-run-job-execution.service.spec.ts -t "awaiting_input completion reconciliation"`
Expected: FAIL — the "completes and clears stale question state" test fails because the current guard (`run.awaiting_input || run.wait_reason`) returns early, so `cancelOpenForRun`/`setAwaitingInput`/`tryMarkJobCompleted` are never called.

- [ ] **Step 3: Implement the split guard**

In `handleJobComplete`, replace the existing block (currently lines ~165-178):

```ts
// A run parked for any reason (awaiting human input or a dependency wait)
// is intentionally suspended, not finished: the agent's turn ended after it
// requested a durable wait (e.g. await_agent_workflow). Treating that
// turn-end as a job completion would progress the DAG or mark the run
// COMPLETED while it is still parked, defeating durable resume. Leave the
// parked run RUNNING so the dependency-join/resume path can re-enqueue it.
if (run.awaiting_input || run.wait_reason) {
  this.logger.log(
    `Run ${workflowRunId} is parked (wait_reason=${
      run.wait_reason ?? "awaiting_input"
    }); suspending job ${jobId} turn-end without completing the run`,
  );
  return;
}
```

with:

```ts
// A run parked on a durable dependency wait (e.g. await_agent_workflow) must
// never complete on a turn-end: the agent's turn ended because it requested
// the wait, not because the job finished. Leave it RUNNING for resume.
if (run.wait_reason) {
  this.logger.log(
    `Run ${workflowRunId} is parked (wait_reason=${run.wait_reason}); suspending job ${jobId} turn-end without completing the run`,
  );
  return;
}

// A run awaiting a user-question answer is normally parked too. But a parked
// question container can be torn down (idle teardown) and the step retried;
// the fresh execution may finish the work and persist set_job_output without
// re-asking. In that case awaiting_input — and its pending user_question_awaits
// row — are stale, and discarding this genuine completion is exactly what
// wedges the run RUNNING forever. Distinguish the two by persisted output:
// posing a question never persists job output, finishing the job does.
if (run.awaiting_input) {
  const completedWithOutput = await hasPersistedJobOutput(
    (path) => this.stateManager.getVariable(workflowRunId, path),
    jobId,
  );
  if (!completedWithOutput) {
    this.logger.log(
      `Run ${workflowRunId} is parked awaiting user input; suspending job ${jobId} turn-end without completing the run`,
    );
    return;
  }
  this.logger.warn(
    `Run ${workflowRunId} job ${jobId} finished with persisted output while awaiting_input was still set (stale question state after a retry); clearing it and completing the run`,
  );
  await this.questionAwaitRepo.cancelOpenForRun(workflowRunId);
  await this.runRepo.setAwaitingInput(workflowRunId, false);
}
```

(`hasPersistedJobOutput` is already imported at the top of the file — verify the import on line ~51; do not re-add it.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test --workspace=apps/api -- workflow-run-job-execution.service.spec.ts -t "awaiting_input completion reconciliation"`
Expected: PASS (all 3).

- [ ] **Step 5: Run the full service suite for regressions**

Run: `npm run test --workspace=apps/api -- workflow-run-job-execution.service.spec.ts`
Expected: PASS (all pre-existing tests still green).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/workflow/workflow-run-job-execution.service.ts apps/api/src/workflow/workflow-run-job-execution.service.spec.ts
git commit -m "fix(workflow): complete run when set_job_output persisted despite stale awaiting_input

handleJobComplete dropped a genuine step completion whenever awaiting_input
was set, wedging human-in-the-loop runs RUNNING forever after a question
container was torn down and the step retried. Split the guard: durable
dependency waits still suspend the turn-end; a question park only suspends
when no job output was persisted, otherwise reconcile the stale await and
complete.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Fix A — do not retry a transport timeout while parked on an open question

**Files:**

- Modify: `apps/api/src/workflow/workflow-run-job-execution.service.ts` (`handleJobFailed`, after the salvage block at ~line 305)
- Test: `apps/api/src/workflow/workflow-run-job-execution.service.spec.ts`

**Interfaces:**

- Consumes: `this.questionAwaitRepo.findOpenByRunId`, `AGENT_TRANSPORT_TIMEOUT_PATTERN`.
- Produces: `handleJobFailed` returns `'ignored'` (no retry, no failure) for a transport timeout on a run parked on an open user question.

- [ ] **Step 1: Write the failing tests**

Add to the spec file a new `describe` block:

```ts
describe("WorkflowRunJobExecutionService — transport timeout while parked on a question", () => {
  const RUN_ID = "run-1";
  const JOB_ID = "refine_charter";

  const parkedRun = {
    id: RUN_ID,
    workflow_id: "wf-1",
    status: WorkflowStatus.RUNNING,
    awaiting_input: true,
    wait_reason: null,
    state_variables: {},
  };

  it("leaves the run parked (ignored) when an open question exists", async () => {
    const ctx = createService({ autoRetryEnabled: true });
    ctx.runRepo.findById.mockResolvedValue(parkedRun);
    ctx.questionAwaitRepo.findOpenByRunId.mockResolvedValue({
      id: "await-1",
      status: "pending",
    });

    const result = await ctx.service.handleJobFailed(
      RUN_ID,
      JOB_ID,
      "socket hang up",
    );

    expect(result).toBe("ignored");
    expect(ctx.stepQueue.add).not.toHaveBeenCalled();
    expect(ctx.runRepo.update).not.toHaveBeenCalledWith(
      RUN_ID,
      expect.objectContaining({ status: WorkflowStatus.FAILED }),
    );
  });

  it("still retries a transport timeout when no open question exists", async () => {
    const ctx = createService({ autoRetryEnabled: true });
    ctx.runRepo.findById.mockResolvedValue(parkedRun);
    ctx.questionAwaitRepo.findOpenByRunId.mockResolvedValue(null);

    const result = await ctx.service.handleJobFailed(
      RUN_ID,
      JOB_ID,
      "socket hang up",
    );

    expect(result).not.toBe("ignored");
  });
});
```

(The second test asserts the guard is _scoped_ — a transport timeout without an open question is not silently swallowed.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test --workspace=apps/api -- workflow-run-job-execution.service.spec.ts -t "transport timeout while parked"`
Expected: FAIL — the "leaves the run parked" test fails because the current `handleJobFailed` schedules a retry (or fails the run) for `socket hang up`.

- [ ] **Step 3: Implement the parked-question short-circuit**

In `handleJobFailed`, immediately after the salvage block (after the `if (isTransportTimeout) { … salvage … }` block, before `let shouldRetry = …`), insert:

```ts
// A transport timeout on a run parked on an open user question is the
// expected consequence of the question-idle container being torn down to
// free capacity — the answer path resumes from the persisted session tree.
// Retrying here spawns a fresh execution that re-runs the whole step and
// races the durable question lifecycle (and can leave awaiting_input stale).
// Leave the run cleanly parked instead.
if (isTransportTimeout && run.awaiting_input) {
  const openQuestion =
    await this.questionAwaitRepo.findOpenByRunId(workflowRunId);
  if (openQuestion) {
    this.logger.warn(
      `Run ${workflowRunId} job ${jobId} hit a transport timeout while parked on an open user question; leaving it parked instead of retrying (idle container teardown)`,
    );
    return "ignored";
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test --workspace=apps/api -- workflow-run-job-execution.service.spec.ts -t "transport timeout while parked"`
Expected: PASS (both).

- [ ] **Step 5: Run the full service suite for regressions**

Run: `npm run test --workspace=apps/api -- workflow-run-job-execution.service.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/workflow/workflow-run-job-execution.service.ts apps/api/src/workflow/workflow-run-job-execution.service.spec.ts
git commit -m "fix(workflow): do not retry transport timeout while parked on an open question

The question-idle container teardown produces a 'socket hang up' on the
blocked dispatch call, which was classified as agent_transport_timeout and
retried — spawning a fresh execution that re-ran the step. Short-circuit the
retry when the run is awaiting_input with an open user_question_awaits row and
leave it cleanly parked for the answer path to resume.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Fix B — reconcile orphaned question awaits when a retry is scheduled

**Files:**

- Modify: `apps/api/src/workflow/workflow-run-job-execution.service.ts` (`handleJobFailed`, the `if (retryScheduled)` branch at ~line 344-346)
- Test: `apps/api/src/workflow/workflow-run-job-execution.service.spec.ts`

**Interfaces:**

- Consumes: `this.questionAwaitRepo.cancelOpenForRun`, `this.runRepo.setAwaitingInput`.
- Produces: when a retry is scheduled for a parked run, its open awaits are cancelled and `awaiting_input` is cleared before the fresh execution starts.

- [ ] **Step 1: Write the failing test**

Add to the spec file:

```ts
describe("WorkflowRunJobExecutionService — retry clears orphaned question state", () => {
  const RUN_ID = "run-1";
  const JOB_ID = "refine_charter";

  it("cancels open awaits and clears awaiting_input when a retry is scheduled", async () => {
    const ctx = createService({ autoRetryEnabled: true });
    ctx.runRepo.findById.mockResolvedValue({
      id: RUN_ID,
      workflow_id: "wf-1",
      status: WorkflowStatus.RUNNING,
      awaiting_input: true,
      wait_reason: null,
      state_variables: {},
    });
    // No open question on the transport-timeout path, so Fix A does not
    // short-circuit; the retry proceeds and Fix B reconciles.
    ctx.questionAwaitRepo.findOpenByRunId.mockResolvedValue(null);

    const result = await ctx.service.handleJobFailed(
      RUN_ID,
      JOB_ID,
      "provider overloaded",
    );

    expect(result).toBe("retry_scheduled");
    expect(ctx.questionAwaitRepo.cancelOpenForRun).toHaveBeenCalledWith(RUN_ID);
    expect(ctx.runRepo.setAwaitingInput).toHaveBeenCalledWith(RUN_ID, false);
  });
});
```

> Note: `'provider overloaded'` is a retryable, non-transport reason — it avoids Fix A's transport short-circuit so the retry path (and Fix B) is exercised. Confirm `autoRetryEnabled: true` produces a scheduled retry; if the workflow-definition load short-circuits, set `workflowRepo.findByIdentifier`/`findById` to return `{ workflow_id: 'wf-1', name: 'WF 1', jobs: [{ id: JOB_ID }] }` as the other retry tests in this suite do.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace=apps/api -- workflow-run-job-execution.service.spec.ts -t "retry clears orphaned question state"`
Expected: FAIL — `cancelOpenForRun`/`setAwaitingInput` are not called on the current retry path.

- [ ] **Step 3: Implement the reconciliation on retry**

In `handleJobFailed`, change the `if (retryScheduled)` branch (currently):

```ts
if (retryScheduled) {
  return "retry_scheduled";
}
```

to:

```ts
if (retryScheduled) {
  // A retried step starts over in a fresh execution. Any user-question
  // await the prior execution left open is now orphaned — the new run will
  // not answer it. Cancel it and clear awaiting_input so the retry begins
  // from clean state and the completion path is never blocked by a stale
  // park flag.
  if (run.awaiting_input) {
    await this.questionAwaitRepo.cancelOpenForRun(workflowRunId);
    await this.runRepo.setAwaitingInput(workflowRunId, false);
  }
  return "retry_scheduled";
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test --workspace=apps/api -- workflow-run-job-execution.service.spec.ts -t "retry clears orphaned question state"`
Expected: PASS.

- [ ] **Step 5: Run the full service suite for regressions**

Run: `npm run test --workspace=apps/api -- workflow-run-job-execution.service.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/workflow/workflow-run-job-execution.service.ts apps/api/src/workflow/workflow-run-job-execution.service.spec.ts
git commit -m "fix(workflow): clear orphaned question awaits when a parked step is retried

A retried step replaces the prior execution, so any open user_question_awaits
row it left behind is dead. Cancel it and clear awaiting_input when a retry is
scheduled for a parked run, so the fresh execution starts clean and its
completion is never swallowed by a stale park flag.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Verify the full API gate and document the behaviour

**Files:**

- Modify: `apps/api/src/workflow/workflow-run-job-execution.service.ts` (doc comment only, if needed)
- Reference: confirm no Kanban boundary residue introduced

- [ ] **Step 1: Typecheck / build the API**

Run: `npm run build:api`
Expected: build succeeds (no TS errors from the new dependency or edits).

- [ ] **Step 2: Lint the API workspace**

Run: `npm run lint:api`
Expected: clean — no new findings, no suppressions added.

- [ ] **Step 3: Run the full API unit suite**

Run: `npm run test:api`
Expected: PASS — the three new behaviours plus all pre-existing tests are green.

- [ ] **Step 4: Confirm the class doc comment reflects the new invariant**

Ensure the `handleJobComplete` / `handleJobFailed` comments (edited in Tasks 2–4) read coherently together: durable `wait_reason` always suspends; a user-question park suspends only until the job has persisted output; transport timeouts never retry while parked on an open question; retries clear orphaned awaits. No separate doc file change is required, but if `docs/guide` documents the question/await lifecycle, add a sentence there describing the teardown-retry reconciliation.

- [ ] **Step 5: Commit (only if Step 4 changed files)**

```bash
git add -A
git commit -m "docs(workflow): clarify awaiting_input completion/retry reconciliation invariants

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Optional Task 6: One-off recovery of the wedged run `d9c39896`

This unsticks the already-wedged run from the diagnosis. It is independent of the code fixes (which prevent recurrence) and is **dev-stack only**. The run's `set_job_output` was already persisted (`{charter_updated: true, changes_made: 11}`), so the work is done — it only needs the stale state cleared and a terminal transition.

- [ ] **Step 1: Inspect the current state**

```bash
docker exec nexus-postgres psql -U nexus -d nexus_orchestrator -c "SELECT id, status, awaiting_input FROM workflow_runs WHERE id='d9c39896-6bea-4c7f-8b21-650b82fe10b3';"
docker exec nexus-postgres psql -U nexus -d nexus_orchestrator -c "SELECT id, status FROM user_question_awaits WHERE workflow_run_id='d9c39896-6bea-4c7f-8b21-650b82fe10b3';"
```

Expected: run `RUNNING`/`awaiting_input=t`; one `pending` await (`abf1ceab…`).

- [ ] **Step 2: Cancel the orphaned await and clear the flag**

```bash
docker exec nexus-postgres psql -U nexus -d nexus_orchestrator -c "UPDATE user_question_awaits SET status='cancelled', updated_at=now() WHERE workflow_run_id='d9c39896-6bea-4c7f-8b21-650b82fe10b3' AND status='pending';"
docker exec nexus-postgres psql -U nexus -d nexus_orchestrator -c "UPDATE workflow_runs SET awaiting_input='f' WHERE id='d9c39896-6bea-4c7f-8b21-650b82fe10b3';"
```

- [ ] **Step 3: Decide the terminal transition**

The job output is persisted but no live container will re-drive completion. For a single dev run, transition it to its terminal state directly (the work was completed):

```bash
docker exec nexus-postgres psql -U nexus -d nexus_orchestrator -c "UPDATE workflow_runs SET status='COMPLETED', completed_at=now(), updated_at=now() WHERE id='d9c39896-6bea-4c7f-8b21-650b82fe10b3' AND status='RUNNING';"
```

- [ ] **Step 4: Verify**

```bash
docker exec nexus-postgres psql -U nexus -d nexus_orchestrator -c "SELECT id, status, awaiting_input, completed_at FROM workflow_runs WHERE id='d9c39896-6bea-4c7f-8b21-650b82fe10b3';"
```

Expected: `COMPLETED`, `awaiting_input=f`, `completed_at` set. Confirm the UI (`/sessions/d9c39896…`) no longer shows RUNNING.

> Do **not** commit this task — it is a manual data operation, not a code change.

---

## Self-Review

**Spec coverage:**

- Fix A (don't retry parked transport timeout) → Task 3. ✓
- Fix B (clear orphaned awaits on retry) → Task 4. ✓
- Fix C (honour genuine completion through stale flag) → Task 2. ✓
- DI prerequisite → Task 1. ✓
- Build/lint/test gate → Task 5. ✓
- Stuck-run recovery → Task 6 (optional). ✓

**Type consistency:** `findOpenByRunId`, `cancelOpenForRun`, `setAwaitingInput`, `hasPersistedJobOutput`, `jobOutputStatePath`, and `AGENT_TRANSPORT_TIMEOUT_PATTERN` are used with the exact signatures verified in the source. The constructor goes from 12 → 13 params; the spec factory is updated in the same task (Task 1) that adds the param, so no task sees an inconsistent arity. `handleJobFailed`'s return union (`'ignored' | 'retry_scheduled' | 'failed' | 'salvaged'`) already includes `'ignored'`, used by Fix A.

**Placeholder scan:** no TBD/TODO; every code and test step shows concrete content; commands have expected outcomes.

**Ordering note:** Fixes A and C are each sufficient on their own to prevent the exact wedge (A stops the retry → run stays cleanly parked; C honours the completion if a retry still happens). B is defense-in-depth. They compose without conflict: A returns `'ignored'` before B's retry branch, so B only fires for non-transport retries of a parked run.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-22-awaiting-input-completion-wedge.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
