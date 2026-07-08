# ADR-20260623: Per-Work-Item Orchestration Lease for `requestWorkItemRun` Link Path

**Status:** Accepted
**Date:** 2026-06-23
**Work item:** 58a8780e-521d-480c-85a7-c7a42cd7910d
**Module:** `apps/kanban/src/work-item`
**Severity:** critical

## Context

`WorkItemService.requestWorkItemRun` is the single funnel that turns a kanban
work-item status transition (dispatch / review / merge) into a workflow run
launch against Core. After Core accepts the run, the service must persist
`linked_run_id` and `current_execution_id` on the work item so subsequent
lifecycle events can be projected back. The current implementation calls
`KanbanWorkItemRepository.linkRunIfUnlinked` — a conditional `UPDATE` whose
`WHERE linked_run_id IS NULL AND current_execution_id IS NULL` clause is
supposed to be the only race-safety barrier on the hot path.

The conditional `UPDATE` is correct as a *single-row atomic guard*, but it is
the *only* defense on a path that is interleaved with at least five other
mutators of the same row:

1. `WorkItemService.dispatchWorkItem` ↔ `submitReviewDecision` (concurrent
   user actions on the same work item — same funnel, different action).
2. `CoreLifecycleStreamConsumer.linkWorkItemRunFromLifecycleEvent` (the
   projection from `core.workflow.run.started` events).
3. `DispatchService.linkAcceptedRun` (the dispatch-cycle path that
   initializes status to `in-progress`).
4. `dispatchSelectedWorkItems.linkAcceptedRun` (the batch dispatch path).
5. `WorkItemService.requestWorkItemRun` itself, when `linkRunIfUnlinked`
   returns `false` *after* a successful `requestWorkflowRun` — the run has
   already been accepted by Core, but the work item is left without a
   `linked_run_id`, and a subsequent reconciliation cannot recover the
   causality link.

The conditional `UPDATE` defends against the "both observers see NULL"
interleaving for the *same* logical operation, but it does not (and cannot)
defend against:

- Status transitions that read the work item, mutate it, and write it back
  *around* the conditional link. If the status transition runs after the
  conditional link commits, the in-memory `item` snapshot can clobber the
  link columns and we end up with a `linked_run_id` that no longer matches
  the persisted `current_execution_id` — or a run that Core believes is
  linked to a work item the work-item row no longer acknowledges.
- Ordering between the lifecycle-projection link and a concurrent status
  transition: the projection can win and commit a `linked_run_id` that the
  subsequent status write then nulls out by spreading an older `item`
  snapshot, leaving the work item in a state where the linked run no
  longer matches the work item's current status.
- The partial-write window in which Core has accepted a run and the
  kanban-side link is `false`. The current code throws
  `ConflictException`, but the launched run is now an orphan that no
  kanban-side reconciliation can re-link (the idempotency key for the
  dispatch is per-work-item, not per-acceptance).

The work item is the unit of work that every concurrent orchestration path
contends on. The race window is small in steady state, but the failure mode
is a silent corruption of the work-item ↔ workflow-run relationship — the
orchestration hot path's primary invariant.

## Decision

We adopt **option (b) per-work-item orchestration lease** as the race-safety
mechanism for `requestWorkItemRun`. Concretely:

- Extend the existing `kanban_orchestration_leases` table with a
  `work_item` conflict key kind (already present in
  `OrchestrationConflictKeyKind` — it is currently unused for orchestration
  paths) and a new owner kind `work_item_run_request`.
- `WorkItemService.requestWorkItemRun` acquires a per-work-item lease
  *before* invoking Core, holding the lease for the duration of:
  1. The Core `requestWorkflowRun` call.
  2. The conditional `linkRunIfUnlinked` UPDATE.
  3. Any status / metadata mutations tied to this request.
- All other mutators of the same work item (`submitReviewDecision`,
  `DispatchService.linkAcceptedRun`, the lifecycle-projection link, the
  batch dispatch `linkAcceptedRun`) are required to either (a) participate
  in the same lease protocol by acquiring the same lease first, or (b)
  fail fast with a deterministic `409 Conflict` if the lease is held.
- On lease acquisition failure the caller surfaces a deterministic
  `ConflictException` and does **not** proceed to `requestWorkflowRun`,
  eliminating the orphan-run partial-write window.
- Lease TTL is bounded (default 30s, configurable) and reclaimed by the
  existing `OrchestrationLeaseSweeperService`, so a process crash mid-call
  cannot strand a work item in a permanently-leased state.

This decision is constrained to the kanban-side orchestration hot path.
Core-side ownership of the run is unaffected; the lease is purely a
kanban coordination primitive.

## Alternatives considered

### (a) DB-level pessimistic write lock via TypeORM transaction

Wrap the entire `requestWorkItemRun` body (status read, status mutation,
Core call, conditional link) in a `dataSource.transaction` with
`pessimistic_write` (`SELECT ... FOR UPDATE`) on the work-item row.

- **Pros:** simple; no new schema; no new code paths.
- **Cons:**
  - Holds a Postgres row lock for the full duration of the Core
    `requestWorkflowRun` network round-trip. With Core-side work that may
    take seconds (workflow launch, queue enqueue, project mount
    resolution), the lock is held for the entire call — every other
    mutator of the same work item blocks. This converts a probabilistic
    race into a deterministic throughput regression on the orchestration
    hot path.
  - Row-level locks do not compose with the dispatch-cycle and
    lifecycle-projection mutators that also touch the work item; every
    site must adopt the same transaction wrapper or the lock is
    bypassed, which means the original race is reintroduced.
  - The lock is only released on transaction commit/rollback — a Core
    timeout or a kanban process crash in the middle leaves the row locked
    until the connection is reaped, and Postgres does not give us a
    deterministic, application-aware timeout.
  - Pairs poorly with the existing `kanban_orchestration_leases` table:
    we would end up with two coordination primitives on the same domain
    object, which is exactly the "more than one" coordination primitive
    problem this ADR is meant to avoid.

### (b) Per-work-item orchestration lease (CHOSEN)

Extend `kanban_orchestration_leases` with a per-work-item conflict key and
acquire it for the duration of the link path.

- **Pros:**
  - Reuses an existing, battle-tested coordination primitive. The lease
    table already has TTL, owner identity, sweeper reclamation, and a
    unique-violation-based conflict path that the repository already
    implements. The lease service exposes a typed `AcquireLeaseResult`
    discriminated union that already captures "conflict" vs. "acquired".
  - Bounded TTL with sweeper reclamation means a crashed kanban process
    cannot strand a work item. The orphan window is at most one lease
    TTL.
  - Composes with the existing dispatch-cycle and lifecycle-projection
    mutators: they are required to acquire the same lease (or a
    superset) before mutating the work item, which gives us a single
    coordination protocol across all five failure modes.
  - Does not hold a Postgres row lock during the Core round-trip. The
    lease is a kanban-side coordination row, not a row lock on the
    work item itself, so concurrent reads (status queries, listing
    endpoints) are not blocked.
  - Conflict path is deterministic: a second caller observes
    `acquired: false` with a typed `LeaseConflict` and surfaces a
    `ConflictException` *before* invoking Core, eliminating the
    partial-write window.
  - One-line feature-flag rollback: the lease acquisition is wrapped in
    a feature-flag check (see Rollback). Setting the flag off returns
    the path to status quo.

- **Cons:**
  - Requires a new conflict-key kind in the existing lease table (the
    `work_item` kind is already declared in the TypeScript types but not
    yet used for orchestration paths; we will start using it).
  - Requires every mutator of the work-item link columns to adopt the
    lease protocol. We can roll this out incrementally — the first
    milestone (this ADR) instruments `requestWorkItemRun`; later
    milestones bring `DispatchService.linkAcceptedRun`,
    `dispatchSelectedWorkItems.linkAcceptedRun`, and
    `linkWorkItemRunFromLifecycleEvent` under the same protocol.
  - Requires the `OrchestrationLeaseSweeperService` to be running.
    Today it is wired into the kanban `ControlPlaneModule`; the
    work-item module must depend on (or share) the sweeper so a
    crashed `requestWorkItemRun` does not strand the lease.

### (c) Postgres advisory lock keyed on `(project_id, work_item_id)`

Acquire a session-level or transaction-level `pg_advisory_xact_lock(hashtextextended(project_id || ':' || work_item_id))` around the link path.

- **Pros:** zero schema change; the lock is automatically released on
  transaction end; no new code path on the read side.
- **Cons:**
  - Advisory locks are *session/transaction-scoped*, not
    *application-scoped*. If the application leaks a connection (a
    kanban worker that does not release the connection after the
    workflow run is launched), the lock is held until the connection
    is reaped, and Postgres does not give us a deterministic,
    application-aware timeout — same outage profile as (a).
  - Advisory locks are not visible in the application's own state.
    They cannot be queried (`pg_locks` is the only window), they
    cannot be swept, and they cannot be listed for an operator. This
    makes production debugging of "why is this work item stuck" much
    harder than the kanban lease, which is a first-class row.
  - Hash collisions on `hashtextextended` are vanishingly rare for
    `(project_id, work_item_id)` tuples but non-zero; the existing
    lease uses a `UNIQUE(project_id, conflict_key_kind,
    conflict_key_value, status)` constraint that has a deterministic
    conflict path. Advisory-lock collisions are silent lock waits.
  - Advisory locks are not composable with the lifecycle-projection
    consumer, which is a stream-driven background worker that does
    not necessarily run inside a single transaction with the
    work-item write — making the protocol brittle.

## Why option (b) wins

The decisive factors are (i) the bounded TTL with sweeper reclamation,
(ii) the deterministic `AcquireLeaseResult` discriminated union, and (iii)
the composition with the existing dispatch-cycle and lifecycle-projection
mutators. The lease gives us a single coordination primitive on a single
domain object, with an application-aware timeout and a first-class
operator-visible state row, that the existing `kanban_orchestration_leases`
table already provides. The advisory-lock option duplicates the lease
table's responsibility for half of its properties and gives up the
operator-visible state. The pessimistic-lock option holds a row lock for
the duration of a network round-trip and does not compose with the other
mutators.

## Lease protocol

| Field | Value |
| --- | --- |
| Conflict key kind | `work_item` |
| Conflict key value | `work_item_dispatch:<project_id>:<work_item_id>` (encoded with the `work_item_dispatch:` prefix; see `WorkItemRunLeaseService.buildConflictKey` in `apps/kanban/src/work-item/work-item-run-lease.ts`) |
| Owner kind | `work_item_run_request` (new) |
| Owner id (lease row) | `kanban:work-item-run:<project_id>:<work_item_id>:<action>` (deterministic 4-tuple; derived from the inputs by `WorkItemRunLeaseService.deriveOwnerId`) |
| Owner id (per-request) | `<deterministic id>:<request_correlation_id>` (used as the `acquireRunLease` input so the request id is preserved on lease metadata for operator-visible tracing) |
| Lane | `dispatch` (see `WorkItemRunLeaseService.LANE`; the table reservation is shared with the dispatch-cycle funnel) |
| Action taxonomy | `dispatch` / `review` / `merge` (user actions) + `lifecycle_link` / `dispatch_selected` (internal) |
| Default TTL | 30 000 ms (`WORK_ITEM_RUN_LEASE_DEFAULT_TTL_MS` in `apps/kanban/src/orchestration/control-plane/control-plane.types.ts`) |
| Sweeper | existing `OrchestrationLeaseSweeperService` (30s tick) |

The lease is acquired with the deterministic 4-tuple id as the lease
row `owner_id` so that the release path is straightforward: any
holder — user-action funnel, dispatch-cycle funnel, lifecycle-
projection observer — can release a lease for a `(project_id,
work_item_id, action)` tuple without per-request state. The
per-request correlation id is preserved on the lease metadata for
operator-visible tracing. The lease is released in a `finally` block
on the happy path and on the conflict path.

## Rollback

The lease acquisition is gated by a single kanban setting,
`work_item_run_lease_enabled` (default `true`). The setting is
declared in `apps/kanban/src/settings/kanban-settings.constants.ts`
and validated by `packages/kanban-contracts/src/settings.schema.ts`.
The setting is read by `requestWorkItemRun` via
`KanbanSettingsService.getBoolean("work_item_run_lease_enabled")` at
the top of every call; the value falls back to the registry default
when the setting row is missing or corrupted, so a degraded database
defaults to the *safe* (lease-protected) behaviour. Setting the flag
to `false` short-circuits the lease acquisition and release in
`requestWorkItemRun` (see `WORK_ITEM_RUN_LEASE_ENABLED_SETTING_KEY` in
`apps/kanban/src/work-item/work-item-run.helpers.ts`), returning the
user-action funnel to the pre-ADR status quo (no lease, conditional
`linkRunIfUnlinked` UPDATE only). This is a one-line configuration
change in `KanbanSettingsService` (the `POST /api/settings` endpoint
or `KanbanSettingsService.set(...)` in code) and does not require a
schema rollback — the lease table is unchanged and unused while the
flag is off.

The flag controls the user-action funnel only. The dispatch-cycle
funnel and the lifecycle-projection observer retain the lease protocol
they adopted in the prior milestones; only `requestWorkItemRun`
reverts when the flag is off. This is intentional: the F1/F2 race
windows reopen only for the user-action funnel, while the
dispatch-cycle and lifecycle-projection paths stay serialized against
each other and against the user-action funnel via the dispatch-cycle
lease.

The operator runbook for detection, holder identification, and manual
release is at
[`docs/operations/README.md#work-item-run-link-lease-contention`](../operations/README.md#work-item-run-link-lease-contention).
The developer handbook is at
[`apps/kanban/README.md#race-safe-work-item-run-linking`](../apps/kanban/README.md#race-safe-work-item-run-linking).

If the lease causes production contention regressions — for example, if a
deployment with extremely high `requestWorkItemRun` QPS saturates the
lease table's `idx_kanban_orchestration_leases_project_lane_status`
index — the rollback is the same flag flip. We commit to monitoring the
following dashboards for at least 14 days after enabling the flag:

- `kanban_orchestration_lease_acquire_conflict_total` (counter).
- `kanban_orchestration_lease_acquire_latency_ms` (histogram).
- `kanban_work_item_request_work_item_run_total{outcome="lease_conflict"}`
  (counter).

A regression on any of these above the pre-ADR baseline is the trigger
for the flag flip.

## Consequences

- `WorkItemService.requestWorkItemRun` becomes the canonical writer of
  `linked_run_id` / `current_execution_id` for the dispatch, review, and
  merge actions. The dispatch-cycle and lifecycle-projection writers are
  *additional* writers; their updates are guarded by the same lease
  protocol starting in the milestone that brings them under it.
- The orphan-run partial-write window closes: a conflict on lease
  acquisition surfaces a `ConflictException` *before* Core is invoked.
- Lease state is now first-class operational data. Operators can query
  `kanban_orchestration_leases` for `conflict_key_kind = 'work_item'` to
  see in-flight work-item transitions, which is a new operator surface
  that did not exist before.
- The `work_item` conflict key kind, which was already declared in the
  TypeScript types, becomes load-bearing. Removing it from the union
  would now break the protocol.

## Acceptance criteria satisfied

- **AC-1, AC-2, AC-4** (failure-mode inventory): see
  `apps/kanban/src/work-item/README.md`, which enumerates the six
  interleavings the current `requestWorkItemRun` cannot defend against and
  pairs each with a target test case for Milestone 6.
- **AC-6, AC-8** (race-safety strategy documented): this ADR compares
  the three alternatives and selects (b) with an explicit one-line
  feature-flag rollback. The flag is wired in code as
  `work_item_run_lease_enabled` in
  `apps/kanban/src/work-item/work-item-run.helpers.ts`
  (`WORK_ITEM_RUN_LEASE_ENABLED_SETTING_KEY`); the operator runbook is
  at
  `docs/operations/README.md#work-item-run-link-lease-contention`.
