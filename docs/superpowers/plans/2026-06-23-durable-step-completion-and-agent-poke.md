# Durable Step Completion & Hung-Agent Poke — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a workflow step's completion durable across API restarts (so a finished agent never leaves its run stuck RUNNING), add a supervisor safety-net that reconciles finished-but-running steps, and add a "poke" capability that nudges a genuinely idle agent before reaping it.

**Architecture:** Today a parent `workflow_step`'s completion is emitted _only_ by an in-process `void` promise (`runAgentJobAndPublishResult` → `executionEventPublisher.completed`) running in the API instance that dispatched it. An API redeploy or crash mid-step orphans that promise forever; the surviving container finishes the agent loop but nothing emits `execution.completed`, so the DAG never advances. Subagents do not have this problem because their completion is driven durably from the `workflow.agent.completed` telemetry event (`subagentCoordination.handleCompletion`). This plan brings parent steps to parity (Workstream A), adds a reaper-side reconciler as defence-in-depth (Workstream C), then layers a hung-agent poke feature (Workstream Poke) and the deeper durable-async-dispatch refactor (Workstream D).

**Tech Stack:** NestJS, TypeORM (Postgres), BullMQ/Redis, Vitest, domain-event outbox + in-process fanout bus, WebSocket telemetry gateway, Docker (dockerode), `packages/harness-runtime` (PI harness).

## Background / Root Cause (incident run `0c0cfe8e-8d0f-4dfc-a310-bb3fec0f0f6e`)

- Step `implement` (kind `workflow_step`, execution `ff36e465-…`) started 15:10:49Z.
- `nexus-api` was redeployed at 16:12Z (fresh container, `RestartCount=0`), destroying the in-process awaiter for that step.
- The step's Docker container is not part of compose, so it survived; the agent kept working via callbacks to the new API and finished at 17:46:31Z, emitting `workflow.agent.completed` — but nothing called `executionEventPublisher.completed(ff36e465)`, so the run stayed RUNNING.
- Safety nets all missed it: `step_complete` only stores a 10-min-TTL Redis signal (never popped); `StartupResumeCoordinator` only re-attaches `frozen=true` rows; `classifyExecutionForReaping` exempts `workflow_step` from `idle_timeout`; `container_lost` can't fire (container alive). Only `max_runtime_exceeded` (4h) would catch it — as a destructive failure.
- The incident run was manually parked with `executions.frozen=true` to prevent the destructive 4h reap. **Recovery note:** after Workstream A or C ships and is deployed, clear that flag (`UPDATE executions SET frozen=false WHERE id='ff36e465-f154-4c42-917d-0d0eef40b2dc'`) so the new completion path finalizes it; or abort the run if it is no longer wanted.

## Global Constraints

- Strict lint policy — never suppress (`eslint-disable`, `@ts-ignore`, `@ts-nocheck`). Fix in code.
- API/core must stay Kanban-neutral — no kanban/work-item identifiers in `apps/api/src`.
- Controllers transport-only; services own domain logic; repositories own persistence.
- TDD: Red → Green → Refactor. One assertion-focused failing test before each implementation step.
- NestJS build via `nest build` (not `tsc`). Tests run on Vitest/SWC.
- State transitions for executions are owned by `ExecutionProjector`, driven by domain events — never write `executions.state` directly from feature code; emit an event via `ExecutionEventPublisher`.
- `execution.completed` must be **idempotent**: emitting it for an already-terminal execution must be a no-op (the projector + `StepExecutionCompletionListener` already guard `completed`/`cancelled`; preserve that).

---

# Workstream A — Durable parent-step completion (the actual fix)

**Why first:** This alone fixes the incident class. It makes parent-step completion driven by the durable `workflow.agent.completed` telemetry event (processed by whichever API instance is connected when the agent finishes), exactly mirroring the subagent path.

**File structure:**

- `apps/api/src/telemetry/telemetry-gateway-runtime.helpers.ts` (≈line 467) — currently calls `subagentCoordination.handleCompletion` only for subagents; add a parallel durable finalize for parent steps.
- `apps/api/src/workflow/workflow-step-execution/step-completion-finalizer.service.ts` (**new**) — resolves the running `workflow_step` execution for `(workflowRunId, stepId/jobId)` and emits `execution.completed` / `execution.failed` idempotently.
- `apps/api/src/workflow/workflow-step-execution/step-completion-finalizer.service.spec.ts` (**new**) — unit tests.
- `apps/api/src/workflow/workflow-step-execution/workflow-step-execution.module.ts` — provide + export the finalizer.
- `apps/api/src/telemetry/telemetry.module.ts` (or the runtime-helpers wiring) — inject the finalizer into the gateway runtime helper deps.
- `apps/api/src/execution-lifecycle/database/repositories/execution.repository.ts` — add `findRunningStepByRunAndContext` if not already present.

### Task A1: Repository lookup for a running step execution

**Files:**

- Modify: `apps/api/src/execution-lifecycle/database/repositories/execution.repository.ts`
- Test: `apps/api/src/execution-lifecycle/database/repositories/execution.repository.spec.ts`

**Interfaces:**

- Produces: `ExecutionRepository.findRunningStepByRunAndContext(workflowRunId: string, contextId: string): Promise<ExecutionRow | null>` — returns the non-terminal (`state IN ('provisioning','running')`) `workflow_step` row for that run+job, newest first, or null.

- [ ] **Step 1: Write the failing test** — assert that given two rows for the same run (one `completed`, one `running`), the method returns the `running` one; and returns `null` when only terminal rows exist. Use the repo's existing in-memory/SQLite test harness pattern from neighbouring tests in this file.
- [ ] **Step 2: Run it, verify it fails** — `npm run test --workspace=apps/api -- execution.repository.spec` → FAIL (`findRunningStepByRunAndContext is not a function`).
- [ ] **Step 3: Implement** the method using the existing query-builder pattern in the repo: filter `kind='workflow_step'`, `workflow_run_id=:runId`, `context_id=:contextId`, `state IN ('provisioning','running')`, `terminal_at IS NULL`, order by `created_at DESC`, limit 1.
- [ ] **Step 4: Run it, verify it passes.**
- [ ] **Step 5: Commit** — `feat(execution): add findRunningStepByRunAndContext lookup`.

### Task A2: StepCompletionFinalizerService

**Files:**

- Create: `apps/api/src/workflow/workflow-step-execution/step-completion-finalizer.service.ts`
- Test: `apps/api/src/workflow/workflow-step-execution/step-completion-finalizer.service.spec.ts`

**Interfaces:**

- Consumes: `ExecutionRepository.findRunningStepByRunAndContext` (A1), `ExecutionEventPublisher.completed(id)` / `.failed(id, {failure_reason, error_message})`.
- Produces: `StepCompletionFinalizerService.finalizeFromAgentEnd(params: { workflowRunId: string; contextId: string; hasFailure: boolean; failureMessage?: string }): Promise<{ finalized: boolean; executionId?: string }>`.

- [ ] **Step 1: Write the failing test(s):**
  - given a running step row, `hasFailure=false` → calls `publisher.completed(rowId)` once and returns `{finalized:true, executionId:rowId}`;
  - `hasFailure=true` → calls `publisher.failed(rowId, {failure_reason:'agent_error', error_message})`;
  - no running row (already terminal) → calls neither and returns `{finalized:false}` (idempotent / awaiter-won-the-race case).
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** the service: look up the row; if none, return `{finalized:false}`; else emit completed/failed and return `{finalized:true, executionId}`. Inject `ExecutionRepository` and `ExecutionEventPublisher`. Log at `debug`.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `feat(step-exec): durable step completion finalizer driven by agent_end`.

### Task A3: Wire the finalizer into the gateway agent_end path

**Files:**

- Modify: `apps/api/src/telemetry/telemetry-gateway-runtime.helpers.ts:467` (the `if (client.isSubagent …)` block)
- Modify: `apps/api/src/telemetry/telemetry.module.ts` (deps wiring for the runtime helper)
- Modify: `apps/api/src/workflow/workflow-step-execution/workflow-step-execution.module.ts` (export `StepCompletionFinalizerService`)
- Test: `apps/api/src/telemetry/telemetry-gateway-runtime.helpers.spec.ts`

**Interfaces:**

- Consumes: `StepCompletionFinalizerService.finalizeFromAgentEnd` (A2).

- [ ] **Step 1: Write the failing test** — drive `handleAgentEnd` with a non-subagent agent client (`client.isSubagent=false`, `client.workflowRunId`, `client.stepId`/job context set). Assert `finalizeFromAgentEnd` is called once with the right `workflowRunId`/`contextId`/`hasFailure`. Add a second case: subagent client → finalizer NOT called (subagent path unchanged).
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** — after the existing subagent branch, add: `if (!client.isSubagent) { await stepCompletionFinalizer.finalizeFromAgentEnd({ workflowRunId: client.workflowRunId, contextId: client.jobId ?? client.stepId, hasFailure, failureMessage: failureContext }); }`. Thread the finalizer through the helper `params` deps and the module providers (resolve `contextId` from the same field the dispatcher uses as `context_id` — confirm against `step-execution-orchestrator.service.ts`). Keep it best-effort (wrap in try/catch, log warn) so a finalize hiccup never breaks telemetry ingestion.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `fix(telemetry): durably finalize parent step on agent_end (restart-safe)`.

### Task A4: Idempotency integration test (awaiter + telemetry race)

**Files:**

- Test: `apps/api/src/workflow/workflow-step-execution/step-completion-idempotency.integration-spec.ts` (**new**)

- [ ] **Step 1: Write the failing test** — emit `execution.completed` for the same execution twice (simulating both the in-process awaiter at `step-execution-orchestrator.service.ts:309` and the new telemetry finalizer). Assert `StepExecutionCompletionListener.handleJobComplete` advances the job exactly once (second emission is a no-op because the execution is already `completed` / job already done). Use the existing in-process domain-event bus test harness.
- [ ] **Step 2: Run, verify fail** (if a double-advance bug exists) **or pass** (if existing guards already cover it — in which case this test documents the invariant).
- [ ] **Step 3:** If it fails, add a guard in `StepCompletionFinalizerService` (re-check `state` is non-terminal immediately before emit) and/or confirm `ExecutionProjector` ignores `completed` on a terminal row. Do **not** weaken existing guards.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `test(step-exec): assert idempotent step completion across awaiter+telemetry`.

### Task A5: Manual verification on the live incident run

- [ ] Rebuild + redeploy `nexus-api`. Clear the park: `docker exec nexus-postgres psql -U nexus -d nexus_orchestrator -c "UPDATE executions SET frozen=false WHERE id='ff36e465-f154-4c42-917d-0d0eef40b2dc'"`.
- [ ] Since the original `agent_end` already fired (run is past it), this run won't re-emit — instead confirm Workstream C reconciles it (see C4), or abort it cleanly if no longer wanted. For _new_ runs, kill `nexus-api` mid-step in a scratch run and confirm the step finalizes after restart. Record the result in this file.

---

# Workstream C — Supervisor reconciler (defence-in-depth)

**Why:** Workstream A depends on the `workflow.agent.completed` telemetry event being delivered. If it is lost (transport failure — the incident container logged `wait_for_subagents error: fetch failed` during the restart window) the step is still orphaned. C makes the existing 30-second supervisor sweep _positively detect_ a finished-but-running step and reconcile it, instead of waiting 4h for the destructive `max_runtime` ceiling.

**File structure:**

- `apps/api/src/execution-lifecycle/execution-supervision.helpers.ts` — extend `SupervisionInput` + `classifyExecutionForReaping` with a positive "agent finished" signal.
- `apps/api/src/execution-lifecycle/execution-supervision.helpers.types.ts` — add the new input field.
- `apps/api/src/execution-lifecycle/execution-supervisor.service.ts` — compute the signal per row and, on a finished-but-running step, emit `execution.completed` (success) rather than a failure reap.
- New: a small read seam to answer "did this step's agent finish?" from the event ledger (`workflow.agent.completed` for `(workflowRunId, stepId)`).

### Task C1: Event-ledger read — did the step's agent end?

**Files:**

- Create: `apps/api/src/execution-lifecycle/agent-end-signal.reader.ts`
- Test: `apps/api/src/execution-lifecycle/agent-end-signal.reader.spec.ts`

**Interfaces:**

- Produces: `AgentEndSignalReader.findLatest(workflowRunId: string, stepId: string): Promise<{ endedAtMs: number; outcome: 'success' | 'failure' } | null>` — reads the most recent `workflow.agent.completed` event-ledger row for that run+step.

- [ ] **Step 1: Write the failing test** — seed two ledger rows (success then nothing / failure) and assert the reader returns the latest `endedAtMs` + outcome; returns null when absent.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** with the event-ledger repository (`domain='workflow'`, `event_name='workflow.agent.completed'`, `workflow_run_id`, `step_id`, order `occurred_at DESC` limit 1).
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `feat(supervisor): reader for workflow.agent.completed signal`.

### Task C2: Classifier — `finished_step_reconcilable`

**Files:**

- Modify: `apps/api/src/execution-lifecycle/execution-supervision.helpers.types.ts` (add `agentEndedForMs?: number | null` to `SupervisionInput`)
- Modify: `apps/api/src/execution-lifecycle/execution-supervision.helpers.ts`
- Test: `apps/api/src/execution-lifecycle/execution-supervision.helpers.spec.ts`

**Interfaces:**

- Produces: a new classification outcome. Add `'completed_reconciled'` to a _separate_ return discriminator — do NOT shoehorn it into `ExecutionFailureReason` (it is a success, not a failure). Recommended: change `classifyExecutionForReaping` to return `{ kind: 'reap'; reason: ExecutionFailureReason } | { kind: 'reconcile_completed' } | null`, and update the supervisor + its existing tests accordingly.

- [ ] **Step 1: Write the failing test** — a `workflow_step`, `state='running'`, container alive, no live subagents, `agentEndedForMs` ≥ `RECONCILE_GRACE_MS` (new const, e.g. 60_000) → returns `{ kind: 'reconcile_completed' }`. Add negative cases: agent NOT ended → null (unchanged); live subagent → null; under grace → null.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** — add `RECONCILE_GRACE_MS`; insert the reconcile branch _before_ the `workflow_step → return null` idle exemption (lines 95–102). Keep `max_runtime_exceeded` and `container_lost` as-is. Update the return type and all existing call-site assertions in the spec.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `feat(supervisor): classify finished-but-running step as reconcilable`.

### Task C3: Supervisor emits completion on reconcile

**Files:**

- Modify: `apps/api/src/execution-lifecycle/execution-supervisor.service.ts`
- Test: `apps/api/src/execution-lifecycle/execution-supervisor.service.spec.ts`

**Interfaces:**

- Consumes: `AgentEndSignalReader` (C1), new classifier shape (C2), `ExecutionEventPublisher.completed`.

- [ ] **Step 1: Write the failing test** — a sweep over a finished-but-running step row (with the reader stubbed to return an ended signal older than grace) calls `publisher.completed(rowId)` and NOT `publisher.reaped`. A still-working step (reader → null) calls neither.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** — in `sweepOnce`, after computing `containerLost`/`hasLiveChildSubagent`, fetch `agentEndedForMs` via the reader for `workflow_step` rows only (guard the extra query behind the cheap pre-checks: running + container alive + no live subagents). Branch on the new classifier result: `reconcile_completed` → `publisher.completed(row.id)`; `reap` → existing `publisher.reaped(...)`. Reuse the per-sweep batching style already in the file to avoid N+1 (only read for candidate rows).
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `fix(supervisor): reconcile finished-but-running steps to completed within a sweep`.

### Task C4: Live reconcile of the incident run

- [ ] After deploy, clear the park (`frozen=false` on `ff36e465-…`). Within ~1–2 sweeps (≤60s + grace) confirm the supervisor emits `execution.completed`, the DAG advances, and run `0c0cfe8e` leaves RUNNING. Capture the outcome here.

---

# Workstream Poke — Hung-agent prod (complementary; NOT the fix for this incident)

**Why separate:** The incident agent had _finished_; a poke would have done nothing. Poke targets a different mode — container alive, agent loop **not** ended, no tool/turn activity for N minutes (a genuinely stalled agent). It builds on the existing delivery primitive `WorkflowRunSteeringService.injectMessage` → `telemetryGateway.sendPromptCommand(runId, stepId, message)`.

> **Scope check:** This is an independent subsystem. Expand it into its own plan `docs/superpowers/plans/<date>-hung-agent-poke.md` when scheduled. Outline below.

- **Idle detection:** Track last agent activity per running step (last `workflow.turn.completed` / tool event timestamp via the telemetry gateway or a heartbeat column). "Idle" = container running AND no `workflow.agent.completed` AND no activity for `AGENT_POKE_IDLE_MS` (e.g. 5 min). Must distinguish _finished_ (agent.completed present → not a poke candidate; hand to Workstream A/C) from _stalled_ (no agent.completed, no activity).
- **Auto-poke:** When idle, inject a bounded nudge via `sendPromptCommand` ("You appear idle. Continue, or call `step_complete`/`set_job_output` if done.") Cap at `AGENT_POKE_MAX` attempts (e.g. 2) with backoff; emit a `workflow.agent.poked` event each time; after the cap, escalate to the existing reap/repair path instead of poking forever.
- **Operator-triggered poke:** A `POST /runs/:runId/poke` endpoint (thin wrapper over `injectMessage` with a default nudge) + a web UI button on the run view. Reuse `injectMessageSchema`.
- **Tests:** idle-vs-finished discrimination; poke cap + escalation; operator endpoint authz; "poke does nothing when agent already completed".

---

# Workstream D — Durable async dispatch (deeper architectural fix)

**Why separate / last:** D removes the in-process awaiter entirely by moving to `WORKFLOW_AGENT_DISPATCH_MODE=async` with a **durable** await registry, so completion is _only ever_ event-driven. It overlaps with A (A makes the sync path restart-safe; D removes the fragile sync path). Ship A+C first; treat D as the consolidation.

> **Scope check:** Independent subsystem. Expand into `docs/superpowers/plans/<date>-durable-async-dispatch.md` when scheduled. Outline below.

- **Problem:** `async-dispatch-registry.ts` (`registerAsyncDispatch`/`awaitAsyncDispatch`) is an in-memory map — `awaitAsyncDispatch` is an in-process promise that is also lost on restart. So even async mode is not durable today.
- **Change:** Persist async-dispatch waiters (a table or reuse the executions row state) so that `signalAsyncDispatchIfPending` (telemetry agent_end) resolves the step via the durable completion path (now Workstream A's finalizer), and a restarted API reconstructs/needs no in-memory waiter. Then flip `WORKFLOW_AGENT_DISPATCH_MODE=async` as the default and delete the long-lived synchronous `executeAgent` HTTP path once A+C have shipped and soaked.
- **Tests:** restart between dispatch-accepted and agent_end still finalizes; no double-dispatch; long-step (>2h) no longer depends on a held HTTP socket (also resolves the separate 2h-socket-timeout failure class).
- **Sequencing:** Requires A (finalizer) as the completion sink. Do not start until A+C are deployed and verified.

---

## Self-Review

- **Spec coverage:** A (durable completion) ✓ Tasks A1–A5; C (reconciler net) ✓ C1–C4; Poke ✓ outlined as own plan; D ✓ outlined as own plan. The incident-run recovery is covered by A5/C4 + the park-clear note.
- **Type consistency:** `findRunningStepByRunAndContext` (A1) consumed in A2; `finalizeFromAgentEnd` (A2) consumed in A3; classifier return-shape change (C2) consumed in C3; `AgentEndSignalReader.findLatest` (C1) consumed in C2/C3. `contextId` == executions `context_id` == jobId — verify against `step-execution-orchestrator.service.ts` during A3.
- **Placeholder scan:** none — each A/C task carries concrete files, signatures, and the verified seam (`telemetry-gateway-runtime.helpers.ts:467`, `execution-supervision.helpers.ts:95-102`, `step-execution-orchestrator.service.ts:309`). Poke/D are intentionally outlines flagged for their own plans per the writing-plans scope check.

## Execution Handoff

Recommended order: **A → C → (verify incident run) → Poke → D.** A+C are the bug fix and should ship together. Poke and D each become their own plan when scheduled.
