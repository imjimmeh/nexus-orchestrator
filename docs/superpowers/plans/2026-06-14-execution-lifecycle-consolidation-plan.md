# Execution Lifecycle Consolidation — Implementation Plan (Phases 1–5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan phase-by-phase. Steps use checkbox (`- [ ]`) syntax. **Re-detail each phase from its section into bite-sized TDD steps at execution time** — Phase 1 is already at that granularity; Phases 2–5 are task-level because each phase changes the assumptions of the next, so committing line-level detail now would be speculative.

**Goal:** Collapse the parallel/duplicated execution-lifecycle machinery into the single unified substrate that already exists (`ExecutionLifecycleModule`), ending at one execution record, one supervisor/reaper, one liveness probe, one heartbeat path, one failure taxonomy, one terminal-write path, and async (fire-and-poll) dispatch for every kind.

**Architecture:** The `executions` projection + `ExecutionProjector` (sole state writer) + `ExecutionEventPublisher` (events through the wired `domain_event_outbox`) is the keeper. Every other liveness sweeper, probe, heartbeat, taxonomy, and terminal-writer is migrated onto `execution.*` event reactions and then **deleted**. Strangler-fig order: behavior first (reapers → events), schema last (table collapse). The supervisor stays a **pure emitter**; all side effects live in event listeners, preserving the single-writer invariant.

**Tech Stack:** TypeScript, NestJS, TypeORM, BullMQ, the existing `domain-events` outbox + `event_ledger`, Vitest. Kanban-neutral throughout (`apps/api` + `packages/core` only).

**Companion docs (read first):**

- `docs/analysis/2026-06-14-execution-lifecycle-consolidation-roadmap.md` — current-state duplication map (the "why", file:line-grounded).
- `docs/specs/SDD-unified-execution-lifecycle.md` — target end-state design.
- `docs/analysis/2026-06-11-execution-lifecycle-reaper-redesign.md` — original incident analysis + failure taxonomy.

**Cross-cutting invariants (hold for every phase):**

1. **Parity before deletion** — ship the replacement listener/rule with tests proving identical observable outcomes, _then_ delete the legacy system in a follow-up commit.
2. **Supervisor emits only** — no DB writes / mesh-cancel / ledger writes inside any sweep loop; those are listeners on `execution.*`.
3. **Idempotent terminal writes** — a terminal row/session is never re-labeled by a later writer.
4. **Each phase is independently shippable and revertible**; the projection is rebuildable from the event stream.
5. TDD red→green→refactor per `CLAUDE.md`; typecheck (`npm run build:api`) + lint (`npm run lint:api`) green before each merge.

**Resolved design decisions** (from the roadmap's open questions):

- **Subagent details home (Phase 4):** a `subagent_details` satellite table keyed by `execution_id` (1:1), not widening `executions` with many nullable columns — keeps the core projection lean.
- **`spawn_timeout`:** add a dedicated `spawn_timeout` code to `ExecutionFailureReason` (don't overload `provision_failed`) so the cause stays legible.
- **Event store:** reuse `domain_event_outbox` + `event_ledger`; no new `execution_events` table.

---

# Phase 1 — One probe, one reaper for container-backed work

**Outcome:** `SubagentExecutionReaperService` and the duplicate liveness probe are deleted; `ExecutionSupervisorService` is the only liveness reaper for subagents; its unique side effects move to `execution.reaped` listeners. No schema change.

**Files:**

- Modify: `apps/api/src/execution-lifecycle/execution-supervision.helpers.ts` (+`.spec.ts`)
- Modify: `apps/api/src/execution-lifecycle/execution-supervisor.service.ts` (+`.spec.ts`) — only the provisioning/spawn rule
- Create: `apps/api/src/workflow/workflow-subagents/subagent-reaped.listener.ts` (+`.spec.ts`) — diagnostics + mesh-cancel + `subagent_executions.result` write on `execution.reaped` for `kind='subagent'`
- Modify: `apps/api/src/execution-lifecycle/execution-lifecycle.contracts.ts` — add `spawn_timeout` to `EXECUTION_FAILURE_REASONS`
- Delete: `apps/api/src/workflow/workflow-subagents/subagent-execution-reaper.service.ts` (+`.spec.ts`, +`.types.ts`)
- Modify: `apps/api/src/workflow/workflow-subagents/workflow-subagents.module.ts` (drop the reaper provider; register the listener)
- Modify: `docs/guide/42-execution-lifecycle.md`

## Task 1.1 — Generalize the supervisor `container_lost` grace to all kinds

This closes the still-open third false-reap instance (the supervisor reaps `kind='subagent'` on `container_lost` immediately today) and removes the `workflow_step` special-case.

- [ ] **Step 1 — Update failing helper tests.** In `execution-supervision.helpers.spec.ts`, replace the kind-specific expectations:
  - Change `reaps container_lost regardless of heartbeat` (no kind) so that with `containerLostForMs: null` it returns `null` (within grace) and with `containerLostForMs: DEFAULT_CONTAINER_LOST_GRACE_MS` it returns `'container_lost'`.
  - Replace `reaps a non-workflow_step container_lost immediately regardless of grace` with `debounces container_lost for a subagent kind too`: `{ kind: 'subagent', containerLost: true, containerLostForMs: null }` ⇒ `null`; same with `containerLostForMs: DEFAULT_CONTAINER_LOST_GRACE_MS` ⇒ `'container_lost'`.
  - Keep the `workflow_step` grace tests and the `max_runtime` precedence tests unchanged.
- [ ] **Step 2 — Run, expect RED** (`npm run test --workspace=apps/api -- execution-supervision.helpers.spec.ts --run`): the subagent/no-kind immediate-reap assertions now fail because the code still reaps non-`workflow_step` immediately.
- [ ] **Step 3 — Implement.** In `classifyExecutionForReaping`, collapse the container-lost branch to be kind-agnostic:

```typescript
if (input.containerLost) {
  // A container is removed as part of normal completion BEFORE the row reaches
  // a terminal state, briefly leaving a dead container_id on a live row — true
  // for every container-backed kind. Only reap once it has been continuously
  // observed lost beyond the grace window (a real orphan exceeds it; the
  // cleanup race resolves to terminal first).
  const lostForMs = input.containerLostForMs ?? null;
  if (lostForMs !== null && lostForMs >= containerLostGraceMs) {
    return "container_lost";
  }
  // within grace: fall through so max_runtime stays a hard safety net
}
```

- [ ] **Step 4 — Run, expect GREEN.**
- [ ] **Step 5 — Commit:** `fix(execution-lifecycle): debounce container_lost for all kinds, not just workflow_step`.

## Task 1.2 — Add `spawn_timeout` to the failure taxonomy

- [ ] **Step 1 — Failing test.** In a contracts spec (or `execution-supervisor.service.spec.ts`), assert a `PROVISIONING` execution older than the provision-grace with no live container yields `failure_reason: 'spawn_timeout'`.
- [ ] **Step 2 — RED.**
- [ ] **Step 3 — Implement.** Add `'spawn_timeout'` to `EXECUTION_FAILURE_REASONS` in `execution-lifecycle.contracts.ts`, add its `REASON_MESSAGES` entry in `execution-supervisor.service.ts` ("Container was never provisioned within the spawn window"), and add the rule to `classifyExecutionForReaping`: `state === 'provisioning'` (or `pending`) and `nowMs - createdAtMs > provisionGraceMs` and `containerLost`/no container ⇒ `'spawn_timeout'`. Add `resolveProvisionGraceMs` (env `EXECUTION_PROVISION_GRACE_MS`, default 5 min, mirroring `REAPER_SPAWN_AGE_MS`).
- [ ] **Step 4 — GREEN.**
- [ ] **Step 5 — Commit:** `feat(execution-lifecycle): add spawn_timeout reason + provisioning-grace reap rule`.

## Task 1.3 — Subagent reaped-event listener (parity for the reaper's side effects)

The reaper does three things the supervisor (a pure emitter) must not: writes `subagent_executions.result` with container diagnostics, marks the linked chat session FAILED, and calls `meshDelegation.handleSubagentCancellation`. Move these to a listener on `execution.reaped`/`execution.failed` filtered to `kind='subagent'`.

- [ ] **Step 1 — Failing test** (`subagent-reaped.listener.spec.ts`): on an `execution.reaped` event whose execution has `kind='subagent'`, the listener (a) collects child-container diagnostics (last 80 lines, sanitized — reuse the existing helpers, extracted), (b) writes `subagent_executions.result = { status:'Failed', failure_reason, error, reaped_at, container_diagnostics }`, (c) calls `meshDelegation.handleSubagentCancellation({ subagentExecutionId, reason })`. Non-subagent kinds are ignored.
- [ ] **Step 2 — RED** (listener doesn't exist).
- [ ] **Step 3 — Implement** the listener. Extract the diagnostics/log-sanitization helpers out of the old reaper into a shared util (`subagent-container-diagnostics.helpers.ts`) so both the listener and any future caller reuse them (kills redundancy 3.2's cousin). Chat-session FAILED is **not** written here — it is already handled by `ExecutionLegacyCascadeListener` on `execution.reaped`; add a test asserting that path covers subagent sessions (parity), and only add to the new listener if a gap is proven.
- [ ] **Step 4 — GREEN.**
- [ ] **Step 5 — Register** the listener in `workflow-subagents.module.ts`; commit `feat(workflow-subagents): react to execution.reaped for subagent diagnostics + mesh-cancel`.

## Task 1.4 — Map remaining reaper rules onto the supervisor; prove full parity

- [ ] **Step 1 — Parity matrix test.** Table-driven test asserting each old `AbandonReason` path now produces an equivalent supervisor outcome: `spawn_timeout`→`spawn_timeout` (Task 1.2); `container_lost`→debounced `container_lost` (Task 1.1); `chat_session_failed`→ covered by the cascade from the linked session/run terminal (verify; if the only trigger was the reaper reading `chat_sessions.status===FAILED`, confirm that signal still reaches a terminal via `ExecutionLegacyCascadeListener` or run-cascade).
- [ ] **Step 2** — close any proven gap with a supervisor rule or listener (TDD each).
- [ ] **Step 3 — Commit** the parity tests.

## Task 1.5 — Delete `SubagentExecutionReaperService` + duplicate probe

- [ ] **Step 1** — Remove the provider/registration from `workflow-subagents.module.ts`; delete `subagent-execution-reaper.service.ts`, its `.spec.ts`, and `.types.ts`. Delete the inline `isContainerLost` (gone with the file); any remaining caller uses the shared `ContainerLivenessProbe`.
- [ ] **Step 2 — Run the full subagent + execution-lifecycle suites** (`npm run test --workspace=apps/api -- workflow-subagents execution-supervis`) — all green; no references to the deleted symbols remain (grep `SubagentExecutionReaperService`, `AbandonReason`).
- [ ] **Step 3 — Build + lint** (`npm run build:api`, `npm run lint:api`).
- [ ] **Step 4 — Docs:** update `docs/guide/42-execution-lifecycle.md` — one supervisor now covers subagents; remove references to the standalone reaper; note `spawn_timeout` and the universal `container_lost` grace.
- [ ] **Step 5 — Commit:** `refactor(workflow-subagents): retire SubagentExecutionReaperService; supervisor is the sole liveness reaper`.

**Phase 1 done when:** no standalone subagent reaper or duplicate probe exists; subagents are reaped only by `ExecutionSupervisorService`; all prior observable outcomes (diagnostics, mesh-cancel, session FAILED, structured reason) are preserved by tests.

---

# Phase 2 — One terminal-write path (retire `ChatSessionCleanupService`)

**Outcome:** every `chat_sessions` terminal write goes through one idempotent router driven by `execution.*`; the `container_id IS NULL` heuristic and the hardcoded "orphaned"/"stuck-starting" strings are deleted; `never_dispatched` becomes a supervisor rule.

**Files:** `chat-session.repository.ts`, `chat-execution-completion.listener.ts`, `execution-legacy-cascade.listener.ts`, `workflow-run-chat-session-cascade.listener.ts`, `chat-session-cleanup.service.ts` (delete), `chat-execution.module.ts`, supervisor helpers/contracts.

## Tasks

- [ ] **2.1 Idempotent terminal write.** Add `ChatSessionRepository.failIfNotTerminal(id, { reason, message })` — writes only when the row is non-terminal and only sets `error_message` when currently null/empty. TDD: a session already FAILED with a specific message is left untouched. Route all session-FAILED writers through it.
- [ ] **2.2 Collapse the chat terminal routers.** Merge `ExecutionLegacyCascadeListener` + `ChatExecutionCompletionListener` into one `ChatSessionTerminalRouter` keyed off `execution.completed|failed|reaped` (completed→COMPLETED+save tree, failed/reaped→`failIfNotTerminal`). `WorkflowRunChatSessionCascadeListener` stays (run→session cascade is a distinct event source) but also routes through `failIfNotTerminal`. TDD parity for each prior path.
- [ ] **2.3 `never_dispatched` as a supervisor rule.** Add `'never_dispatched'` handling: a `PENDING` execution past dispatch-grace with no queue job / no container ⇒ `execution.reaped(never_dispatched)`. The cleanup service's only legitimate job folds here. TDD.
- [ ] **2.4 Delete `ChatSessionCleanupService`** + registration; remove `findOrphanedSessions`/`findStaleStartingSessions` heuristics and the hardcoded strings. Grep clean, suites green, build+lint.
- [ ] **2.5 Docs** + commit per task (parity-before-deletion: 2.1–2.3 land first, 2.4 deletes).

**Risk:** medium — chat session display semantics. Gate behind the parity tests; the idempotent writer prevents regressions to the "orphaned" mislabel.

---

# Phase 3 — One heartbeat + one failure taxonomy

**Outcome:** a single activity/heartbeat mechanism feeding `last_heartbeat_at`; `AbandonReason` deleted (already absorbed in Phase 1, finalize here); run-activity unified with execution heartbeats.

## Tasks

- [ ] **3.1 Unify heartbeats.** Make `WorkflowRunHeartbeatService` emit through `ExecutionHeartbeatService`'s event path (or, once steps carry an execution id end-to-end after Phase 5, fold run activity into execution heartbeats). One throttle (`shouldEmit*` helpers consolidated), one store. TDD: telemetry seam records activity once; both run and execution liveness reads see it.
- [ ] **3.2 Single taxonomy.** Confirm `AbandonReason` is fully removed (Phase 1) and every terminal write uses `ExecutionFailureReason`. Add a `packages/core` export if any consumer outside `apps/api` needs the enum. TDD: a table mapping every legacy reason string → structured code; no free-text terminal reasons remain except `never_dispatched`'s human message.
- [ ] **3.3 `workflow_step` heartbeat parity.** Steps currently receive no gateway heartbeat (hence the idle-timeout carve-out). After Phase 5 wires step telemetry to an execution id, remove the carve-out so steps get real idle supervision. (If Phase 5 is deferred, keep the carve-out and note it.) TDD.

**Risk:** low–medium.

---

# Phase 4 — Collapse `subagent_executions` into `executions`

**Outcome:** one execution record. Subagent-only data moves to a `subagent_details` satellite (1:1 by `execution_id`); `subagent_executions` table + `SubagentExecutionRepository` retired.

## Tasks

- [ ] **4.1 Create `subagent_details`** (migration via the `adding-entity-migration` skill): columns `execution_id` (PK/FK), `parent_container_id`, `delegation_contract_id`, `lineage_trace_id`, `lineage_parent_trace_id`, `depth`, `assigned_files`, `parent_session_tree_id`, `result`. Register in `registered-migrations.ts`. Entity + repository. TDD repository.
- [ ] **4.2 Dual-write** subagent details to the satellite at spawn (`subagent-orchestrator.spawn.operations.ts`) while still writing the legacy table (shadow). Parity test: satellite row matches legacy row for the same execution id.
- [ ] **4.3 Switch readers** (`findByParentContainerId`, concurrency checks, diagnostics listener from Phase 1.3, mesh-delegation lineage reads) to the satellite + `executions`. TDD each read path.
- [ ] **4.4 Backfill migration** for in-flight rows; **stop writing** the legacy table; drop `subagent_executions` + `SubagentExecutionRepository` in a follow-up migration once no reader remains. Grep clean.
- [ ] **4.5 Fix the `completed_at` landmine** (analysis §3.7): the satellite/`executions` must use a proper `@UpdateDateColumn updated_at` separate from `terminal_at` — never overload one column as both. Verify `executions` already does (it does); ensure the satellite follows suit.

**Risk:** medium (schema + data migration). Strangler order: dual-write → switch reads → backfill → drop.

---

### Relationship to workflow-run-operations {#phase-5-boundary}

This plan consolidates the `execution-lifecycle/` module, which is paired — across a deliberate seam — with the [`WorkflowRunOperationsModule`](../guide/05-api-module-graph.md#workflowrunoperationsmodule) (`apps/api/src/workflow/workflow-run-operations/`) on the run side. The two modules own orthogonal slices: the lifecycle module owns per-execution state, supervision, and event emission; the run-operations module owns run-level routing, reconciliation, and the run-facing HTTP surface. The coupling is **unidirectional** (`workflow-run-operations → execution-lifecycle`): the only entry point is a `forwardRef(() => ExecutionLifecycleModule)` in `workflow-run-operations.module.ts`, and exactly three collaborators are consumed — `ExecutionRepository`, `ServiceLifecycleStateService`, and `SubagentContainerLivenessProbe` — all by `WorkflowRunReconciliationService`. See [Relationship to workflow-run-operations](../guide/42-execution-lifecycle.md#relationship-to-workflow-run-operations) in the execution-lifecycle guide for the full stable-contract surface and layering rules.

**Phase 5.4 is the run-operations side of this same story.** Phases 1–4 collapse the lifecycle module's redundant sweepers, heartbeats, taxonomies, and the `subagent_executions` shadow table into one execution model — liveness becomes `execution.heartbeat` + container alive. Once that holds, the "no live queue job found" trigger inside `WorkflowRunReconciliationService` has no execution to immunise against and goes away; what remains on the run side is _pending-run activation_ only. Phase 5.4 is therefore the delete-half of the seam this plan builds.

# Phase 5 — Async dispatch + retire stale-run reconciliation (north-star)

**Outcome:** no queue worker holds a synchronous agent connection; completion is event-driven for every kind; the "no live queue job found" stale-run trigger is deleted. Generalizes the fire-and-poll pattern subagents already use (and steps half-use).

## Tasks

- [ ] **5.1 Chat fire-and-poll.** Convert the `chat-sessions` consumer to enqueue→provision→`background:true` kickoff→complete-the-job-immediately; drive completion from `execution.completed`/`failed` via the Phase 2 router. TDD: job returns fast; completion event marks the session terminal; no synchronous hold. Make `RETRY_SCHEDULED` a first-class state end-to-end.
- [ ] **5.2 Workflow-step fire-and-poll.** Finish converting the `workflow-steps` consumer (already partially fire-and-poll via `dispatchAgentJobBackground`) so `handleJobComplete`/`handleJobFailed` are driven purely by `execution.completed`/`failed` (`StepExecutionCompletionListener` already exists). Remove the synchronous 2-hour POST hold where it remains. TDD: long step never trips a queue-liveness check.
- [ ] **5.3 Completion backstop.** Add the supervisor rule: container exited cleanly but no completion signaled ⇒ read the agent-response store / final logs ⇒ emit `execution.completion_signaled` or `execution.reaped(container_lost)`. TDD. This is the async-era replacement for "the worker noticed the POST returned" (SDD §6.3).
- [ ] **5.4 Delete stale-run reconciliation.** Remove the `STALE_RUN_REASON` / "no live queue job found" trigger from `WorkflowRunReconciliationService`; it keeps only _pending-run activation_. Liveness now = recent `execution.heartbeat` + container alive. Remove the BullMQ `lockDuration`↔step-duration coupling. TDD + parity.
- [ ] **5.5 Make the projection authoritative.** Stop any remaining dual-write of legacy run/session state; `executions` (+ projections) is the single source of truth. Add a projection-rebuild command/test (replay outbox → identical projection).

**Risk:** high — biggest blast radius (chat + workflow dispatch). Gate behind config flags per consumer; keep the redundant completion signal paths (primary WS/HTTP + supervisor backstop) so a lost completion can't strand a run. Only undertake after Phases 1–4 are stable in production.

---

## Sequencing, ownership, and coordination

- **Order is load-bearing:** 1 → 2 → 3 → 4 → 5. Phases 1–3 are behavior-only (low/medium risk); 4 is schema; 5 is dispatch. Never collapse the table (4) before the sweepers are unified (1–2).
- **Coordinate with in-flight work:** `feat/shutdown-pause-resume` and `docs/superpowers/specs/2026-06-14-service-shutdown-pause-resume-design.md` touch the supervisor/in-flight executions — land Phase 1's supervisor changes compatibly (the shutdown work should pause/resume _executions_, which Phase 1 makes the single owner of).
- **ADR:** write `docs/adrs/0001-event-sourced-execution-lifecycle.md` (referenced by the SDD) capturing the "lifecycle facts go through the outbox/projection; EventEmitter2 is live-UI fanout only" rule before Phase 5.
- **Each phase ends with:** full `apps/api` suite green, `npm run build:api` + `npm run lint:api` clean, docs updated in `docs/guide/42-execution-lifecycle.md`, and the legacy system's deletion committed separately from its replacement.

## Self-review

- **Coverage vs roadmap:** the five roadmap redundancies map to phases — dual subagent tracking → P1+P4; duplicate probe → P1; overlapping sweepers → P1+P2+P5; five terminal writers → P2; two heartbeats/taxonomies → P3. ✓
- **Type/name consistency:** `failIfNotTerminal` (P2), `subagent_details` (P4), `spawn_timeout`/`never_dispatched` reasons (P1/P2) used consistently across phases.
- **No silent scope creep:** `AgentAwaitReconcilerService`, `ChatMemoryJobService`, and non-execution queues are explicitly out of scope.
