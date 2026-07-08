# EPIC: Workflow Concurrency Policy

**Epic ID:** EPIC-041
**Status:** Implemented
**Created:** 2026-04-04
**Priority:** P0 - Critical
**Theme:** Workflow Engine
**Depends On:** EPIC-036 (Workflow Run Dedup & Worktree Hardening)

---

## 1. Executive Summary

### 1.1 Problem Statement

When a work item completes, the system emits ~3 events within 1 second (`status_changed:done`, `workflow_run_status:COMPLETED` ×2). Each event triggers the dispatch coordinator, which checks available slots, sees 1 open slot (the previous dispatch run hasn't committed its selection yet), and fires a **new dispatch workflow run**. Result: 3 parallel dispatch runs competing to fill 1 slot.

The existing dedup mechanism (`findActiveByTriggerContext`) doesn't help because each trigger has different data (`reason`, `candidates` list, etc.), so the dedup keys never match.

There is no way to declare **"only N instances of this workflow should be running at a time within a given scope"** in the workflow definition. The system lacks a first-class concurrency control primitive at the workflow level.

### 1.2 Solution Overview

Introduce a declarative `concurrency` block in the workflow YAML schema that controls how many instances of a workflow can be active simultaneously, scoped by trigger data.

```yaml
concurrency:
  max_runs: 1
  scope: "trigger.projectId"
  on_conflict: skip
```

Three conflict policies cover all common patterns:
- **skip** — silently discard the new run (idempotent reconciliation loops)
- **queue** — hold as PENDING, activate FIFO when a slot opens
- **cancel_running** — cancel the oldest running instance, start the new one

### 1.3 Success Criteria

- A workflow can declare `concurrency.max_runs` to limit simultaneous active runs within a scope.
- Scope is configurable via dot-path into trigger data (e.g., `trigger.projectId`).
- Three conflict policies (`skip`, `queue`, `cancel_running`) are supported.
- The dispatch workflow uses `concurrency: { max_runs: 1, scope: trigger.projectId, on_conflict: skip }` to eliminate the burst problem.
- Queued runs (PENDING) are activated FIFO when slots open on completion/failure.
- Cancelled runs have their containers and sessions cleaned up.
- Existing workflows without a `concurrency` block behave identically to before.
- All changes are covered by unit tests.
- Kanban E2E tests pass.

---

## 2. Stories

### Story 1: Core Interfaces & Data Model

**What:** Add `IConcurrencyPolicy` and `ConcurrencyConflictPolicy` types to `@nexus/core`. Add `concurrency_scope` column to the `workflow_runs` table/entity.

**Files:**
- `packages/core/src/interfaces/index.ts`
- `apps/api/src/database/entities/workflow-run.entity.ts`

**Acceptance:**
- `IWorkflowDefinition` includes optional `concurrency?: IConcurrencyPolicy`
- `WorkflowRun` entity has nullable `concurrency_scope` varchar column
- Types compile cleanly

---

### Story 2: Repository Methods

**What:** Add `countActiveByScope`, `findOldestPendingByScope`, and `findOldestRunningByScope` to `WorkflowRunRepository`.

**Files:**
- `apps/api/src/database/repositories/workflow-run.repository.ts`

**Acceptance:**
- Methods query by `(workflow_id, concurrency_scope, status)` efficiently
- Unit tested

---

### Story 3: ConcurrencyPolicyService

**What:** New service encapsulating scope resolution, active count check, and conflict policy execution.

**Files:**
- `apps/api/src/workflow/concurrency-policy.service.ts` (new)
- `apps/api/src/workflow/concurrency-policy.service.spec.ts` (new)

**Acceptance:**
- `resolveConcurrencyScope()` handles global, simple, and compound scopes
- `checkAndApply()` returns `proceed | skip | queue | cancel` based on policy and active count
- 100% unit test coverage

---

### Story 4: Parser Validation

**What:** Validate the `concurrency` block during YAML parsing.

**Files:**
- `apps/api/src/workflow/workflow-parser.service.ts`
- `apps/api/src/workflow/workflow-parser.service.spec.ts`

**Acceptance:**
- Valid concurrency blocks pass
- Invalid `max_runs`, `on_conflict`, or `scope` types throw descriptive errors
- Parsed definition includes `concurrency` property

---

### Story 5: Engine Integration

**What:** Integrate concurrency check into `WorkflowEngineService.startWorkflow()`. Add `createQueuedRun()` and `activateQueuedRun()` methods.

**Files:**
- `apps/api/src/workflow/workflow-engine.service.ts`
- `apps/api/src/workflow/workflow-engine.service.spec.ts`

**Acceptance:**
- When `max_runs` is reached with `skip` policy, returns `null`
- When `max_runs` is reached with `queue` policy, creates PENDING run
- When `max_runs` is reached with `cancel_running` policy, cancels oldest and starts new
- Under limit, proceeds normally
- Backward compatible for workflows without concurrency config

---

### Story 6: Queue Activation on Completion/Failure

**What:** Hook into `progressDagOrComplete()` and `handleJobFailed()` to activate the oldest queued run when a concurrency slot opens.

**Files:**
- `apps/api/src/workflow/workflow-run-job-execution.service.ts`
- `apps/api/src/workflow/workflow-run-job-execution.service.spec.ts`

**Acceptance:**
- On COMPLETED/FAILED, if run has `concurrency_scope` and workflow has `queue` policy, activates oldest PENDING run
- No activation if no PENDING runs exist
- Unit tested

---

### Story 7: Dispatch Workflow Configuration

**What:** Add `concurrency` block to the dispatch workflow YAML seed.

**Files:**
- `apps/api/src/database/seeds/work-item-todo-dispatch-default.workflow.yaml`

**Acceptance:**
- Dispatch workflow limits to 1 concurrent run per project
- Seed resyncs on next deployment

---

## 3. Implementation Order

1. Story 1 — Core interfaces + entity
2. Story 2 — Repository methods
3. Story 3 — ConcurrencyPolicyService (TDD)
4. Story 4 — Parser validation
5. Story 5 — Engine integration
6. Story 6 — Queue activation hook
7. Story 7 — Dispatch workflow YAML

## 4. Out of Scope

- Replacing the existing `findActiveByTriggerContext` dedup (complementary, not replaced)
- HTTP rate limiting on API endpoints
- BullMQ-level queue concurrency changes
- UI for managing concurrency policies
