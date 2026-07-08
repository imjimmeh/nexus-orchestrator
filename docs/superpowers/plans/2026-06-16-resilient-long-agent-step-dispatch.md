# Resilient Long-Running Agent-Step Dispatch — Implementation Plan (B + C + D)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop a long-running `implement_and_commit` agent step from being destructively restarted (fresh agent session, work re-done) when the synchronous `POST /execute/agent` connection drops or times out, and ultimately remove the long-held connection that causes it.

**Architecture:** The API dispatches an agent step by holding one synchronous HTTP `POST /execute/agent` open for the agent's entire run (can be hours), then BullMQ + `handleJobFailed` treat any connection failure as a `generic_failure` and re-enqueue the job cold — new container, new agent session, no memory of the work already done (the worktree files survive, but the agent re-investigates from scratch). We fix this in three layers: **(D)** classify a clean transport timeout/disconnect distinctly instead of lumping it into `generic_failure`; **(B)** make the retry non-destructive — first salvage the step if it already produced its `set_job_output`, otherwise re-enqueue the retry *resuming the same agent session* instead of cold-starting; **(C)** eliminate the root cause by switching `/execute/agent` to fire-and-poll (return `202` immediately; completion is reported through the existing `step_complete` / `set_job_output` callback path) so the API never holds a multi-hour connection.

**Tech Stack:** NestJS + TypeORM (PostgreSQL) for `apps/api`; BullMQ for the step queue; `@nexus/harness-runtime` container HTTP server (`packages/harness-runtime/src/server/server.ts`); **Vitest** for tests. Test runner convention (api): `cd apps/api && npx vitest run --config vitest.config.ts <relative-spec-path>`. Typecheck (api): `cd apps/api && npx tsc --noEmit -p tsconfig.json`.

**Root-cause reference:** Run `75fd86ac-13db-4ba6-9987-d77918d411df`, job `implement_and_commit`. `workflow.retry_scheduled` reason `HTTP POST timed out: http://172.18.0.10:8374/execute/agent`, `reasonCode: generic_failure`, attempt 2/3, after a legitimate ~2h run (7 sequential subagents). The retry started a fresh parent session (`pi_session_trees` shows a new tree ~10:56) whose first action was re-running `git status` to "explore". See memory `project_implement_2h_http_timeout_destructive_retry`.

**Relationship to prior plan:** `docs/superpowers/plans/2026-06-10-workflow-long-step-failures.md` Phase 1 (timeout 35min→2h, configurable via `WORKFLOW_AGENT_HTTP_TIMEOUT_MS`) already shipped; option **A** (default 2h→6h) is being applied separately on the current branch. That plan explicitly deferred async dispatch — **this plan is that follow-up plus the non-destructive-retry safety net.**

---

## How the three layers interact (read once)

A connection failure on `POST /execute/agent` surfaces at `runAgentJobAndPublishResult` (`step-execution-orchestrator.service.ts:302` catch) → publishes `execution.failed` → `WorkflowRunJobExecutionService.handleJobFailed(runId, jobId, reason)` (`workflow-run-job-execution.service.ts:250`). That method is the single decision point we harden.

- **D** gives the failure a distinct `reasonCode` (`agent_transport_timeout`) so telemetry/UI and the retry path can recognise it (today the message `"HTTP POST timed out"` falls through `classifyWorkflowFailure` → `generic_failure`).
- **B-salvage** runs *before* scheduling a retry: if the step already persisted `jobs.<jobId>.output`, the agent had finished and only the *response* was lost — route to `handleJobComplete` instead of restarting.
- **B-resume** covers the in-progress case (this run): when a retry *is* scheduled for an agent step that has a persisted session ref/tree, re-enqueue carrying `resumeSessionRef` / `resumeSessionTreeId` so the new container continues the agent session rather than cold-starting.
- **C** removes the long-held connection entirely, so transport timeouts stop happening at all; B+D remain as the safety net for genuine container death.

Ship order: **Phase 1 (D + B-salvage)** → **Phase 2 (B-resume)** → **Phase 3 (C async dispatch)**. Each phase is independently shippable and testable.

---

## File Structure

**Phase 1 — distinct classification + salvage**
- Modify `apps/api/src/workflow/workflow-failure-classification.helpers.ts` — recognise transport timeout/disconnect, return `reasonCode: 'agent_transport_timeout'`.
- Test `apps/api/src/workflow/workflow-failure-classification.helpers.spec.ts` (create if absent).
- Create `apps/api/src/workflow/workflow-job-output.helpers.ts` — pure `jobOutputStatePath(jobId)` + `hasPersistedJobOutput(...)`.
- Test `apps/api/src/workflow/workflow-job-output.helpers.spec.ts`.
- Modify `apps/api/src/workflow/workflow-run-job-execution.service.ts` — in `handleJobFailed`, salvage-before-retry for agent steps with persisted output.
- Test `apps/api/src/workflow/workflow-run-job-execution.service.spec.ts` (exists).

**Phase 2 — resume the agent session on retry**
- Modify `apps/api/src/workflow/workflow-run-auto-retry.helpers.ts` — thread an optional `resume` ref into the re-enqueued job data.
- Modify `apps/api/src/workflow/workflow-run-job-execution.service.ts` — resolve the persisted session ref/tree for the failed agent job and pass it to `scheduleWorkflowAutoRetry`.
- Modify `apps/api/src/workflow/workflow-step-execution/step-execution-orchestrator.service.ts` — when `autoRetry.resume` is present, take the existing resume path instead of cold dispatch.
- Tests: `workflow-run-auto-retry.helpers.spec.ts` (create), `step-execution-orchestrator.resume.spec.ts` (exists), `workflow-run-job-execution.service.spec.ts`.

**Phase 3 — fire-and-poll dispatch (remove the long-held connection)**
- Modify `packages/harness-runtime/src/server/server.ts` — `/execute/agent` accepts `{ mode: 'async' }`, returns `202 { ok: true, accepted: true }`, runs the agent in the background, reports terminal result via the existing completion callback.
- Modify `apps/api/src/docker/container-http-client.service.ts` — `executeAgentAsync(...)` posts with a short timeout and expects `202`.
- Modify `apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.multistep.ts` — dispatch async, then await the completion signal (domain event) instead of the HTTP response.
- Modify `apps/api/src/workflow/workflow-step-execution/step-execution-completion.listener.ts` — already routes `execution.completed/failed`; ensure async path resolves the pending dispatch.
- Tests: `container-http-client.service.spec.ts` (exists), `step-agent-step-executor.multistep.spec.ts` (exists), harness-runtime server tests.

---

## Phase 1 — Distinct timeout classification + salvage-before-restart

### Task 1: Classify a transport timeout/disconnect distinctly (D)

Today `"HTTP POST timed out: <url>"` is unknown to `classifyWorkflowFailure`, so it returns `generic_failure`. Give it its own `reasonCode` so downstream logic and telemetry can recognise it. It stays retryable (not added to the non-retryable list).

**Files:**
- Modify: `apps/api/src/workflow/workflow-failure-classification.helpers.ts`
- Test: `apps/api/src/workflow/workflow-failure-classification.helpers.spec.ts`

- [ ] **Step 1: Read the current classifier** so the new branch matches its return shape.

Run: `cat apps/api/src/workflow/workflow-failure-classification.helpers.ts`
Note the `WorkflowFailureClassification` return type and how `reasonCode` / `retryCategory` are set for the default (`generic_failure`) case. The new branch must return the same shape with only `reasonCode` changed.

- [ ] **Step 2: Write the failing test**

Add to `apps/api/src/workflow/workflow-failure-classification.helpers.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { classifyWorkflowFailure } from './workflow-failure-classification.helpers';

describe('classifyWorkflowFailure — transport timeout', () => {
  const base = { providerOverloadDelayMs: 1000, rateLimitResetBufferMs: 1000 };

  it('classifies an /execute/agent POST timeout as agent_transport_timeout', () => {
    const result = classifyWorkflowFailure({
      reason: 'HTTP POST timed out: http://172.18.0.10:8374/execute/agent',
      ...base,
    });
    expect(result.reasonCode).toBe('agent_transport_timeout');
  });

  it('classifies a socket hang up / ECONNRESET as agent_transport_timeout', () => {
    const result = classifyWorkflowFailure({
      reason: 'request to http://172.18.0.10:8374/execute/agent failed, reason: socket hang up (ECONNRESET)',
      ...base,
    });
    expect(result.reasonCode).toBe('agent_transport_timeout');
  });

  it('leaves an unrelated error as generic_failure', () => {
    const result = classifyWorkflowFailure({ reason: 'something else broke', ...base });
    expect(result.reasonCode).toBe('generic_failure');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/api && npx vitest run --config vitest.config.ts src/workflow/workflow-failure-classification.helpers.spec.ts`
Expected: FAIL — the first two return `generic_failure`.

- [ ] **Step 4: Write minimal implementation**

In `apps/api/src/workflow/workflow-failure-classification.helpers.ts`, add near the top:

```typescript
const AGENT_TRANSPORT_TIMEOUT_PATTERN =
  /(?:HTTP POST timed out|socket hang up|ECONNRESET|ECONNREFUSED|ETIMEDOUT)/i;
```

Then, in `classifyWorkflowFailure`, immediately before the final `generic_failure` return, add:

```typescript
  if (AGENT_TRANSPORT_TIMEOUT_PATTERN.test(params.reason)) {
    return {
      // keep the same retryCategory the generic path uses (do NOT mark
      // provider_overload/rate_limit) — only the reasonCode is specialised
      // so telemetry + the salvage/resume paths can recognise a lost
      // connection vs. a genuine agent crash.
      retryCategory: 'generic',
      reasonCode: 'agent_transport_timeout',
    };
  }
```

> Match the exact property names/enum values the file already uses for the generic case (verify against Step 1). If the generic return omits `retryCategory`, omit it here too.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/api && npx vitest run --config vitest.config.ts src/workflow/workflow-failure-classification.helpers.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/workflow/workflow-failure-classification.helpers.ts apps/api/src/workflow/workflow-failure-classification.helpers.spec.ts
git commit -m "feat(workflow): classify agent transport timeout distinctly from generic_failure"
```

---

### Task 2: Pure helper to detect already-persisted job output

`set_job_output` persists to state key `jobs.<jobId>.output` (see `workflow-runtime-set-job-output.service.ts` and `job-output-capability.provider.ts:12`). Add a tiny pure helper so the salvage check is testable in isolation.

**Files:**
- Create: `apps/api/src/workflow/workflow-job-output.helpers.ts`
- Test: `apps/api/src/workflow/workflow-job-output.helpers.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/workflow/workflow-job-output.helpers.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  jobOutputStatePath,
  hasPersistedJobOutput,
} from './workflow-job-output.helpers';

describe('workflow-job-output.helpers', () => {
  it('builds the canonical job output state path', () => {
    expect(jobOutputStatePath('implement_and_commit')).toBe(
      'jobs.implement_and_commit.output',
    );
  });

  it('hasPersistedJobOutput is true when a non-empty object is present', async () => {
    const getVariable = async (path: string) =>
      path === 'jobs.j1.output' ? { summary: 'done' } : null;
    expect(await hasPersistedJobOutput(getVariable, 'j1')).toBe(true);
  });

  it('is false for null / undefined / empty object', async () => {
    expect(await hasPersistedJobOutput(async () => null, 'j1')).toBe(false);
    expect(await hasPersistedJobOutput(async () => undefined, 'j1')).toBe(false);
    expect(await hasPersistedJobOutput(async () => ({}), 'j1')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run --config vitest.config.ts src/workflow/workflow-job-output.helpers.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `apps/api/src/workflow/workflow-job-output.helpers.ts`:

```typescript
/** Canonical state path where set_job_output persists a job's structured output. */
export const jobOutputStatePath = (jobId: string): string =>
  `jobs.${jobId}.output`;

/**
 * True when the job already persisted a non-empty output object via
 * set_job_output. Used to salvage an agent step whose work completed but whose
 * dispatch connection dropped before the HTTP response returned.
 */
export async function hasPersistedJobOutput(
  getVariable: (path: string) => Promise<unknown>,
  jobId: string,
): Promise<boolean> {
  const value = await getVariable(jobOutputStatePath(jobId));
  if (value === null || value === undefined || typeof value !== 'object') {
    return false;
  }
  return Object.keys(value as Record<string, unknown>).length > 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run --config vitest.config.ts src/workflow/workflow-job-output.helpers.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/workflow/workflow-job-output.helpers.ts apps/api/src/workflow/workflow-job-output.helpers.spec.ts
git commit -m "feat(workflow): add helper to detect already-persisted job output"
```

---

### Task 3: Salvage a timed-out agent step that already produced output

In `handleJobFailed`, when the failure is `agent_transport_timeout` and the job already persisted output, complete the job (salvage) instead of restarting it.

**Files:**
- Modify: `apps/api/src/workflow/workflow-run-job-execution.service.ts:250-356` (`handleJobFailed`)
- Test: `apps/api/src/workflow/workflow-run-job-execution.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Add to `apps/api/src/workflow/workflow-run-job-execution.service.spec.ts` (follow the existing mock setup in that file for `runRepo`, `stateManager`, `handleJobComplete` spy):

```typescript
it('salvages a transport-timeout failure when job output already exists', async () => {
  // run is RUNNING; output already persisted
  runRepo.findById.mockResolvedValue({
    id: 'run-1',
    workflow_id: 'wf-1',
    status: WorkflowStatus.RUNNING,
    awaiting_input: false,
    wait_reason: null,
  });
  stateManager.getVariable.mockImplementation(async (_run: string, path: string) =>
    path === 'jobs.implement_and_commit.output' ? { summary: 'done' } : null,
  );
  const completeSpy = vi
    .spyOn(service, 'handleJobComplete')
    .mockResolvedValue(undefined);

  const result = await service.handleJobFailed(
    'run-1',
    'implement_and_commit',
    'HTTP POST timed out: http://172.18.0.10:8374/execute/agent',
  );

  expect(completeSpy).toHaveBeenCalledWith(
    'run-1',
    'implement_and_commit',
    { summary: 'done' },
  );
  expect(result).toBe('salvaged');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run --config vitest.config.ts src/workflow/workflow-run-job-execution.service.spec.ts`
Expected: FAIL — `'salvaged'` is not a valid return / salvage branch missing.

- [ ] **Step 3: Write minimal implementation**

In `workflow-run-job-execution.service.ts`:

1. Widen the return type of `handleJobFailed` (line 254) to include `'salvaged'`:

```typescript
  ): Promise<'ignored' | 'retry_scheduled' | 'failed' | 'salvaged'> {
```

2. Add imports near the top of the file:

```typescript
import { resolveWorkflowRetryDecision } from './workflow-provider-overload-retry.helpers';
import {
  hasPersistedJobOutput,
  jobOutputStatePath,
} from './workflow-job-output.helpers';
```

(`resolveWorkflowRetryDecision` is already imported — do not duplicate; only add the job-output import.)

3. Immediately after the `run.status !== RUNNING` guard returns (after line 265), insert the salvage branch:

```typescript
    // Salvage: an agent step whose work already produced set_job_output but
    // whose dispatch connection dropped before the HTTP response returned is
    // effectively complete. Restarting it would re-run hours of work, so route
    // the persisted output through the normal completion path instead.
    const transportTimeout = /(?:HTTP POST timed out|socket hang up|ECONNRESET|ETIMEDOUT)/i.test(
      reason,
    );
    if (transportTimeout) {
      const output = (await this.stateManager.getVariable(
        workflowRunId,
        jobOutputStatePath(jobId),
      )) as Record<string, unknown> | null;
      if (
        output &&
        (await hasPersistedJobOutput(
          (path) => this.stateManager.getVariable(workflowRunId, path),
          jobId,
        ))
      ) {
        this.logger.warn(
          `Salvaging job ${jobId} in run ${workflowRunId}: transport timeout but set_job_output already persisted`,
        );
        await this.handleJobComplete(workflowRunId, jobId, output);
        return 'salvaged';
      }
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run --config vitest.config.ts src/workflow/workflow-run-job-execution.service.spec.ts`
Expected: PASS. Also run the whole file to confirm no regression in existing retry/fail tests.

- [ ] **Step 5: Typecheck**

Run: `cd apps/api && npx tsc --noEmit -p tsconfig.json`
Expected: no errors (the new `'salvaged'` union member must be handled by any caller that switches on the result — search call sites with `grep -rn "handleJobFailed(" apps/api/src` and confirm none exhaustively switch without a default).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/workflow/workflow-run-job-execution.service.ts apps/api/src/workflow/workflow-run-job-execution.service.spec.ts
git commit -m "feat(workflow): salvage timed-out agent step that already produced job output"
```

---

## Phase 2 — Resume the agent session on retry instead of cold-starting

This phase covers the in-progress case (the actual `75fd86ac` failure): the agent had NOT yet produced final output, so Phase 1 salvage does not apply. Instead of cold-restarting, re-enqueue the retry carrying the prior session reference so the new container resumes the same agent session. The resume infrastructure already exists for parent-await and checkpoint resume (`step-execution-orchestrator.service.ts:451-512`, `resumeJobWithMessage(..., { resumeSessionRef })`); we wire it into the auto-retry path.

### Task 4: Carry an optional resume ref through the auto-retry enqueue

**Files:**
- Modify: `apps/api/src/workflow/workflow-run-auto-retry.helpers.ts` (`ScheduleWorkflowAutoRetryParams` ~line 54, `enqueueRetryJob` ~line 241, the `stepQueue.add` payload ~line 295)
- Test: `apps/api/src/workflow/workflow-run-auto-retry.helpers.spec.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/workflow/workflow-run-auto-retry.helpers.spec.ts`. Mock `stepQueue.add`, `stateManager`, `runRepo`, `systemSettings` (retry enabled, maxAttempts 3), and a workflow definition containing the job. Assert that when `resume` is supplied, the enqueued job data contains it:

```typescript
it('threads the resume ref into the re-enqueued job data', async () => {
  // ...arrange mocks so a retry IS scheduled (attempt 0, enabled)...
  await scheduleWorkflowAutoRetry({
    run: { id: 'run-1', workflow_id: 'wf-1' },
    jobId: 'implement_and_commit',
    reason: 'HTTP POST timed out: ...',
    reasonCode: 'agent_transport_timeout',
    resume: { resumeSessionRef: { kind: 'claude_code', sessionId: 'sess-1' } },
    // ...other required params from ScheduleWorkflowAutoRetryParams...
  } as never);

  expect(stepQueue.add).toHaveBeenCalledWith(
    'execute-job',
    expect.objectContaining({
      autoRetry: expect.objectContaining({
        resume: { resumeSessionRef: { kind: 'claude_code', sessionId: 'sess-1' } },
      }),
    }),
    expect.any(Object),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run --config vitest.config.ts src/workflow/workflow-run-auto-retry.helpers.spec.ts`
Expected: FAIL — `resume` not accepted / not present in enqueued data.

- [ ] **Step 3: Write minimal implementation**

Define a shared resume type. Add to `workflow-run-auto-retry.helpers.ts`:

```typescript
import type { HarnessSessionRef } from '@nexus/core';

export interface AgentRetryResume {
  resumeSessionRef?: HarnessSessionRef;
  resumeSessionTreeId?: string;
}
```

Add `resume?: AgentRetryResume;` to `ScheduleWorkflowAutoRetryParams` (after line 77), forward it into `enqueueRetryJob` (add `resume: params.resume,` in the call ~line 146 and a `resume?: AgentRetryResume;` field on the `enqueueRetryJob` params type ~line 264), and include it in the `stepQueue.add` `autoRetry` object (line 303):

```typescript
      autoRetry: {
        attempt: params.nextAttempt,
        retryQueueJobId,
        resume: params.resume,
      },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run --config vitest.config.ts src/workflow/workflow-run-auto-retry.helpers.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/workflow/workflow-run-auto-retry.helpers.ts apps/api/src/workflow/workflow-run-auto-retry.helpers.spec.ts
git commit -m "feat(workflow): thread resume ref through auto-retry enqueue"
```

---

### Task 5: Resolve and pass the failed agent job's session ref when retrying

When `handleJobFailed` schedules a retry for a transport timeout, look up the freshest session ref/tree for the run and pass it as `resume`.

**Files:**
- Modify: `apps/api/src/workflow/workflow-run-job-execution.service.ts` (the `scheduleWorkflowAutoRetry({...})` call ~line 298)
- Reuse: session lookup from `session-hydration.service.ts` (`findSessionTreeByWorkflowRunId`) and/or `agent-await.repository.ts` `parent_session_ref`. Inject whichever the service already has access to; prefer the session tree id for PI and `parent_session_ref` for claude_code.
- Test: `apps/api/src/workflow/workflow-run-job-execution.service.spec.ts`

- [ ] **Step 1: Write the failing test** — assert that on a transport-timeout retry (no persisted output), `scheduleWorkflowAutoRetry` is called with a `resume` arg derived from the looked-up session tree id. Mock the session lookup to return `{ id: 'tree-9' }`:

```typescript
it('passes a resume ref when retrying a timed-out agent step with no output', async () => {
  runRepo.findById.mockResolvedValue({ id: 'run-1', workflow_id: 'wf-1', status: WorkflowStatus.RUNNING, awaiting_input: false, wait_reason: null });
  stateManager.getVariable.mockResolvedValue(null); // no persisted output
  sessionHydration.findSessionTreeByWorkflowRunId.mockResolvedValue({ id: 'tree-9' });
  scheduleAutoRetrySpy.mockResolvedValue(true);

  const result = await service.handleJobFailed('run-1', 'implement_and_commit', 'HTTP POST timed out: ...');

  expect(scheduleAutoRetrySpy).toHaveBeenCalledWith(
    expect.objectContaining({ resume: { resumeSessionTreeId: 'tree-9' } }),
  );
  expect(result).toBe('retry_scheduled');
});
```

- [ ] **Step 2: Run test to verify it fails** — Run the spec; FAIL (no `resume` passed).

- [ ] **Step 3: Write minimal implementation** — inject the session lookup into the service constructor (follow the existing DI pattern in the file), and in `handleJobFailed`, before the `scheduleWorkflowAutoRetry` call, build the resume ref for transport timeouts:

```typescript
      let resume: AgentRetryResume | undefined;
      if (retryDecision.reasonCode === 'agent_transport_timeout') {
        const tree = await this.sessionHydration.findSessionTreeByWorkflowRunId(
          workflowRunId,
        );
        if (tree?.id) {
          resume = { resumeSessionTreeId: tree.id };
        }
      }
```

Then add `resume,` to the `scheduleWorkflowAutoRetry({...})` argument object.

- [ ] **Step 4: Run test to verify it passes** — Run the spec; PASS. Run the full file for regressions.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/workflow/workflow-run-job-execution.service.ts apps/api/src/workflow/workflow-run-job-execution.service.spec.ts
git commit -m "feat(workflow): resolve agent session ref for transport-timeout retries"
```

---

### Task 6: Honor `autoRetry.resume` in the dispatcher (resume instead of cold start)

**Files:**
- Modify: `apps/api/src/workflow/workflow-step-execution/step-execution-orchestrator.service.ts` (`dispatchJob` ~line 128 and the existing resume branch ~line 451-512)
- Test: `apps/api/src/workflow/workflow-step-execution/step-execution-orchestrator.resume.spec.ts`

- [ ] **Step 1: Write the failing test** — feed `dispatchJob` queue data containing `autoRetry.resume.resumeSessionTreeId = 'tree-9'` and assert it takes the resume path (threads `resumeSessionTreeId` into the runner config) rather than provisioning a fresh session. Mirror the assertions already used in `step-execution-orchestrator.resume.spec.ts` for checkpoint resume.

- [ ] **Step 2: Run test to verify it fails** — Run the spec; FAIL.

- [ ] **Step 3: Write minimal implementation** — in `dispatchJob`, read `queueData.autoRetry?.resume`; when present, route through the same resume mechanism the checkpoint/parent-await paths use (set `resumeSessionTreeId` / `resumeSessionRef` on the dispatch params; see lines 495-500). Guard: only resume if the job is not already completed (reuse the existing completed-check at line 477-480).

- [ ] **Step 4: Run test to verify it passes** — Run the spec; PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
cd apps/api && npx tsc --noEmit -p tsconfig.json
git add apps/api/src/workflow/workflow-step-execution/step-execution-orchestrator.service.ts apps/api/src/workflow/workflow-step-execution/step-execution-orchestrator.resume.spec.ts
git commit -m "feat(workflow): resume agent session on auto-retry instead of cold start"
```

- [ ] **Step 7: Manual verification (live stack)** — restart `nexus-api` (`docker restart nexus-api`), launch a workflow whose `implement_and_commit` step is forced to fail mid-run with a transport timeout (temporarily set `WORKFLOW_AGENT_HTTP_TIMEOUT_MS=60000` in the api env), and confirm via `retrieve-debug-bundle` that the retry session reuses the prior `pi_session_trees` chat_session rather than starting a fresh `git status` investigation. Reset the env var afterwards.

---

## Phase 3 — Fire-and-poll dispatch (remove the long-held connection)

Root-cause fix: the API stops holding `POST /execute/agent` open for the agent's whole run. The container accepts the job, returns `202` immediately, runs the agent in the background, and reports the terminal result through the **existing** completion callback path (`step_complete` / `set_job_output` → `execution.completed` / `execution.failed` domain events that `step-execution-completion.listener.ts` already routes). After this phase, transport timeouts on long runs cannot occur; Phases 1–2 remain as the safety net for genuine container death.

> This is the larger refactor the 2026-06-10 plan deferred. It spans `packages/harness-runtime` and `apps/api`. Implement behind a flag (`WORKFLOW_AGENT_DISPATCH_MODE=async|sync`, default `sync` until verified) so it can be rolled out and rolled back safely.

### Task 7: harness-runtime `/execute/agent` async mode

**Files:**
- Modify: `packages/harness-runtime/src/server/server.ts` (the `/execute/agent` handler)
- Test: harness-runtime server spec (locate with `ls packages/harness-runtime/src/server/*.spec.ts`)

- [ ] **Step 1: Read the current handler** — `cat packages/harness-runtime/src/server/server.ts` to find the `/execute/agent` route, how it currently runs the agent to completion before responding, and how it already calls back to the API for `step_complete` / `set_job_output` (the completion-callback client). The async mode reuses that callback for the terminal result.

- [ ] **Step 2: Write the failing test** — POST `/execute/agent` with `{ ...request, mode: 'async' }` and assert the HTTP response is `202` with `{ ok: true, accepted: true }` *before* the agent finishes, and that the completion callback is invoked once the background run resolves. Use a fake/stubbed agent runner so the test is deterministic.

- [ ] **Step 3: Write minimal implementation** — when `mode === 'async'`: validate the request, start the agent run as a background promise (`void run().catch(reportFailure)`), and immediately respond `202 { ok: true, accepted: true }`. On background completion, post the terminal result through the existing completion-callback client (the same path that today fires `execution.completed` / `execution.failed`). Preserve the existing synchronous behavior when `mode` is absent or `'sync'`.

- [ ] **Step 4: Run test / build** — `cd packages/harness-runtime && npm test` (and `npm run build`). Expected: PASS. Rebuild container images that bundle harness-runtime (`nexus-light`, `nexus-heavy`) per CLAUDE.md when verifying live.

- [ ] **Step 5: Commit**

```bash
git add packages/harness-runtime/src/server/server.ts <spec>
git commit -m "feat(harness-runtime): async mode for /execute/agent (202 + callback)"
```

### Task 8: API `executeAgentAsync` client

**Files:**
- Modify: `apps/api/src/docker/container-http-client.service.ts`
- Test: `apps/api/src/docker/container-http-client.service.spec.ts`

- [ ] **Step 1: Write the failing test** — a mock server returns `202 { ok: true, accepted: true }`; assert `executeAgentAsync(baseUrl, request)` resolves to that, and uses a SHORT timeout (e.g. 60s) not the 6h agent timeout.

- [ ] **Step 2: Run / fail.**

- [ ] **Step 3: Implement** — add:

```typescript
export const AGENT_ASYNC_ACCEPT_TIMEOUT_MS = 60_000;

async executeAgentAsync(
  baseUrl: string,
  request: ContainerAgentRequest,
): Promise<{ ok: boolean; accepted: boolean }> {
  return this.httpPostJson(`${baseUrl}/execute/agent`, {
    ...request,
    mode: 'async',
  });
}
```

Parameterize `httpPostJson` to accept an optional `timeoutMs` (default to the existing `resolveAgentPostTimeoutMs(...)`), and pass `AGENT_ASYNC_ACCEPT_TIMEOUT_MS` from `executeAgentAsync`. The accept POST is short-lived, so the 6h socket timeout no longer applies to async dispatch.

- [ ] **Step 4: Run / pass. Step 5: Commit.**

```bash
git add apps/api/src/docker/container-http-client.service.ts apps/api/src/docker/container-http-client.service.spec.ts
git commit -m "feat(api): executeAgentAsync client for fire-and-poll dispatch"
```

### Task 9: Multistep executor awaits the completion signal, not the HTTP response

**Files:**
- Modify: `apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.multistep.ts` (`executeAgentStepOnContainer` ~line 432-510)
- Modify (if needed): `apps/api/src/workflow/workflow-step-execution/step-execution-completion.listener.ts`
- Test: `apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.multistep.spec.ts`

- [ ] **Step 1: Write the failing test** — with `WORKFLOW_AGENT_DISPATCH_MODE=async`, assert `executeAgentStepOnContainer` calls `executeAgentAsync` (not `executeAgent`) and then resolves only when the completion signal for that `executionId` fires (emit a fake `execution.completed`). With mode `sync` (default), assert the existing synchronous path is unchanged.

- [ ] **Step 2: Run / fail.**

- [ ] **Step 3: Implement** — gate on `process.env.WORKFLOW_AGENT_DISPATCH_MODE === 'async'`. In async mode: call `executeAgentAsync`, then `await` a promise that resolves/rejects when the completion listener observes `execution.completed` / `execution.failed` for this `executionId` (a small in-memory pending-dispatch registry keyed by `executionId`, resolved from the listener). The container is NOT torn down by the accept call; teardown happens in the existing `finally` once the completion signal arrives. Keep the `sync` branch byte-for-byte as today.

- [ ] **Step 4: Run / pass. Step 5: Typecheck. Step 6: Commit.**

```bash
cd apps/api && npx tsc --noEmit -p tsconfig.json
git add apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.multistep.ts apps/api/src/workflow/workflow-step-execution/step-execution-completion.listener.ts apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.multistep.spec.ts
git commit -m "feat(workflow): await completion signal for async agent dispatch"
```

### Task 10: End-to-end live verification + flip default

- [ ] **Step 1** — rebuild images (`docker compose build nexus-light nexus-heavy nexus-api`), set `WORKFLOW_AGENT_DISPATCH_MODE=async`, restart the stack.
- [ ] **Step 2** — launch a real `implement_and_commit` workflow; confirm via `retrieve-debug-bundle` that there is exactly ONE `pi_session_trees` chat_session for the parent, no `workflow.retry_scheduled` with `HTTP POST timed out`, and the run reaches `job.completed`.
- [ ] **Step 3** — once verified over several runs, change the default in code to `async` and remove the `sync` branch in a follow-up cleanup commit (per the codebase's eliminate-don't-deprecate policy).
- [ ] **Step 4** — update `docs/guide/03-container-architecture.md` to describe fire-and-poll dispatch and the `WORKFLOW_AGENT_DISPATCH_MODE` knob; note the timeout/retry safety net (Phases 1–2).

---

## Self-Review

**Spec coverage:**
- **D** → Task 1 (distinct `agent_transport_timeout` classification).
- **B** → Tasks 2–3 (salvage already-produced output) + Tasks 4–6 (resume session on retry).
- **C** → Tasks 7–10 (async fire-and-poll dispatch).

**Open items the implementer MUST verify against live code (cited but not yet read end-to-end):**
1. The exact return shape of `classifyWorkflowFailure` (Task 1 Step 1) — match `retryCategory`/`reasonCode` property names precisely.
2. `WorkflowRunJobExecutionService` constructor DI for the session lookup (Task 5) — confirm `SessionHydrationService.findSessionTreeByWorkflowRunId` signature/return; if PI vs claude_code resume needs `parent_session_ref`, source it from `agent-await.repository.ts` instead.
3. The resume threading in `step-execution-orchestrator.service.ts:451-512` — reuse the existing checkpoint/parent-await resume params rather than inventing new ones.
4. The harness-runtime completion-callback client name/shape (Task 7) — reuse exactly what `step_complete`/`set_job_output` already post.
5. All `handleJobFailed(` call sites handle the new `'salvaged'` union member (Task 3 Step 5).

**Placeholder scan:** Phase 1 tasks contain complete code. Phase 2–3 integration tasks intentionally reference existing resume/callback infrastructure by file:line rather than reproducing it, because the correct implementation is "reuse the existing mechanism" — the implementer reads the cited lines and threads the new field through. This is a deliberate decoupling boundary, not a missing detail.

**Type consistency:** `AgentRetryResume` (Task 4) is the single shared resume type used by Tasks 4–6; `agent_transport_timeout` is the single reasonCode string used by Tasks 1, 3, 5; `jobOutputStatePath` is the single output-path helper used by Tasks 2–3.
