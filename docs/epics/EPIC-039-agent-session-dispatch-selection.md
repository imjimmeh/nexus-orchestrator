# EPIC: Agent-Session Work Item Dispatch Selection

**Epic ID:** EPIC-039  
**Status:** Implemented  
**Created:** 2026-03-31  
**Priority:** P0 - Critical  
**Theme:** Workflow-Driven Kanban Automation

## 1. Executive Summary

### 1.1 Problem Statement

Auto-dispatch was selecting candidates in backend code and emitting per-item transition events. The dispatch workflow run itself only performed `transition_status`, so there was no dispatcher agent session deciding what to start.

### 1.2 Solution Overview

Implement an agent-session dispatch loop where:

- coordinator computes capacity and dependency-eligible candidates,
- coordinator emits a single selection event (`WorkItemDispatchSelectEvent`),
- dispatch workflow runs an agent step for selection,
- agent starts selected items through the Kanban-owned `kanban.dispatch_selected_work_items` boundary,
- backend applies `todo -> in-progress` transitions via `WorkItemService.updateStatus`, preserving existing status-triggered implementation workflows.

### 1.3 Success Criteria

- Dispatch reconcile emits one selection request event per project reconcile.
- Dispatch workflow run includes an agent step (visible chat/session trace).
- Agent can start zero or more selected work items.
- Started items transition to `in-progress` and trigger downstream automation.
- Dispatch workflow completion does not self-trigger reconcile loops.

---

## 2. Scope

### In Scope

- New dispatch selection event contract and payload.
- Coordinator refactor to request agent selection instead of direct per-item start events.
- Dispatch workflow YAML conversion to agent-execution job.
- New selected dispatch action, now superseded by `kanban.dispatch_selected_work_items`.
- Telemetry gateway handler to execute selected item transitions.
- Unit tests for coordinator, runner bridge tools, and telemetry gateway.

### Out of Scope

- UI changes for dispatch activity visualization.
- Removal of legacy dispatch-start event constants/workflows for backward compatibility cleanup.

---

## 3. Implementation Tasks

- [x] Add `WORK_ITEM_DISPATCH_SELECT_EVENT` constant.
- [x] Add dispatch selection payload types.
- [x] Refactor coordinator to emit selection request event with candidate list and slot count.
- [x] Add guard to ignore dispatch-selection workflow status events in reconcile listener.
- [x] Convert `work-item-todo-dispatch-default.workflow.yaml` to an agent execution job triggered by `WorkItemDispatchSelectEvent`.
- [x] Extend the selected dispatch bridge/tool validation, now superseded by the Kanban-owned MCP boundary.
- [x] Add selected dispatch handler coverage, now superseded by `kanban.dispatch_selected_work_items`.
- [x] Add/adjust tests for all touched behavior.
- [x] **Server-side capacity enforcement**: selected dispatch enforces `work_item_dispatch_max_active_per_project` at the execution boundary. Returns started and skipped work item IDs so the caller knows what was capped.
- [x] **Hierarchical candidate filtering**: coordinator's `reconcileProject` now runs `filterHierarchyReadyCandidates` after dependency filtering — only tasks with an active parent story (and stories with an active parent epic) are eligible for dispatch.

---

## 4. Risks and Mitigations

- **Risk:** Agent selects invalid item IDs.
  - **Mitigation:** backend validates each status transition through `WorkItemService.updateStatus`; failures are reported and do not crash processing.

- **Risk:** Agent ignores slot limit and starts too many items.
  - **Mitigation:** `kanban.dispatch_selected_work_items` enforces `work_item_dispatch_max_active_per_project` server-side, capping started items to remaining capacity regardless of how many IDs the agent provides. Excess IDs are returned as skipped work item IDs.

- **Risk:** Dispatch run completion creates infinite reconcile loop.
  - **Mitigation:** coordinator ignores `workflow.run.status-changed` events where trigger event is `WorkItemDispatchSelectEvent`.

- **Risk:** No item selected while slots remain available.
  - **Mitigation:** action allows empty selection and records telemetry result; future reconciles still occur on normal lifecycle events.

---

## 5. Validation

- Coordinator unit tests verify selection event emission and skip behavior.
- Coordinator unit tests verify hierarchical candidate filtering (tasks excluded when parent story is not active; stories excluded when parent epic is not active; orphan items pass through).
- Runner bridge tool unit tests verify new action payload/validation.
- Telemetry gateway tests verify selected IDs are transitioned in project context and missing-context handling.
- Telemetry gateway compat helper tests verify server-side capacity enforcement (capping, frozen dispatch, full capacity, recalculation).
