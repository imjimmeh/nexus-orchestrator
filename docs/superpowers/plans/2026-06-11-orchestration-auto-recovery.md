# Orchestration Auto-Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the workflow engine automatically recover orchestration runs that strand in `RUNNING` with no live queue job, and stop the reconciler/consumer race that manufactures those stranded runs in the first place.

**Architecture:** All changes live in the single 30-second sweep service `WorkflowRunReconciliationService`. We scan the BullMQ `workflow-steps` queue once per cycle for "live" run ids (jobs in `active`/`waiting`/`delayed`/`prioritized`), then (B) skip failed-queue-job reconciliation for runs that already have a live job (the in-band `onFailed` handler already owns the retry), and (A) add a new pass that feeds genuinely-stranded `RUNNING` runs back through the existing `handleJobFailed` retry/repair path, gated by the re-wired `WORKFLOW_STALE_RUN_GRACE_MS` grace.

**Tech Stack:** NestJS, BullMQ (`bullmq`), TypeORM, Vitest. Tracking issue: `kanban-ezqy`.

---

## Background (why this works)

- A stranded run is `RUNNING`, `awaiting_input === false`, `updated_at` frozen, and has **no** job in the step queue's `active`/`waiting`/`delayed`/`prioritized` states. The delayed auto-retry job (`auto-retry-<run>-<job>`) is created with `removeOnFail: true` / `removeOnComplete: true`, so once it is consumed or dropped (e.g. the activation guard skips it as "stale"), nothing remains in the queue and no sweep notices the run.
- Pause sets status to `PENDING` (see `workflow-engine.service.ts`), so a `RUNNING`-only watchdog never touches paused runs. Only `awaiting_input` runs need explicit exclusion (they are intentionally idle while blocked on `ask_user_questions`).
- `handleJobFailed(runId, jobId, reason)` is the existing, bounded failure path: it consults retry policy, schedules an auto-retry if attempts remain, or marks the run `FAILED` and closes it via the terminal closer. Feeding a stranded run into it is correct and self-limiting — a run that already exhausted its retries fails immediately; one with attempts left gets them.
- Root cause of stranding (B): both the consumer's `@OnWorkerEvent('failed')` → `handleJobFailed` **and** `reconcileFailedQueueJobs` → `handleJobFailed` handle the same failed BullMQ job, each scheduling an auto-retry and bumping `_internal.auto_retry.<jobId>.attempt`. The real delayed retry then fails `WorkflowAutoRetryActivationGuardService`'s attempt-match check and is silently dropped. Skipping reconciliation when the run already has a live job removes the double-handling while preserving the reconciler's real purpose (catching failures the in-band path missed, e.g. after a process crash, where no live job exists).

## File Structure

- **Modify:** `apps/api/src/workflow/workflow-run-operations/workflow-run-reconciliation.service.ts`
  - Re-wire `STALE_RUN_GRACE_MS` from `resolveStaleRunGraceMs(process.env.WORKFLOW_STALE_RUN_GRACE_MS)`.
  - Add `STALE_RUN_REASON` constant and `LIVE_SCAN_LIMIT`.
  - Add `private now()`, `runIdsFromJobs()`, `isOlderThanGrace()`, `reconcileStaleRunningRuns()`.
  - Refactor `reconcileNow` to fetch the `RUNNING` list, live jobs, and failed jobs once (single scan each) and pass them down.
  - Change `reconcileFailedQueueJobs` signature to `(source, runningRuns, liveRunIds, failedJobs)` (no internal queue scan) and skip runs in `liveRunIds`.
  - The stale pass excludes runs in `liveRunIds` **and** `failedRunIds` (a failed job is already owned by `reconcileFailedQueueJobs`; the stale pass only targets runs invisible to both).
- **Modify (tests):** `apps/api/src/workflow/workflow-run-operations/workflow-run-reconciliation.service.spec.ts`
  - Switch the queue mock to a deterministic, states-aware `mockImplementation`.
  - Add tests for B (skip-if-live) and A (stale-run recovery).
- **Modify (docs/config):** `apps/api/.env.example` (or repo `.env.example` if that is the canonical one — verify in Task 3) — document `WORKFLOW_STALE_RUN_GRACE_MS`.

No new files. One responsibility per method; the service already owns "reconcile run/queue drift on an interval", which is exactly where stale-run recovery belongs.

---

## Task 1: Option B — stop the double-failure-handling race

**Files:**

- Modify: `apps/api/src/workflow/workflow-run-operations/workflow-run-reconciliation.service.ts`
- Test: `apps/api/src/workflow/workflow-run-operations/workflow-run-reconciliation.service.spec.ts`

- [ ] **Step 1: Make the existing queue mock deterministic (green refactor)**

Replace the `createService` helper in the spec so `getJobs` answers by queue state instead of by call order. This keeps every existing test green while making them robust to the extra queue scan added in Step 3.

In `workflow-run-reconciliation.service.spec.ts`, replace the `createService` definition (the `const createService = () => { ... };` block, currently lines ~26-54) with:

```ts
type FakeJob = { id?: string; data: unknown; failedReason?: string };

const createService = () => {
  const runRepo = {
    findByStatus: vi.fn().mockResolvedValue([]),
    findOldestRunningByScope: vi.fn().mockResolvedValue(null),
  };

  const runExecution = {
    handleJobFailed: vi.fn().mockResolvedValue("failed"),
    handleJobComplete: vi.fn().mockResolvedValue(undefined),
    activateQueuedRun: vi.fn().mockResolvedValue(true),
  };

  const stepQueue = {
    getJobs: vi.fn(),
  };

  // Deterministic, order-independent queue mock: answers by requested state.
  const setQueueJobs = (jobs: { live?: FakeJob[]; failed?: FakeJob[] }) => {
    stepQueue.getJobs.mockImplementation((states: string[]) =>
      Promise.resolve(
        states.includes("failed") ? (jobs.failed ?? []) : (jobs.live ?? []),
      ),
    );
  };
  setQueueJobs({});

  const service = new WorkflowRunReconciliationService(
    runRepo as never,
    runExecution as never,
    stepQueue as never,
  );

  return { service, runRepo, runExecution, stepQueue, setQueueJobs };
};
```

Then update every existing test that configured `stepQueue.getJobs` directly to use `setQueueJobs` instead. Apply these exact replacements:

- In `delegates failed queue jobs to handleJobFailed with original reason`, replace the `stepQueue.getJobs.mockResolvedValueOnce([...])` block with:

```ts
setQueueJobs({
  failed: [
    {
      data: { workflowRunId: "run-1", jobId: "discovery_and_specs" },
      failedReason: "job stalled more than allowable limit",
    },
  ],
});
```

- In `does not fail a run that is awaiting user input even when a failed queue job exists`, replace `stepQueue.getJobs.mockResolvedValue([]);` with `setQueueJobs({});`.

- In `activates orphaned pending queued runs when no running run exists for the scope`, replace `stepQueue.getJobs.mockResolvedValueOnce([]);` with `setQueueJobs({});`.

- In `deduplicates the same failed queue job across multiple reconciliation runs`, replace the two-call `stepQueue.getJobs.mockResolvedValueOnce([failedJob]).mockResolvedValueOnce([failedJob]);` with `setQueueJobs({ failed: [failedJob] });`.

- In `delegates to handleJobFailed with original failedReason and does not replay events`, replace the `stepQueue.getJobs.mockResolvedValueOnce([...])` block with:

```ts
setQueueJobs({
  failed: [
    {
      id: "queue-job-dedupe",
      data: { workflowRunId: "run-dedupe", jobId: "build_and_test" },
      failedReason: "Git command failed: author identity unknown",
    },
  ],
});
```

- In `retries a failed queue job if handleJobFailed threw on the first attempt`, replace the two-call `stepQueue.getJobs.mockResolvedValueOnce([failedJob]).mockResolvedValueOnce([failedJob]);` with `setQueueJobs({ failed: [failedJob] });`.

- In `does not rebroadcast historical failed runs during reconciliation`, replace `stepQueue.getJobs.mockResolvedValueOnce([]);` with `setQueueJobs({});`.

- [ ] **Step 2: Run the existing suite to confirm it is still green**

Run: `npm run test --workspace=apps/api -- workflow-run-reconciliation.service.spec.ts`
Expected: PASS (all existing tests). This proves the mock refactor is behavior-preserving before any production change.

- [ ] **Step 3: Write the failing test for skip-if-live**

Add this test inside the `describe('WorkflowRunReconciliationService', ...)` block:

```ts
it("does not re-handle a failed queue job when the run already has a live job", async () => {
  const { service, runRepo, runExecution, setQueueJobs } = createService();

  const runningRun = {
    id: "run-live",
    current_step_id: "ceo_orchestration_decision",
    updated_at: new Date(),
    awaiting_input: false,
  };

  runRepo.findByStatus
    .mockResolvedValueOnce([runningRun]) // RUNNING
    .mockResolvedValueOnce([]); // PENDING

  setQueueJobs({
    // The in-band onFailed handler already scheduled the delayed auto-retry,
    // so the run has a live job in the queue.
    live: [
      {
        data: {
          workflowRunId: "run-live",
          jobId: "ceo_orchestration_decision",
        },
      },
    ],
    failed: [
      {
        id: "queue-job-live",
        data: {
          workflowRunId: "run-live",
          jobId: "ceo_orchestration_decision",
        },
        failedReason: "column DomainEventOutboxEntity.eventId does not exist",
      },
    ],
  });

  await service.reconcileNow("manual");

  expect(runExecution.handleJobFailed).not.toHaveBeenCalled();
});
```

- [ ] **Step 4: Run the new test to verify it fails**

Run: `npm run test --workspace=apps/api -- workflow-run-reconciliation.service.spec.ts -t "already has a live job"`
Expected: FAIL — `handleJobFailed` is currently called once (no skip logic yet).

- [ ] **Step 5: Implement the live-scan + skip-if-live in production code**

In `workflow-run-reconciliation.service.ts`:

(a) Add a scan-limit constant next to `FAILED_SCAN_LIMIT` (currently line ~13):

```ts
const FAILED_SCAN_LIMIT = 500;
const LIVE_SCAN_LIMIT = 1000;
```

(b) Replace the body of `reconcileNow` (currently the `try { await this.reconcileFailedQueueJobs(source); await this.reconcileOrphanedPendingRuns(source); }` block) so the `RUNNING` list, live jobs, and failed jobs are each fetched once and shared:

```ts
this.reconciliationInFlight = true;
try {
  const [runningRuns, liveJobs, failedJobs] = await Promise.all([
    this.runRepo.findByStatus(WorkflowStatus.RUNNING),
    this.stepQueue.getJobs(
      ["active", "waiting", "delayed", "prioritized"],
      0,
      LIVE_SCAN_LIMIT - 1,
    ),
    this.stepQueue.getJobs(["failed"], 0, FAILED_SCAN_LIMIT - 1),
  ]);
  const liveRunIds = this.runIdsFromJobs(liveJobs);
  await this.reconcileFailedQueueJobs(
    source,
    runningRuns,
    liveRunIds,
    failedJobs,
  );
  await this.reconcileOrphanedPendingRuns(source);
} catch (error) {
  this.logger.error(
    `Workflow run reconciliation failed (${source}): ${(error as Error).message}`,
  );
} finally {
  this.reconciliationInFlight = false;
}
```

> The stale pass is added to this block in Task 2 Step 6. For Task 1 it is not yet present.

(c) Change `reconcileFailedQueueJobs` to accept the shared `runningRuns`, `liveRunIds`, and `failedJobs`, drop its own `findByStatus(RUNNING)` and `getJobs(['failed'])` calls, and skip runs that have a live job. Replace its signature and the first part of its body:

```ts
  private async reconcileFailedQueueJobs(
    source: string,
    runningRuns: WorkflowRun[],
    liveRunIds: Set<string>,
    failedJobs: Array<{ id?: string; data: unknown; failedReason?: string }>,
  ): Promise<void> {
    if (runningRuns.length === 0) {
      return;
    }

    // Runs parked on user input are intentionally idle, not stalled.
    const runningRunIds = new Set(
      runningRuns.filter((run) => !run.awaiting_input).map((run) => run.id),
    );
    const fallbackJobByRun = new Map(
      runningRuns.map((run) => [
        run.id,
        this.resolveRunJobId(run.current_step_id),
      ]),
    );

    let repairedCount = 0;
    for (const failedJob of failedJobs) {
      const context = this.extractQueueJobContext(failedJob.data);
      if (!context || !runningRunIds.has(context.workflowRunId)) {
        continue;
      }

      // A live job means the in-band onFailed handler already scheduled a retry
      // (or the next step). Re-handling here double-counts the auto-retry attempt
      // and gets the real retry dropped as "stale". Only reconcile genuinely
      // unhandled failures (no live job, e.g. the process died before onFailed).
      if (liveRunIds.has(context.workflowRunId)) {
        continue;
      }

      const jobId =
        context.jobId ?? fallbackJobByRun.get(context.workflowRunId);
      // ...rest of the existing loop body is unchanged...
```

Leave the remainder of the loop (the `jobId` guard, `failedReason`, dedupe key, `handleJobFailed` call, `trackProcessedKey`, `repairedCount`) and the trailing `if (repairedCount > 0) { ... }` log exactly as they are. Note the loop now iterates the passed-in `failedJobs` instead of a locally-scanned list.

(d) Add the `runIdsFromJobs` helper (place it right after `reconcileFailedQueueJobs`). Both the live-job set and the failed-job set are derived from it, reusing the existing `extractQueueJobContext`:

```ts
  private runIdsFromJobs(
    jobs: Array<{ data: unknown }> | undefined,
  ): Set<string> {
    const runIds = new Set<string>();
    for (const job of jobs ?? []) {
      const context = this.extractQueueJobContext(job.data);
      if (context) {
        runIds.add(context.workflowRunId);
      }
    }
    return runIds;
  }
```

(e) Add the `WorkflowRun` type import near the top with the other imports:

```ts
import type { WorkflowRun } from "../database/entities/workflow-run.entity";
```

- [ ] **Step 6: Run the spec to verify all tests pass**

Run: `npm run test --workspace=apps/api -- workflow-run-reconciliation.service.spec.ts`
Expected: PASS — the new skip-if-live test and all existing tests are green.

- [ ] **Step 7: Typecheck the API build**

Run: `npm run build:api`
Expected: build succeeds (no TypeScript errors).

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/workflow/workflow-run-operations/workflow-run-reconciliation.service.ts \
        apps/api/src/workflow/workflow-run-operations/workflow-run-reconciliation.service.spec.ts
git commit -m "fix(api/workflow): stop reconciler double-handling failures that already have a live retry (kanban-ezqy)"
```

---

## Task 2: Option A — auto-recover stranded RUNNING runs

**Files:**

- Modify: `apps/api/src/workflow/workflow-run-operations/workflow-run-reconciliation.service.ts`
- Test: `apps/api/src/workflow/workflow-run-operations/workflow-run-reconciliation.service.spec.ts`

- [ ] **Step 1: Write the failing tests for the stale-run watchdog**

Add this nested describe inside `describe('WorkflowRunReconciliationService', ...)`:

```ts
describe("stale RUNNING run recovery", () => {
  const STALE = new Date("2020-01-01T00:00:00.000Z"); // far older than any grace
  const FRESH = new Date(); // within grace

  it("recovers a stale RUNNING run with no live job via handleJobFailed", async () => {
    const { service, runRepo, runExecution, setQueueJobs } = createService();

    runRepo.findByStatus
      .mockResolvedValueOnce([
        {
          id: "run-stranded",
          current_step_id: "ceo_orchestration_decision",
          updated_at: STALE,
          awaiting_input: false,
        },
      ]) // RUNNING
      .mockResolvedValueOnce([]); // PENDING
    setQueueJobs({});

    await service.reconcileNow("manual");

    expect(runExecution.handleJobFailed).toHaveBeenCalledTimes(1);
    expect(runExecution.handleJobFailed).toHaveBeenCalledWith(
      "run-stranded",
      "ceo_orchestration_decision",
      expect.stringContaining("stale-run watchdog"),
    );
  });

  it("does not touch a stale RUNNING run that still has a live job", async () => {
    const { service, runRepo, runExecution, setQueueJobs } = createService();

    runRepo.findByStatus
      .mockResolvedValueOnce([
        {
          id: "run-live",
          current_step_id: "ceo_orchestration_decision",
          updated_at: STALE,
          awaiting_input: false,
        },
      ])
      .mockResolvedValueOnce([]);
    setQueueJobs({
      live: [
        {
          data: {
            workflowRunId: "run-live",
            jobId: "ceo_orchestration_decision",
          },
        },
      ],
    });

    await service.reconcileNow("manual");

    expect(runExecution.handleJobFailed).not.toHaveBeenCalled();
  });

  it("does not touch a RUNNING run updated within the grace window", async () => {
    const { service, runRepo, runExecution, setQueueJobs } = createService();

    runRepo.findByStatus
      .mockResolvedValueOnce([
        {
          id: "run-fresh",
          current_step_id: "ceo_orchestration_decision",
          updated_at: FRESH,
          awaiting_input: false,
        },
      ])
      .mockResolvedValueOnce([]);
    setQueueJobs({});

    await service.reconcileNow("manual");

    expect(runExecution.handleJobFailed).not.toHaveBeenCalled();
  });

  it("does not touch a stale RUNNING run that is awaiting user input", async () => {
    const { service, runRepo, runExecution, setQueueJobs } = createService();

    runRepo.findByStatus
      .mockResolvedValueOnce([
        {
          id: "run-awaiting",
          current_step_id: "capture_charter",
          updated_at: STALE,
          awaiting_input: true,
        },
      ])
      .mockResolvedValueOnce([]);
    setQueueJobs({});

    await service.reconcileNow("manual");

    expect(runExecution.handleJobFailed).not.toHaveBeenCalled();
  });

  it("skips a stale RUNNING run that has no current_step_id", async () => {
    const { service, runRepo, runExecution, setQueueJobs } = createService();

    runRepo.findByStatus
      .mockResolvedValueOnce([
        {
          id: "run-no-step",
          current_step_id: undefined,
          updated_at: STALE,
          awaiting_input: false,
        },
      ])
      .mockResolvedValueOnce([]);
    setQueueJobs({});

    await service.reconcileNow("manual");

    expect(runExecution.handleJobFailed).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npm run test --workspace=apps/api -- workflow-run-reconciliation.service.spec.ts -t "stale RUNNING run recovery"`
Expected: FAIL — `recovers a stale RUNNING run...` fails because no stale pass exists yet (`handleJobFailed` not called). The negative tests pass trivially.

- [ ] **Step 3: Re-wire the grace constant and add the watchdog reason**

In `workflow-run-reconciliation.service.ts`, just after `resolveStaleRunGraceMs` is defined (currently ~line 25), add the consumed constant and the reason string:

```ts
const STALE_RUN_GRACE_MS = resolveStaleRunGraceMs(
  process.env.WORKFLOW_STALE_RUN_GRACE_MS,
);

const STALE_RUN_REASON =
  "Run stalled: RUNNING with no active or queued step job (stale-run watchdog)";
```

- [ ] **Step 4: Add the time source and grace check**

Add these private members to the class (place `now()` near the top of the class body, `isOlderThanGrace` near the other private helpers):

```ts
  private now(): number {
    return Date.now();
  }

  private isOlderThanGrace(
    updatedAt: Date | undefined,
    now: number,
  ): boolean {
    const timestamp = updatedAt?.getTime();
    if (!timestamp) {
      return false;
    }
    return now - timestamp >= STALE_RUN_GRACE_MS;
  }
```

- [ ] **Step 5: Add the stale-run recovery pass**

Add this method after `reconcileOrphanedPendingRuns`:

```ts
  private async reconcileStaleRunningRuns(
    source: string,
    runningRuns: WorkflowRun[],
    liveRunIds: Set<string>,
    failedRunIds: Set<string>,
  ): Promise<void> {
    const now = this.now();
    let recoveredCount = 0;

    for (const run of runningRuns) {
      // Awaiting-input runs are intentionally idle; live runs are already
      // progressing; runs with a failed queue job are owned by
      // reconcileFailedQueueJobs; runs inside the grace window may just be slow.
      if (
        run.awaiting_input ||
        liveRunIds.has(run.id) ||
        failedRunIds.has(run.id)
      ) {
        continue;
      }
      if (!this.isOlderThanGrace(run.updated_at, now)) {
        continue;
      }

      const stepId = run.current_step_id;
      if (!stepId || stepId.length === 0) {
        this.logger.warn(
          `Stale RUNNING run ${run.id} has no current_step_id; cannot recover automatically (${source})`,
        );
        continue;
      }

      try {
        await this.runExecution.handleJobFailed(run.id, stepId, STALE_RUN_REASON);
        recoveredCount += 1;
      } catch (error) {
        this.logger.error(
          `Failed to recover stale RUNNING run ${run.id} (${source}): ${(error as Error).message}`,
        );
      }
    }

    if (recoveredCount > 0) {
      this.logger.warn(
        `Recovered ${recoveredCount.toString()} stale RUNNING run(s) with no active queue job (${source})`,
      );
    }
  }
```

- [ ] **Step 6: Invoke the new pass from `reconcileNow`**

In `reconcileNow`, derive `failedRunIds` from the already-fetched `failedJobs` and add the stale pass after `reconcileOrphanedPendingRuns` (reusing the already-fetched `runningRuns` and `liveRunIds`). The `try` block becomes:

```ts
const [runningRuns, liveJobs, failedJobs] = await Promise.all([
  this.runRepo.findByStatus(WorkflowStatus.RUNNING),
  this.stepQueue.getJobs(
    ["active", "waiting", "delayed", "prioritized"],
    0,
    LIVE_SCAN_LIMIT - 1,
  ),
  this.stepQueue.getJobs(["failed"], 0, FAILED_SCAN_LIMIT - 1),
]);
const liveRunIds = this.runIdsFromJobs(liveJobs);
const failedRunIds = this.runIdsFromJobs(failedJobs);
await this.reconcileFailedQueueJobs(
  source,
  runningRuns,
  liveRunIds,
  failedJobs,
);
await this.reconcileOrphanedPendingRuns(source);
await this.reconcileStaleRunningRuns(
  source,
  runningRuns,
  liveRunIds,
  failedRunIds,
);
```

- [ ] **Step 7: Run the full spec to verify all tests pass**

Run: `npm run test --workspace=apps/api -- workflow-run-reconciliation.service.spec.ts`
Expected: PASS — all stale-run recovery tests plus every Task 1 and pre-existing test.

> Note: the pre-existing test `does not rebroadcast historical failed runs during reconciliation` asserts `findByStatus` is called exactly twice (RUNNING then PENDING). This still holds: `reconcileNow` fetches `RUNNING` once and `reconcileOrphanedPendingRuns` fetches `PENDING` once; the stale pass reuses the shared `runningRuns` array and does not call `findByStatus`. If this test fails, do not add a third `findByStatus` call — keep reusing `runningRuns`.

- [ ] **Step 8: Typecheck the API build**

Run: `npm run build:api`
Expected: build succeeds.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/workflow/workflow-run-operations/workflow-run-reconciliation.service.ts \
        apps/api/src/workflow/workflow-run-operations/workflow-run-reconciliation.service.spec.ts
git commit -m "feat(api/workflow): auto-recover stale RUNNING runs with no active queue job (kanban-ezqy)"
```

---

## Task 3: Documentation, lint, and end-to-end verification

**Files:**

- Modify: `apps/api/.env.example` (verify the canonical env-example path first)
- Verify only: full reconciliation spec, API lint, live stack behaviour

- [ ] **Step 1: Document the grace env var**

Find the canonical env-example file and confirm it lists workflow env vars:

Run: `ls apps/api/.env.example .env.example 2>/dev/null; grep -rln "WORKFLOW_\|RECONCIL\|STALE" --include=*.env.example .`
Expected: identifies the file(s) that document API env vars.

Add this line to the workflow section of that file (use the file the grep above identifies; if both exist, add to the API one):

```bash
# How long a workflow run may sit in RUNNING with no active/queued step job
# before the reconciler treats it as stalled and routes it through the retry/
# repair path. Milliseconds. Default: 300000 (5 minutes).
WORKFLOW_STALE_RUN_GRACE_MS=300000
```

- [ ] **Step 2: Lint the API workspace**

Run: `npm run lint:api`
Expected: PASS with no new findings. Do not suppress any rule — fix in code if anything fires.

- [ ] **Step 3: Run the full reconciliation + job-execution specs together**

Run: `npm run test --workspace=apps/api -- workflow-run-reconciliation workflow-run-job-execution`
Expected: PASS — confirms the shared `handleJobFailed` contract still holds for both callers.

- [ ] **Step 4: Rebuild the API image and restart**

Run: `docker compose up -d --build api`
Expected: `nexus-api` reports healthy.

- [ ] **Step 5: Verify the watchdog recovers a stranded run end-to-end**

Lower the grace temporarily so the check is fast, then strand a run and observe recovery.

Run (set a 30s grace and restart):

```bash
WORKFLOW_STALE_RUN_GRACE_MS=30000 docker compose up -d api
```

Create a synthetic stranded run directly in the DB (RUNNING, no queue job, old `updated_at`), using a real workflow id:

```bash
docker exec nexus-postgres psql -U nexus -d nexus_orchestrator -c \
  "INSERT INTO workflow_runs (id, workflow_id, status, current_step_id, state_variables, awaiting_input, created_at, updated_at) \
   SELECT gen_random_uuid(), w.id, 'RUNNING', 'ceo_orchestration_decision', '{}'::jsonb, false, now() - interval '10 minutes', now() - interval '10 minutes' \
   FROM workflows w WHERE w.name = 'Project Orchestration Cycle (CEO)' LIMIT 1 RETURNING id;"
```

Within ~60s, confirm the reconciler picked it up:

```bash
docker logs nexus-api --since 2m 2>&1 | grep -iE "Recovered .* stale RUNNING run|stale-run watchdog"
```

Expected: a `Recovered N stale RUNNING run(s) with no active queue job (interval)` log line, and the synthetic run transitions out of `RUNNING` (to a retry or `FAILED`):

```bash
docker exec nexus-postgres psql -U nexus -d nexus_orchestrator -c \
  "SELECT id, status FROM workflow_runs WHERE current_step_id='ceo_orchestration_decision' ORDER BY updated_at DESC LIMIT 5;"
```

- [ ] **Step 6: Restore the default grace**

Run: `docker compose up -d api` (drops the temporary `WORKFLOW_STALE_RUN_GRACE_MS` override so the 5-minute default applies). Confirm `nexus-api` is healthy.

- [ ] **Step 7: Close the tracking issue and commit docs**

```bash
git add -A
git commit -m "docs(api): document WORKFLOW_STALE_RUN_GRACE_MS stale-run watchdog grace (kanban-ezqy)"
bd close kanban-ezqy --reason="Auto-recovery watchdog + double-handling fix implemented and verified end-to-end"
```

---

## Self-Review

**Spec coverage:**

- Option A (auto-recover hung runs): Task 2 adds `reconcileStaleRunningRuns`, re-wires the dead `WORKFLOW_STALE_RUN_GRACE_MS` grace, and feeds stranded runs through `handleJobFailed`. ✓
- Option B (stop the strander): Task 1 skips failed-queue-job reconciliation when the run already has a live job, removing the double `handleJobFailed`. ✓
- Exclusions (awaiting_input, paused→PENDING, within-grace, no-step): covered by Task 2 tests and guards. ✓
- Bounded behaviour (no infinite watchdog loops): each recovery goes through the existing retry-policy/attempt counter; exhausted runs fail and close. ✓
- Docs/config: Task 3 Step 1. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code; every run step shows the command and expected result. ✓

**Type consistency:** `runIdsFromJobs(jobs: Array<{ data: unknown }> | undefined): Set<string>`, `reconcileFailedQueueJobs(source, runningRuns: WorkflowRun[], liveRunIds: Set<string>, failedJobs: Array<{ id?: string; data: unknown; failedReason?: string }>)`, `reconcileStaleRunningRuns(source, runningRuns: WorkflowRun[], liveRunIds: Set<string>, failedRunIds: Set<string>)`, `isOlderThanGrace(updatedAt: Date | undefined, now: number)`, and the `setQueueJobs({ live?, failed? })` test helper are used consistently across tasks. `STALE_RUN_REASON` contains the substring `stale-run watchdog` asserted by the Task 2 test. ✓

**Cross-pass exclusion (the subtle correctness point):** Several pre-existing tests give a run an old `updated_at` (e.g. `2026-04-05`) **and** a failed queue job. Without excluding `failedRunIds`, the stale pass would call `handleJobFailed` a second time on those runs and break the dedupe/delegate assertions. The stale pass therefore skips any run in `failedRunIds` (owned by `reconcileFailedQueueJobs`) and any run in `liveRunIds` (already progressing). Walk each existing test mentally before implementing Task 2: a run only reaches `handleJobFailed` via the stale pass when it has neither a live nor a failed job. ✓

**Risk notes for the implementer:**

- The only behaviour change to existing reconciliation is the skip-if-live guard; the queue-mock refactor in Task 1 Step 1 is behaviour-preserving and must stay green before Step 3.
- Do not add a third `findByStatus(RUNNING)` call; reuse the shared `runningRuns`. `reconcileNow` fetches `RUNNING` once and `reconcileOrphanedPendingRuns` fetches `PENDING` once — still exactly two `findByStatus` calls.
- `runIdsFromJobs` defends against a falsy `getJobs` result (`?? []`) so a mock or empty queue cannot throw.
- If `reconcileFailedQueueJobs` throws (e.g. `handleJobFailed` rejects), `reconcileNow`'s `catch` aborts the rest of the cycle, so the stale pass does not run that cycle — this is what keeps the existing "retries a failed queue job if handleJobFailed threw" test at exactly two calls.
