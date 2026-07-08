# Kanban Service

NestJS service that owns project/work-item/orchestration domain APIs after service split extraction.

## Responsibilities

- Project API surface (`/api/projects/*`)
- Work-item lifecycle and execution configuration APIs (`/api/projects/:projectId/work-items/*`)
- Orchestration domain APIs (`/api/projects/:projectId/orchestration/*`)
- Kanban retrospective run APIs (`/api/retrospectives/*`)
- Review and orchestration policy domain APIs
- Core workflow run integration via shared `@nexus/core` contracts

## Runtime

- Global prefix: `/api`
- Default port: `KANBAN_PORT=3012`
- Health endpoint: `GET /api/health`

## Work Item List Queries

The work-item list endpoints accept query parameters and return a paginated
envelope `{ items, total, limit, offset }` (wrapped in the standard
`{ success, data }` response):

- `GET /api/work-items` — all work items across projects.
- `GET /api/projects/:project_id/work-items` — work items for one project.

| Param       | Type                                                  | Default      | Notes                                                                  |
| ----------- | ----------------------------------------------------- | ------------ | ---------------------------------------------------------------------- |
| `search`    | string                                                | —            | Case-insensitive `ILIKE` match on `title` and `description`.           |
| `status`    | comma-separated `WorkItemStatus`                      | —            | e.g. `status=todo,blocked`.                                            |
| `priority`  | comma-separated string                                | —            | e.g. `priority=p1,p2`.                                                 |
| `scope`     | comma-separated (`standard`/`large`)                  | —            |                                                                        |
| `projectId` | string                                                | —            | Honored only by the global `GET /api/work-items` endpoint as a filter. |
| `sortBy`    | `updated_at`/`created_at`/`title`/`status`/`priority` | `updated_at` | Whitelisted columns only; invalid values are rejected with `400`.      |
| `sortDir`   | `asc`/`desc`                                          | `desc`       |                                                                        |
| `limit`     | integer                                               | `50`         | Clamped to a maximum of `200`.                                         |
| `offset`    | integer                                               | `0`          | For classic limit/offset pagination.                                   |

The project-scoped endpoint always derives the project from the path and ignores
any `projectId` query value. Invalid query parameters return `400`.

## Split Umbrella Relationships

Large work item splitting is owned by the Kanban service. Split parent/child
links are stored in work-item metadata:

- Umbrella parents list proposed children in `metadata.split.proposedChildIds`.
- Split children link back to the parent with `metadata.split.parentId`.
- Legacy authored specs using `metadata.parent_context_id` are still accepted;
  publish-specs canonicalizes them to `metadata.split.parentId` while preserving
  the legacy field.

When a split child transitions to `done`, the umbrella resolution workflow calls
`kanban.work_item_resolve_umbrella_parent`. If every listed child is loaded and
`done`, the blocked umbrella parent transitions to `done`.

## Core Integration

Kanban requests workflow actions through Core API using `CoreWorkflowClientService`.

Relevant env vars:

- `KANBAN_CORE_BASE_URL` (default `http://localhost:3010/api`)
- `KANBAN_CORE_BEARER_TOKEN` (optional static token)
- `JWT_SECRET` (used for service JWT fallback)
- `KANBAN_CORE_JWT_AUDIENCE` (default `nexus-core-internal`)
- `KANBAN_CORE_JWT_ISSUER` (default `nexus-kanban`)
- `KANBAN_CORE_JWT_TTL` (default `5m`)

## Internal Service Auth

Internal routes under `/api/internal/core/*` are guarded by `InternalServiceAuthGuard`.

Auth modes:

1. Static token: `KANBAN_SERVICE_BEARER_TOKEN`
2. Service JWT: `JWT_SECRET` + audience/issuer checks (`KANBAN_SERVICE_JWT_AUDIENCE`, `KANBAN_SERVICE_JWT_ISSUER`)

## Core Lifecycle Stream Smoke Checks

Use these internal endpoints after Core/Kanban lifecycle integration changes or when repairing missing `kanban_core_run_projections` rows. Both endpoints require internal service auth.

- `GET /api/internal/core/lifecycle-stream/health` with `kanban.core-events:read` scope returns the stream key, consumer name, last persisted stream id, and recent dead-letter count.
- `POST /api/internal/core/lifecycle-stream/replay` with `kanban.core-events:write` scope replays `stream:core:lifecycle` from the persisted cursor and returns `{ processed, deadLettered, lastStreamId }`.

Smoke sequence:

1. Call `GET /api/internal/core/lifecycle-stream/health` and note `data.lastStreamId` plus `data.deadLetterCount`.
2. Call `POST /api/internal/core/lifecycle-stream/replay`.
3. Call health again and confirm `lastStreamId` advanced when replay processed entries and `deadLetterCount` did not unexpectedly increase.

## Retrospective Operations

Kanban owns retrospective runs for Kanban orchestration cycles. Core consumes only neutral retrospective learning candidate proposal events (`learning.candidate.proposed.v1`).

- `POST /api/retrospectives/run` manually replays a Kanban retrospective run.
- `GET /api/retrospectives/runs` lists retrospective runs and diagnostics.
- `GET /api/retrospectives/projects/:projectId/status` returns latest retrospective status for a project.

The old Core `project_retrospective_autorun` seed workflow is retired/deleted; Core seed startup deactivates stale active seeded rows for that workflow id.

## Orchestration Policy Service (Phase 2–3)

Kanban owns the **Orchestration Policy Service**, which manages the curated registry of well-known keys and enforces server-side validation on mutation. The variable store itself lives in Core (`/variables`); Kanban validates writes via the policy endpoint.

### Endpoints

#### Get the effective (merged) orchestration policy

```http
GET /api/projects/:projectId/orchestration/policy
```

Returns the effective policy for the project: global defaults + project-scoped overrides.

**Example response:**

```json
{
  "autonomy.strategize": {
    "key": "autonomy.strategize",
    "value": true,
    "source": "global"
  },
  "autonomy.dispatch": {
    "key": "autonomy.dispatch",
    "value": false,
    "source": "project"
  }
}
```

#### Get the effective policy for a preset

```http
GET /api/projects/:projectId/orchestration/policy/preset/:presetName
```

Returns the policy as it would be if a given preset were applied (e.g., `autonomous`, `semi-autonomous`, `supervised`).

#### Set a policy entry (project-scoped)

```http
POST /api/projects/:projectId/orchestration/policy
Content-Type: application/json

{
  "key": "autonomy.dispatch",
  "value": false
}
```

Validates that the key exists in the curated registry and matches the expected type. Returns the resolved entry and an audit row.

**Validation errors:**

- `400` — key not in registry or value type mismatch
- `403` — insufficient permissions

### Autonomy Keys (Registry)

The curated key set is defined in `packages/kanban-contracts/src/orchestration-policy.schema.ts`. Examples:

| Key                   | Type    | Default | Phase | Meaning                                                   |
| --------------------- | ------- | ------- | ----- | --------------------------------------------------------- |
| `autonomy.strategize` | boolean | `true`  | 2–3   | Whether the CEO strategize job runs fully autonomous      |
| `autonomy.dispatch`   | boolean | `true`  | 2–3   | Whether the CEO dispatch job promotes/starts autonomously |
| `autonomy.ideation`   | boolean | `true`  | 2–3   | Whether ideation/backlog-gen runs without approval        |

Defaults are written to missing project-scoped keys by `OrchestrationPolicyBackfillService` on Kanban startup.

## Race-safe work-item run linking

`WorkItemService.requestWorkItemRun` is the single funnel that turns a
work-item status transition (dispatch / review / merge) into a Core
workflow-run launch. After Core accepts the run, the service must persist
`linked_run_id` and `current_execution_id` on the work item so subsequent
lifecycle events can be projected back. The naive path is racy: a
conditional `UPDATE ... WHERE linked_run_id IS NULL` is the only barrier,
and at least five other mutators of the same row can interleave around
it. The race window is small in steady state, but the failure mode is a
silent corruption of the work-item ↔ workflow-run relationship — the
orchestration hot path's primary invariant.

The race-safety strategy is documented in
[`docs/architecture/ADR-20260623-work-item-run-link-lease.md`](../docs/architecture/ADR-20260623-work-item-run-link-lease.md)
(ADR) and the failure-mode inventory in
[`apps/kanban/src/work-item/README.md`](src/work-item/README.md). This
section is the operator/developer handbook for the protocol: what
identifies a work-item lease, what the rollback flag does, and how to
flip it.

### Lease identity

A work-item run lease is a row in `kanban_orchestration_leases` with the
following contract. The fields are the single source of truth shared
between the kanban service and the operation runbook; the constants
below are the literal values written by `WorkItemRunLeaseService`.

| Field                  | Value                                                                                              | Source                                                                                                      |
| ---------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Conflict key kind      | `work_item`                                                                                        | `WorkItemRunLeaseService.CONFLICT_KEY_KIND`                                                                 |
| Conflict key value     | `work_item_dispatch:<project_id>:<work_item_id>`                                                   | `WorkItemRunLeaseService.buildConflictKey(projectId, workItemId)`                                           |
| Owner kind             | `work_item_run_request`                                                                            | `OrchestrationLeaseOwnerKind` (control-plane types)                                                         |
| Owner id (lease row)   | `kanban:work-item-run:<project_id>:<work_item_id>:<action>` (deterministic 4-tuple)                | `WorkItemRunLeaseService.deriveOwnerId(projectId, workItemId, action)`                                      |
| Owner id (per-request) | `<deterministic id>:<request_correlation_id>` (used as the `acquireRunLease` input)                | `requestWorkItemRun` (requestWorkItemRun) / `leaseAndLinkAcceptedRun` / `linkWorkItemRunFromLifecycleEvent` |
| Lane                   | `dispatch`                                                                                         | `WorkItemRunLeaseService.LANE`                                                                              |
| Action taxonomy        | `dispatch` / `review` / `merge` (user actions) + `lifecycle_link` / `dispatch_selected` (internal) | `AcquireWorkItemRunLeaseServiceInput.action` (work-item-run-lease.types)                                    |
| Default TTL            | `30 000 ms`                                                                                        | `WORK_ITEM_RUN_LEASE_DEFAULT_TTL_MS` (control-plane.types)                                                  |
| Sweeper                | `OrchestrationLeaseSweeperService` (30 s tick)                                                     | control-plane module                                                                                        |

The deterministic 4-tuple owner id is what makes the release path
straightforward: any holder — user-action funnel, dispatch-cycle
funnel, lifecycle-projection observer — can release a lease for a
`(project_id, work_item_id, action)` tuple without per-request state,
because they all derive the same id from the same inputs. The
`owner_id` column on the lease row is the deterministic id (not the
per-request id), so the `releaseRunLease(projectId, ownerId)` call
always matches exactly the row acquired by `acquireRunLease` for the
same tuple.

The lease is acquired **before** the Core `requestWorkflowRun` call and
released in a `try/finally`. A losing acquire surfaces a deterministic
`ConflictException` _before_ Core is invoked, eliminating the
orphan-run partial-write window that the naive path leaves open.

### Rollback flag (one-line revert)

The lease acquisition is gated by a single kanban setting:

| Setting key                   | Type    | Default | Effect when `false`                                                                                                                                                                                                                                                                      |
| ----------------------------- | ------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `work_item_run_lease_enabled` | boolean | `true`  | `requestWorkItemRun` short-circuits the lease acquire/release. The path falls back to the pre-ADR conditional `linkRunIfUnlinked` UPDATE only. The dispatch-cycle and lifecycle-projection writers are unaffected — they retain the lease protocol they adopted in the prior milestones. |

Flipping the flag is a one-line configuration change; no schema or
code change is required. The default is `true` so the rollout is safe
even if the setting row is missing or the database is in a degraded
state — `KanbanSettingsService.getBoolean` falls back to the registry
default. The setting is documented in
`apps/kanban/src/settings/kanban-settings.constants.ts` and validated
by `packages/kanban-contracts/src/settings.schema.ts`.

#### When to flip the flag

The flag is the operational escape hatch if the lease causes a
production regression. Concretely, flip the flag if any of the
following are true after the rollout (in priority order):

1. **`kanban_work_item_request_work_item_run_total{outcome="lease_conflict"}`
   counter is non-zero and climbing.** A non-zero rate on this counter
   means concurrent writers are racing; a _climbing_ rate that
   saturates request rate means the lease TTL is too tight or a
   downstream path is holding the lease too long. See
   [Detection in the ops runbook](../docs/operations/README.md#work-item-run-link-lease-contention)
   for the SQL query that surfaces this state.
2. **`kanban_orchestration_lease_acquire_conflict_total` counter
   regression vs. pre-ADR baseline.** A regression on this counter
   (post-ADR minus pre-ADR is more than the pre-ADR baseline by a
   large factor) is a signal that the lease is over-serializing.
3. **`kanban_orchestration_lease_acquire_latency_ms` p99 spikes.**
   p99 above the pre-ADR p99 by more than 50 ms sustained for 30
   minutes is a flag-flip trigger.

The flag does not require a restart to take effect; the value is read
on every `requestWorkItemRun` call, so the next request after the
flip sees the new value.

#### How to flip the flag

The setting is a standard kanban setting, so it is reachable through
the existing settings API:

```bash
# Disable the lease (rollback to pre-ADR behaviour).
curl -sS -X POST http://localhost:3012/api/settings \
  -H 'Content-Type: application/json' \
  -d '{"key":"work_item_run_lease_enabled","value":false}'

# Re-enable the lease.
curl -sS -X POST http://localhost:3012/api/settings \
  -H 'Content-Type: application/json' \
  -d '{"key":"work_item_run_lease_enabled","value":true}'
```

The flag is also reachable through `KanbanSettingsService.set(...)` in
code (used by the `POST /api/settings` route). There is no environment
variable override: the lease protocol is a kanban-internal coordination
decision, not a deployment-environment decision.

#### What changes when the flag is off

When the flag is off, `requestWorkItemRun`:

1. Skips the `acquireRunLease` call (no row written to
   `kanban_orchestration_leases`).
2. Skips the `releaseRunLease` call in `finally` (no row released).
3. Continues to call `linkRunIfUnlinked` and surface a
   `ConflictException` on the F6 partial-write window. The conditional
   UPDATE remains the _only_ race-safety barrier on the rollback path;
   the F1/F2 windows reopen.

The dispatch-cycle and lifecycle-projection writers **are not** affected
by this flag. They retain the per-work-item lease protocol they
adopted in the prior milestones; only the user-action funnel reverts to
the pre-ADR behaviour. The lease table is the source of truth for
their protocols regardless of the flag value.

### Related docs

- [ADR-20260623-work-item-run-link-lease](../docs/architecture/ADR-20260623-work-item-run-link-lease.md)
  — the design decision and alternatives considered.
- [apps/kanban/src/work-item/README.md](src/work-item/README.md) —
  the failure-mode inventory (F1–F6) and the test-plan cross-reference.
- [Work-item run link lease contention runbook](../docs/operations/README.md#work-item-run-link-lease-contention)
  — the operator runbook for detection, holder identification, and
  manual release.

## Local Commands

```bash
npm run lint --workspace=apps/kanban
npm run test --workspace=apps/kanban
npm run build --workspace=apps/kanban
npm run start:dev --workspace=apps/kanban
```

## Related Docs

- `docs/architecture/rest-api.md`
- `docs/operations/service-split-migration-dashboard.md`
- `docs/operations/compatibility-layers-and-legacy-removal.md`
