# EPIC-032: Kanban Live Status Indicators

## Summary

Replace the column-based work item status indicators on the Kanban board with real execution-state-aware indicators. The current implementation derives a work item's "live state" purely from which Kanban column it occupies, producing misleading badges (e.g. "running" for a FAILED execution that remains in the In Progress column).

## Motivation

### Current Behaviour

The `deriveLiveState()` function maps Kanban column → badge:

| Column | Badge |
|---|---|
| `in-progress` + `currentExecutionId` | `running` (green pulse) |
| `in-review` + `currentExecutionId` | `thinking` (yellow pulse) |
| `done` | `paused` |
| `blocked` | `error` |
| Everything else | `idle` |

This is incorrect because:

1. A work item in `in-progress` with a **FAILED** workflow run still shows "running".
2. A work item in `in-progress` with a **COMPLETED** run still shows "running".
3. A work item in `in-progress` with a **PENDING** run shows "running" before it has actually started.
4. `done` items show "paused" — semantically misleading.
5. `blocked` items always show "error" even when they have no execution failure.
6. `thinking` and `paused` are not meaningful states to expose to users.

### Why Now

The Kanban board is the primary surface for monitoring agent task progress. Misleading status badges reduce trust and make it impossible to diagnose stuck or failed tasks at a glance.

## Goals

1. Derive live status from the **actual workflow run status** (`PENDING`, `RUNNING`, `COMPLETED`, `FAILED`, `CANCELLED`), not from the Kanban column.
2. Expose the current execution's run status in the work item API response to avoid N+1 frontend queries.
3. Provide clear, honest badge labels: `idle`, `queued`, `running`, `error`, `blocked`, `completed`.
4. Update all consumers of `deriveLiveState()` and `WorkItemLiveState` across the Kanban board, Sessions tab, and workspace utilities.
5. Ensure the WebSocket real-time pipeline propagates run status changes to the frontend.

## Non-Goals

1. Adding new Kanban columns or changing work item status transitions.
2. Changing the workflow execution engine behaviour.
3. Adding pagination or filtering to the work item list endpoint.

## Technical Approach

### Backend

1. **Enrich work item API response** — Add a `lastExecutionStatus` field (type: `WorkflowRunStatus | null`) to the work item list endpoint. Computed via a left-join on `workflow_runs` using `currentExecutionId` at query time.
2. **Repository query** — Modify `WorkItemRepository.findAllByProjectId()` to use a query builder with a left-join on `workflow_runs` to select the run status alongside the work item.
3. **WebSocket propagation** — After a workflow run transitions status (in `WorkflowEngineService`), re-fetch and broadcast the associated work item so the Kanban board reflects the change in real-time.

### Frontend

1. **Type changes** — Add `lastExecutionStatus` to `WorkItem` interface. Update `WorkItemLiveState` union to `"idle" | "queued" | "running" | "error" | "blocked" | "completed"`.
2. **`deriveLiveState()` rewrite** — Prioritise `lastExecutionStatus` over column status when present.
3. **Badge styling** — Update `getLiveBadgeClass()` for the new states with clear, distinguishable colours.
4. **`deriveSessionSummary()` alignment** — Update workspace utilities to use the same new state model.
5. **`hasActiveSession` logic** — Derive from `lastExecutionStatus` (`RUNNING` or `PENDING`) instead of column + ID presence.

## Affected Files

### Backend (apps/api)
- `src/database/repositories/work-item.repository.ts` — Left-join query
- `src/project/work-item.service.ts` — Pass enriched work items through
- `src/workflow/workflow-engine.service.ts` — Broadcast work item on run status change

### Frontend (apps/web)
- `src/lib/api/types.ts` — `WorkItem`, `WorkItemLiveState`
- `src/pages/kanban/kanban.utils.ts` — `deriveLiveState()`
- `src/pages/kanban/kanban.utils.spec.ts` — Updated tests
- `src/pages/kanban/KanbanBoard.tsx` — Badge classes, active session logic
- `src/pages/project-workspace/workspace.utils.ts` — `deriveSessionSummary()`
- `src/pages/project-workspace/SessionsTab.tsx` — Consumer of `deriveLiveState()`

## Acceptance Criteria

- [ ] Work items in `in-progress` with a `FAILED` run show `error` badge (red).
- [ ] Work items in `in-progress` with a `RUNNING` run show `running` badge (green pulse).
- [ ] Work items in `in-progress` with a `PENDING` run show `queued` badge (amber pulse).
- [ ] Work items in `in-progress` with a `COMPLETED` run show `completed` badge.
- [ ] Work items in `blocked` column show `blocked` badge (not `error`).
- [ ] Work items in `done` column show `completed` badge (not `paused`).
- [ ] Work items with no execution show `idle` badge.
- [ ] WebSocket broadcasts trigger UI updates when run status changes.
- [ ] All `deriveLiveState()` unit tests updated and passing.
- [ ] No regressions in existing Kanban functionality.
