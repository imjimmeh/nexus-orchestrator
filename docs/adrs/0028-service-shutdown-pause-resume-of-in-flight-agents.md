# ADR-0028: Service Shutdown Pause/Resume of In-Flight Agents

## Status

Accepted

## Date

2026-06-14

## Context

Agents run in **independent Docker containers** that outlive the API process. When the API container is rebuilt (e.g. `docker compose up -d --build api`), the agent containers keep running, frozen-in-time, while their in-container HTTP calls back to the API runtime tools (and kanban tools) start failing — so agents error mid-execution and burn tokens against a dead service.

The system already persists a great deal to the database and reconciles on startup: workflow-run status and state variables, `ExecutionEntity` state, BullMQ jobs (Redis), agent-await join records, user-question awaits, session trees (JSONL), container-id links, and concurrency scope locks all survive a restart. What was missing was any mechanism to **pause** in-flight work so agents stop calling a service that is mid-restart, and to **resume** it cleanly once the service is back. Reconciliation timers also pause while the API is down, so a paused agent looks indistinguishable from a stalled one to the existing watchdogs.

Design spec: [`docs/superpowers/specs/2026-06-14-service-shutdown-pause-resume-design.md`](../superpowers/specs/2026-06-14-service-shutdown-pause-resume-design.md).
Implementation plan: [`docs/superpowers/plans/2026-06-14-service-shutdown-pause-resume.md`](../superpowers/plans/2026-06-14-service-shutdown-pause-resume.md).

## Decision

A **hybrid** freeze + resilience model, operating on the neutral `ExecutionEntity` only so the core/kanban boundary holds (kanban gets graceful shutdown hooks and the resilience client only — it does not own Docker).

### Primary mechanism: freeze-in-place via `docker pause` / `docker unpause`

On a clean shutdown, the `ShutdownFreezeCoordinator` (`OnApplicationShutdown`) sets the lifecycle phase to `draining`, pauses the BullMQ step workers, enumerates non-terminal executions of the freezable kinds (`workflow_step`, `workflow_chat`, `adhoc_chat`) that have a live `container_id`, and `docker pause`s each one (cgroup freezer — a fast SIGSTOP, no process teardown). Each frozen row is marked `frozen=true` with `paused_at` / `pause_reason`, and an `execution.paused` audit event is emitted.

On startup, the `StartupResumeCoordinator` (`OnApplicationBootstrap`) queries all `frozen` rows; for each it probes the container runtime state and `docker unpause`s containers that are still present (paused or running), clears the `frozen` flag, and emits an `execution.resumed` audit event. Resume is fully automatic — there is no manual operator gate — and the per-restart outcome (frozen found / resumed / failed / last-resume timestamp) is recorded and surfaced at `GET /api/operations/lifecycle/resume-summary` and in the web management UI Doctor page (`ResumeSummaryPanel`).

### Safety net: agent → API/kanban retry/backoff

The in-container agent HTTP client to API runtime tools (`packages/harness-runtime` `api-callback`) and the shared `sendJsonRequest` path (`packages/core`) retry with capped exponential backoff on connection-refused / retriable status codes (408, 425, 429, 5xx), distinct from real 4xx errors which still fail fast. This covers crash restarts (no clean freeze), the un-frozen tail (executions left behind when the freeze budget is exceeded), frozen agents whose in-flight socket died on unpause, and kanban-only rebuilds (kanban does not own Docker).

### Fallback: rehydrate (currently degraded)

If a container is gone on startup (e.g. a full host restart, not just an API rebuild), the resume coordinator delegates to `SessionRehydratorAdapter`. **This path currently degrades**: re-provisioning a fresh container from scratch needs the full step-executor pipeline (runner-config storage, JWT minting, AI-config resolution, worktree resolution, tier selection), which is execution-kind specific and not generically reusable from this adapter. So the adapter logs that the execution cannot be auto-rehydrated and returns `false`. `workflow_step` executions are still recovered by the existing stale-run reconciliation; chat executions require manual/operator recovery. Full re-provision-from-session is future work.

### `frozen` orthogonal to the execution state machine

The `frozen` flag is a property of the execution, **not** a state. A paused execution stays in `running` state; its workflow run / chat session status is unchanged. This keeps the freeze concern decoupled from the legal-transition machine and means resume is just "clear the flag", not a state transition that has to be threaded through every consumer.

### Lifecycle phases gate the watchdogs

`ServiceLifecycleStateService` exposes a process-wide phase (`booting` / `running` / `draining`). The `ExecutionSupervisorService` and the stale-run watchdog (`WorkflowRunReconciliationService`) stand down whenever the phase is not `running`, and skip any row with `frozen` set. This ensures a paused-then-resuming execution is never mistaken for a stalled one during the restart window. (The subagent reaper is not gated: subagents are out of freeze scope, run on the separate `subagent_executions` table, and only reap on `exited`/`dead`/`removing`/`404` — a paused or running container is never treated as lost.) The phase starts at `booting`, flips to `running` only after the resume sweep completes (always, even on resume error, so the service still accepts work and the watchdogs recover anything left behind), and flips to `draining` at shutdown.

## Consequences

Positive:

1. A clean API rebuild mid-run no longer errors in-flight agents: they are paused before the process exits and resumed near-instantly on boot, with full in-memory state preserved (no session rehydration in the common case).
2. The resilience net independently protects agent calls across crash restarts, the un-frozen tail, and kanban-only rebuilds.
3. The whole restart is auditable end-to-end via `execution.paused` / `execution.resumed` ledger events plus the resume-summary endpoint and Doctor panel.
4. Watchdogs no longer false-reap healthy paused work, and frozen rows survive restart because the DB is the source of truth for the paused registry.

Trade-offs / limitations:

1. Paused containers **hold their memory** while frozen — `docker pause` stops the processes but does not release RAM.
2. **Subagents are not frozen.** Only `workflow_step`, `workflow_chat`, and `adhoc_chat` are in freeze scope; subagent (mesh) executions are protected only by the resilience layer.
3. The primary mechanism **relies on the agent containers surviving the API rebuild** (the rebuild replaces only the API container while agent containers and the host persist). A full host reboot loses every container and falls through to the rehydrate fallback.
4. The **freeze budget is capped below the compose `stop_grace_period`** (`EXECUTION_FREEZE_BUDGET_MS` default 20000ms, hard-capped 25000ms, vs `stop_grace_period: 30s`). Executions not frozen within the budget are left to the resilience net and watchdog grace.
5. **Rehydrate-from-scratch is future work** — the fallback currently degrades to "leave it to stale-run reconciliation / manual recovery" rather than re-provisioning a fresh container.

## References

- Design spec: [`docs/superpowers/specs/2026-06-14-service-shutdown-pause-resume-design.md`](../superpowers/specs/2026-06-14-service-shutdown-pause-resume-design.md)
- Implementation plan: [`docs/superpowers/plans/2026-06-14-service-shutdown-pause-resume.md`](../superpowers/plans/2026-06-14-service-shutdown-pause-resume.md)
- Guide: [`docs/guide/README.md`](../guide/README.md) — "Service shutdown freeze/resume"
- Guide: [`docs/guide/42-execution-lifecycle.md`](../guide/42-execution-lifecycle.md) — execution entity and supervisor
- Operations: [`docs/operations/README.md`](../operations/README.md) — restart operational note
