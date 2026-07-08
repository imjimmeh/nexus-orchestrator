# Kanban Retrospective Cycle Decision Architecture Analysis

**Work Item:** 884a2230-bec1-45e1-8727-96583401cb20 (original analysis) + 2a64258d-8542-4ca0-b582-42a69dd61ff0 (WI-2026-062, typed failure surface)  
**Milestone:** Analyze existing code architecture + Typed failure surface (WI-2026-062 Milestone 2)  
**Date:** 2026-05-30 (original); 2026-06-20 (typed failure surface update)

## Executive Summary

This document analyzes the existing code architecture for wiring CEO cycle decisions into the learning candidate pipeline. The key finding is that the `kanban.retrospective_cycle_decision_recorded` event already exists and is being emitted from `kanban.complete_orchestration_cycle_decision` tool when substantive decisions are made.

---

## 1. `kanban.complete_orchestration_cycle_decision` Tool Implementation

### Location

`apps/kanban/src/mcp/tools/mutation/complete-orchestration-cycle-decision.tool.ts`

### Parameters (Input Schema)

Located in `apps/kanban/src/mcp/tools/shared/schemas.ts`:

```typescript
CompleteOrchestrationCycleDecisionSchema = OrchestrationRecordCycleDecisionSchema
// Which includes:
{
  project_id: string,
  decision: "repeat" | "pause" | "complete" | "blocked" (optional),
  reason: string,
  idempotency_key: string (optional),
  autonomous_default: boolean (optional),
  ready_work_remaining: boolean (optional)
}
```

### How It Persists Decisions

1. **Delegates to `OrchestrationRecordCycleDecisionTool`** (`orchestration-record-cycle-decision.tool.ts`)
2. **The `OrchestrationService.recordCycleDecision()`** method persists the decision to the `kanban_orchestrations` table
3. Decision is stored in `decision_log` array with timestamp, correlationId, and decision metadata
4. Idempotency is handled via `idempotency_key` to prevent duplicate processing

### Key Flow

```
CompleteOrchestrationCycleDecisionTool.execute()
  ├─> OrchestrationRecordCycleDecisionTool.execute()  // Persists decision
  ├─> coreWorkflowClient.setWorkflowJobOutput()       // Writes to workflow job output
  ├─> emitRetrospectiveCycleDecisionRecorded()         // Emits kanban.retrospective_cycle_decision_recorded
  ├─> emitCycleDecisionRecordedEvent()                 // Emits kanban.cycle_decision_recorded
  └─> coreWorkflowClient.stepComplete()               // Completes the workflow step
```

---

## 2. Retrospective Service Analysis

### Location

`apps/kanban/src/retrospectives/kanban-retrospective.service.ts`

### How It Emits `learning.candidate.proposed.v1` Events

The retrospective service operates through a different trigger path:

1. **Trigger Types:**
   - `completion_event` - triggered when orchestration cycle completes
   - `manual_replay` - triggered manually by users
   - `failure_threshold` - triggered when the consecutive-failure counter
     reaches `FAILURE_THRESHOLD_COUNT`. The counter is only incremented
     for `FailureClass` values in `FAILURE_CLASSES_THAT_COUNT`; see
     [§9 Typed Failure Surface](#9-typed-failure-surface-wi-2026-062)
     for the typed counting rule.

2. **Evidence Collection:**
   - Uses `KanbanRetrospectiveEvidenceService.collectProjectEvidence()`
   - Builds `KanbanRetrospectiveDeltaSnapshot` with:
     - Project info
     - Orchestration state
     - Work item counts by status
     - Decision log entries
     - Action requests

3. **Event Emission:**
   - Calls `coreClient.emitDomainEventOrThrow()` with `LEARNING_CANDIDATE_PROPOSED_EVENT`
   - Payload includes lesson, evidence, confidence, tags, and provenance

### Key Difference from Cycle Decision Tool

The retrospective service is **NOT called** from `complete_orchestration_cycle_decision`. Instead, the tool directly emits both:

- `kanban.retrospective_cycle_decision_recorded` (for internal tracking)
- `learning.candidate.proposed.v1` (for learning pipeline)

---

## 3. Existing Event Types and Schema Patterns

### Event Types in Kanban Codebase

| Event Name                                        | Location                                  | Purpose                     |
| ------------------------------------------------- | ----------------------------------------- | --------------------------- |
| `learning.candidate.proposed.v1`                  | `retrospective.types.ts`                  | Learning candidate proposal |
| `kanban.retrospective_cycle_decision_recorded.v1` | `retrospective.types.ts`                  | Cycle decision recorded     |
| `kanban.cycle_decision_recorded`                  | `events/cycle-decision.recorded.event.ts` | Simple cycle decision event |

### Event Schema Patterns

#### `RetrospectiveCycleDecisionRecordedEvent` Structure

```typescript
interface RetrospectiveCycleDecisionRecordedEvent {
  event_name: string;
  scope_id: string;
  decision_type: "repeat" | "pause" | "complete" | "blocked";
  reason: string;
  is_substantive: boolean;
  board_state_summary: {
    workItems: { total: number; countsByStatus: Record<string, number> };
    goals: { total: number; countsByStatus: Record<string, number> };
  };
  work_item_counts: {
    total: number;
    byStatus: Record<string, number>;
    activeCount: number;
    doneCount: number;
  };
  goal_coverage: {
    total: number;
    active: number;
    completed: number;
    coveragePercentage: number;
  };
  cycle_decision_recorded_at: string;
  provenance: {
    project_id: string;
    workflow_run_id: string | null;
    job_id: string | null;
    idempotency_key: string | null;
    decision_source: "orchestration_cycle" | "manual" | "system";
  };
}
```

> **Source-of-truth note (post-M7, 2026-06-23):** The `work_item_counts` and
> `goal_coverage` sub-objects are now always populated by
> `BoardStateService.getBoardStateSummary` (terminal work-item statuses
> `['done', 'completed']`; `goal_coverage.coveragePercentage` falls back to
> `0` when `total === 0`; archived goals excluded). The five overlapping
> `BoardStateSummary` declarations across
> `apps/kanban/src/services/board-state.types.ts`,
> `apps/kanban/src/retrospectives/types/cycle-decision.types.ts`,
> `apps/kanban/src/events/cycle-decision.event.types.ts`,
> `apps/kanban/src/events/retrospective-cycle-decision.event.types.ts`, and
> `apps/kanban/src/retrospectives/retrospective.types.ts` remain a separate
> type-consolidation follow-up tracked in the revised plan for
> `40fc4266-0ec6-4b94-9bc6-cf9603dbd326`.

#### `LearningCandidateProposedEvent` Structure

```typescript
interface LearningCandidateProposedEvent {
  event_name: "learning.candidate.proposed.v1";
  source_service: "kanban";
  scope_type: "kanban_project";
  scope_id: string;
  lesson: string;
  evidence: Array<{
    kind: "kanban_retrospective_delta";
    id: string;
    summary: string;
    data: KanbanRetrospectiveDeltaSnapshot;
  }>;
  confidence: number;  // 0.6
  tags: string[];
  provenance: {
    project_id: string;
    orchestration_id: string | null;
    retrospective_run_id: string;
    cycle_decision: string;
    trigger: { type: string; ... };
  };
}
```

---

## 4. Board State Information Sources

### Work Item Counts

**Repository:** `KanbanWorkItemRepository`

- Method: `findByproject_id(projectId: string)`
- Returns: `KanbanWorkItemEntity[]` with status field
- Counts computed in `KanbanRetrospectiveEvidenceService.buildDeltaSnapshot()`

### Goal Coverage

**Repository:** `KanbanProjectGoalRepository`

- Method: `findByproject_id(projectId: string, includeArchived?: boolean)`
- Returns: `KanbanProjectGoalEntity[]` with status field
- Status values: `"todo"`, `"in-progress"`, `"done"`, etc.

### Evidence Service Flow

```typescript
collectProjectEvidence(projectId)
  ├─> projects.findById()           // Validate project exists
  ├─> orchestrations.findByProjectId() // Get orchestration state
  ├─> workItems.findByProjectId()    // Get work items
  ├─> getDecisionLog()               // Get decision history
  ├─> getActionRequests()             // Get action requests
  └─> getCycleDecisionEvents()       // Get cycle decision events from projections
```

### Event Projections for Cycle Decisions

**Entity:** `KanbanEventDeliveryProjectionEntity`

- Stores event snapshots for replay and evidence
- Filtered by `RETROSPECTIVE_CYCLE_DECISION_RECORDED_EVENT` event name
- Contains `payload_snapshot` with full event data

---

## 5. Key Implementation Details

### Substantive Decision Logic

The tool determines if a decision is "substantive" for event emission:

```typescript
// In complete-orchestration-cycle-decision.tool.ts
private async isSubstantiveDecisionForEvent(decision, reason):
  - "blocked" or "complete" → always substantive
  - "repeat" with board mutation (reason contains "changed", "updated", etc.) → substantive
  - "repeat" without mutation → NOT substantive
```

### Learning Candidate Proposed Event Trigger

The tool emits `learning.candidate.proposed.v1` directly for:

- All `blocked` decisions
- All `complete` decisions
- `repeat` decisions where board mutation is detected

### Idempotency

- Both events use idempotency keys from the tool input
- Duplicate triggers are detected and skipped in the retrospective service
- Event IDs are constructed with project ID, workflow run ID, and timestamp

---

## 6. Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                    CEO Workflow Execution                             │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  kanban.complete_orchestration_cycle_decision Tool                  │
│  (complete-orchestration-cycle-decision.tool.ts)                    │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
        ┌───────────────────┐ ┌───────────┐ ┌──────────────────────┐
        │ Orchestration     │ │ Core      │ │ KanbanRetrospective  │
        │ RecordCycleDecision│ │ Workflow  │ │ EvidenceService      │
        │ Tool              │ │ Client    │ │                      │
        └───────────────────┘ └───────────┘ └──────────────────────┘
                    │               │               │
                    ▼               ▼               ▼
        ┌───────────────────┐ ┌───────────┐ ┌──────────────────────┐
        │ Orchestration     │ │ setJob    │ │ Board State Summary   │
        │ Service          │ │ Output    │ │ (workItems, goals)    │
        └───────────────────┘ └───────────┘ └──────────────────────┘
                    │                                │
                    ▼                                ▼
        ┌───────────────────┐            ┌──────────────────────┐
        │ Orchestration     │            │ Events Emitted:       │
        │ Repository       │            │ 1. retrospective_     │
        │ (decision_log)   │            │    cycle_decision_    │
        └───────────────────┘            │    recorded          │
                                        │ 2. learning.candidate_│
                                        │    proposed.v1        │
                                        └──────────────────────┘
```

---

## 7. Key Files Reference

| File                                                                   | Purpose                  |
| ---------------------------------------------------------------------- | ------------------------ |
| `src/mcp/tools/mutation/complete-orchestration-cycle-decision.tool.ts` | Main tool implementation |
| `src/mcp/tools/mutation/orchestration-record-cycle-decision.tool.ts`   | Persistence layer        |
| `src/retrospectives/kanban-retrospective.service.ts`                   | Retrospective service    |
| `src/retrospectives/kanban-retrospective-evidence.service.ts`          | Evidence collection      |
| `src/retrospectives/retrospective.types.ts`                            | Type definitions         |
| `src/retrospectives/events/cycle-decision.recorded.event.ts`           | Event factory            |
| `src/retrospectives/types/cycle-decision.types.ts`                     | Cycle decision types     |
| `src/core/core-workflow-client.service.ts`                             | Core workflow client     |
| `src/mcp/tools/shared/schemas.ts`                                      | Input schemas            |
| `src/orchestration/orchestration.service.ts`                           | Orchestration service    |
| `src/database/repositories/kanban-work-item.repository.ts`             | Work item repository     |
| `src/database/repositories/kanban-project-goal.repository.ts`          | Goal repository          |
| `src/database/entities/kanban-event-delivery-projection.entity.ts`     | Event projection entity  |

---

## 8. Findings Summary

### What Already Exists

1. ✅ `kanban.retrospective_cycle_decision_recorded` event type defined
2. ✅ Event emission logic in `complete_orchestration_cycle_decision` tool
3. ✅ `learning.candidate.proposed.v1` event emission for substantive decisions
4. ✅ Board state summary collection via `KanbanRetrospectiveEvidenceService`
5. ✅ Event projection storage in `kanban_event_delivery_projections` table
6. ✅ Evidence service that builds delta snapshots from board state

### What Needs to Be Done (for full implementation)

1. The basic event wiring is already in place
2. Goal coverage is currently returning zeros (needs proper goal data retrieval)
3. Event test coverage exists in `complete-orchestration-cycle-decision.learning-candidate.spec.ts`

### Architecture Strengths

- Clean separation between tool execution and event emission
- Idempotency handled at multiple levels
- Evidence service provides reusable board state collection
- Event projections enable audit trail and replay capability

### Potential Improvements

- Goal coverage calculation should be enhanced to query actual goal data
- Consider adding goal status counts to the evidence service
- Event emission could be moved to a dedicated event service for consistency

---

## 9. Typed Failure Surface (WI-2026-062)

> **Supersedes the legacy "any FAILED cycle decision increments" heuristic.**
> The pre-WI-2026-062 implementation treated every `failed` cycle decision
> as a counted failure. That heuristic conflated product-intentional
> outcomes (e.g. a QA rejection, or a healthy "no actionable work" repeat)
> with genuine system regressions, so an over-eager retrospective would
> fire on healthy boards. WI-2026-062 introduced the `FailureClass`
> discriminator (defined in `@nexus/core`) so only true regressions
> count toward the threshold. This section documents the typed surface.

### 9.1 The `FailureClass` enum

The `FailureClass` enum is defined in `packages/core/src/retrospectives/failure-class.types.ts`
and re-exported through `@nexus/core`. The kanban failure-threshold
service re-exports it via `apps/kanban/src/retrospectives/kanban-retrospective-failure-threshold.types.ts`
so its call sites do not need a second import path. Values:

| Value                  | Underlying string        | Meaning                                                                                                                                                                                   |
| ---------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `QaRejection`          | `qa_rejection`           | The QA agent rejected the work item's output. The retry is an intentional product decision, not a system regression.                                                                      |
| `NoActionableWork`     | `no_actionable_work`     | The orchestration cycle was a no-op because there is no actionable work (status `failed` due to no actionable work). This is an intentional repeat of a healthy cycle decision.           |
| `SystemFailure`        | `system_failure`         | A container-lost, orchestrator-error, or other infra/system failure caused the workflow run to terminate without a domain-meaningful explanation.                                         |
| `EventDeliveryFailure` | `event_delivery_failure` | A domain event failed to be delivered (the core event bus rejected the envelope, the projection storage rejected the record, or the underlying transport returned a non-retryable error). |
| `UnhandledException`   | `unhandled_exception`    | An unhandled exception bubbled up through the orchestration or retrospective pipeline.                                                                                                    |

The set of values that count toward the threshold is exported as
`FAILURE_CLASSES_THAT_COUNT` (a `ReadonlySet<FailureClass>`) and the
predicate `shouldCountFailure(failureClass)` is the single source of
truth for the counting rule. The service never inlines the set
membership check — it always asks `shouldCountFailure`.

### 9.2 Failure surface → `FailureClass` mapping

The following table maps each failure surface to its `FailureClass`
value and the counting rule. The mapping is owned by the call site
that invokes `KanbanRetrospectiveFailureThresholdService.checkFailureThreshold`
(the synchronous `OrchestrationCycleDecisionService.checkFailureThreshold`
path and the asynchronous `OrchestrationContinuationReconcilerService`
"pending count" path both route through the same `shouldCountFailure`
filter):

| Surface                                                                    | `FailureClass` value   | Counts?                | Rationale                                                                                                            |
| -------------------------------------------------------------------------- | ---------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `work_item_workflow_run_failed` fact — QA rejection                        | `QaRejection`          | No (intentional loop)  | The retry is the desired behaviour; the QA rejection is a normal product flow.                                       |
| `work_item_workflow_run_failed` fact — container lost / orchestrator error | `SystemFailure`        | Yes                    | The workflow run terminated without a domain-meaningful explanation; this is a real regression.                      |
| Orchestration cycle decision `failed` — no actionable work                 | `NoActionableWork`     | No (intentional no-op) | A `repeat` with no dispatchable work is a healthy steady state, not a regression.                                    |
| Orchestration cycle decision `failed` — uncaught error                     | `UnhandledException`   | Yes                    | An uncaught exception in the orchestration pipeline is a real regression.                                            |
| `event_delivery_failed` fact (core event bus, projection, transport)       | `EventDeliveryFailure` | Yes                    | A non-retryable event-delivery failure breaks the learning-candidate pipeline downstream; this is a real regression. |

### 9.3 The `kanban.retrospective.failure_observed` diagnostic event

Every call to `KanbanRetrospectiveFailureThresholdService.checkFailureThreshold`
emits a `kanban.retrospective.failure_observed` event via the in-process
kanban event emitter (the `EventEmitter2` singleton in
`apps/kanban/src/events/kanban-event-emitter.ts`). The event is
emitted on **both** the counted and the non-counted paths so operators
can audit the full failure surface (intentional and real) without
re-inferring it from cycle-decision history. The event name is
exported as `KANBAN_RETROSPECTIVE_FAILURE_OBSERVED_EVENT` from
`apps/kanban/src/retrospectives/kanban-retrospective-failure-threshold.service.ts`.

Payload shape:

| Field                       | Type                   | Meaning                                                                                                                                                                                                                                   |
| --------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `event_name`                | `string`               | Always `kanban.retrospective.failure_observed`.                                                                                                                                                                                           |
| `scope_id`                  | `string`               | The project ID the observation was recorded for (the `checkFailureThreshold(projectId, ...)` argument).                                                                                                                                   |
| `failure_class`             | `FailureClass \| null` | The classified surface, or `null` when the call site did not thread a class (back-compat: callers that pre-date WI-2026-062).                                                                                                             |
| `counted`                   | `boolean`              | `true` if this observation incremented the `consecutive_failure_count` counter; `false` if it was a no-op (intentional class, no orchestration, persistence failure, or uncategorised-but-treated-as-counted).                            |
| `observation_reason`        | `string`               | A machine-readable reason for the `counted` value: `counted` (real failure), `intentional_class` (e.g. `QaRejection`, `NoActionableWork`), `no_orchestration` (no row in `kanban_orchestrations`), `persistence_failed` (DB write threw). |
| `consecutive_failure_count` | `number`               | The new counter value after this observation (or the previous value if the observation did not count).                                                                                                                                    |
| `threshold`                 | `number \| undefined`  | The configured `FAILURE_THRESHOLD_COUNT` when the observation was counted; absent on non-counted observations.                                                                                                                            |
| `observed_at`               | `string`               | ISO-8601 timestamp of the observation.                                                                                                                                                                                                    |

Subscribers should rely on `counted` and `observation_reason` rather
than on `failure_class` alone to decide what to do — the discriminated
union (`failure_class` + `counted`) is the contract.

### 9.4 Shared filter via `shouldCountFailure`

Both the synchronous and asynchronous producers of failure-threshold
observations share the same `shouldCountFailure` filter:

- **Synchronous producer** — `OrchestrationCycleDecisionService.checkFailureThreshold`
  invokes `IKanbanRetrospectiveFailureThresholdService.checkFailureThreshold`
  inline at the point where the cycle decision is recorded. This is
  the "decision-aware" path: the failure class is already known at the
  call site (e.g. `NoActionableWork` for a "repeat" with no dispatchable
  work, `UnhandledException` for a caught/uncaught error).
- **Asynchronous producer** — `OrchestrationContinuationReconcilerService`
  maintains a `pending_consecutive_failure_count` from persisted
  failure facts and, when the reconciler next runs and the count
  crosses the threshold, invokes `checkFailureThreshold` with the
  classified `FailureClass` value of the underlying fact (e.g.
  `QaRejection` for a QA rejection, `SystemFailure` for a
  container-lost event, `EventDeliveryFailure` for a
  `event_delivery_failed` fact). This is the "fact-replay" path.

Because both producers route through the same `checkFailureThreshold`
method, the only counting rule the codebase has to maintain lives in
`shouldCountFailure` — a one-line predicate backed by a `ReadonlySet`.
There is no parallel "we used to count this here" / "we used to skip
this there" branch logic.

### 9.5 Files touched by WI-2026-062

| File                                                                                    | Role                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/retrospectives/failure-class.types.ts`                               | New file. Defines `FailureClass`, `FAILURE_CLASSES_THAT_COUNT`, and `shouldCountFailure`.                                                                                                                                                                                        |
| `packages/core/src/index.ts`                                                            | Re-exports the new symbols so `@nexus/core` callers can import them.                                                                                                                                                                                                             |
| `apps/kanban/src/retrospectives/kanban-retrospective-failure-threshold.types.ts`        | Re-exports the symbols and updates the `IKanbanRetrospectiveFailureThresholdService` interface to accept an optional `failureClass` argument.                                                                                                                                    |
| `apps/kanban/src/retrospectives/kanban-retrospective-failure-threshold.service.ts`      | Updates `checkFailureThreshold` to accept the optional `failureClass`, gate the counter increment through `shouldCountFailure`, and always emit `kanban.retrospective.failure_observed`. Adds `KANBAN_RETROSPECTIVE_FAILURE_OBSERVED_EVENT` constant + `EmitterLike` annotation. |
| `apps/kanban/src/retrospectives/kanban-retrospective-failure-threshold.service.spec.ts` | New tests covering each `FailureClass` value (counted + non-counted) and the diagnostic event payload.                                                                                                                                                                           |
| `docs/architecture/kanban-retrospective-cycle-decision-architecture.md`                 | This section.                                                                                                                                                                                                                                                                    |
| `docs/project-context/OPEN_QUESTIONS.md`                                                | Marks the K1 open question as **Resolved** by WI-2026-062.                                                                                                                                                                                                                       |

### 9.6 Backward compatibility

- `failureClass` is **optional** on
  `IKanbanRetrospectiveFailureThresholdService.checkFailureThreshold`.
  Existing callers that pre-date WI-2026-062 continue to work and
  still increment the counter (because `shouldCountFailure(undefined)`
  returns `true` — "unknown / not classified" is conservatively
  counted).
- The `failure_observed` event is emitted on every call (counted and
  non-counted) so historical callers can be migrated incrementally
  without losing the audit trail.
- The `consecutive_failure_count` field on
  `kanban_orchestrations.metadata` is unchanged — existing
  `done`/`in-progress` migration columns still apply.

---

## 10. Failure-Threshold Settings Schema (WI-2026-063)

> **Supersedes the WI-2026-062-era hardcoded `FAILURE_THRESHOLD_COUNT`
> env var.** Before WI-2026-063 the failure-threshold trigger read a
> single deployment-time env var (`FAILURE_THRESHOLD_COUNT`) with no
> notion of a window, no explicit cooldown-bypass knob, and a
> non-deterministic `trigger_revision_marker` (UUID). The
> WI-2026-062-era service accepted an optional `failureClass` but
> still relied on that env var for the threshold count and had no
> way to express "failures within the last N seconds". WI-2026-063
> promoted the trigger's knobs to six first-class `SystemSetting`
> entries with Zod validation, introduced sliding-vs-fixed window
> strategies, added the explicit cooldown-bypass knob, and made the
> `trigger_revision_marker` deterministic per `(project_id, window)`
> tuple. This section documents the new typed surface.

### 10.1 Settings keys

The failure-threshold trigger reads six `SystemSetting` entries at the
start of every `checkFailureThreshold()` call via the narrow
`ISystemSettingsReader.get<T>(key, defaultValue)` contract. When the
optional `ISystemSettingsReader` is not wired (the production
`RetrospectivesModule` does not import `SystemSettingsModule` to honor
the apps/packages boundary), the service falls through to a per-key
env-var reader and then to the schema default — the chain is
`SystemSetting > env var > schema default`, identical to the sibling
`distillation-threshold` / `repair-delegation-settings` knobs.

| Setting key                                        | Type                   | Default     | Constraints        | Purpose                                                                                               |
| -------------------------------------------------- | ---------------------- | ----------- | ------------------ | ----------------------------------------------------------------------------------------------------- |
| `retrospective_failure_threshold_enabled`          | `boolean`              | `true`      | —                  | Master switch; when `false`, the service returns immediately with no side effects.                    |
| `retrospective_failure_threshold_count`            | `number`               | `3`         | `int ≥ 1 ≤ 100`    | Failure count that triggers a retrospective. Replaces the legacy `FAILURE_THRESHOLD_COUNT` env var.   |
| `retrospective_failure_threshold_window_seconds`   | `number`               | `600`       | `int ≥ 60 ≤ 86400` | Window size for counting failures. Used by both `sliding` and `fixed` strategies.                     |
| `retrospective_failure_threshold_cooldown_seconds` | `number`               | `900`       | `int ≥ 0 ≤ 86400`  | Minimum gap between two failure-threshold-triggered retrospectives. `0` disables the cooldown.        |
| `retrospective_failure_threshold_bypass_cooldown`  | `boolean`              | `false`     | —                  | When `true`, the cooldown is bypassed and a fire happens regardless of `cooldown_seconds`. Closes K2. |
| `retrospective_failure_threshold_window_strategy`  | `'sliding' \| 'fixed'` | `'sliding'` | enum               | Selects the failure-window strategy (see below).                                                      |

The keys + defaults are the single source of truth in
`@nexus/core` at
`packages/core/src/retrospectives/failure-threshold-settings.constants.ts`.
The API-side Zod schemas live at
`apps/api/src/settings/retrospective-failure-threshold-settings.constants.ts`
and are re-exported from the `@nexus/core` constants file so the
keys, defaults, and inferred TypeScript union all derive from the
same source. The seeded defaults are registered in
`apps/api/src/settings/system-settings.defaults.ts` so the keys and
the seeded defaults cannot drift apart.

**Env-var fallback.** Each setting can be overridden at deploy time
by an env var named `RETROSPECTIVE_FAILURE_THRESHOLD_<KEY>` (e.g.
`RETROSPECTIVE_FAILURE_THRESHOLD_ENABLED`,
`RETROSPECTIVE_FAILURE_THRESHOLD_COUNT`,
`RETROSPECTIVE_FAILURE_THRESHOLD_WINDOW_SECONDS`,
`RETROSPECTIVE_FAILURE_THRESHOLD_COOLDOWN_SECONDS`,
`RETROSPECTIVE_FAILURE_THRESHOLD_BYPASS_COOLDOWN`,
`RETROSPECTIVE_FAILURE_THRESHOLD_WINDOW_STRATEGY`). The legacy
`FAILURE_THRESHOLD_COUNT` env var remains the deployment-time
default for `Count` so existing deployments don't break; the new
`RETROSPECTIVE_FAILURE_THRESHOLD_COUNT` env var (added by WI-2026-063)
takes precedence over the legacy one when both are set.

**Read-at-call-site.** Every `checkFailureThreshold()` call invokes
`resolveSettings()` first, which reads all six keys (and the per-key
env-var fallback). The keys are NOT cached in-process — operator
changes via the `system-settings` REST surface take effect on the
next observation without a restart. When `Enabled === false`, the
service emits a `kanban.retrospective.failure_observed` event with
`counted: false`, `observation_reason: "disabled"`, and returns
immediately; no DB read, no count increment, no retrospective run.

### 10.2 Trigger Revision Marker

The failure-threshold trigger emits a deterministic
`trigger_revision_marker` of the form:

```
failure-threshold:{project_id}:{window_start_epoch_seconds}
```

where:

- `{project_id}` is the kanban `project_id`.
- `{window_start_epoch_seconds}` is the start of the failure-counting
  window:
  - `sliding` strategy: `floor((now_epoch_seconds - window_seconds))`.
  - `fixed` strategy: `floor(now_epoch_seconds / 60) * 60`.

This marker is used as the idempotency-key seed for `executeRun`, so
retried emissions within the same
`(project_id, window_start_epoch_seconds)` pair are automatically
deduped. Closes `OPEN_QUESTIONS K5`.

#### Cooldown bypass

When `bypass_cooldown === true` (or `manual_override === true` is
passed via the existing `executeRun` API), the cooldown check is
skipped. The service still emits a
`kanban.retrospective.cooldown_skipped` event with payload:

```json
{
  "event_name": "kanban.retrospective.cooldown_skipped",
  "scope_id": "<project_id>",
  "bypass_cooldown": true,
  "trigger_revision_marker": "failure-threshold:<project_id>:<window_start_epoch_seconds>",
  "window_start_epoch_seconds": <epoch_seconds>,
  "recorded_at": "<ISO timestamp>"
}
```

Closes `OPEN_QUESTIONS K2`.

> **Note on bypass + same-window dedupe.** The
> `(project_id, window_start_epoch_seconds)` dedupe runs BEFORE the
> cooldown/bypass check. A retried emission within the same window is
> always deduped regardless of `bypass_cooldown`. To fire again with
> `bypass_cooldown: true`, the caller must wait for a new window
> (i.e., advance past the window boundary).

### 10.3 Window Strategies

The `retrospective_failure_threshold_window_strategy` setting picks
how the failure-window timestamps are interpreted. Both strategies
share the same `trigger_revision_marker` shape
(`failure-threshold:{project_id}:{window_start_epoch_seconds}`) and
the same `last_emitted_window` metadata key; only the
**`window_start_epoch_seconds`** value and the **prune semantics**
differ.

#### Sliding window

A sliding window counts failures within the last `WindowSeconds`
from "now". Failure timestamps are persisted in
`orchestration.metadata.failure_threshold_timestamps` (an array of
epoch-seconds) and pruned at the start of each
`checkFailureThreshold()` call. The count is the post-prune length
of the array. Use this strategy when you want the threshold to be
"failures in the last N seconds", regardless of calendar
boundaries.

#### Fixed window

A fixed window counts failures within the current 1-minute calendar
window. The window key is `floor(now_epoch_seconds / 60) * 60`. On
calendar roll (window key changes), the counter resets to 0 (or 1
for the new failure). The previous window's `last_emitted_window`
metadata is consulted to skip a redundant fire within the same
window. Use this strategy when you want predictable, human-aligned
windows (e.g., "failures within this minute").

#### Choice guidance

Use `sliding` (default) for runtime stability: the threshold adapts
to actual recent activity. Use `fixed` when you want operators to
reason about specific calendar windows.

### 10.4 Files touched by WI-2026-063

| File                                                                                            | Role                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/retrospectives/failure-threshold-settings.constants.ts`                      | New file. Defines the 6 `SystemSettingKey` strings + `DEFAULTS` record, frozen with `as const`. Single source of truth for keys + defaults.                                                                                                                                                                                                                                                                                               |
| `packages/core/src/retrospectives/failure-threshold-settings.types.ts`                          | New file. Inferred TypeScript union types derived from the keys/defaults.                                                                                                                                                                                                                                                                                                                                                                 |
| `packages/core/src/index.ts`                                                                    | Re-exports the new symbols so `@nexus/core` callers can import them.                                                                                                                                                                                                                                                                                                                                                                      |
| `apps/api/src/settings/retrospective-failure-threshold-settings.constants.ts`                   | API-side surface: re-exports keys/defaults from `@nexus/core` + adds Zod validation schemas + min/max constants.                                                                                                                                                                                                                                                                                                                          |
| `apps/api/src/settings/retrospective-failure-threshold-settings.constants.types.ts`             | Inferred TypeScript types for the API-side Zod schemas.                                                                                                                                                                                                                                                                                                                                                                                   |
| `apps/api/src/settings/retrospective-failure-threshold-settings.constants.spec.ts`              | Unit tests covering each Zod validation schema (in-range, out-of-range, type-mismatch).                                                                                                                                                                                                                                                                                                                                                   |
| `apps/api/src/settings/system-settings.defaults.ts`                                             | Registers the seeded defaults on boot so `SystemSettingsService.seedDefaults()` returns a sane value on a fresh database.                                                                                                                                                                                                                                                                                                                 |
| `apps/kanban/src/retrospectives/kanban-retrospective-failure-threshold.service.ts`              | Service updated to read the 6 settings at the start of every `checkFailureThreshold()` call via `resolveSettings()`, honor `Enabled` / `Count` / `WindowSeconds` / `WindowStrategy` / `CooldownSeconds` / `BypassCooldown`, persist the failure-window timestamp list in `orchestration.metadata.failure_threshold_timestamps`, and emit the deterministic `failure-threshold:{project_id}:{window_start_epoch_seconds}` revision marker. |
| `apps/kanban/src/retrospectives/kanban-retrospective-failure-threshold.types.ts`                | Interface updated to thread the `triggerRevisionMarker` + `idempotencyKey` + `bypassCooldown` + `windowStartEpochSeconds` payload through `runForFailureThreshold`.                                                                                                                                                                                                                                                                       |
| `apps/kanban/src/retrospectives/kanban-retrospective-failure-threshold.helpers.ts`              | New file. Pure helpers: `computeWindowStartEpochSeconds` (sliding + fixed), `pruneAndAppendFailureTimestamp`, `getFailureTimestamps`, `isCooldownActive`, `wasWindowAlreadyEmitted`.                                                                                                                                                                                                                                                      |
| `apps/kanban/src/retrospectives/kanban-retrospective-failure-threshold.env.ts`                  | New file. Env-var fallback readers so the kanban app can run with no `SystemSettingsModule` DI wiring.                                                                                                                                                                                                                                                                                                                                    |
| `apps/kanban/src/retrospectives/kanban-retrospective-candidate.helpers.ts`                      | New file. Extraction helpers that surface the `triggerRevisionMarker` on the emitted `learning.candidate.proposed.v1` event.                                                                                                                                                                                                                                                                                                              |
| `apps/kanban/src/retrospectives/kanban-retrospective.service.ts`                                | `executeRun` accepts the new `triggerRevisionMarker` from the caller and uses it for idempotency-key computation; emits `kanban.retrospective.cooldown_skipped` when bypass is in effect.                                                                                                                                                                                                                                                 |
| `apps/kanban/src/retrospectives/kanban-retrospective-failure-threshold.service.spec.ts`         | Updated unit tests covering each Zod-validated setting, sliding vs fixed window strategies, cooldown honored, cooldown bypassed via `BypassCooldown: true`, deterministic trigger revision marker across retried emissions, and the disabled (`Enabled: false`) no-op path.                                                                                                                                                               |
| `apps/kanban/src/retrospectives/kanban-retrospective.integration.spec.ts`                       | Updated integration spec covering the failure-threshold lifecycle (5 consecutive failures within a 60s window → fires once with a deterministic revision marker → retried emission within the cooldown is deduped → retried emission with `BypassCooldown: true` fires again).                                                                                                                                                            |
| `apps/kanban/test/retrospectives/retrospective-failure-threshold-lifecycle.integration-spec.ts` | New black-box integration test that exercises the full failure-to-retrospective path against a real database.                                                                                                                                                                                                                                                                                                                             |
| `apps/kanban/test/retrospectives/retrospective-lifecycle.integration-spec.ts`                   | Updated to thread the new `triggerRevisionMarker` + `bypassCooldown` payload through the deterministic retrospective lifecycle.                                                                                                                                                                                                                                                                                                           |
| `docs/architecture/kanban-retrospective-cycle-decision-architecture.md`                         | This section.                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `docs/project-context/OPEN_QUESTIONS.md`                                                        | Marks the K2, K4, K5 open questions as **Resolved** by WI-2026-063.                                                                                                                                                                                                                                                                                                                                                                       |

### 10.5 Backward compatibility

- The legacy `FAILURE_THRESHOLD_COUNT` env var remains a
  deployment-time default for the `Count` setting, so deployments
  that never set the new `RETROSPECTIVE_FAILURE_THRESHOLD_COUNT`
  env var (and never wrote the key to `system_settings`) keep their
  pre-WI-2026-063 behaviour.
- When `Enabled` is absent from the database and neither env var is
  set, the default is `true` (mirrors the legacy hardcoded behaviour
  in the downstream retrospective failure-threshold service).
- The deterministic `trigger_revision_marker` shape is a contract
  change for any downstream consumer that previously relied on the
  UUID-shaped marker. The integration spec
  (`apps/kanban/test/retrospectives/retrospective-failure-threshold-lifecycle.integration-spec.ts`)
  asserts the new shape and verifies the dedupe path so the contract
  is enforced by tests, not just docs.
- The `cooldown_skipped` event is a net-new diagnostic event; no
  prior consumer expected it, so the addition is purely additive.
