# Operations Runbooks

This folder contains operator-facing runbooks for lifecycle behaviors and incident response.

## Current Runbooks

- [dispatch-polling-runbook.md](dispatch-polling-runbook.md)
- [ceo-restart-continuity-runbook.md](ceo-restart-continuity-runbook.md)
- [orchestration-lifecycle-hardening-runbook.md](orchestration-lifecycle-hardening-runbook.md)
- [orchestration-stall-recovery.md](orchestration-stall-recovery.md) — SQL diagnosis and recovery for stalled workflow runs
- [orchestration-run-storm-diagnostics.md](orchestration-run-storm-diagnostics.md)
- [orchestration-worktree-conflicts.md](orchestration-worktree-conflicts.md)
- [steering-operations-runbook.md](steering-operations-runbook.md)
- [workflow-required-tools-audit-runbook.md](workflow-required-tools-audit-runbook.md)
- [war-room-retrospective-runbook.md](war-room-retrospective-runbook.md)
- [service-split-migration-dashboard.md](service-split-migration-dashboard.md)
- [service-split-phase-exit-checklist.md](service-split-phase-exit-checklist.md)
- [multi-service-cutover-runbook.md](multi-service-cutover-runbook.md)
- [chat-memory-lifecycle-runbook.md](chat-memory-lifecycle-runbook.md)
- [oauth-providers.md](oauth-providers.md) — subscription OAuth provider token auto-refresh and 401 incident recovery
- [compatibility-layers-and-legacy-removal.md](compatibility-layers-and-legacy-removal.md)
- [host-mount-rollout-execution.md](host-mount-rollout-execution.md)
- [gitops-pr-workflow.md](gitops-pr-workflow.md)
- [gitops-seeding-migration.md](gitops-seeding-migration.md)
- [api-migration-baseline-runbook.md](api-migration-baseline-runbook.md)
- [refresh-token-hmac-deploy.md](refresh-token-hmac-deploy.md) — bcrypt → HMAC-SHA-256 refresh-token hash refactor: deploy steps, breaking-change procedure, `REFRESH_TOKEN_HMAC_KEY` setup
- [RUNBOOK-EPIC135-observability.md](RUNBOOK-EPIC135-observability.md)
- [EPIC-070-rollout.md](EPIC-070-rollout.md)
- [self-improvement-project.md](self-improvement-project.md) — configuring `self_improvement_project_id`, the code-change bridge, and dead-letter recovery for parked improvement-task events
- [Work-item run link lease contention](#work-item-run-link-lease-contention) — detection, holder identification, and manual release for the per-work-item orchestration lease guarding `requestWorkItemRun`

## Diagnostics

For a failed or stuck workflow run, start with the guide rather than the runbooks:

1. **[43 — Repair Diagnostics Operator Guide](../guide/43-repair-diagnostics-operator-guide.md)** — end-to-end diagnostic journey: Doctor checks → event ledger → manual repair → configuration verification.
2. **[10 — Workflow Repair](../guide/10-workflow-repair.md)** — failure classification, repair policies, operator configuration, and manual endpoints.
3. **[20 — Operations](../guide/20-operations.md)** — Doctor framework, the 8 health checks, and repair executor actions.

The Operations Doctor provides automated diagnostics and targeted repair:

- API: `GET /api/operations/doctor` (full health report), `POST /api/operations/doctor/repair` (execute a repair action)
- All repairs support `dry_run: true` mode and persist execution history in `doctor_repair_history`
- Doctor checks and repair delegation are bridged automatically when `workflow_repair_delegation_enabled = true`

For SQL-level diagnosis of stalled orchestrations specifically, see [orchestration-stall-recovery.md](orchestration-stall-recovery.md).

## Usage

1. Start with the diagnostic guide for incident triage:
   - `../guide/43-repair-diagnostics-operator-guide.md`

2. For architecture context before making changes:
   - `../architecture/failure-classification-repair.md`
   - `../architecture/operations-doctor.md`
   - `../architecture/workflow-engine.md`

3. Follow the runbook verification checklist before recovery actions.

4. Record incident findings in `docs/analysis/` if behavioral gaps are discovered.

## Service Shutdown Freeze/Resume

When you rebuild the API mid-run with `docker compose up -d --build api`, in-flight agent containers are **paused and resumed automatically** — they are no longer left erroring on their callbacks. The same applies to the kanban service on its own rebuild (kanban does not own Docker, so it relies on the resilience retry layer rather than pausing containers). See [ADR-0028](../adrs/0028-service-shutdown-pause-resume-of-in-flight-agents.md) and the guide section "Service shutdown freeze/resume" in [../guide/README.md](../guide/README.md).

**What happens on `docker compose up -d --build api` mid-run:**

1. The old API container receives SIGTERM and enters `draining`: BullMQ step workers pause, then each in-flight execution of a freezable kind (`workflow_step`, `workflow_chat`, `adhoc_chat`) with a live container is `docker pause`d and marked `frozen` in the `executions` table.
2. The new API container boots in `booting` phase; the `StartupResumeCoordinator` finds every `frozen` row, `docker unpause`s the still-present containers, clears the flag, and flips the phase to `running` — releasing the watchdogs.
3. Subagents are **not** frozen and any execution not frozen within the budget rides the agent → API retry/backoff safety net instead.

**Reading the resume summary:**

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  http://localhost:3010/api/operations/lifecycle/resume-summary
```

Returns `{ frozenFound, resumed, failed, lastResumeAt }`. `failed > 0` means containers were gone on boot (e.g. a full host restart) and hit the degraded rehydrate fallback — `workflow_step` rows recover via stale-run reconciliation, but chat executions need manual recovery. The same figures render in the web Doctor page (`ResumeSummaryPanel`). Per-execution `execution.paused` / `execution.resumed` events are in the `event_ledger` (domain `execution`).

**`stop_grace_period` ↔ `EXECUTION_FREEZE_BUDGET_MS` coupling:**

The freeze sweep must finish before Docker force-kills the container. `docker-compose.yaml` sets `stop_grace_period: 30s` on both `api` and `kanban`; `EXECUTION_FREEZE_BUDGET_MS` (default `20000`, hard-capped `25000`) must stay strictly below that grace period. If you raise the freeze budget, raise `stop_grace_period` to match first — otherwise the sweep is truncated by SIGKILL and unfrozen executions fall back to the resilience net. The compose file carries an inline comment reminding operators to keep the two in sync.

## Decisions

- Restart continuity policy decisions are tracked in `docs/adrs/`

## Heavy Runner Image

The `nexus-heavy:latest` Docker image is used for implementation subagents that run verification commands. It intentionally includes workspace `devDependencies` (vitest, @eslint/js, eslint, unplugin-swc, etc.) to enable test and lint execution inside heavy containers.

To verify toolchain availability in the heavy image:

```bash
docker build -f docker/Dockerfile.heavy -t nexus-heavy:latest .
docker run --rm nexus-heavy:latest sh -lc "npx vitest --version && npx eslint --version"
```

The `--include=dev` flag in the Dockerfile ensures dev dependencies are installed even when `NODE_ENV=production` is set.

### Lockfile-drift self-healing entrypoint

The heavy image bakes `node_modules` at `/app/node_modules` and exposes it to the
bind-mounted `/workspace` via a symlink. If a dependency is added to
`package.json`/`package-lock.json` **after** the image was last built, that
symlink points at stale deps and in-container commands (`npm run build`, the
auto-merge quality gate) fail with `Cannot find module '<new-dep>'`.

`docker/heavy-entrypoint.sh` guards against this: on startup it compares the
mounted workspace's `package-lock.json` against the image's baked lockfile. When
they match (or the workspace has no lockfile) it keeps the fast symlink path;
when they have **drifted** it materialises a workspace-local `node_modules`
(seed-copied from the image, then `npm install --ignore-scripts` to reconcile the
delta) so each container self-heals instead of running against stale deps. Logic
is covered by `docker/heavy-entrypoint.test.sh` (run `sh docker/heavy-entrypoint.test.sh`).

This is a safety net, not a substitute for rebuilding: **rebuild
`nexus-heavy:latest` and `nexus-light:latest` after any dependency change** so the
fast path stays correct and the drift install is never needed at gate time.

## Work-item run link lease contention

This runbook covers the per-work-item orchestration lease that protects
the `WorkItemService.requestWorkItemRun` link path. The lease is a row
in `kanban_orchestration_leases` that serialises concurrent writers on
the same `(project_id, work_item_id)` tuple — the user-action funnel
(dispatch / review / merge), the dispatch-cycle funnel, and the
lifecycle-projection observer all participate. The protocol is
documented in
[`docs/architecture/ADR-20260623-work-item-run-link-lease.md`](../architecture/ADR-20260623-work-item-run-link-lease.md);
the developer handbook is in
[`apps/kanban/README.md#race-safe-work-item-run-linking`](../apps/kanban/README.md#race-safe-work-item-run-linking).

The lease is bounded by `WORK_ITEM_RUN_LEASE_DEFAULT_TTL_MS = 30 000 ms`
(constant in `apps/kanban/src/orchestration/control-plane/control-plane.types.ts`)
and reclaimed by the existing `OrchestrationLeaseSweeperService` on a 30s
tick. A lease that lingers past the TTL is a sweeper failure or a TTL
that is too tight for the Core `requestWorkflowRun` round-trip; both
manifest the same way on the wire and need the same triage.

### Detection — find a stuck work-item lease

A work-item lease is identifiable in the lease table by the
`conflict_key_kind = 'work_item'` column (the only kind that uses the
`work_item_dispatch:` value prefix) and the `owner_kind =
'work_item_run_request'` column. A lease that should have been
released is one where `status = 'active'` and `expires_at < now()` —
the conditional UPDATE in the lease sweeper has not reclaimed it. The
following query surfaces that state across all projects:

```sql
-- Stuck work-item run leases (active past the TTL).
SELECT
  id,
  project_id,
  conflict_key_kind,
  conflict_key_value,
  lane,
  owner_kind,
  owner_id,
  acquired_at,
  expires_at,
  EXTRACT(EPOCH FROM (now() - expires_at)) AS seconds_overdue
FROM kanban_orchestration_leases
WHERE conflict_key_kind = 'work_item'
  AND status = 'active'
  AND expires_at < now()
ORDER BY expires_at ASC;
```

A non-empty result is a _symptom_, not a _cause_. The cause is one of:

- **The kanban process holding the lease crashed before the
  `releaseRunLease` `finally` block could run.** The sweeper is
  supposed to reclaim these within 30s. If the sweeper is healthy
  (see the lease-sweeper runbook entry), this should be transient —
  verify the row disappears within one sweeper tick.
- **The Core `requestWorkflowRun` round-trip exceeds the TTL.** A Core
  degradation that pushes the round-trip over 30s will hold every
  work-item lease past the TTL until the call returns. The
  `kanban_orchestration_lease_acquire_latency_ms` histogram
  p99 above 30s is the leading indicator.
- **The sweeper itself is degraded.** Check the kanban logs for
  `OrchestrationLeaseSweeperService` errors and the
  `kanban_orchestration_lease_sweep_duration_ms` histogram.

### Holder identification — who holds the lease

For every lease row returned by the detection query, the holder is
identified by the `owner_kind` and `owner_id` columns. The
`owner_id` for a work-item run lease is the deterministic 4-tuple
`kanban:work-item-run:<project_id>:<work_item_id>:<action>` where
`action ∈ {dispatch, review, merge, lifecycle_link,
dispatch_selected}`. The following query joins the lease row to the
work-item row so the operator can see the work item that the lease
is guarding:

```sql
-- Active work-item run leases (any TTL state) with the work item.
SELECT
  l.id AS lease_id,
  l.project_id,
  l.conflict_key_value,
  l.owner_kind,
  l.owner_id,
  l.status,
  l.acquired_at,
  l.expires_at,
  w.id AS work_item_id,
  w.title AS work_item_title,
  w.status AS work_item_status,
  w.linked_run_id,
  w.current_execution_id
FROM kanban_orchestration_leases l
LEFT JOIN kanban_work_items w
  ON w.project_id = l.project_id
  AND 'work_item_dispatch:' || l.project_id::text || ':' ||
     split_part(l.conflict_key_value, ':', 3) = l.conflict_key_value
WHERE l.conflict_key_kind = 'work_item'
  AND l.status = 'active'
ORDER BY l.acquired_at ASC;
```

The deterministic `owner_id` is what makes the manual release safe:
releasing by the deterministic id matches exactly the row acquired by
the same `(project_id, work_item_id, action)` tuple, and does not
inadvertently release a different concurrent holder. The action
taxonomy is documented in
[`apps/kanban/README.md#race-safe-work-item-run-linking`](../apps/kanban/README.md#race-safe-work-item-run-linking).

### Manual release procedure

When a stuck lease is confirmed (sweeper failure, Core degradation, or
a known holder crash that will not be naturally resolved), the
operator can release the row manually. The release is a row update
that mirrors the production `releaseRunLease` path's effect on the
lease table; it does not require coordinating with the kanban
process. The procedure is:

```sql
-- Manual release of a specific work-item run lease.
-- Run the detection query first to confirm the lease id, then:
UPDATE kanban_orchestration_leases
SET status = 'released',
    released_at = now()
WHERE id = '<lease_id>'
  AND conflict_key_kind = 'work_item'
  AND status = 'active'
RETURNING id, owner_id, released_at;
```

**Pre-conditions:**

- The lease id is known (from the detection query above).
- The lease has been active for longer than one sweeper tick
  (>30s past `expires_at`) so the sweeper has had a chance to
  reclaim it.
- The kanban process holding the lease is confirmed crashed or
  unreachable. Releasing a live holder's lease is safe but
  counter-productive — the next request from the same funnel will
  acquire a fresh lease and the cycle repeats.

**Post-conditions:**

- The next `requestWorkItemRun` call for the same
  `(project_id, work_item_id, action)` tuple acquires a fresh
  lease. The conditional `linkRunIfUnlinked` UPDATE remains the
  only race-safety barrier for the first request after the manual
  release, so the F1/F2 windows reopen for that single call.
- The kanban `kanban_orchestration_lease_release_total{kind="work_item"}`
  counter increments by one (counted by the lease release path on
  the next call).

**Bounded release** (when the work item is known but the lease id is
not): the `owner_id` is deterministic, so a release by owner is
equivalent to a release by lease id for the matching tuple. Prefer the
lease-id path above when the id is known — the owner-id path releases
_all_ active leases for the same tuple, which is more than you may
have intended if two actions are racing on the same work item:

```sql
-- Bounded release by deterministic owner_id.
UPDATE kanban_orchestration_leases
SET status = 'released',
    released_at = now()
WHERE project_id = '<project_id>'
  AND owner_id = 'kanban:work-item-run:<project_id>:<work_item_id>:<action>'
  AND status = 'active'
RETURNING id, released_at;
```

### Rollback — disable the lease entirely

If lease contention is a sustained production regression (e.g. a
high-QPS deployment saturates the lease table's
`idx_kanban_orchestration_leases_project_lane_status` index), the
operator can disable the lease for the user-action funnel only. The
dispatch-cycle and lifecycle-projection writers retain the lease
protocol they adopted in the prior milestones; only
`requestWorkItemRun` reverts.

The flag is the kanban setting `work_item_run_lease_enabled` (default
`true`). Flipping it to `false` is a one-line configuration change
with no schema or code change; the value is read on every
`requestWorkItemRun` call so the next request after the flip sees
the new value. The flag-flip API is documented in
[`apps/kanban/README.md#rollback-flag-one-line-revert`](../apps/kanban/README.md#rollback-flag-one-line-revert).

**Trade-off of the flag-flip:** the F1/F2 windows reopen for the
user-action funnel only. The conditional `linkRunIfUnlinked` UPDATE
remains the only race-safety barrier on the rollback path, which is
the pre-ADR behaviour. The dispatch-cycle and lifecycle-projection
writers still serialize on the lease, so a user-action funnel call
that races a dispatch-cycle funnel call would still be caught by the
cycle-side lease. The lifecycle-projection observer is the only
mutator that does not fully serialize with the user-action funnel
on the rollback path.

### Dashboards to monitor

After enabling the flag (default), monitor the following for at
least 14 days. A regression on any of these is the trigger for the
flag flip.

| Signal                                                                             | Healthy                            | Flag-flip trigger                              |
| ---------------------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------- |
| `kanban_orchestration_lease_acquire_conflict_total` (counter)                      | low / zero at steady state         | sustained climb after a deploy                 |
| `kanban_orchestration_lease_acquire_latency_ms` (histogram)                        | p99 < 5 ms                         | p99 > 50 ms sustained for 30 minutes           |
| `kanban_work_item_request_work_item_run_total{outcome="lease_conflict"}` (counter) | low / zero                         | non-zero and climbing (saturates request rate) |
| `kanban_orchestration_lease_release_total{kind="work_item"}` (counter)             | monotonically tracks acquires      | stalls (signals release path failure)          |
| Stuck-work-item-lease query (above) row count                                      | zero (sweeper reclaims within 30s) | non-zero for more than one sweeper tick        |

The flag is the rollback posture, but the _root cause_ investigation
is the lease TTL or the Core round-trip degradation that is causing
the contention. The flag-flip is the operational escape hatch; the
flag is intended to be re-enabled once the root cause is fixed.

### Related docs

- [`docs/architecture/ADR-20260623-work-item-run-link-lease.md`](../architecture/ADR-20260623-work-item-run-link-lease.md)
  — the design decision, alternatives considered, and the rollback
  plan.
- [`apps/kanban/README.md#race-safe-work-item-run-linking`](../apps/kanban/README.md#race-safe-work-item-run-linking)
  — the developer handbook for the lease identity and the
  `work_item_run_lease_enabled` flag.
- [`docs/guide/kanban-work-item-lifecycle.md`](../guide/kanban-work-item-lifecycle.md)
  — the lifecycle guide cross-reference.
- [`apps/kanban/src/work-item/README.md`](../apps/kanban/src/work-item/README.md)
  — the failure-mode inventory (F1–F6) and the test-plan
  cross-reference.
