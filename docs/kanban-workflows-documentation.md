# Kanban Functionality — Complete Workflow Documentation

> **Scope**: All kanban workflows, agents, skills, process flows, conditions, I/O contracts, and integration points in the Nexus Orchestrator.
>
> **Source**: `apps/kanban/src/`, `apps/api/src/workflow/`, `packages/kanban-contracts/`, workflow seed YAMLs, startup route rules.
> **Current-state note (2026-05-11):** Use `docs/architecture/ARCH-kanban-workflow.md` as the canonical lifecycle reference. This document remains comprehensive, but active gap tracking and boundary ownership updates are maintained in architecture and analysis docs.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Work Item Status Model](#2-work-item-status-model)
3. [Core Services](#3-core-services)
4. [Startup Orchestration & Route Selection](#4-startup-orchestration--route-selection)
5. [Work Item Lifecycle Workflows](#5-work-item-lifecycle-workflows)
6. [Merge Workflow](#6-merge-workflow)
7. [Refinement Workflow](#7-refinement-workflow)
8. [Split Workflow](#8-split-workflow)
9. [Dispatch & Orchestration Cycle](#9-dispatch--orchestration-cycle)
10. [Core Lifecycle Integration](#10-core-lifecycle-integration)
11. [MCP Tools & Agent Integration](#11-mcp-tools--agent-integration)
12. [Workflow Seed Registry](#12-workflow-seed-registry)
13. [Entity Reference](#13-entity-reference)
14. [Error Handling & Dead-Letter](#14-error-handling--dead-letter)

---

## 1. Architecture Overview

### 1.1 System Topology

```
┌─────────────────────────────────────────────────────────────────┐
│                        Nexus Core                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ Workflow      │  │ Event Ledger  │  │ Secret Store         │  │
│  │ Engine        │  │ (PostgreSQL)  │  │ (encrypted secrets)  │  │
│  └──────┬───────┘  └──────────────┘  └──────────────────────┘  │
│         │                                                      │
│  ┌──────▼──────────────────────────────────────────────────┐   │
│  │ Redis Stream: stream:core:lifecycle                     │   │
│  │ (workflow run lifecycle events)                         │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────▲──────────────────────────────────────┘
                          │ HTTP / Redis Stream
┌─────────────────────────┴──────────────────────────────────────┐
│                        apps/kanban                              │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Kanban NestJS Application                                 │ │
│  │  ┌────────────┐  ┌───────────┐  ┌───────────────┐         │ │
│  │  │ Orchestration│ │Dispatch   │  │ WorkItem      │         │ │
│  │  │ Service     │  │ Service   │  │ Service       │         │ │
│  │  └──────┬──────┘  └─────┬─────┘  └───────┬───────┘         │ │
│  │         │              │                 │                 │ │
│  │  ┌──────▼──────────────▼─────────────────▼───────┐         │ │
│  │  │  Core Integration Layer                        │         │ │
│  │  │  ├─ CoreLifecycleStreamConsumer (Redis poll)  │         │ │
│  │  │  ├─ CoreRunProjectionService (state sync)     │         │ │
│  │  │  └─ CoreWorkflowClientService (HTTP client)   │         │ │
│  │  └───────────────────────────────────────────────┘         │ │
│  │                                                             │ │
│  │  ┌──────────────┐  ┌───────────────┐  ┌───────────────┐   │ │
│  │  │ Review       │  │ Goals         │  │ MCP           │   │ │
│  │  │ Service      │  │ Service       │  │ Service       │   │ │
│  │  └──────────────┘  └───────────────┘  └───────────────┘   │ │
│  └────────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  PostgreSQL (kanban schema)                                │ │
│  │  ├─ kanban_work_items                                      │ │
│  │  ├─ kanban_projects                                        │ │
│  │  ├─ kanban_project_goals                                   │ │
│  │  ├─ kanban_orchestration                                   │ │
│  │  ├─ kanban_core_run_projections                            │ │
│  │  └─ kanban_core_lifecycle_dead_letter                      │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 Module Composition

```
AppModule
├── RequestContextModule          — Request-scoped context (user, tenant, correlation ID)
├── DatabaseModule                — TypeORM, all kanban entities & repositories
├── CoreIntegrationModule         — Core lifecycle event ingestion (Redis + HTTP)
├── ProjectModule                 — Project CRUD
├── ProjectGoalsModule            — Project goals & worklogs
├── WorkItemModule                — Work item CRUD, status transitions, subtasks
├── DispatchModule                — Work item dispatch, agent assignment
├── OrchestrationModule           — Project orchestration steering, startup routing
├── ReviewModule                  — Review/signoff delegation
└── KanbanMcpModule               — MCP tools for LLM agent interaction
```

### 1.3 Data Flow: Work Item Creation to Completion

```
[Agent/MCP/API]
     │
     ▼
┌──────────────────────┐
│ WorkItemService      │
│ createWorkItem()     │  status: "todo"
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ DispatchService      │
│ dispatchReadyWorkItem│  selects "todo" items
│ ()                   │  checks deps, capacity
└──────────┬───────────┘
           │
           ▼
┌──────────────────────────────────┐
│ CoreWorkflowClientService        │
│ requestWorkflowRun()             │  launches core workflow
│ (HTTP POST to Nexus Core)        │
└──────────┬───────────────────────┘
           │
           ▼
┌──────────────────────────────────┐
│ Nexus Core Workflow Engine       │
│ Executes workflow run            │  agent_profile: orchestrator
│ (work_item_in_progress_default)  │
└──────────┬───────────────────────┘
           │
           │ event → kanban.work_item.status_changed.v1
           ▼
┌──────────────────────────────────┐
│ CoreLifecycleStreamConsumer      │
│ Polls Redis stream               │
│ Consumes core.workflow.run.*     │
│ events                           │
└──────────┬───────────────────────┘
           │
           ▼
┌──────────────────────────────────┐
│ CoreRunProjectionService         │
│ Records projection               │  kanban_core_run_projections
└──────────┬───────────────────────┘
           │
           │ on completion: triggers
           │ requestOrchestrationCycle()
           ▼
┌──────────────────────────────────┐
│ OrchestrationService             │
│ Resolves startup route           │
│ Dispatches next work item        │
└──────────────────────────────────┘
```

---

## 2. Work Item Status Model

### 2.1 Valid Statuses

| Status           | Description                                      |
| ---------------- | ------------------------------------------------ |
| `backlog`        | Item is in the backlog, not yet planned          |
| `todo`           | Item is planned and ready for dispatch           |
| `refinement`     | Item is undergoing refinement (PM → Architect)   |
| `in-progress`    | Item is actively being implemented               |
| `in-review`      | Implementation complete, under QA review         |
| `ready-to-merge` | Review passed, ready for merge                   |
| `blocked`        | Item is blocked (can be entered from any status) |
| `done`           | Item is complete                                 |

### 2.2 Status Mutation Rules

Any known status may move to any other known status. Kanban validates that the requested target status is supported, persists actual changes, and emits lifecycle events after persistence. Process-specific routing decisions belong to workflows rather than a Kanban-owned transition graph.

Same-status updates for known statuses are non-saving, non-eventing no-ops. Unsupported status values are rejected, including unsupported same-status input.

### 2.3 Automation Trigger Mapping

Actual status changes emit one canonical lifecycle event: `kanban.work_item.status_changed.v1`. Seeded status workflows subscribe to that event and use trigger conditions on `status` to route the correct lifecycle workflow. Kanban no longer owns source-to-target routing policy.

| Status Payload               | Canonical Event                      | Lifecycle Workflow                 |
| ---------------------------- | ------------------------------------ | ---------------------------------- |
| `status == "refinement"`     | `kanban.work_item.status_changed.v1` | `work_item_refinement_default`     |
| `status == "in-progress"`    | `kanban.work_item.status_changed.v1` | `work_item_in_progress_default`    |
| `status == "in-review"`      | `kanban.work_item.status_changed.v1` | `work_item_in_review_default`      |
| `status == "ready-to-merge"` | `kanban.work_item.status_changed.v1` | `work_item_ready_to_merge_default` |

Same-status updates do not emit lifecycle events. Statuses without lifecycle automation are recorded as state changes without starting status-specific workflows.

### 2.4 Event Normalisation

Kanban no longer derives source-to-target transition policy from event names. The canonical status-change event carries `status` and `previousStatus`; workflow-owned trigger conditions decide which status workflow runs.

---

## 3. Core Services

### 3.1 WorkItemService (`src/work-item/work-item.service.ts`)

**Purpose**: Core CRUD, status transitions, run request orchestration, subtask management.

| Method                                                | Input                | Output                              | Purpose                                                                                                       |
| ----------------------------------------------------- | -------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `createWorkItem(project_id, input)`                   | `CreateWorkItemDto`  | `WorkItemRecord`                    | Create with status `todo`, priority `p2`, scope `standard`. Validates/stores dependencies, replaces subtasks. |
| `listWorkItems(project_id)`                           | `project_id`         | `WorkItemRecord[]`                  | List with dependencies and subtasks resolved.                                                                 |
| `listAllWorkItems()`                                  | —                    | `WorkItemRecord[]`                  | Cross-project query.                                                                                          |
| `updateStatus(project_id, workItemId, status)`        | `WorkItemStatus`     | `WorkItemRecord`                    | Validates known target status, persists actual status changes, emits lifecycle events after persistence.      |
| `dispatchWorkItem(project_id, workItemId, input)`     | —                    | `{ workItem, run_id, workflow_id }` | Delegates to `requestWorkItemRun()` with `action: "dispatch"`.                                                |
| `submitReviewDecision(project_id, workItemId, input)` | `decision: "approve" | "reject"`                           | `{ workItem, run_id, workflow_id }`                                                                           | Delegates to `requestWorkItemRun()` with `action: "review"`, `launchSource: "kanban_review"`. |
| `requestMerge(project_id, workItemId, input)`         | —                    | `{ workItem, run_id, workflow_id }` | Delegates to `requestWorkItemRun()` with `action: "merge"`, `launchSource: "kanban_merge"`.                   |
| `updateWorkItem(project_id, workItemId, data)`        | Partial update       | `WorkItemRecord`                    | Updates title, description, priority, scope, executionConfig, metadata, dependencies, subtasks.               |
| `getActiveAutomationStatuses(project_id)`             | `project_id`         | `string[]`                          | Returns deduplicated status list for all items in project.                                                    |
| `upsertExecutionConfig(project_id, workItemId, data)` | JSONB partial update | —                                   | Shallow merge into `execution_config`.                                                                        |

**Key internal method** — `buildWorkflowRunRequest()`:

- Constructs `WorkflowRunRequestV1` with `scopeId`, `contextId` (workItemId), `action`, `launch_source`, correlation/causation IDs, idempotency key, external MCP mounts.

### 3.2 DispatchService (`src/dispatch/dispatch.service.ts`)

**Purpose**: Central dispatch logic selecting ready work items and launching core workflow runs.

| Method                                  | Input                            | Output                                | Purpose                                                                |
| --------------------------------------- | -------------------------------- | ------------------------------------- | ---------------------------------------------------------------------- |
| `dispatchReadyWorkItems(input)`         | `DispatchInput`                  | `{ dispatched, skipped, reconciled }` | Main dispatch entry point with persisted dispatch confirmation fields. |
| `dispatchSelectedWorkItems(input)`      | `DispatchSelectedWorkItemsInput` | `{ dispatched, skipped, reconciled }` | Selection-scoped dispatch entry point used by the MCP tool and CEO.    |
| `requestOrchestrationCycle(project_id)` | `project_id`                     | —                                     | Emits `ProjectOrchestrationCycleRequestedEvent` to core.               |

> **Unified core.** Both `dispatchReadyWorkItems` and `dispatchSelectedWorkItems` are thin facades (~22 LOC each) that delegate to a single core function `dispatchWorkItems(deps, options)` in `apps/kanban/src/dispatch/dispatch-work-items.core.ts`. Mode-specific behavior (ready-mode vs selected-mode) is selected by `DispatchCoreOptions` flags (`selectedWorkItemIds`, `limit`/`slots`, `capacitySkipReason`, `causationIdPrefix`, `partialFailure`, `reconcileOrphans`, `releaseBranchOnFailure`, …) so there is one dispatch loop and one source of truth for skip-reason enum strings, idempotency-key formats, and `causation_id` formats. The legacy `dispatchSelectedWorkItems` pure-function module is retained as a back-compat wrapper used by the MCP tool spec surface and also delegates to the core. See `docs/plans/2026-06-23-dispatch-loop-unification.md`.

**`dispatchReadyWorkItems` flow** (branching conditions in order):

```
FOR each work_item IN sorted_candidates:
  1. core status available          → yes → continue, no → SKIP (core_status_unavailable)
  2. linked_run_id exists?          → yes → idempotent dispatch confirmation, no → continue
  3. status === "todo"              → yes → continue, no → SKIP (not_dispatchable_status)
  4. new-dispatch limit available?  → yes → continue, no → no fresh launch
  5. all deps done?                 → yes → continue, no → SKIP (dependencies_not_ready)
  6. agent capacity available?      → yes → continue, no → SKIP (agent_capacity_reached)
  7. → CALL coreClient.requestWorkflowRun()
     → link run to work item
     → add to dispatched
```

**Sorting**: Priority ascending (p0 → p3), then creation time ascending (FIFO).

**Capacity tracking**: Items with `linked_run_id` or `status === "in-progress"` count toward per-agent concurrency limit.

**Dispatch confirmations**: Each `dispatched[]` entry includes `workItemId`, `runId`, `linkedRunId`, `currentExecutionId`, `status`, `idempotent`, and `mutationConfirmed: true`. `mutationConfirmed` means the persisted dispatch state/linkage was confirmed. For `idempotent: true`, the item was already linked; do not treat it as a new mutation, and do not require non-`todo` status or non-null `currentExecutionId`. For `idempotent: false`, the service newly launched and linked a workflow run, so callers should expect `linkedRunId`, `currentExecutionId`, and `status` before claiming a new dispatch succeeded.

### 3.3 OrchestrationService (`src/orchestration/orchestration.service.ts`)

**Purpose**: Project orchestration lifecycle, decision logging, action request workflows, startup route selection.

| Method                                               | Purpose                                                                             |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `start(project_id, input)`                           | Start orchestration: resolve routing, select route, launch workflow, persist state. |
| `updateMode(project_id, mode)`                       | Update orchestration mode (autonomous/supervised/notifications_only).               |
| `pause(project_id)`                                  | Set status to `"paused"`.                                                           |
| `resume(project_id)`                                 | Set status to `"orchestrating"`.                                                    |
| `complete(project_id)`                               | Set status to `"completed"`.                                                        |
| `recordDecision(project_id, input)`                  | Append decision entry to `decision_log`.                                            |
| `requestAction(project_id, input)`                   | Create `ActionRequest` (status: `"pending"`).                                       |
| `approveActionRequest(project_id, requestId, input)` | Transition `"pending"` → `"approved"`.                                              |
| `rejectActionRequest(project_id, requestId, input)`  | Transition `"pending"` → `"rejected"`.                                              |
| `updateSpecsReady(project_id, specs_ready)`          | Set `readinessSignals.specs_ready` in orchestration metadata.                       |
| `getDiagnostics(project_id)`                         | Blocked status, reasons, decision count, pending actions, last decision.            |

**Orchestration status values**: `idle`, `initializing`, `awaiting_approval`, `bootstrapping`, `orchestrating`, `paused`, `completed`, `failed`.

**Orchestration mode values**: `autonomous`, `supervised`, `notifications_only`.

### 3.4 ReviewService (`src/review/review.service.ts`)

**Purpose**: Thin delegation layer for review decisions.

| Method                   | Delegates To                             |
| ------------------------ | ---------------------------------------- |
| `recordDecision(params)` | `WorkItemService.submitReviewDecision()` |

All review logic lives in `WorkItemService.submitReviewDecision()` which calls `requestWorkItemRun()` with `action: "review"`, `decision: "approve" | "reject"`, `launchSource: "kanban_review"`.

### 3.5 CoreRunProjectionService (`src/core/core-run-projection.service.ts`)

**Purpose**: Projects core workflow run lifecycle events into kanban's `core_run_projections` table.

| Method                                 | Purpose                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------ |
| `recordCoreLifecycleEvent(eventInput)` | Record event: parse/validate → idempotency check → stale check → persist projection. |
| `getProjection(runId)`                 | Get latest projection for a run.                                                     |
| `listByProject(project_id)`            | List projections for a project.                                                      |

**Idempotency**: If `existing.last_event_id === event.event_id`, no-op.

**Stale detection**: If incoming event timestamp < stored projection timestamp, no-op.

### 3.6 CoreLifecycleStreamConsumer (`src/core/core-lifecycle-stream.consumer.ts`)

**Purpose**: Polls Redis stream `stream:core:lifecycle` and reacts to events.

**Configuration**: Consumer group `core-lifecycle-projection`, poll interval 5000ms (configurable via `KANBAN_CORE_LIFECYCLE_POLL_INTERVAL_MS`).

**Event processing pipeline** (for each entry):

```
FOR each Redis stream entry:
  1. parse envelope (validate schema)
  2. IF event_type starts with "core.workflow.run.":
       → CoreRunProjectionService.recordCoreLifecycleEvent()
  3. IF event_type == "core.workflow.run.completed.v1" AND workItemId != "__orchestration_lifecycle__":
       → DispatchService.requestOrchestrationCycle(project_id)
  4. IF completed workflow is "project_discovery_ceo" or "project_spec_revision_ceo":
       → OrchestrationService.updateSpecsReady(project_id, true)
  5. save cursor position
  6. IF processing fails:
       → dead-letter to kanban_core_lifecycle_dead_letters
```

### 3.7 CoreWorkflowClientService (`src/core/core-workflow-client.service.ts`)

**Purpose**: HTTP client for core workflow API with JWT authentication.

| Method                                       | Core API Endpoint          |
| -------------------------------------------- | -------------------------- |
| `requestWorkflowRun(request)`                | Launch workflow run        |
| `getWorkflowRunStatus(runId, correlationId)` | Query run status           |
| `controlWorkflowRun(request)`                | Control run (pause/resume) |
| `cancelWorkflowRunsByScope(scopeId)`         | Cancel runs by scope       |
| `retrieveSecret(secretId)`                   | Retrieve encrypted secret  |
| `emitEventLedger(payload)`                   | Write to event ledger      |
| `emitDomainEvent(params)`                    | Emit domain event          |

**Authentication**:

- Static bearer token from `KANBAN_CORE_BEARER_TOKEN`, OR
- Dynamic JWT with roles `["Admin", "Developer"]`, service `"kanban"`, scopes `["core.events:write", "core.workflow-runs:read", "core.workflow-runs:write", "core.secrets:read"]`.

---

## 4. Startup Orchestration & Cycle Entry

### 4.1 Orchestration Start Flow

```
OrchestrationService.start(project_id)
  │
  ├─► resolveStartupContext()
  │     └─ Resolves sourceContext, readinessContext, startupHints from input/metadata.
  │
  ├─► omitStartupRouteMetadata()
  │     └─ Explicitly removes legacy selectedRoute and selectedRuleId from existing metadata.
  │
  ├─► buildRunRequest()
  │     └─ Constructs WorkflowRunRequestV1 for "project_orchestration_cycle_ceo".
  │
  └─► CoreWorkflowClientService.requestWorkflowRun()
        └─ Persists ProjectOrchestration state with linked_run_id.
```

### 4.2 The Role of the Cycle CEO and Advisor

Startup orchestration is no longer deterministic at the domain boundary. Instead, the **Project Orchestration Cycle (CEO)** workflow (`project_orchestration_cycle_ceo`) acts as the authoritative entry point.

1. **Cycle CEO Launch:** All orchestration starts (and resumes) by launching the Cycle CEO.
2. **State Analysis:** The Cycle CEO queries project state and orchestration history.
3. **Advisor Consultation:** For bootstrap gaps (no work items) or ambiguous state, it invokes the **Project Orchestration Advisor** (`project_orchestration_advisor`) for read-only evidence and recommendations.
4. **Autonomous Delegation:** The Cycle CEO decides the next step:
   - Invoke `project_discovery_ceo` for greenfield or imported-repo investigation.
   - Dispatch existing work items via `kanban.dispatch_selected_work_items`.
   - Reconcile specs via `kanban.publish_specs`.
   - Complete orchestration if goals are met.

---

## 5. Work Item Lifecycle Workflows

### 5.1 In-Progress Workflow (`work_item_in_progress_default`)

**Trigger**: `kanban.work_item.status_changed.v1` with `status == "in-progress"`.

**Purpose**: Implementation workflow for work items entering in-progress status.

#### Process Flow Diagram

```
                    ┌─────────────────────┐
                    │ provision_worktree   │  (git_operation)
                    └──────────┬──────────┘
                               │
                               ▼
              ┌──────────────────────────────┐
              │ scope == 'large'             │
              │ AND no implementationPlan?   │
              ├──────────────────────────────┤
              │ YES → plan_implementation    │  (architect-agent)
              │        │                     │
              │        ▼                     │
              │        persist_plan          │  (mcp_tool_call)
              │        │                     │
              │        ▼                     │
              │     [plan exists]            │
              │ NO ──────────────────┐       │
              └──────────────────────┼───────┘
                                     │
              ┌──────────────────────▼───────┐
              │ has failedDeliverables?      │
              ├──────────────────────────────┤
              │ YES → check_repeated_failures│  (qa_automation)
              │        │                    │
              │        ▼                    │
              │     should_escalate?        │
              │     ├─ YES → escalate       │  → blocked (needs-rework)
              │     └─ NO  ─────────────┐   │
              │ NO ────────────────────┤   │
              └────────────────────────┼───┘
                                     │
              ┌──────────────────────▼───────┐
              │ has plan?                    │
              │ AND has rejections?          │
              │ AND NOT escalated?           │
              ├──────────────────────────────┤
              │ YES → delta_replan           │  (architect-agent)
              │        │                    │
              │        ▼                    │
              │        persist_delta_plan   │  (mcp_tool_call)
              │        │                    │
              │        ▼                    │
              │     [delta plan exists]     │
              │ NO ──────────────────┐       │
              └──────────────────────┼───────┘
                                     │
              ┌──────────────────────▼───────┐
              │ NOT escalated?               │
              │ AND (large scope OR          │
              │    has delta plan)?          │
              ├──────────────────────────────┤
              │ YES → war_room_plan_alignment│  (architect-agent, 4 loops)
              │        │                    │
              │        ▼                    │
              │     converge               │
              │ NO ───────────────────┐     │
              └───────────────────────┼─────┘
                                     │
              ┌──────────────────────▼───────┐
              │ NOT escalated?               │
              ├──────────────────────────────┤
              │ YES → implement_and_commit   │  (orchestrator, 5 loops)
              │        │                    │
              │        ▼                    │
              │        transition_to_review  │  → in-review
              │        │                    │
              │        ▼                    │
              │     workitem complete        │
              │ NO ────────────────────┐    │
              └────────────────────────┼────┘
                                     │ (escalated)
              ┌──────────────────────▼───────┐
              │ blocked (needs-rework)       │
              └──────────────────────────────┘
```

#### Branching Logic Summary

| Condition                                         | Path                    | Outcome                                               |
| ------------------------------------------------- | ----------------------- | ----------------------------------------------------- |
| `scope == 'large'` AND no plan                    | Plan first              | Architect creates implementation plan, then continues |
| Has `failedDeliverables`                          | Check repeated failures | QA decides if escalation needed                       |
| Repeated AC failures → `should_escalate`          | Escalation              | → `blocked` status with `needs-rework`                |
| Has plan + rejections + NOT escalated             | Delta replan            | Architect creates delta plan, continues               |
| NOT escalated AND (large scope OR has delta plan) | War room alignment      | Architect alignment before implementation             |
| NOT escalated                                     | Implement               | Commit loop → transition to `in-review`               |

#### Output Contract

No structured output contract — the workflow's purpose is state transition to `in-review`.

### 5.2 In-Review Workflow (`work_item_in_review_default`)

**Trigger**: `kanban.work_item.status_changed.v1` with `status == "in-review"`.

**Purpose**: QA review for work items in review status.

#### Process Flow Diagram

```
                    ┌─────────────────────┐
                    │ review_work_item     │  (qa_automation)
                    │                     │  output:
                    │  decision           │    decision,
                    │  feedback           │    feedback,
                    │  failed_deliverables│    failed_deliverables
                    └──────────┬──────────┘
                               │
                               ▼
              ┌──────────────────────────────┐
              │ record_qa_feedback           │  (kanban.work_item_append_metadata_array)
              └──────────┬───────────────────┘
                         │
                         ▼
              ┌──────────────────────────────┐
              │ decision == 'reject'?        │
              ├──────────────────────────────┤
              │ YES → record_failed_deliverables │
              │                     │          │  (kanban.work_item_patch_execution_config)
              │                     ▼          │
              │                    converge     │
              │ NO  ──────────────────┐         │
              └───────────────────────┼─────────┘
                                      │
              ┌───────────────────────▼─────────┐
              │ apply_qa_decision               │
              │ (kanban.work_item_transition)   │
              │                                   │
              │  decision = 'accept' → ready-to-merge │
              │  decision = 'reject' → in-progress  │
              └───────────────────────────────────┘
```

#### Branching Logic Summary

| QA Decision | Transition                   | Outcome                                 |
| ----------- | ---------------------------- | --------------------------------------- |
| `accept`    | `in-review → ready-to-merge` | Triggers merge workflow                 |
| `reject`    | `in-review → in-progress`    | Returns to implementation with feedback |

#### Output Contract

| Field                 | Required    | Description                                         |
| --------------------- | ----------- | --------------------------------------------------- |
| `decision`            | Yes         | `"accept"` or `"reject"`                            |
| `feedback`            | Yes         | Review feedback text                                |
| `failed_deliverables` | Conditional | List of failed deliverable paths (only if rejected) |

### 5.3 Ready-to-Merge Workflow (`work_item_ready_to_merge_default`)

**Trigger**: `kanban.work_item.status_changed.v1` with `status == "ready-to-merge"`.

**Purpose**: Auto-merge for work items that passed review.

#### Process Flow Diagram

```
                    ┌─────────────────────┐
                    │ attempt_merge        │  (git_operation)
                    │                     │  transitions:
                    │                     │    succeeded → submit_clean_merge
                    │                     │    conflict → resolve_local_conflicts
                    │                     │    auth_error/failed → emit_merge_failed
                    └──────────┬──────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
      succeeded ▼        conflict ▼      auth_error/failed ▼
      ┌──────────────┐  ┌──────────────┐   ┌──────────────┐
      │submit_clean   │  │resolve_local │   │emit_merge_   │
      │_merge         │  │_conflicts     │   │failed        │
      └──────┬─────────┘  └──────┬───────┘   └──────┬───────┘
             │                   │                   │
             ▼                   ▼                   ▼
      ┌──────────────┐  ┌──────────────┐   ┌──────────────┐
      │validate_merge │  │validate      │   │terminate_    │
      │              │  │_merge         │   │failed_merge  │
      └──────┬────────┘  └──────┬───────┘   └──────────────┘
             │                   │
     ┌───────┴────────┐   ┌─────┴──────┐
     │                │   │            │
 succeeded ▼      conflict ▼       fail ▼
 ┌──────────────┐ ┌─────────────┐ ┌──────────┐
 │record_merge_ │ │resolve_remote │ │emit_     │
 │metadata_conflict│ _conflicts    │merge_failed│
 └──────┬───────┘ └──────┬───────┘ └──────────┘
        │                │
        ▼                ▼
 ┌─────────────┐  ┌──────────────┐
 │transition_  │  │validate_merge│
 │done_conflict│  │_after_remote  │
 └──────┬──────┘  └──────┬───────┘
        │                │
 ┌──────┴────────┐   ┌───┴────────────┐
 │               │   │                │
 succeeded ▼  conflict/failed ▼  ┌───────────┐
record_merge_ │emit_merge_       │terminate_ │
metadata_conflict│failed          │failed_merge│
 └──────┬──────┘ └───────────────┘ └───────────┘
        │
        ▼
 ┌──────────────┐
 │transition_   │
 │done_clean     │
 └──────┬────────┘
        │
        ▼
 ┌──────────────┐
 │emit_merge_   │
 │completed_    │
 │clean          │
 └──────┬────────┘
        │
        ▼
 ┌──────────────┐
 │cleanup_      │
 │worktree_clean │
 └──────────────┘
```

#### Branching Logic Summary

| Merge Outcome                | Path                                                                                                         | Outcome                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| Clean merge                  | `submit_clean → record → transition → emit → cleanup`                                                        | Work item → `done`                       |
| Local conflict → resolved    | `resolve_local → validate → record_conflict → transition → emit → cleanup`                                   | Work item → `done` (with conflict noted) |
| Remote conflict → resolved   | `resolve_local → validate → resolve_remote → validate_after → record_conflict → transition → emit → cleanup` | Work item → `done`                       |
| Remote conflict → unresolved | `resolve_local → validate → resolve_remote → emit_failed → terminate`                                        | Work item remains `ready-to-merge`       |
| Auth error / initial failure | `emit_merge_failed → terminate`                                                                              | Work item remains `ready-to-merge`       |

#### Output Contract

Events emitted:

- `WorkItemMergeCompletedEvent` (clean or conflict)
- `WorkItemMergeFailedEvent` (failed)

### 5.4 Refinement Workflow (`work_item_refinement_default`)

**Trigger**: `kanban.work_item.status_changed.v1` with `status == "refinement"` and a condition preventing redundant refinements.

**Purpose**: PM → Architect refinement for work items entering refinement status.

#### Process Flow Diagram

```
                    ┌──────────────────────┐
                    │ codebase_analysis     │  (architect-agent)
                    └──────────┬───────────┘
                               │
                               ▼
              ┌──────────────────────────────┐
              │ pm_refinement               │  (product-manager)
              │                              │  output:
              │                              │    pm_summary,
              │                              │    acceptance_clarifications
              └──────────┬───────────────────┘
                         │
                         ▼
              ┌──────────────────────────────┐
              │ persist_pm_artifacts          │  (mcp_tool_call)
              └──────────┬───────────────────┘
                         │
                         ▼
              ┌──────────────────────────────┐
              │ war_room_refinement_alignment │  (ceo-agent, 4 loops)
              │                               │  align PM + Architect
              └──────────┬───────────────────┘
                         │
                         ▼
              ┌──────────────────────────────┐
              │ architect_refinement          │  (architect-agent)
              │                               │  output:
              │                               │    architect_summary,
              │                               │    sdd_targets,
              │                               │    split_recommendation,
              │                               │    subtask_blueprint,
              │                               │    [optional] implementation_plan,
              │                               │    split_children,
              │                               │    omission_reason,
              │                               │    risk_level
              └──────────┬───────────────────┘
                         │
                         ▼
              ┌──────────────────────────────┐
              │ persist_architect_artifacts   │  (mcp_tool_call)
              └──────────┬───────────────────┘
                         │
              ┌──────────┴──────────────────┐
              │                               │
     split_required ▼                  NOT   │
     ┌────────────────────┐                 │
     │ resolve_split       │                 │
     │                    │                 │
     │ materialize_split_ │                 │
     │ _children          │                 │
     │ (for_each)         │                 │
     └────────┬───────────┘                 │
              │                              │
              │              ┌───────────────┤
              │              │               │
              │    NOT split ▼               │
              │    required                  │
              │                              │
              │   ┌──────────────────────┐   │
              │   │ validate_subtask_    │   │
              │   │ _blueprint           │   │
              │   └────────┬─────────────┘   │
              │            │                  │
              │            ▼                  │
              │   ┌──────────────────────┐   │
              │   │ materialize_          │   │
              │   │ refinement_subtasks   │   │
              │   │ (for_each)            │   │
              │   └────────┬─────────────┘   │
              │            │                  │
              │            ▼                  │
     ┌────────┴────────────┤                  │
     │                      ▼                  │
     │   persist_subtask_materialization_       │
     │   errors (if materialize failed)         │
     │                                          │
     │   persist_implementation_plan (if has)   │
     │   plan_validation (if has, qa_automation)│
     │   validate_exit (all gates pass?)        │
     │   mark_complete (if gates pass)          │
     │   transition_to_todo                     │
     └──────────────────────────────────────────┘
```

#### Branching Logic Summary

| Condition                       | Path                    | Outcome                                   |
| ------------------------------- | ----------------------- | ----------------------------------------- |
| `split_required` from architect | Split children          | Materialize child work items              |
| NOT `split_required`            | Subtask materialization | Validate blueprint → materialize subtasks |
| Has `implementation_plan`       | Persist + validate      | QA validates plan                         |
| All exit gates pass             | Mark complete → `todo`  | Item ready for dispatch                   |
| Exit gates fail                 | No transition           | Item stays in `refinement`                |

#### Output Contract

| Field                       | Required    | Source                                |
| --------------------------- | ----------- | ------------------------------------- |
| `pm_summary`                | Yes         | PM refinement agent                   |
| `acceptance_clarifications` | Yes         | PM refinement agent                   |
| `architect_summary`         | Yes         | Architect refinement agent            |
| `sdd_targets`               | Yes         | Architect refinement agent            |
| `split_recommendation`      | Yes         | Architect refinement agent            |
| `subtask_blueprint`         | Yes         | Architect refinement agent            |
| `implementation_plan`       | Conditional | Architect refinement agent (optional) |
| `split_children`            | Conditional | Architect refinement agent (if split) |
| `omission_reason`           | Conditional | Architect refinement agent            |
| `risk_level`                | Conditional | Architect refinement agent            |

### 5.5 Split Workflow (`work_item_split_default`)

**Trigger**: `kanban.work_item.status_changed.v1` with `status == "refinement"` and a large-scope condition.

**Purpose**: Decompose large-scope work items into child items. The agent self-validates acceptance-criteria (AC) coverage before publishing, so a failed split leaves no orphaned children.

#### Process Flow Diagram

```
                    ┌──────────────────────┐
                    │ split_work_item       │  (architect-agent)
                    │                      │  1. Design child partition
                    │                      │  2. Call work_item_validate_split_coverage
                    │                      │     (fix violations, repeat until ok)
                    │                      │  3. Publish child specs (only after 2 passes)
                    │                      │  output:
                    │                      │    split_outcome
                    │                      │    child_ids
                    │                      │    child_files
                    └──────────┬───────────┘
                               │
                    ┌──────────┴───────────┐
                    │ validate_split_       │  (downstream guard)
                    │ coverage             │
                    └──────────┬───────────┘
                               │
                    ┌──────────┴───────────┐
                    │ split_outcome ==      │
                    │ 'split_completed'?   │
                    ├──────────────────────┤
                    │ YES                  │
                    │                      │
                    ▼                      │
     ┌──────────────────────┐              │
     │ mark_parent_as_umbrella│             │
     └──────────┬───────────┘              │
                │                          │
                ▼                          │
     ┌──────────────────────┐              │
     │ mark_parent_blocked_  │              │
     │ _awaiting_children   │              │
     └──────────────────────┘              │
     (parent becomes umbrella             │
      tracker, never implements)           │
     NO ──────────────────────────────────┘
```

#### Branching Logic

| `split_outcome`   | Action                                                |
| ----------------- | ----------------------------------------------------- |
| `split_completed` | Parent marked as umbrella + blocked awaiting children |
| Other             | No action taken                                       |

#### Validation and Repair

The split agent calls `kanban.work_item_validate_split_coverage` **in-loop** before publishing child specs. It fixes any violations (duplicate ACs, uncovered parent ACs, unknown ACs) and retries the call until the tool returns `{ "ok": true }`. Child specs are written and published only after this in-loop validation passes, so a failed split leaves no orphaned children in the Kanban DB.

If the downstream `validate_split_coverage` guard still fails (e.g. if the agent ran without the self-validation step), the workflow repair engine classifies it as `split_coverage_invalid` — a recoverable class that re-dispatches the upstream producer job with the validation violation as feedback, rather than routing to a human.

#### Output Contract

| Field                  | Required | Description                                       |
| ---------------------- | -------- | ------------------------------------------------- |
| `split_outcome`        | Yes      | Result of split operation                         |
| `child_ids`            | Yes      | UUIDs of created child work items                 |
| `child_files`          | Yes      | File paths from children                          |
| `parent_ac_ids`        | Yes      | All parent AC ids used for coverage validation    |
| `child_ac_assignments` | Yes      | Per-child AC assignments validated before publish |

---

## 6. Merge Workflow

### 6.1 Complete Merge Path Diagram

See Section 5.3 (Ready-to-Merge Workflow) for the detailed process flow.

### 6.2 Merge Outcome Paths

```
attempt_merge
    │
    ├── succeeded ──► submit_clean_merge ──► record_clean ──► transition_done_clean ──► emit_clean ──► cleanup_clean ──► [done]
    │
    ├── conflict ──► resolve_local_conflicts (architect, 1 retry)
    │     │
    │     ├── succeeded ──► validate_merge
    │     │     │
    │     │     ├── succeeded ──► record_conflict ──► transition_done_conflict ──► emit_conflict ──► cleanup_conflict ──► [done]
    │     │     │
    │     │     └── conflict ──► resolve_remote_conflicts (architect, 1 retry)
    │     │           │
    │     │           ├── succeeded ──► validate_merge_after_remote
    │     │           │     │
    │     │           │     ├── succeeded ──► record_conflict ──► transition_done_conflict ──► emit_conflict ──► cleanup_conflict ──► [done]
    │     │           │     │
    │     │           │     └── conflict/auth_error/failed ──► emit_failed ──► terminate ──► [ready-to-merge]
    │     │           │
    │     │           └── failed ──► emit_failed ──► terminate ──► [ready-to-merge]
    │     │
    │     └── failed ──► emit_failed ──► terminate ──► [ready-to-merge]
    │
    └── auth_error ──► emit_failed ──► terminate ──► [ready-to-merge]
```

---

## 7. Refinement Workflow

### 7.1 Complete Refinement Path Diagram

See Section 5.4 (Refinement Workflow) for the detailed process flow.

### 7.2 Refinement Exit Gates

| Gate                           | Condition                | Action if Fail                                     |
| ------------------------------ | ------------------------ | -------------------------------------------------- |
| Subtask blueprint validation   | Blueprint valid          | Stay in `refinement`                               |
| Implementation plan validation | Plan valid (if has plan) | Stay in `refinement`                               |
| All gates pass                 | All pass                 | `mark_refinement_completed` → `transition_to_todo` |

### 7.3 Split vs Subtask Path Decision

```
architect_refinement output:
    split_recommendation.split_required?
        YES → Split path: materialize child work items
        NO  → Subtask path: validate blueprint → materialize subtasks
```

---

## 8. Split Workflow

### 8.1 Split Process

See Section 5.5 (Split Workflow) for the detailed process flow.

### 8.2 Split Outcome Handling

| Outcome           | Parent Status                                      | Children Status         |
| ----------------- | -------------------------------------------------- | ----------------------- |
| `split_completed` | `blocked` (awaiting children) + marked as umbrella | Created as `todo` items |
| Other             | No change                                          | No children created     |

---

## 9. Dispatch & Orchestration Cycle

### 9.1 Orchestration Cycle Flow

```
[Trigger: core.workflow.run.completed.v1]
  │
  ▼
CoreLifecycleStreamConsumerService
  │ detects completion of non-orchestration run
  │
  ▼
DispatchService.requestOrchestrationCycle(project_id)
  │
  ▼
Emits ProjectOrchestrationCycleRequestedEvent → Nexus Core
  │
  ▼
Triggers project_orchestration_cycle_ceo workflow
  │
  ▼
CEO Agent makes orchestration decision:
  ├─ Dispatch next work items → WorkItemDispatchSelectEvent
  ├─ Request refinement → ProjectOrchestrationRefinementRequestedEvent
  ├─ Request specs revision → ProjectOrchestrationRevisionRequestedEvent
  └─ Complete orchestration → ProjectOrchestrationCompletedEvent
```

Loop guard for bootstrap gaps: if persisted goals exist but no work items exist, the CEO may invoke `project_discovery_ceo` only when recent discovery/hydration evidence allows a retry. If a recent imported-repo hydration ended blocked or returned `ready_for_cycle: false`, the CEO must not relaunch discovery indefinitely; it must report the blocked state via `kanban.orchestration_complete` or the relevant orchestration output fields.

Imported-repo discovery event gates: for imported-repo routes, `project_discovery_ceo` emits specs-ready and cycle-request events only when the child hydration workflow returns JSON boolean `ready_for_cycle: true`. The gate does not rely on an LLM-reported `existing_work_item_count`; that count must be derived from `project_state.workItems.length` only.

### 9.2 Dispatch Flow

`dispatched[]` rows are confirmation records, not just run IDs. Each row carries `mutationConfirmed: true`, `linkedRunId`, `currentExecutionId`, `status`, and `idempotent`. An `idempotent: true` row confirms already-linked work and may have no new mutation, `status: "todo"`, or `currentExecutionId: null`; an `idempotent: false` row represents a newly launched dispatch and should include linkage/execution/status evidence before callers claim a new dispatch succeeded.

```
DispatchService.dispatchReadyWorkItems(input)
  │
  ├─► Fetch project work items
  ├─► Fetch dependencies
  │
  ├─► IF reconcileRunStatus == true:
  │     Reconcile linked runs (query core for terminal status)
  │     Clear linked_run_id if terminal
  │
  ├─► Sort candidates: priority (p0→p3) then created_at ASC (FIFO)
  │
  └─► FOR each candidate:
        1. core available? → yes
        2. linked_run_id exists? → idempotent dispatch confirmation
        3. status == "todo"? → yes
        4. new-dispatch limit available? → yes
        5. dependencies ready? → yes (all deps == "done")
        6. agent capacity OK? → yes
        7. → launch core workflow run
           → link run to work item
           → continue traversal for non-launch confirmations/skips
```

### 9.3 Work Item Dispatch Auto-Dispatch (`work_item_todo_dispatch_default`)

**Trigger**: Event `WorkItemDispatchSelectEvent`

**Purpose**: Event-driven dispatcher that selects which `todo` work item(s) to start.

**Selection policy** (priority order):

1. Higher `criticalPathLength` first
2. Higher priority (p0 before p1, etc.)
3. Lower `topologicalLevel` first
4. Candidate order (creation order)

**Agent**: Light agent profile (dispatch selector)

**Action**: Kanban-owned MCP tool: `kanban.dispatch_selected_work_items`

---

## 10. Core Lifecycle Integration

### 10.1 Event Projection Flow

```
Nexus Core → Redis stream:core:lifecycle
  │
  ▼
CoreLifecycleStreamConsumerService (polls every 5s)
  │
  ├─► Parse envelope (validate CoreWorkflowEventEnvelopeV1Schema)
  │
  ├─► IF event_type == "core.workflow.run.completed.v1":
  │     └─► IF workItemId != "__orchestration_lifecycle__":
  │            DispatchService.requestOrchestrationCycle(project_id)
  │
  ├─► IF event_type starts with "core.workflow.run.":
  │     └─► CoreRunProjectionService.recordCoreLifecycleEvent()
  │           ├─ Idempotency: skip if event_id already stored
  │           ├─ Stale detection: skip if timestamp older
  │           └─ Persist to kanban_core_run_projections
  │
  ├─► IF completed workflow in [project_discovery_ceo, project_spec_revision_ceo]:
  │     └─► OrchestrationService.updateSpecsReady(project_id, true)
  │
  ├─► Save cursor position
  │
  └─► IF processing fails:
        └─► Dead-letter to kanban_core_lifecycle_dead_letters
```

### 10.2 Core Run Projection Schema

| Field           | Type      | Description                     |
| --------------- | --------- | ------------------------------- |
| `runId`         | UUID      | Core workflow run ID            |
| `workflowId`    | string    | Workflow that produced this run |
| `status`        | string    | Current run status              |
| `project_id`    | UUID      | Associated project              |
| `workItemId`    | UUID      | Associated work item            |
| `occurredAt`    | timestamp | Event timestamp                 |
| `lastEventId`   | string    | Last processed event ID         |
| `lastEventType` | string    | Last event type                 |

### 10.3 Dead-Letter Queue

| Field          | Type      | Description              |
| -------------- | --------- | ------------------------ |
| `id`           | UUID      | Dead-letter entry ID     |
| `stream_id`    | string    | Original Redis stream ID |
| `event_data`   | JSONB     | Original event envelope  |
| `error_reason` | text      | Why processing failed    |
| `created_at`   | timestamp | When dead-lettered       |

---

## 11. MCP Tools & Agent Integration

### 11.1 MCP Architecture

```
LLM Agent
    │
    ▼
KanbanMcpController (MCP transport)
    │
    ▼
KanbanMcpService
    │
    ├─► listTools() → discover registered tool handlers
    │
    └─► callTool(toolName, args, context)
          ├─► Lookup handler by tool name
          ├─► Execute with InternalToolExecutionContext
          │     (workflowRunId, scopeId)
          ├─► Audit result (KanbanMcpAuditService)
          └─► Return result
```

### 11.2 MCP Tools Catalog

#### Read Tools

| Tool Name                | Purpose                       | Key Parameters             |
| ------------------------ | ----------------------------- | -------------------------- |
| `project-state`          | Get project state             | `project_id`, `brief`      |
| `work-items`             | List work items for a project | `project_id`               |
| `work-item`              | Get single work item          | `project_id`, `workItemId` |
| `todo-list`              | List todo items               | `contextId` (scope)        |
| `project-brief`          | Get project brief             | `project_id`               |
| `goals`                  | Get project goals             | `project_id`               |
| `orchestration-timeline` | Get orchestration timeline    | `project_id`               |

#### Mutation Tools

| Tool Name                              | Purpose                                                | Key Parameters                                                          |
| -------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------- |
| `work-item-create`                     | Create work item                                       | `project_id`, `title`, `description`, etc.                              |
| `work-item-update`                     | Full update                                            | `project_id`, `workItemId`, full item data                              |
| `work-item-patch`                      | Partial update                                         | `project_id`, `workItemId`, partial data                                |
| `work-item-patch-metadata`             | Patch metadata only                                    | `project_id`, `workItemId`, `metadata`                                  |
| `work-item-append-metadata-array`      | Append to metadata array                               | `project_id`, `workItemId`, `key`, `value`                              |
| `work-item-patch-execution-config`     | Patch execution config                                 | `project_id`, `workItemId`, `executionConfig`                           |
| `work-item-transition-status`          | Transition status                                      | `project_id`, `workItemId`, `status` (underscores → hyphens)            |
| `review-decision`                      | Submit review decision                                 | `project_id`, `workItemId`, `decision`                                  |
| `work-item-subtask-upsert`             | Upsert subtasks                                        | `project_id`, `workItemId`, `subtasks`                                  |
| `work-item-subtask-validate-blueprint` | Validate subtask blueprint                             | `project_id`, `workItemId`, `subtasks`                                  |
| `orchestration-complete`               | Complete orchestration                                 | `project_id`                                                            |
| `publish-specs`                        | Reconcile markdown work-item specs into Kanban DB rows | `project_id`, `scope_id` alias, `spec_directory`, `allow_missing_specs` |

#### Publish-Specs Tools

| Tool Name       | Purpose                                                                                                                                |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `publish-specs` | Database-only reconciliation of `docs/work-items/**/*.md` specs into Kanban work items. It does not commit, merge, or manage branches. |

`publish-specs` contract:

- Use `project_id` as the canonical project parameter. `scope_id` is accepted only as a compatibility alias.
- `spec_directory` defaults to `docs/work-items`; workflows that edit a provisioned worktree should pass the worktree-specific `.../docs/work-items` path.
- `allow_missing_specs: true` allows a structured no-op only for a missing spec directory and returns reason `missing_spec_directory`.
- Direct result fields include `ok`, `project_id`, `spec_directory`, `spec_count`, `created_count`, `updated_count`, `unchanged_count`, `archived_count`, `errored_count`, `skipped_count`, `errors`, and `reason` when relevant.
- Created and updated work items preserve source metadata including `metadata.workItemMarkdownPath`, `metadata.sourcePath`, `metadata.sourceHash`, `metadata.sourceId`, and author-supplied frontmatter metadata.
- Supported frontmatter includes `item_id`, `priority`, `scope`, optional `status`, `depends_on_item_ids`/dependency source IDs, `agent_profile`, `base_branch`, `target_branch`, `context_files`, and custom metadata.
- Status frontmatter is for intentional bootstrap/import state only. Existing work-item status changes go through `WorkItemService.updateStatus()` instead of being patched directly. Known statuses can move flexibly; failures are unsupported status values or other persistence/runtime errors.
- Malformed files are reported per file while valid files continue reconciling.

### 11.3 Tool Execution Context

Each tool call receives:

- `correlationId`: Request correlation ID
- `workflowRunId`: Running workflow's ID
- `stepId`: Current step ID
- `scopeId`: Derived from `correlationId`

### 11.4 Audit Events

| Event Type                  | When Emitted             |
| --------------------------- | ------------------------ |
| `kanban.mcp.tool.succeeded` | Tool execution succeeded |
| `kanban.mcp.tool.failed`    | Tool execution failed    |

---

## 12. Workflow Seed Registry

### 12.1 Seed Loading Mechanism

**Service**: `WorkflowSeedService` in `apps/api/src/database/seeds/workflows.seed.ts`

**Search paths** (checked in order):

1. `NEXUS_WORKFLOWS_SEED_PATH` environment variable
2. `seed/workflows/` (relative to cwd)
3. Parent `seed/workflows/` directory
4. `src/workflows/` (relative to cwd)

**Loading logic**: Recursively finds all `*.workflow.yaml` files → parses with `WorkflowParserService.parseWorkflow()` → creates `WorkflowDefinitionEntity` with `raw_yaml`, parsed definition, `status: 'active'`.

### 12.2 Complete Workflow Registry (28 workflows)

| #   | Workflow ID                             | Trigger                                                                      | Agent                             | Purpose                               |
| --- | --------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------- | ------------------------------------- |
| 1   | `project_discovery_ceo`                 | `ProjectOrchestrationStartedEvent`                                           | ceo-agent                         | Project discovery and spec generation |
| 2   | `project_spec_revision_ceo`             | `ProjectOrchestrationRevisionRequestedEvent`                                 | ceo-agent                         | Spec revision with war-room alignment |
| 3   | `project_work_item_generation_ceo`      | `ProjectOrchestrationApprovalGrantedEvent`                                   | spec-generator                    | Bootstrap work item generation        |
| 4   | `project_orchestration_cycle_ceo`       | `ProjectOrchestrationCycleRequestedEvent`                                    | ceo-agent (heavy)                 | Orchestration cycle decision          |
| 5   | `project_orchestration_refinement_ceo`  | `ProjectOrchestrationRefinementRequestedEvent`                               | ceo-agent                         | Mid-flight refinement                 |
| 6   | `project_codebase_deep_investigation`   | Manual                                                                       | investigation-coordinator         | Codebase deep investigation           |
| 7   | `imported_repo_synthesis_and_hydration` | Manual                                                                       | ceo-agent                         | Synthesize and hydrate imported repo  |
| 8   | `orchestration_invoke_agent_default`    | Programmatic                                                                 | dynamic                           | Generic agent invocation              |
| 9   | `work_item_in_progress_default`         | `kanban.work_item.status_changed.v1` (`status == "in-progress"`)             | orchestrator                      | Implementation workflow               |
| 10  | `work_item_in_review_default`           | `kanban.work_item.status_changed.v1` (`status == "in-review"`)               | qa_automation                     | QA review workflow                    |
| 11  | `work_item_ready_to_merge_default`      | `kanban.work_item.status_changed.v1` (`status == "ready-to-merge"`)          | architect                         | Auto-merge workflow                   |
| 12  | `work_item_refinement_default`          | `kanban.work_item.status_changed.v1` (`status == "refinement"`)              | product-manager + architect + ceo | PM→Architect refinement               |
| 13  | `work_item_split_default`               | `kanban.work_item.status_changed.v1` (`status == "refinement"`, large scope) | architect                         | Large-scope decomposition             |
| 14  | `work_item_todo_dispatch_default`       | `WorkItemDispatchSelectEvent`                                                | dispatch selector                 | Auto-dispatch todo items              |
| 15  | `work_item_post_merge_spec_hydration`   | `WorkItemMergeCompletedEvent`                                                | orchestrator                      | Post-merge spec hydration             |
| 16  | `standard_feature_flow`                 | Manual (with inputs)                                                         | ceo-agent (pipeline)              | Standard feature delivery pipeline    |
| 17  | `hotfix_flow`                           | Manual (with inputs)                                                         | ceo-agent (pipeline)              | Hotfix fast-path delivery             |
| 18  | `documentation_audit`                   | Manual (with inputs)                                                         | staff_engineer                    | Documentation audit                   |
| 19  | `conversational_artifact_steering`      | Manual (with inputs)                                                         | ceo-agent + software-engineer     | Conversational artifact steering      |
| 20  | `workflow_yaml_enhancements_demo`       | Manual (with inputs)                                                         | —                                 | YAML enhancements demo                |
| 21  | `workflow_failure_doctor`               | Manual (with inputs)                                                         | qa_automation                     | Workflow failure diagnosis            |
| 22  | `workflow_environment_repair`           | `workflow.repair-delegation.sysadmin.requested`                              | sysadmin-repair                   | Environment repair                    |
| 23  | `chat_direct_agent_default`             | Programmatic                                                                 | dynamic                           | Chat direct agent invocation          |
| 24  | `automated_quality_check`               | `QualityCheckRequestedEvent`                                                 | qa_automation                     | Automated QA check                    |
| 25  | `project_retrospective_autorun`         | `ProjectOrchestrationCompletedEvent`                                         | —                                 | Retrospective checkpoint              |
| 26  | `project_generate_agents_md`            | Manual                                                                       | senior_dev                        | AGENTS.md authoring and merge         |
| 27  | `todo_web_app_test_workflow`            | (test)                                                                       | testing-agent                     | Test delivery workflow                |
| 28  | `web_search_tool_test_workflow`         | (test)                                                                       | testing-agent                     | Tool registration test                |

### 12.3 Kanban-Specific Workflows (12)

These workflows are directly triggered by kanban events or used in kanban processes:

| Workflow                               | Trigger                                                                      | Kanban Role             |
| -------------------------------------- | ---------------------------------------------------------------------------- | ----------------------- |
| `work_item_in_progress_default`        | `kanban.work_item.status_changed.v1` (`status == "in-progress"`)             | Implementation          |
| `work_item_in_review_default`          | `kanban.work_item.status_changed.v1` (`status == "in-review"`)               | QA Review               |
| `work_item_ready_to_merge_default`     | `kanban.work_item.status_changed.v1` (`status == "ready-to-merge"`)          | Auto-Merge              |
| `work_item_refinement_default`         | `kanban.work_item.status_changed.v1` (`status == "refinement"`)              | PM→Architect Refinement |
| `work_item_split_default`              | `kanban.work_item.status_changed.v1` (`status == "refinement"`, large scope) | Scope Decomposition     |
| `work_item_todo_dispatch_default`      | `WorkItemDispatchSelectEvent`                                                | Auto-Dispatch           |
| `work_item_post_merge_spec_hydration`  | `WorkItemMergeCompletedEvent`                                                | Post-Merge Hydration    |
| `project_discovery_ceo`                | `ProjectOrchestrationStartedEvent`                                           | Startup Discovery       |
| `project_spec_revision_ceo`            | `ProjectOrchestrationRevisionRequestedEvent`                                 | Spec Revision           |
| `project_work_item_generation_ceo`     | `ProjectOrchestrationApprovalGrantedEvent`                                   | Work Item Generation    |
| `project_orchestration_cycle_ceo`      | `ProjectOrchestrationCycleRequestedEvent`                                    | Cycle Decision          |
| `project_orchestration_refinement_ceo` | `ProjectOrchestrationRefinementRequestedEvent`                               | Mid-Flight Refinement   |

### 12.4 Job Types Reference

| Job Type          | Count | Description                                                            |
| ----------------- | ----- | ---------------------------------------------------------------------- |
| `execution`       | ~150+ | Agent-driven execution with configurable agent_profile, steps, retries |
| `invoke_workflow` | ~25   | Invoke another workflow by ID, wait for completion                     |
| `emit_event`      | ~25   | Emit event with payload (supports switch/default routing, for_each)    |
| `git_operation`   | ~10   | Git operations: provision/merge/remove worktree, base/target branch    |
| `register_tool`   | 1     | Register tool with schema and TypeScript code                          |
| `mcp_tool_call`   | ~30   | MCP server tool call with policy-based permissions                     |
| `run_command`     | ~10   | Shell command execution with working_dir and transitions               |

---

## 13. Entity Reference

### 13.1 Database Entities (kanban schema)

| Entity                                | Table                               | Key Fields                                                                                                                                                                                      |
| ------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `KanbanWorkItemEntity`                | `kanban_work_items`                 | id, project_id, title, description, status, priority, scope, assigned_agent_id, token_spend, current_execution_id, waiting_for_input, execution_config (JSONB), metadata (JSONB), linked_run_id |
| `KanbanWorkItemSubtaskEntity`         | `kanban_work_item_subtasks`         | Subtask linked to work item                                                                                                                                                                     |
| `KanbanWorkItemDependencyEntity`      | `kanban_work_item_dependencies`     | depends_on_id → work_item_id                                                                                                                                                                    |
| `KanbanProjectEntity`                 | `kanban_projects`                   | Project entity                                                                                                                                                                                  |
| `KanbanProjectGoalEntity`             | `kanban_project_goals`              | Project goal entity                                                                                                                                                                             |
| `KanbanProjectGoalWorklogEntity`      | `kanban_project_goal_worklogs`      | Worklog for project goals                                                                                                                                                                       |
| `KanbanOrchestrationEntity`           | `kanban_orchestration`              | Orchestration state entity                                                                                                                                                                      |
| `KanbanCoreRunProjectionEntity`       | `kanban_core_run_projections`       | Read-model projection from core                                                                                                                                                                 |
| `KanbanCoreLifecycleDeadLetterEntity` | `kanban_core_lifecycle_dead_letter` | Dead-letter queue for failed events                                                                                                                                                             |
| `KanbanCoreLifecycleCursorEntity`     | `kanban_core_lifecycle_cursor`      | Event stream cursor position                                                                                                                                                                    |

### 13.2 WorkItemExecutionConfig (JSONB)

| Field                | Type     | Description                                                             |
| -------------------- | -------- | ----------------------------------------------------------------------- |
| `baseBranch`         | `string` | Branch to base work on                                                  |
| `targetBranch`       | `string` | Branch for the worktree                                                 |
| `agentProfileId`     | `string` | Agent profile slug override                                             |
| `implementationPlan` | `object` | Plan from architect-agent                                               |
| `rejectionFeedback`  | `object` | { decision: 'reject', feedback: string, failedDeliverables?: string[] } |

**Access in YAML**: `"{{ trigger.resource.executionConfig.baseBranch }}"`

### 13.3 ProjectOrchestration State

| Field            | Type    | Description                                                                                           |
| ---------------- | ------- | ----------------------------------------------------------------------------------------------------- |
| `projectId`      | UUID    | Associated project                                                                                    |
| `goals`          | JSONB   | Orchestration goals                                                                                   |
| `mode`           | enum    | autonomous / supervised / notifications_only                                                          |
| `status`         | enum    | idle / initializing / awaiting_approval / bootstrapping / orchestrating / paused / completed / failed |
| `linkedRunId`    | UUID    | Linked core workflow run                                                                              |
| `decisionLog`    | JSONB[] | Decision entries                                                                                      |
| `actionRequests` | JSONB[] | Action request records                                                                                |
| `metadata`       | JSONB   | Readiness signals, startup hints, selected route info                                                 |

---

## 14. Error Handling & Dead-Letter

### 14.1 Dead-Letter Flow

```
Processing error in CoreLifecycleStreamConsumer
    │
    ▼
Save entry to kanban_core_lifecycle_dead_letters
    │
    ├─ stream_id (original Redis stream ID)
    ├─ event_data (original envelope)
    ├─ error_reason (exception message)
    └─ created_at (timestamp)
    │
    ▼
Continue processing next entries (no fatal error)
```

### 14.2 Reconciliation

`DispatchService.reconcileLinkedRuns()` runs during dispatch:

- Queries core for each `linked_run_id`'s status
- Clears `linked_run_id` if run reached terminal status (`COMPLETED`, `FAILED`, `CANCELLED`)
- Items that fail status check are added to `skipped` with reason `core_status_unavailable`

### 14.3 Idempotency Mechanisms

| Component                     | Mechanism                                               |
| ----------------------------- | ------------------------------------------------------- |
| `CoreRunProjectionService`    | Duplicate `event_id` check + stale timestamp detection  |
| `DispatchService`             | Idempotent dispatch when `linked_run_id` already exists |
| `CoreWorkflowClientService`   | Idempotency key in run request metadata                 |
| `CoreLifecycleStreamConsumer` | Cursor-based consumption (no reprocessing)              |

---

## Appendix A: Status Mutation Matrix

Any supported status may transition to any other supported status. Same-status updates for supported statuses are accepted as non-saving, non-eventing no-ops. Unsupported status values are rejected before persistence.

## Appendix B: Workflow Trigger-to-Workflow Mapping

| Trigger Event / Webhook                                             | Workflow Triggered                                                                  |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `kanban.work_item.status_changed.v1` (`status == "in-progress"`)    | `work_item_in_progress_default`                                                     |
| `kanban.work_item.status_changed.v1` (`status == "in-review"`)      | `work_item_in_review_default`                                                       |
| `kanban.work_item.status_changed.v1` (`status == "ready-to-merge"`) | `work_item_ready_to_merge_default`                                                  |
| `kanban.work_item.status_changed.v1` (`status == "refinement"`)     | `work_item_refinement_default` (standard) / `work_item_split_default` (large scope) |
| `WorkItemDispatchSelectEvent`                                       | `work_item_todo_dispatch_default`                                                   |
| `WorkItemMergeCompletedEvent`                                       | `work_item_post_merge_spec_hydration`                                               |
| `ProjectOrchestrationStartedEvent`                                  | `project_discovery_ceo`                                                             |
| `ProjectOrchestrationRevisionRequestedEvent`                        | `project_spec_revision_ceo`                                                         |
| `ProjectOrchestrationApprovalGrantedEvent`                          | `project_work_item_generation_ceo`                                                  |
| `ProjectOrchestrationCycleRequestedEvent`                           | `project_orchestration_cycle_ceo`                                                   |
| `ProjectOrchestrationRefinementRequestedEvent`                      | `project_orchestration_refinement_ceo`                                              |
| `ProjectOrchestrationCompletedEvent`                                | `project_retrospective_autorun`                                                     |
| `QualityCheckRequestedEvent`                                        | `automated_quality_check`                                                           |
| `workflow.repair-delegation.sysadmin.requested`                     | `workflow_environment_repair`                                                       |
| `kanban.work_item.status_changed.v1`                                | Canonical lifecycle event for actual status changes                                 |

## Appendix C: Agent Profiles Used

| Agent Profile               | Used In Workflows                                                                                                                | Role                          |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `ceo-agent`                 | project_discovery, project_spec_revision, project_orchestration_cycle, project_orchestration_refinement, imported_repo_synthesis | Orchestrator / decision-maker |
| `architect-agent`           | work_item_in_progress, work_item_in_review, work_item_refinement, work_item_ready_to_merge, work_item_split                      | Architecture / planning       |
| `qa_automation`             | work_item_in_review, work_item_refinement, workflow_failure_doctor, automated_quality_check                                      | QA / review                   |
| `product-manager`           | work_item_refinement                                                                                                             | PM refinement                 |
| `orchestrator`              | work_item_in_progress (implement step)                                                                                           | Implementation                |
| `investigation-coordinator` | project_codebase_deep_investigation                                                                                              | Codebase investigation        |
| `dispatch-selector`         | work_item_todo_dispatch_default                                                                                                  | Dispatch selection            |
| `sysadmin-repair`           | workflow_environment_repair                                                                                                      | Environment repair            |
| `spec-generator`            | project_work_item_generation                                                                                                     | Work item generation          |
| `software-engineer`         | conversational_artifact_steering                                                                                                 | Artifact steering             |
| `staff_engineer`            | documentation_audit                                                                                                              | Documentation audit           |
| `senior_dev`                | project_generate_agents_md                                                                                                       | AGENTS.md authoring           |
| `testing-agent`             | todo_web_app, web_search_tool_test                                                                                               | Test workflows                |

## Appendix D: Redis Configuration

| Key / Component | Value                                                    | Purpose                        |
| --------------- | -------------------------------------------------------- | ------------------------------ |
| Stream key      | `stream:core:lifecycle`                                  | Core lifecycle event stream    |
| Consumer name   | `core-lifecycle-projection`                              | Stream consumer group member   |
| Poll interval   | `5000ms` (env: `KANBAN_CORE_LIFECYCLE_POLL_INTERVAL_MS`) | Event polling frequency        |
| Redis module    | `kanban-redis.module.ts`                                 | Redis connection configuration |
| Redis constants | `kanban-redis.constants.ts`                              | Key prefixes                   |

## Appendix E: Startup Route Selection (Deprecated)

Deterministic startup route selection via `StartupRouteRouterService` and `startup-route-rules.config.yaml` has been **deprecated and removed**.

Startup behavior is now governed by the **Project Orchestration Cycle (CEO)** and **Project Orchestration Advisor** workflows based on real-time evidence and agent judgment.

## Appendix F: Cross-Workflow Data Dependencies

```
project_discovery_ceo
  ├─ outputs: decision
  ├─ triggers: emit_specs_ready (ProjectOrchestrationSpecsReadyEvent)
  └─ triggers: emit_cycle_request (ProjectOrchestrationCycleRequestedEvent)

project_spec_revision_ceo
  ├─ inputs: trigger.feedback (from revision)
  ├─ outputs: decision
  ├─ triggers: emit_specs_ready (conditional on feedback)
  └─ triggers: emit_cycle_request (ProjectOrchestrationCycleRequestedEvent)

project_work_item_generation_ceo
  ├─ inputs: ProjectOrchestrationApprovalGrantedEvent
  ├─ outputs: file_paths, dependency_strategy
  └─ triggers: emit_bootstrap_completed, emit_cycle_request

project_orchestration_cycle_ceo
  ├─ inputs: ProjectOrchestrationCycleRequestedEvent
  ├─ outputs: decision (CEO agent)
  └─ decision may trigger:
       ├─ WorkItemDispatchSelectEvent → work_item_todo_dispatch_default
       ├─ ProjectOrchestrationRefinementRequestedEvent → project_orchestration_refinement_ceo
       ├─ ProjectOrchestrationRevisionRequestedEvent → project_spec_revision_ceo
       └─ ProjectOrchestrationCompletedEvent → project_retrospective_autorun

work_item_in_progress_default
  ├─ inputs: kanban.work_item.status_changed.v1 (status == "in-progress")
  ├─ outputs: (status transition to in-review)
  └─ conditional escalation → blocked (needs-rework)

work_item_in_review_default
  ├─ inputs: kanban.work_item.status_changed.v1 (status == "in-review")
  ├─ outputs: decision, feedback, failed_deliverables
  └─ transitions: accept → ready-to-merge, reject → in-progress

work_item_ready_to_merge_default
  ├─ inputs: kanban.work_item.status_changed.v1 (status == "ready-to-merge")
  ├─ outputs: (status transition to done)
  └─ triggers: WorkItemMergeCompletedEvent / WorkItemMergeFailedEvent

work_item_refinement_default
  ├─ inputs: kanban.work_item.status_changed.v1 (status == "refinement")
  ├─ outputs: pm_summary, architect_summary, split_recommendation, subtask_blueprint, implementation_plan
  └─ transitions: → todo (if exit gates pass)

work_item_split_default
  ├─ inputs: kanban.work_item.status_changed.v1 (status == "refinement", large scope)
  ├─ outputs: split_outcome, child_ids, child_files
  └─ transitions: parent → blocked (awaiting children)
```
