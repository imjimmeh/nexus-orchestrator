# Phase B — Scope-node Lifecycle & Cleanup Design Spec

**Date:** 2026-06-11
**Status:** Approved for implementation
**Parent:** `docs/superpowers/specs/2026-06-11-epic-204-completion-design.md`
**Fixes:** Symptom 1 — ~20 phantom `project-<hash>` entries in the globe scope switcher.

## Goal

Clean up orphaned `scope_nodes` rows that were minted by the one-shot backfill migration and were
never tied to a live entity. Add a proper soft-archive lifecycle so the switcher shows only real,
active scopes. Expose an admin maintenance endpoint for ongoing hygiene. No auto-provisioning of
scope nodes on entity writes is in scope for this workstream.

## Background

Migration `20260609010000-backfill-scope-nodes.ts` ran `SELECT DISTINCT scope_id` across 8 source
tables (including stale e2e UUIDs) and minted permanent `scope_nodes` rows of `type = 'project'`.
Nothing ever removes them: there is no runtime lifecycle for project-type nodes, no prune job, and
FK `ON DELETE RESTRICT` prevents hard-deletes while rows referencing the node exist.

`ScopeService.getTree()` returns **all** nodes with no membership or archive filtering, which is
why the switcher lists every phantom node.

## Non-goals

- Auto-provisioning scope nodes when a Kanban project or other entity is created (Workstream D).
- Scope propagation or HTTP header wiring (Workstream C).
- Hard-deletes of scope nodes.
- Archiving non-`project` type nodes via this flow (platform/org/region/team nodes are
  human-created and require deliberate lifecycle management outside this workstream).

## Design Decisions

| Decision                         | Choice                                                         | Rationale                                                                    |
| -------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Deletion strategy                | **Soft-archive** (`archived_at` timestamp)                     | Reversible; preserves audit trail; avoids FK cascade risk                    |
| Who can see archived nodes       | **Nobody** (including admins) via the switcher                 | Keeps the switcher clean; separate maintenance endpoint for admin visibility |
| How admins access archived nodes | `GET /scopes/maintenance/orphans` + `POST /scopes/:id/restore` | Explicit opt-in                                                              |
| Ongoing cleanup                  | One-time migration + admin maintenance endpoint only           | Predictable; no surprise cron jobs                                           |
| Auto-provisioning                | Out of scope                                                   | Handled in Workstream D                                                      |

## Data Layer

### Migration A — add column

```sql
-- up
ALTER TABLE scope_nodes ADD COLUMN archived_at TIMESTAMPTZ NULL;

-- down
ALTER TABLE scope_nodes DROP COLUMN archived_at;
```

`ScopeNode` entity gains:

```ts
@Column({ nullable: true, name: 'archived_at' })
archivedAt: Date | null;
```

### Migration B — archive orphaned project nodes

Archives all `type = 'project'` rows whose `id` does not appear in any of the 8 source tables,
excluding the global platform root (id = `'00000000-0000-0000-0000-000000000000'`).

```sql
-- up
UPDATE scope_nodes
SET archived_at = now()
WHERE type = 'project'
  AND id <> '00000000-0000-0000-0000-000000000000'
  AND archived_at IS NULL
  AND id NOT IN (
    SELECT scope_id FROM workflows           WHERE scope_id IS NOT NULL UNION
    SELECT scope_id FROM chat_sessions        WHERE scope_id IS NOT NULL UNION
    SELECT scope_id FROM scheduled_jobs       WHERE scope_id IS NOT NULL UNION
    SELECT scope_id FROM automation_hooks     WHERE scope_id IS NOT NULL UNION
    SELECT scope_id FROM heartbeat_profiles   WHERE scope_id IS NOT NULL UNION
    SELECT scope_id FROM standing_orders      WHERE scope_id IS NOT NULL UNION
    SELECT scope_id FROM workflow_run_todos   WHERE scope_id IS NOT NULL UNION
    SELECT scope_id FROM notifications        WHERE scope_id IS NOT NULL
  );

-- down
UPDATE scope_nodes SET archived_at = NULL WHERE type = 'project';
```

Migration B must run after Migration A (timestamps must exist).

## Service Layer

### `ScopeService` — new and updated methods

#### `archiveNode(id: string): Promise<void>`

Sets `archived_at = now()` on the node with the given id.

Guards (throw `BadRequestException` for both):

- Node is the global platform root.
- Node `type !== 'project'`.

#### `restoreNode(id: string): Promise<void>`

Clears `archived_at` (sets to `null`). Same guards as `archiveNode`.

#### `findOrphanedProjectNodes(): Promise<ScopeNode[]>`

Returns `type = 'project'` rows where `archived_at IS NULL` and the `id` does not appear in any
of the 8 source tables. Mirrors the Migration B filter as a live TypeORM query. Used by the admin
maintenance endpoint as a preview before archiving.

#### `getTree(userId: string, isGlobalAdmin: boolean): Promise<ScopeTreeNode | null>` (updated)

- Always filters `WHERE archived_at IS NULL` — archived nodes never appear in the tree.
- `isGlobalAdmin = true`: returns the full non-archived tree.
- `isGlobalAdmin = false`: calls
  `ScopeAccessService.getAccessibleScopeIds(userId, 'scopes:read')` to get the caller's
  accessible leaf scope IDs, then includes those nodes plus all their ancestors up to the root
  (for breadcrumb context). Returns `null` if the caller has no accessible scopes.

`ScopeAccessService` is in `AuthorizationModule`. `ScopeModule` already imports
`AuthorizationModule` via `forwardRef`; inject `ScopeAccessService` with
`@Inject(forwardRef(() => ScopeAccessService))`.

Auth context (userId, isGlobalAdmin) is extracted in the controller from the JWT; the service
contains no auth logic.

## Controller Layer

### `GET /scopes/tree` (updated)

Extracts `userId` and `isGlobalAdmin` from the JWT claims and passes them to
`scopeService.getTree(userId, isGlobalAdmin)`.

### `GET /scopes/maintenance/orphans` (new)

Requires `scopes:manage` permission. Returns `scopeService.findOrphanedProjectNodes()` as a JSON
array. Read-only preview — no side effects.

### `POST /scopes/:id/archive` (new)

Requires `scopes:manage`. Calls `scopeService.archiveNode(id)`. Returns `204 No Content`.

### `POST /scopes/:id/restore` (new)

Requires `scopes:manage`. Calls `scopeService.restoreNode(id)`. Returns `204 No Content`.

No DTO body is needed for archive or restore — the `id` is provided as a URL parameter.

## Tests

### `ScopeService` unit tests

| Test                                                            | Assertion                                                                        |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `archiveNode` sets `archived_at`                                | Repository `save` called with `archivedAt` set                                   |
| `archiveNode` rejects platform root                             | Throws `BadRequestException`                                                     |
| `archiveNode` rejects non-project type                          | Throws `BadRequestException`                                                     |
| `restoreNode` clears `archived_at`                              | Repository `save` called with `archivedAt = null`                                |
| `findOrphanedProjectNodes` returns unlinked project nodes       | Returns rows not in source tables                                                |
| `getTree` (admin) returns all non-archived nodes                | No `ScopeAccessService` call; archived rows excluded                             |
| `getTree` (regular user) returns accessible subtree + ancestors | `getAccessibleScopeIds` called; non-accessible nodes excluded; archived excluded |
| `getTree` (regular user with no scopes) returns null            | Returns `null`                                                                   |

### `ScopeController` unit tests

| Test                                                            | Assertion                                                |
| --------------------------------------------------------------- | -------------------------------------------------------- |
| `GET /scopes/tree` passes user context to service               | Service called with correct `userId` and `isGlobalAdmin` |
| `GET /scopes/maintenance/orphans` — 403 without `scopes:manage` | Permission guard blocks                                  |
| `GET /scopes/maintenance/orphans` — 200 with correct data       | Returns service result                                   |
| `POST /scopes/:id/archive` — 403 without permission             | Guard blocks                                             |
| `POST /scopes/:id/archive` — 204 with permission                | Service called; 204 returned                             |
| `POST /scopes/:id/restore` — same pattern                       | Mirror of archive                                        |

## Files Touched

| Action   | File                                                                  |
| -------- | --------------------------------------------------------------------- |
| add      | `apps/api/src/database/migrations/<ts>-add-scope-node-archived-at.ts` |
| add      | `apps/api/src/database/migrations/<ts>-archive-orphan-scope-nodes.ts` |
| edit     | `apps/api/src/scope/database/entities/scope-node.entity.ts`           |
| edit     | `apps/api/src/scope/scope.service.ts`                                 |
| edit     | `apps/api/src/scope/scope.controller.ts`                              |
| edit/add | `apps/api/src/scope/scope.service.spec.ts`                            |
| edit/add | `apps/api/src/scope/scope.controller.spec.ts`                         |
