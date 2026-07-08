# Kanban Work Item Lifecycle — Race-Safety Cross-Reference

This guide is a cross-reference for the race-safety protocol that protects
the `WorkItemService.requestWorkItemRun` link path. It is intentionally
short: the design lives in
[`ADR-20260623-work-item-run-link-lease`](../architecture/ADR-20260623-work-item-run-link-lease.md)
and the operator runbook lives in the
[Work-item run link lease contention runbook](../operations/README.md#work-item-run-link-lease-contention).
The full lifecycle state machine is documented in
[22 — Kanban Work Item Lifecycle](22-kanban-lifecycle.md); the failure-mode
inventory for the link path is in
[`apps/kanban/src/work-item/README.md`](../../apps/kanban/src/work-item/README.md).

## Why this cross-reference exists

The lifecycle guide documents the _happy path_ — how a work item moves
through `backlog → todo → in-progress → in-review → ready-to-merge →
done`. The link path (`linked_run_id` / `current_execution_id`) is the
cornerstone of that happy path: every status transition that lands in
`in-progress` is paired with a Core workflow run, and the
`linked_run_id` is the foreign key that lets the lifecycle projection
fold the run's events back into the work item. A silent corruption of
that link is a silent corruption of the lifecycle itself.

`requestWorkItemRun` is the only writer of the link path for the
user-action funnel (dispatch / review / merge). The race-safety
protocol that protects that writer is a per-work-item orchestration
lease — the same `kanban_orchestration_leases` table that protects the
project-orchestration cycle, but with a new conflict-key kind
(`work_item`) and a new owner kind (`work_item_run_request`).

## Where to look, by audience

| Audience            | Start here                                                                                                                                                              |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operator on call    | [Work-item run link lease contention runbook](../operations/README.md#work-item-run-link-lease-contention) — detection query, holder identification, manual release     |
| New kanban engineer | [apps/kanban/src/work-item/README.md](../../apps/kanban/src/work-item/README.md) — failure-mode inventory F1–F6 and the test-plan cross-reference                       |
| Architect           | [ADR-20260623-work-item-run-link-lease](../architecture/ADR-20260623-work-item-run-link-lease.md) — the design decision and alternatives considered                     |
| App developer       | [Race-safe work-item run linking](../../apps/kanban/README.md#race-safe-work-item-run-linking) — the lease identity table, the rollback flag, and the API/curl commands |

## Lease identity at a glance

The full identity table is in
[apps/kanban/README.md#race-safe-work-item-run-linking](../../apps/kanban/README.md#race-safe-work-item-run-linking).
The minimum an operator needs is:

| Field                | Value                                                       |
| -------------------- | ----------------------------------------------------------- |
| Conflict key kind    | `work_item`                                                 |
| Conflict key value   | `work_item_dispatch:<project_id>:<work_item_id>`            |
| Owner id (lease row) | `kanban:work-item-run:<project_id>:<work_item_id>:<action>` |
| Lane                 | `dispatch`                                                  |
| Default TTL          | `30 000 ms` (constant `WORK_ITEM_RUN_LEASE_DEFAULT_TTL_MS`) |

## Rollback posture

The lease is gated by a single kanban setting:
`work_item_run_lease_enabled` (default `true`). Flipping it to
`false` short-circuits the lease acquire/release inside
`requestWorkItemRun` and falls back to the pre-ADR conditional
`linkRunIfUnlinked` UPDATE only. The flag is a one-line configuration
change with no schema or code change. See
[apps/kanban/README.md#rollback-flag-one-line-revert](../../apps/kanban/README.md#rollback-flag-one-line-revert)
for the when/why/how of the flip.

The flag controls the user-action funnel only. The dispatch-cycle
funnel and the lifecycle-projection observer retain the lease protocol
they adopted in the prior milestones; only `requestWorkItemRun` reverts
when the flag is off.

## CEO wakeup policy

`orchestration_wake_policy` (default `slot_freed`) controls when a
terminal work-item run triggers a Project Orchestration Cycle (CEO)
wakeup.

| Value            | Behaviour                                                                                                                                                                                                                                                                                 |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `slot_freed`     | Wakeup fires only when the work item's dispatch slot is freed — i.e. `isProjectDispatchActive` becomes `false` (merge to `done`, or a failure that parks the item in `blocked`). Intermediate stage transitions (`in-progress → in-review`, `in-review → ready-to-merge`) are suppressed. |
| `every_terminal` | Legacy behaviour — wakeup fires on every terminal run event regardless of slot state.                                                                                                                                                                                                     |

The global default is managed by `KanbanSettingsService` (key
`orchestration_wake_policy`). Individual projects can override it via
`PATCH /:projectId/orchestration/settings` with body
`{ "wakePolicy": "every_terminal" }` — stored in
`kanban_projects.orchestration_settings`.
