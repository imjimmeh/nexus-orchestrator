# Work Items Page UX — Design

**Date:** 2026-06-14
**Status:** Approved
**Scope:** Global Work Items page (`/work-items`) + Kanban board (`/projects/:projectId/board`) filtering

## Problem

The Global Work Items page (`apps/web/src/pages/work-items/GlobalWorkItemsPage.tsx`)
renders every work item across all projects in a hand-rolled static `<table>`. It has
no ordering control, no sorting, no search, no filtering, and no pagination. As the
number of work items grows this becomes unusable. The per-project Kanban board groups
by status but offers no text search or attribute filtering beyond the readiness bar.

The web app already ships a generic `DataTable` component
(`apps/web/src/components/ui/data-table/`) supporting sortable columns, search,
filters, and pagination in both client and server modes — but the work items page does
not use it. The kanban list endpoints currently return the full list with no query
parameters.

## Goals

- Default ordering newest → oldest by last activity.
- Sort by columns (title, project, status, priority, created/updated).
- Free-text search across title (and description).
- Filter by project, status, priority, scope.
- Classic limit/offset pagination on the global list.
- Search + attribute filtering on the Kanban board (without breaking drag-drop).
- Shareable / back-button-safe views via URL query-param persistence.

## Decisions

| Decision       | Choice                                                               | Rationale                                                                                                                                                                     |
| -------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pages in scope | Global page + Kanban board filters                                   | Board pagination is out of scope; board needs the full set for columns/DnD.                                                                                                   |
| Data strategy  | Server-side for the global list; client-side filtering for the board | Pagination matters on the flat list; the board must hold the whole set.                                                                                                       |
| Recency source | `updated_at` proxy                                                   | `@UpdateDateColumn` changes on status/token/execution/waiting writes — a good-enough "last activity" with no joins. A denormalized `last_event_at` is a possible fast-follow. |
| Pagination UI  | Classic limit/offset                                                 | Matches existing `DataTablePagination`; URL-friendly (`?page=2`).                                                                                                             |

## Architecture

Approach **A**: one shared query contract drives both pages. The global page runs it
server-side with pagination; the board reuses the same filter-option definitions but
filters its already-fetched set client-side. This keeps filter semantics from drifting
between the two views while respecting each view's data needs.

### 1. Shared contract — `packages/kanban-contracts`

- `WorkItemQuerySchema` (Zod):
  - `search?: string`
  - `status?: WorkItemStatus[]`
  - `priority?: string[]`
  - `scope?: ('standard' | 'large')[]`
  - `projectId?: string` (global endpoint only)
  - `sortBy?: 'updated_at' | 'created_at' | 'title' | 'status' | 'priority'`
  - `sortDir?: 'asc' | 'desc'`
  - `limit?: number` (default `50`, max `200`)
  - `offset?: number` (default `0`)
  - Defaults: `sortBy = 'updated_at'`, `sortDir = 'desc'`.
- `PaginatedWorkItems` envelope:
  `{ items: WorkItem[]; total: number; limit: number; offset: number }`.
- Shared `workItemFilterOptions` (status / priority / scope label+value lists) so both
  the global toolbar and the board toolbar render identical filter choices.

### 2. Backend — `apps/kanban`

- `GET /work-items` and `GET /projects/:project_id/work-items` parse the query DTO via a
  Zod validation pipe and return the `PaginatedWorkItems` envelope instead of a bare
  array.
- Repository builds a TypeORM `QueryBuilder`:
  - case-insensitive `ILIKE` search on `title` and `description`,
  - `IN` filters for status / priority / scope (and `project_id` on the global path),
  - validated `ORDER BY` (whitelist of sortable columns),
  - `take` / `skip` for pagination,
  - a parallel `getCount()` for `total`.
- Migration adding indexes: `(updated_at)` and `(project_id, updated_at)`. Search stays
  `ILIKE` — no full-text search for now (YAGNI).
- Tests: repository query-building/validation unit tests; controller tests for param
  parsing, default application, and envelope shape.

### 3. Frontend — Global page (`GlobalWorkItemsPage.tsx`)

- Replace the static `<table>` with the existing `DataTable` in **server mode**.
- New hook `usePaginatedWorkItems(query)` (React Query) preserving the current 10s
  `refetchInterval` and realtime invalidation.
- Search / filters / sort / page synced to URL search params:
  `?q=&status=&priority=&scope=&project=&sort=updated_at&dir=desc&page=1`.
- Sortable columns: title, project, status, priority, scope, updated (default sort).
  Existing live-state, plan-status, and dependency cells are preserved. Toolbar: search
  input + project / status / priority / scope filter selects. Classic
  `DataTablePagination`.

### 4. Frontend — Kanban board (`KanbanBoard.tsx`)

- Add a `WorkItemFilterToolbar` (search + priority / scope filters) beside the existing
  readiness filter bar. It filters the fetched set client-side before
  `groupWorkItemsByStatus`. Drag-drop and column structure operate on the full set;
  filtered-out cards simply hide. Filter state synced to URL params.

### 5. Reuse / DRY

- `workItemFilterOptions` shared by both toolbars.
- No new table/grid library — `DataTable` already covers sort/search/filter/pagination.

## Data Flow

1. URL search params → query state (hook) → `WorkItemQuery`.
2. Global: hook calls `GET /work-items?...` → `PaginatedWorkItems` → `DataTable` rows +
   pagination control.
3. Board: hook fetches the project's full set (existing behaviour); toolbar state filters
   in-memory → `groupWorkItemsByStatus`.
4. Mutations (status change, delete) invalidate the query; realtime subscription triggers
   refetch.

## Error Handling

- Invalid query params (bad sort column, out-of-range limit) → Zod pipe rejects with 400;
  the frontend clamps/normalises before issuing requests so this is defence-in-depth.
- Empty result sets render an explicit empty state in `DataTable`.
- Fetch errors surface via the existing React Query error UI; pagination control is
  disabled while loading.

## Testing

- **Backend:** repository unit tests (filter/sort/pagination SQL), controller tests
  (param parsing, defaults, envelope).
- **Frontend:** Vitest unit tests for `usePaginatedWorkItems`, the URL-sync logic, and the
  filter toolbar; existing E2E updated for the new envelope shape.

## Out of Scope (YAGNI)

- Full-text search / FTS indexes.
- Denormalised `last_event_at` column (possible fast-follow if `updated_at` proves
  insufficient).
- Infinite scroll / cursor pagination.
- Board pagination.
- Saved filter presets.

## Boundary Note

All backend changes live in `apps/kanban` and `packages/kanban-contracts`. No Kanban
domain identifiers leak into `apps/api` or `packages/core`, per the Core/Kanban boundary.
