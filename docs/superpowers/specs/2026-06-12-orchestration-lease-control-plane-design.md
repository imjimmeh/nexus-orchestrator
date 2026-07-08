# Orchestration Lease-Based Control Plane — Design

**Date:** 2026-06-12
**Status:** Draft (awaiting review)
**Owner:** Orchestration / Kanban control plane

## 1. Background & Motivation

The project-orchestration control plane (EPIC-197) gates every CEO orchestration
cycle and every direct board mutation through a "world model + scheduler" built
on three primitives: **intents**, **facts**, and **conflict keys**, organized
into concurrent **lanes**.

The primitives are sound and serve a real product goal: running multiple
work-streams per project concurrently (ideation, work-item generation,
implementation, backlog/ticket refinement). The failures come from _how
concurrency is enforced_, not from the existence of concurrency.

### The defect

Mutual exclusion is implemented implicitly: **any non-terminal intent
(`pending` / `launchable` / `running`) that carries a conflict key holds that
key as a lock for as long as it stays non-terminal.** Liveness therefore depends
on some caller _remembering_ to terminalize the intent (`completeIntent` /
`terminalizeIntent`). There is no owner, no TTL, and no expiry. An intent that is
born and never advanced holds its conflict key **forever**.

### Confirmed incident (2026-06-12, project `458935f0`)

1. A provider returned `400 Invalid 'tools[N].function.name'` because a governed
   tool name contained a dot (`kanban.*`), failing every CEO turn. (Root cause
   fixed independently in commit `8f8883c8`.)
2. Each failed run spawned a `reconcile_stale_links` repair intent and a
   `validate_project_health` strategy intent. One `validate_project_health`
   intent stuck in `pending` held conflict key
   `workflow_scope:project_orchestration_cycle_ceo:<pid>`.
3. Every subsequent 60s wakeup created a new validate intent, found the stuck one
   via `findActiveByConflictKeys`, recorded `blocked / conflict_key_active`, and
   suppressed itself (`manual_suppression`). **The CEO cycle never launched.**
4. Restarting the stack did nothing — the deadlock lived in the database. Manual
   recovery required calling `reset-intents`, which is normally an MCP tool the
   CEO agent calls — but the CEO could not run, so recovery was circular.

### Structural problems (verified against source)

| #   | Problem                                                                                                                                                   | Location                                                                                                       |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 1   | **No intent lifecycle owner / TTL.** Non-terminal intents hold conflict keys indefinitely.                                                                | `kanban-orchestration-intent.repository.ts:91-126`, `orchestration-control-plane-scheduler.service.ts:220-247` |
| 2   | **Three redundant CEO-cycle guards** (intent conflict key + `hasActiveOrPendingCycle` + engine `max_runs:1`), none coordinated; source of self-conflicts. | `project-orchestration-wakeup.service.ts:70-115`, `concurrency-policy.service.ts`                              |
| 3   | **Intents used as audit-log rows** (created then immediately suppressed). Same conflation that caused `ceo-scheduler-self-conflict`.                      | `project-orchestration-wakeup.service.ts:49-169`                                                               |
| 4   | **Two divergent state records** — `kanban_orchestrations.status='orchestrating'` + null `linked_run_id` vs. the intent tables.                            | `orchestration-state-lifecycle.service.ts`, `orchestration.service.ts:326-340`                                 |
| 5   | **Idempotency-key resurrection** — terminal intent → `key:<Date.now()>` → duplicate intents with the same conflict keys.                                  | `kanban-orchestration-intent.repository.ts:33-35`                                                              |
| 6   | **Recovery is MCP-only** → circular dependency when the control plane is stuck.                                                                           | `orchestration-reset-intents.tool.ts`                                                                          |

## 2. Goals & Non-Goals

### Goals

- A single, **owned, self-expiring** concurrency primitive — a **lease** — keyed
  by conflict key. Mutual exclusion no longer depends on anyone remembering to
  release.
- **Correctness independent of any background job:** a dead holder is reclaimed
  lazily at the next acquire attempt; the sweeper is for proactive cleanup and
  telemetry only.
- Collapse the CEO-cycle serialization to **one** mechanism (the lease).
- Preserve and make-safe **per-lane concurrency** (the product goal).
- **Separate control from audit** — leases gate concurrency; a journal records
  what was requested and why it did/didn't run.
- One source of truth for orchestration status; no divergent records.
- **Automatic + HTTP recovery**; eliminate the circular recovery dependency.

### Non-Goals

- The CEO agent's decision logic and ADR-0026 mutating-authority model are
  unchanged.
- The **facts / freshness** subsystem keeps its current semantics — it is sound
  and orthogonal to locking.
- Cross-project orchestration / global scheduling.
- Changing the generic workflow-engine concurrency policy for non-orchestration
  workflows.

## 3. Core Concept — The Lease

A **lease** is a held lock on a conflict key, owned by an identifiable holder and
valid only until it expires.

### 3.1 Schema — `kanban_orchestration_leases`

| Column               | Type             | Notes                                                                                                |
| -------------------- | ---------------- | ---------------------------------------------------------------------------------------------------- |
| `id`                 | uuid PK          |                                                                                                      |
| `project_id`         | uuid             |                                                                                                      |
| `conflict_key_kind`  | varchar(32)      | `workflow_scope` \| `work_item` \| `target_branch` \| `file_path` \| `module_path` \| `workflow_run` |
| `conflict_key_value` | varchar(512)     |                                                                                                      |
| `lane`               | varchar(64)      | work-stream that holds it                                                                            |
| `owner_kind`         | varchar(32)      | `workflow_run` \| `cycle_request` \| `direct_mutation`                                               |
| `owner_id`           | varchar(255)     | run id / correlation id                                                                              |
| `status`             | varchar(16)      | `active` \| `released` \| `expired`                                                                  |
| `acquired_at`        | timestamptz      |                                                                                                      |
| `heartbeat_at`       | timestamptz      |                                                                                                      |
| `expires_at`         | timestamptz      | heartbeat-extended                                                                                   |
| `released_at`        | timestamptz null |                                                                                                      |
| `metadata`           | jsonb null       | reason, evidence ref, intent id                                                                      |

**The invariant** — at most one _active_ lease per key — is enforced in the
database, not in application code:

```sql
CREATE UNIQUE INDEX uq_active_lease
  ON kanban_orchestration_leases (project_id, conflict_key_kind, conflict_key_value)
  WHERE status = 'active';
```

This makes mutual exclusion atomic and race-free: two concurrent acquirers of the
same key cannot both insert an `active` row.

### 3.2 Operations (`OrchestrationLeaseService`)

- **`acquire(projectId, keys[], owner, lane, ttlMs)`** — single transaction:
  1. **Lazy reclaim:** `UPDATE … SET status='expired' WHERE status='active' AND expires_at < now()` for the requested keys. A dead holder never blocks a live acquirer.
  2. Acquire keys in **canonical sorted order** (deadlock-free for multi-key acquirers).
  3. Insert `active` leases for all keys, **all-or-nothing**. A unique-violation on any key → acquisition fails, returning the live conflicting holder(s).
     Returns `{ acquired: true, leaseIds }` or `{ acquired: false, conflicts: [...] }`.
- **`heartbeat(leaseId)`** — `expires_at = now() + ttlMs`; called by the holder while alive.
- **`release(leaseId, ownerId, outcome)`** — `status='released'`, owner-matched (a stale holder cannot release a reissued lease).
- **`sweep()`** — periodic: expire `active` leases past `expires_at`; **emit telemetry** when reclaiming (a holder died without releasing → visible alert, not a silent deadlock). Correctness does **not** depend on this running.

> **Key property:** liveness is guaranteed by lazy reclaim at acquire time. Even
> with the sweeper disabled, a new acquirer always makes progress once the dead
> holder's TTL elapses. The incident above becomes impossible by construction.

### 3.3 Lane concurrency

`lane` is an attribute of the lease. **Lane capacity** = count of `active` leases
in that lane for the project; a lane-capped acquire checks
`active_in_lane < capacity` (replacing `isLaneCapacityReached`). Cross-lane
concurrency is the default: dispatch-lane and generation-lane leases carry
different keys and coexist. This is the mechanism that delivers the concurrent
product-development vision safely.

## 4. How Each Flow Uses Leases

### 4.1 CEO cycle (collapses 3 guards → 1)

`requestWakeup` / `requestOrchestrationCycle`:

1. `acquire([workflow_scope:ceo:<pid>], owner={cycle_request, correlationId}, lane=strategy, ttl)`.
2. **Fail** → a live cycle holds it → record a journal outcome (`active_cycle_exists`); no launch. No intent created as a lock.
3. **Success** → emit `ProjectOrchestrationCycleRequestedEvent` → Core launches `project_orchestration_cycle_ceo`.
4. The run **rebinds** the lease owner to `workflow_run:<runId>` and **heartbeats** it while `RUNNING`.
5. On terminal run (lifecycle stream) → **release** the lease (owner-matched).

`hasActiveOrPendingCycle` is **deleted**. The engine-level `max_runs:1 /
on_conflict:skip` remains as a silent Core-boundary backstop (Kanban will not emit
a launch event without holding the lease, so it should never fire) — documented,
not relied upon.

### 4.2 Direct mutations (work-item transition, dispatch)

Acquire `work_item:<id>` / `target_branch:<branch>` leases for the mutation's
duration instead of creating conflict-key intents. Fact-freshness preflight is
unchanged and runs before acquire.

### 4.3 Orchestration status derivation

`kanban_orchestrations.status` for the CEO cycle **derives** from the lease:
`orchestrating` iff an active `workflow_scope:ceo` lease exists; otherwise `idle`
(or `paused` when a human stop-decision is set). `linked_run_id` = the lease's
owner run. The `orchestrating`+null-`linked_run_id` divergence cannot occur.

## 5. Disposition of Intents

Intents are **demoted from locks to a journal**. They remain the durable record
of "a cycle/mutation was requested, here is its evidence/freshness requirement and
its outcome," but they **no longer carry mutual-exclusion semantics**:

- `findActiveByConflictKeys` and all conflict-key blocking logic are **deleted**.
- The idempotency-key resurrection hack is **deleted**.
- Intents become append-only journal rows (or are merged into
  `scheduler_outcomes`); they are never "held," so they cannot deadlock.
- `reconcile_stale_links` accumulation disappears — stale links are resolved by
  lease release/expiry on the linked run, not by piling up repair intents.

The scheduler's residual responsibility shrinks to: **check fact freshness +
acquire a lease**.

## 6. Recovery

- **Automatic (primary):** leases expire; dead holders are reclaimed at the next
  acquire (lazy) or by the sweeper. No operator action needed for the incident
  class above.
- **HTTP backstop:** `POST /api/projects/:id/orchestration/leases/release-all`
  force-expires active leases (mirrors the existing MCP tool, but reachable when
  the CEO cannot run). The MCP `reset_orchestration_intents` tool is retargeted to
  release leases.
- **Observability:** sweeper telemetry turns silent reclaims into alerts; the
  decision executor surfaces the **real** reason (lane capacity / fresh-fact)
  instead of masking everything as `terminalized`.

## 7. Phasing

### Phase 0 — Hardening (ship immediately, independent of the lease model)

- HTTP recovery endpoint mirroring the MCP reset → breaks the circular recovery
  dependency now.
- TTL/age-based reaper for orphaned non-terminal intents in the **current** model
  → incidents auto-heal before leases land.
- Fix reason-masking in `orchestration-decision-executor.service.ts`.

### Phase 1 — Lease core (behind a feature flag)

- `kanban_orchestration_leases` table + partial unique index (migration).
- `OrchestrationLeaseService`: acquire (lazy-reclaim, canonical order,
  all-or-nothing), heartbeat, release, sweep.
- Full TDD: invariants, contention, expiry reclaim, multi-key all-or-nothing.

### Phase 2 — Cut over the CEO cycle (flagged, with shadow mode)

- Shadow first: acquire the lease **and** keep the old conflict-key check, logging
  disagreements; flip once clean.
- `requestWakeup` uses lease acquire; delete `hasActiveOrPendingCycle`.
- Run heartbeats; lifecycle stream releases; status/`linked_run_id` derive from
  lease.

### Phase 3 — Lanes, direct mutations & cleanup

- Direct mutations + dispatch acquire work-item/branch leases.
- Lane capacity = active-lease count per lane.
- **Delete** `findActiveByConflictKeys`, conflict-key blocking, the resurrection
  hack, `reconcile_stale_links` accumulation, and `hasActiveOrPendingCycle`
  remnants. No compatibility shims (aggressive-hygiene mandate).

## 8. Testing Strategy

- **TDD** throughout. Lease invariants are the core spec:
  - at most one `active` lease per key (concurrent acquirers → exactly one wins);
  - an expired holder never blocks a new acquirer (lazy reclaim);
  - release is idempotent and owner-matched;
  - multi-key acquire is all-or-nothing;
  - heartbeat extends `expires_at`.
- **Incident regression test:** orphan a holder (acquire, never release/heartbeat),
  advance past TTL, assert the next cycle acquires and launches.
- **Conformance:** existing kanban orchestration E2E
  (`test:e2e:kanban:deterministic`) stays green across the cutover.

## 9. Risks & Mitigations

| Risk                                                          | Mitigation                                                                                                      |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Cutover races between old intents and new leases              | Phase 2 shadow mode logs disagreements before flipping the flag                                                 |
| TTL too short → live run's lease falsely reclaimed mid-flight | Heartbeat while RUNNING + TTL = max step runtime + grace; reclaim only past `expires_at`; owner-matched release |
| Multi-key acquire deadlock between two acquirers              | Canonical sorted key order + single-transaction all-or-nothing                                                  |
| Hidden consumers of intent conflict-key semantics             | Inventory all `conflict_keys` readers in Phase 1; migrate in Phase 3 before deletion                            |

## 10. Affected Components

- `apps/kanban/src/orchestration/control-plane/` — new `OrchestrationLeaseService`; scheduler shrinks to freshness + lease acquire.
- `apps/kanban/src/database/` — new lease entity + repository + migration; intent repository loses conflict-key/resurrection logic.
- `apps/kanban/src/orchestration/project-orchestration-wakeup.service.ts` — lease-based gate; `hasActiveOrPendingCycle` deleted.
- `apps/kanban/src/orchestration/orchestration-continuation-reconciler.service.ts`, `apps/kanban/src/core/core-lifecycle-stream.consumer.ts` — release leases on terminal runs; heartbeat wiring.
- `apps/kanban/src/orchestration/orchestration.controller.ts` / `project.controller.ts` — HTTP `release-all` endpoint.
- `apps/kanban/src/mcp/tools/mutation/orchestration-reset-intents.tool.ts` — retargeted to release leases.
- `apps/api/src/workflow/concurrency-policy.service.ts` — unchanged; documented as silent backstop for the orchestration workflow.

```

```
