# Service Shutdown Pause / Resume — Design

**Date:** 2026-06-14
**Status:** Approved (design)
**Topic:** Gracefully freeze workflows / chat sessions / running agents when the API and kanban services shut down (e.g. Docker container rebuild), and resume them on startup.

## Problem

Agent work runs in **independent Docker containers** that outlive the API process. When the API (or kanban) container is rebuilt:

- Frozen-in-time agents keep running and their in-container calls back to the API runtime tools / kanban tools start failing → agents error mid-execution.
- The system already persists a great deal to the DB and reconciles on startup, but it never **pauses** in-flight work, so agents burn tokens against a dead service and can fail before reconciliation helps.

What already survives a restart (verified): workflow run status & state variables, `ExecutionEntity` state, BullMQ jobs (Redis), agent-await join records, user-question awaits, session trees (JSONL), container-id links, concurrency scope locks.

What is lost / breaks: in-flight agent work has no heartbeat while the API is down; in-flight agent→API HTTP calls fail; reconciliation timers pause during downtime.

## Goal

A **hybrid** freeze + resilience model:

- **Primary:** on a clean shutdown, suspend running agent containers in place and resume them on startup.
- **Safety net:** a resilient agent→API/kanban client so crash restarts, the un-frozen tail, and kanban-only rebuilds (kanban does not own Docker) don't error agents.
- **Fallback:** if a container is gone on startup, fall back to the existing session-rehydrate / re-provision path, or fail cleanly with an audit reason.

## Scope

In scope (freeze targeting): **workflow step agents** (`ExecutionEntity` kind `workflow_step`), **interactive chat sessions** (kind `chat`), and **in-flight durable awaits** (must not be reaped or mis-resumed across the restart window).

Out of explicit freeze scope but protected by the resilience layer: **subagents (mesh)**.

Resume behaviour: **fully automatic + visibility** — auto-unpause/resume on boot with a complete `PAUSED → RESUMING → RUNNING/FAILED` audit trail and paused/resumed counts surfaced in logs and the web management UI. No manual operator gate.

## Decision: freeze mechanism

`docker pause` / `docker unpause` (cgroup freezer — a fast SIGSTOP, no process teardown) as the primary mechanism. Agent in-memory state is preserved and resume is near-instant with no session rehydration in the common case. The rebuild case replaces the API container while agent containers and the host persist, so the container is still present to unpause.

Rejected as standalone:

- **Drain-to-checkpoint** (SIGTERM + dehydrate + stop + rehydrate): survives a full host reboot and holds no memory, but needs an agent-harness SIGTERM handler that can interrupt a mid-LLM-turn cleanly — much larger lift, slower, risks partial-work loss. Retained only as the startup **fallback** when a container is gone.
- **Resilience-only** (no freeze): simplest, but agents keep working against a dead API. Retained as the **safety-net half** of the hybrid, not a standalone answer.

## Architecture

API-side pieces operate on the neutral `ExecutionEntity` only (no Kanban domain knowledge) so the core/kanban boundary holds. Kanban gets graceful shutdown hooks + the resilience client only (it does not own Docker).

- **`ServiceLifecycleStateService`** — process-wide lifecycle flag (`RUNNING` / `DRAINING` / `BOOTING`) and a paused-execution registry rebuilt from the DB on boot. Single source of truth other services consult.
- **`ShutdownFreezeCoordinator`** (`OnApplicationShutdown`) — drains queues, freezes containers, persists paused state.
- **`StartupResumeCoordinator`** (`OnApplicationBootstrap`) — discovers paused executions, unpauses (or rehydrates as fallback), emits audit, surfaces counts.
- **Resilient runtime client** — retry/backoff wrapper on the in-container agent → API/kanban HTTP calls.

### Shutdown path (`OnApplicationShutdown`)

1. `main.ts`: call `app.enableShutdownHooks()` (currently absent) for both `apps/api` and `apps/kanban`.
2. Set lifecycle state → `DRAINING` (stops new dispatch; tells watchdogs to stand down).
3. Pause BullMQ workers (`worker.pause(true)`) so no new step jobs are pulled. In-flight fire-and-poll dispatches already returned, so nothing is mid-pull.
4. Enumerate non-terminal `ExecutionEntity` rows in scope (`workflow_step`, `chat`) with a live `container_id`.
5. `docker pause` each via the existing dockerode orchestrator, in parallel with a bounded time budget.
6. Persist per-execution `paused_at`, `pause_reason`, `frozen`. Emit a `PAUSED` audit event per affected run / chat session.
7. Log a summary: frozen N, skipped M (and why). Containers not reached within the budget fall through to the resilience net.

**Time budget:** `docker pause` is fast, but raise `stop_grace_period` for the api/kanban services in `docker-compose.yml` (e.g. 30s) and cap the freeze sweep below it.

### Startup path (`OnApplicationBootstrap`)

1. Lifecycle state starts as `BOOTING`; watchdogs/reconcilers defer their first sweep until resume completes.
2. Query all `frozen` executions.
3. For each: if the container exists and is paused → `docker unpause`, refresh heartbeat, clear `paused_at` / `frozen`, transition run / chat session back to `RUNNING`, emit `RESUMING` → `RUNNING` audit.
4. **Fallback:** container gone → use the existing `rehydrateSession()` re-provision path; if no session checkpoint exists, mark failed with a clear reason (no silent loss).
5. Record resumed/failed counts; expose via logs **and** the web management UI (a small lifecycle/health surface).
6. Flip lifecycle → `RUNNING`, re-enable workers, release watchdogs.

### Resilience layer (safety net)

- Wrap the in-container agent's HTTP client to API runtime tools and kanban tools with **retry + capped exponential backoff** over a bounded window (target ~120s, configurable) for connection-refused / 502 / 503 ("service restarting"), distinct from real 4xx errors which must still fail fast.
- Covers crash restarts (no clean freeze), the un-frozen tail, frozen agents whose in-flight socket died on unpause, and kanban-only rebuilds.
- Located in the agent runtime bridge (`packages/pi-runner` / `agent-local` / harness) — exact file confirmed during planning.

### Watchdog / reconciler coordination

- `ExecutionSupervisorService`: skip reaping executions with `frozen` / `paused_at` set, and skip all reaping while lifecycle is `BOOTING` / `DRAINING`.
- `WorkflowRunReconciliationService` stale-run path: treat paused runs as healthy; defer first startup sweep until resume done.
- `AgentAwaitReconcilerService` & `UserQuestionAwait`: the resume window must not trip retry/grace logic — paused ≠ stalled. In-flight durable awaits stay in `WAITING`; their backing rows already survive restart, so they need only the "don't reap during boot/drain" guard.

## Data model

Migration (per `adding-entity-migration` skill) adding to the `execution` table:

- `paused_at timestamptz NULL`
- `pause_reason text NULL`
- `frozen boolean NOT NULL DEFAULT false`

Audit uses the existing event ledger — no new table. The in-memory paused registry is rebuilt from these columns on boot (DB is source of truth).

## Error handling & edge cases

- Freeze budget exceeded → log unfrozen executions; resilience net + watchdog grace cover them.
- Already-paused / double-pause → idempotent.
- `unpause` on a missing container → rehydrate fallback → fail-with-reason.
- New work arriving mid-drain → workers paused, so it queues in Redis and runs post-resume.
- Subagents (out of scope) → not frozen, but the resilience client still protects their calls; documented as a known limitation.
- Full host reboot (not just API rebuild) → every container gone → all go through rehydrate fallback.

## Testing strategy (TDD)

- **Unit:** freeze coordinator enumeration + budget + flag-setting; resume coordinator unpause / rehydrate-fallback / fail paths; supervisor & reconciler skip-when-paused; resilient client retries on 503 then succeeds, fails fast on 400.
- **Integration:** simulate shutdown → boot against a test DB, assert run returns to `RUNNING` with audit trail.
- **E2E (stretch):** `docker compose up -d --build api` mid-run, assert the agent continues without erroring.

## Out of scope (YAGNI)

Manual resume gate, health-gated safety check, subagent first-class freezing, cross-host migration. All deferrable.

## Key file references (from exploration)

| Aspect                  | File                                                                                   | Lines   |
| ----------------------- | -------------------------------------------------------------------------------------- | ------- |
| Workflow run entity     | `apps/api/src/workflow/database/entities/workflow-run.entity.ts`                       | 12-72   |
| Execution entity        | `apps/api/src/execution-lifecycle/database/entities/execution.entity.ts`               | 16-80+  |
| Stale-run watchdog      | `apps/api/src/workflow/workflow-run-operations/workflow-run-reconciliation.service.ts` | 48-129  |
| Execution supervisor    | `apps/api/src/execution-lifecycle/execution-supervisor.service.ts`                     | 34-110  |
| Agent-await reconciler  | `apps/api/src/workflow/workflow-await/agent-await-reconciler.service.ts`               | 63-187  |
| User question await     | `apps/api/src/workflow/database/entities/user-question-await.entity.ts`                | 29-66   |
| Session hydration       | `apps/api/src/session/session-hydration.service.ts`                                    | 37-257  |
| BullMQ setup            | `apps/api/src/redis/redis.module.ts`                                                   | 16-42   |
| Queue registration      | `apps/api/src/workflow/workflow.module.ts`                                             | 122-124 |
| Step execution consumer | `apps/api/src/workflow/workflow-step-execution/step-execution.consumer.ts`             | 24-40   |
| Container orchestrator  | `apps/api/src/docker/container-orchestrator.service.ts`                                | 28-57   |
| Subagent reaper         | `apps/api/src/workflow/workflow-subagents/subagent-execution-reaper.service.ts`        | 47-80   |
| API bootstrap           | `apps/api/src/main.ts`                                                                 | ~91     |
