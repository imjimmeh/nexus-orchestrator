# Design: Work Item "Actively Running" Indicator

**Date:** 2026-06-24
**Status:** Approved

## Problem

The kanban board's work item cards already render several "actively running"
indicators:

- A green left border (`KanbanWorkItemCard.tsx:103`)
- A "Session active" text badge (`KanbanWorkItemCardBody.tsx:104`)
- A pulsing footer live-state badge (`KanbanWorkItemCardFooterStats.tsx:32`,
  driven by `deriveLiveState`)

All of them are dead. Every one reads `item.lastExecutionStatus`
(`KanbanWorkItemCard.tsx:60`, `deriveLiveState` in `kanban.utils.ts:163`), but
that field is **never populated** on the board:

- The board loads items via `api.getProjectWorkItems(...)`, mapped server-side
  by `toWorkItemRecord` (`apps/kanban/src/work-item/work-item.service.helpers.ts:92`).
- That mapper sets `currentExecutionId` and `waitingForInput`, but **never
  `lastExecutionStatus`**.
- The kanban work item entity has a `current_execution_id` column but **no
  `last_execution_status` column** — kanban tracks _which_ run is attached, not
  its live status.

Result: `lastExecutionStatus` arrives `undefined`, `hasActiveSession` is always
false, and `deriveLiveState` always falls through to status-based states. The
running UI is unreachable.

## Goal

Light up the existing indicators by populating the single field they read,
`lastExecutionStatus`, sourced from the workflow-run lifecycle events kanban
already consumes. No new frontend UI.

## Approach (chosen)

Persist run status on the kanban work item. Rejected alternatives:

- **Derive from `currentExecutionId` presence** — binary only (no
  queued/awaiting-input/error distinction) and depends on reconciliation
  timeliness to clear.
- **Frontend fetches run status per card** — N network calls + board polling;
  heavier and less clean.

## Data flow

All integration points already exist; we are filling one gap.

### 1. Contract — no change

`lastExecutionStatus` is already declared in
`packages/kanban-contracts/src/work-item.schema.ts:113,141` as
`z.string().nullable().optional()`.

### 2. Entity + migration

Add a column to `KanbanWorkItemEntity`
(`apps/kanban/src/database/entities/kanban-work-item.entity.ts`):

```ts
@Column({ name: "last_execution_status", type: "varchar", nullable: true })
last_execution_status!: string | null;
```

Migration matching `20260616100000-add-work-item-cost-cents.ts`:

```sql
ALTER TABLE kanban_work_items ADD COLUMN last_execution_status varchar NULL
```

Timestamp later than the latest existing migration
(`20260619090000-backfill-work-item-token-spend.ts`).

### 3. Set on non-terminal events

The lifecycle consumer (`apps/kanban/src/core/core-lifecycle-stream.consumer.ts`)
projects non-terminal run events onto the item via `linkRunIfUnlinked`
(`kanban-work-item.repository.ts:51`). That method is **link-once**
(`WHERE current_execution_id IS NULL`) and cannot track PENDING→RUNNING
transitions.

Add a dedicated repository method that writes `last_execution_status =
payload.status` on **every** non-terminal event for the matching run, so
queued → running → awaiting-input are all reflected. `waiting_for_input` is
already handled separately and feeds the "awaiting-input" live state.

### 4. Set on terminal events

When a run reaches `COMPLETED` / `FAILED` / `CANCELLED`, write the terminal
status into `last_execution_status` at the same place the linked fields are
cleared (`clearTerminalLinkedRun` → `clearRunLinksIfMatches` in
`kanban-work-item.repository.ts:27` and `dispatch-work-items-reconciliation.ts`).
This gives a short-lived "error"/"completed" signal via `deriveLiveState`. It is
overwritten by the next run's PENDING.

### 5. Map it out

Add one line to `toWorkItemRecord`
(`work-item.service.helpers.ts:108`):

```ts
lastExecutionStatus: item.last_execution_status,
```

This is what makes the initial board GET carry the field.

### 6. Realtime

The websocket gateway (`work-item-realtime.gateway.ts:49`,
`broadcastWorkItemUpdated`) already broadcasts the full `WorkItemRecord` and the
board upserts it (`useWorkItemRealtimeSubscription`). Once the field is on the
record, transition-driven updates flow for free.

Run-state changes (PENDING→RUNNING→terminal) arrive via the lifecycle consumer,
which does not currently broadcast a board update. Ensure
`broadcastWorkItemUpdated` (and the Redis-pub-sub publisher) fires when
`last_execution_status` changes, so the indicator updates live without a manual
refresh.

### 7. Frontend — no change

`hasActiveSession`, the green border, "Session active" badge, and
`deriveLiveState` already consume `lastExecutionStatus`. Add/extend tests only.

## Judgment calls

- **Terminal status is stored, not nulled.** Gives a short-lived "error" /
  "completed" signal; cleared implicitly by the next run's PENDING. The separate
  `current_execution_id` clearing is unchanged (different concern: which run is
  attached).
- **Update on every non-terminal event**, not link-once, so queued vs. running
  is accurate.

## Testing (TDD)

1. Failing test: `toWorkItemRecord` maps `last_execution_status` →
   `lastExecutionStatus`.
2. Repository: non-terminal update writes status on every matching event;
   terminal update writes terminal status.
3. Consumer: non-terminal event triggers the status update; terminal event
   writes terminal status.
4. Broadcast fires when `last_execution_status` changes.
5. Frontend: `deriveLiveState` / `hasActiveSession` exercised for
   RUNNING/PENDING/FAILED/CANCELLED (extend existing
   `kanban.utils.spec.ts`).

## Out of scope

- New visual treatment / icons (existing indicators are sufficient once live).
- Step-level "which step is running" detail.
- Elapsed-time / live spinner enhancements.

## Affected files

- `apps/kanban/src/database/entities/kanban-work-item.entity.ts`
- `apps/kanban/src/database/migrations/<new>.ts`
- `apps/kanban/src/database/repositories/kanban-work-item.repository.ts`
- `apps/kanban/src/core/core-lifecycle-stream.consumer.ts`
  (+ `core-lifecycle-stream-work-item-link.helpers.ts`)
- `apps/kanban/src/dispatch/dispatch-work-items-reconciliation.ts`
- `apps/kanban/src/work-item/work-item.service.helpers.ts`
- `apps/kanban/src/work-item/work-item-realtime.*` (broadcast-on-change)
- Tests alongside each, plus `apps/web/src/pages/kanban/kanban.utils.spec.ts`
