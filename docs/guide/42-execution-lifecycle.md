# 42 — Execution Lifecycle

The **ExecutionLifecycleModule** (`apps/api/src/execution-lifecycle/`) tracks every agent execution from creation to terminal state. It is the layer below the workflow engine: the engine enqueues BullMQ jobs and manages workflow-run state; the execution lifecycle owns the per-execution record, its health monitoring, and the domain events that drive completion and failure routing.

---

## Overview

```
Workflow Engine
      │ creates ExecutionEntity (workflow_step kind)
      ▼
ExecutionRepository  ←─── ExecutionProjector (event → DB state)
      │
      ├── ExecutionSupervisorService  (30s sweep — idle/lost/exceeded?)
      │         │ reaps stale or dead executions
      │         ▼
      │   ExecutionEventPublisher.reaped()
      │         │
      ├── ExecutionHeartbeatService   (throttled — updates last_heartbeat_at)
      │         │ called on container log activity
      │         ▼
      │   ExecutionEventPublisher.heartbeat()
      │
      └── StepExecutionCompletionListener (in WorkflowStepExecutionModule)
                │ listens: execution.completed / execution.failed / execution.reaped
                ▼
          WorkflowEngine.handleJobComplete / handleJobFailed
```

---

## Execution Entity

Table: `executions`. Each row tracks one agent execution.

### Key Fields

| Field                    | Type             | Description                                                       |
| ------------------------ | ---------------- | ----------------------------------------------------------------- |
| `id`                     | UUID             | Primary key                                                       |
| `kind`                   | `ExecutionKind`  | `workflow_step`, `subagent`, `workflow_chat`, `adhoc_chat`        |
| `state`                  | `ExecutionState` | Current state (see state machine below)                           |
| `workflow_run_id`        | UUID?            | Owning workflow run (set for `workflow_step`)                     |
| `context_id`             | varchar?         | For `workflow_step`: the job ID (`resolve_local_conflicts`, etc.) |
| `container_id`           | varchar?         | Docker container ID, set when provisioned                         |
| `last_heartbeat_at`      | timestamp?       | Updated on each heartbeat event (null until first heartbeat)      |
| `owner_instance_id`      | varchar?         | API instance currently owning a background `workflow_step`        |
| `owner_lease_expires_at` | timestamp?       | Durable owner lease expiry for fire-and-poll step execution       |
| `last_progress_at`       | timestamp?       | Last owner-lease claim or renewal timestamp                       |
| `failure_reason`         | varchar?         | Terminal failure code (`idle_timeout`, `agent_error`, etc.)       |
| `terminal_at`            | timestamp?       | Set when state enters a terminal state                            |

### Execution Kinds

| Kind            | Created by                         | Purpose                                             |
| --------------- | ---------------------------------- | --------------------------------------------------- |
| `workflow_step` | `StepExecutionOrchestratorService` | Background execution of one workflow job            |
| `subagent`      | `WorkflowSubagentsModule`          | Child agent spawned from a war-room or parent agent |
| `workflow_chat` | Chat session launcher              | Chat-driven workflow execution                      |
| `adhoc_chat`    | Ad-hoc chat handler                | Free-form chat sessions                             |

### State Machine

```
pending
  ├──→ provisioning ──→ running ──→ awaiting_input ──→ completing ──→ completed ✓
  │         │               │                │                │
  │         │               │                └──→ failed ✓    └──→ failed ✓
  │         │               └──→ failed ✓
  │         └──→ reaped ✓
  │         └──→ cancelled ✓
  ├──→ reaped ✓
  ├──→ cancelled ✓
  └──→ retry_scheduled ──→ pending (loop)
```

Terminal states (`TERMINAL_EXECUTION_STATES`): `completed`, `failed`, `reaped`, `cancelled`.

`ExecutionRepository.applyTransition(id, to, patch?)` enforces the legal edges above — illegal transitions are silently no-ops (returns `null`).

---

## Services

### `ExecutionRepository`

TypeORM repository wrapper. Key methods:

| Method                                  | Description                                                                                           |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `findNonTerminal()`                     | All rows whose `state` is not in `TERMINAL_EXECUTION_STATES` — used by the supervisor sweep           |
| `findExpiredOwnerLeases(now)`           | Non-terminal executions whose durable owner lease has expired — used by operations doctor diagnostics |
| `findByWorkflowRunAndJob(runId, jobId)` | All executions for a `(workflow_run_id, context_id)` pair — used by the terminal-state guard          |
| `applyTransition(id, to, patch?)`       | Enforces legal state transitions; writes `terminal_at` on entry to terminal states                    |

### `ExecutionOwnerLeaseService`

`workflow_step` background execution is owned by one API process at a time. Before `StepExecutionOrchestratorService` starts the background agent promise, it claims a durable lease on the execution row using `owner_instance_id` and `owner_lease_expires_at`. The default lease TTL is 2 minutes and the owning process renews every 30 seconds while the promise is active. On normal success or failure it releases the lease.

If the API process dies mid-step, the renewal stops but the execution row remains `running`. The next supervisor sweeps can then distinguish a genuine orphan from a healthy live owner by combining the expired owner lease with event-ledger job activity quiescence.

### `ExecutionEventPublisher`

Emits domain events onto the `OutboxDomainEventBus` for each lifecycle stage. The `ExecutionProjector` subscribes and applies corresponding `applyTransition` calls, keeping the DB in sync with the event stream.

| Event                   | Trigger                                                               |
| ----------------------- | --------------------------------------------------------------------- |
| `execution.created`     | Execution entity created                                              |
| `execution.provisioned` | Container assigned — transitions to `running` and sets `container_id` |
| `execution.heartbeat`   | Activity observed — refreshes `last_heartbeat_at`                     |
| `execution.completed`   | Agent job finished successfully                                       |
| `execution.failed`      | Agent job failed with reason                                          |
| `execution.reaped`      | Supervisor terminated a stale or lost execution                       |

### `ExecutionHeartbeatService`

Updates `last_heartbeat_at` through the event pipeline, throttled to at most once per 15 seconds per execution (`EXECUTION_HEARTBEAT_MIN_INTERVAL_MS = 15_000`).

```
Container log chunk arrives
      ↓
StepAgentStepExecutorService.startContainerAndStreamLogs callback
      ├── WorkflowRunHeartbeatService.recordActivity(runId)   ← run-level touch
      └── ExecutionHeartbeatService.recordActivity(executionId, 'container_log')
                ↓
          publisher.heartbeat(executionId, { source })
                ↓
          ExecutionProjector.onHeartbeat
                ↓
          applyTransition(id, 'running', { last_heartbeat_at: new Date() })
```

**Subagent heartbeats** arrive via the telemetry WebSocket gateway (`telemetry-gateway-runtime.helpers.ts`) and call the same `recordActivity` method, keyed on `client.subagentExecutionId`.

**`workflow_step` heartbeats** come from container log streaming (wired in `step-agent-step-executor.service.ts`). Every log chunk refreshes `last_heartbeat_at` as long as the container is producing output.

> **Long `run_command` steps:** a command step (e.g. the merge quality gate's full test suite, ~6.5 min) typically buffers its output and emits no streamed log lines while it runs, which would starve the log-stream heartbeat. `executeCommandStepOnContainer` therefore wraps the synchronous container request in `runWithPeriodicHeartbeat` (`command-step-heartbeat.helpers.ts`), ticking `recordHeartbeat` every 30 s (`COMMAND_STEP_HEARTBEAT_INTERVAL_MS`) — well under the 5-min stale-run grace — so the open request itself keeps the execution record alive.

**Live command output:** while a `run_command` step runs, the harness streams its
stdout/stderr as `command_started` / `command_output` / `command_finished` telemetry
events (`packages/core` command-events contract), attributed by `stepId`. The API
telemetry gateway broadcasts them over the run's websocket (output chunks are
published live but not persisted to the capped replay stream; `command_finished`
carries a bounded `outputTail` so late/replay viewers still see a tail and the exit
status). The web session view renders these as per-step collapsible command cards
(`StepCommandCard`). This is independent of the buffered HTTP response, which remains
the source of truth for the step verdict.

### `ExecutionSupervisorService`

Runs a `setInterval` every **30 seconds** (`SUPERVISOR_SWEEP_INTERVAL_MS`). Each sweep:

1. Loads all non-terminal executions from `findNonTerminal()`.
2. For each, checks Docker to see if its container is still alive (`SubagentContainerLivenessProbe`).
3. Calls `classifyExecutionForReaping(input, now, idleTimeoutMs, maxRuntimeMs, containerLostGraceMs)` with:
   - `kind` — the execution's kind
   - `state` — current state
   - `createdAtMs` — when the entity was created
   - `lastHeartbeatAtMs` — last heartbeat, **falling back to `created_at` when null**
   - `containerLost` — Docker liveness result
   - `containerLostForMs` — how long the container has been **continuously** observed lost across consecutive sweeps (tracked in an in-memory `containerLostSince` map, keyed by execution id, pruned each sweep), or `null` when it is alive or first observed lost
4. If a reap reason is returned, emits `execution.reaped`.

#### Reaping Rules (`classifyExecutionForReaping`)

| Check                                      | Condition                                                 | Reason                 | Applies to                                |
| ------------------------------------------ | --------------------------------------------------------- | ---------------------- | ----------------------------------------- |
| Container lost (non-step)                  | Docker says container is gone                             | `container_lost`       | `subagent`, `workflow_chat`, `adhoc_chat` |
| Container lost (workflow_step)             | Continuously lost for `> 90s` (default)                   | `container_lost`       | `workflow_step` only (debounced)          |
| Expired owner lease + quiescent job ledger | Lease expired and latest job activity quiet for `>= 3min` | `idle_timeout`         | `workflow_step` only                      |
| Max runtime                                | `now − created_at > 4h` (default)                         | `max_runtime_exceeded` | All kinds                                 |
| `awaiting_input` state                     | —                                                         | skip (never reap)      | All kinds                                 |
| **workflow_step generic idle timeout**     | —                                                         | **skip**               | `workflow_step` only                      |
| Idle timeout                               | `now − last_heartbeat_at > 15min` (default)               | `idle_timeout`         | `subagent`, `workflow_chat`, `adhoc_chat` |

> **Why `workflow_step` is exempt from idle-timeout:** `workflow_step` executions manage their own lifecycle via `StepExecutionCompletionListener`. The supervisor must not idle-reap them because container log streaming already refreshes `last_heartbeat_at`, and any gap (e.g., LLM thinking time between turns) could falsely trigger a reap and launch a duplicate container. `max_runtime_exceeded` and the debounced `container_lost` still apply as safety nets.

> **Owner-lease orphan recovery:** A `workflow_step` can still be reaped as `idle_timeout` when its owning API process stops renewing `owner_lease_expires_at` and the event ledger has no recent activity for that same `(workflow_run_id, context_id)` job. This path uses the existing `execution.reaped` → `StepExecutionCompletionListener` → interruption recovery / retry pipeline, so stale owner leases recover like other supervisor reaps without adding another watchdog.

> **Why `container_lost` is debounced for `workflow_step`:** a step's container is removed by the step executor as part of normal completion **before** the execution row reaches a terminal state (`execution.completed` is published after container cleanup, and `running → completing → completed` is processed asynchronously). For a brief window the row is still `running` with a `container_id` pointing at an already-removed container — a single sweep landing there would falsely reap a healthy step and trigger a wasteful retry cascade. Requiring the container to be **continuously** observed lost beyond the grace window (default 90 s, ~3 sweeps) lets that cleanup race resolve to a terminal state first, while a genuine orphan (the API process dies mid-step, so no completion event ever fires) still exceeds the window and is reaped — recovery latency after a restart is ~grace, since the tracking map starts empty on boot. In-process agent errors and container OOM mid-call do **not** rely on this path: they surface synchronously as `execution.failed` (`agent_error`) from the executor's own `try/catch`.

#### Environment Overrides

| Env var                             | Default         | Description                                                                                                                                                                                                                                                      |
| ----------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EXECUTION_IDLE_TIMEOUT_MS`         | 900000 (15 min) | Idle timeout for subagent/chat executions                                                                                                                                                                                                                        |
| `EXECUTION_MAX_RUNTIME_MS`          | 14400000 (4 h)  | Hard max for all execution kinds                                                                                                                                                                                                                                 |
| `EXECUTION_CONTAINER_LOST_GRACE_MS` | 90000 (90 s)    | Grace window a `workflow_step` container (supervisor) **or** a subagent child container must be continuously observed lost before it is reaped as `container_lost`. Debounces the normal container-cleanup race; genuine orphans are still reaped shortly after. |

---

## Fire-and-Poll Dispatch (workflow_step)

`workflow_step` executions use an async fire-and-poll pattern to avoid holding BullMQ job locks during long-running agent executions:

```
BullMQ consumer dequeues job
      ↓
StepExecutionOrchestratorService.dispatchJob()
      ├── Runs synchronous pre-flight: run status, condition, capability preflight
      ├── Creates ExecutionEntity (state=pending, kind=workflow_step, context_id=jobId)
      ├── Fires void runAgentJobAndPublishResult(executionId, ...) — background
      └── Returns { dispatched: true, executionId } immediately → BullMQ lock released

                            [background]
                                ↓
                     claim owner lease on executions row
                                ↓
                      applyTransition(executionId, 'running')
                                ↓
                     release owner lease in finally block
                                ↓
                     StepAgentStepExecutorService.executeJob(data, ..., executionId)
                                ↓
                     Container starts, log streaming begins,
                     heartbeats flow via ExecutionHeartbeatService
                                ↓
                    ┌─── success ──────────────────────────────────┐
                    │  applyTransition(executionId, 'completed')   │
                    │  publisher.completed(executionId)            │
                    │       ↓                                      │
                    │  StepExecutionCompletionListener             │
                    │  → workflowEngine.handleJobComplete()        │
                    └──────────────────────────────────────────────┘
                    ┌─── failure ──────────────────────────────────┐
                    │  applyTransition(executionId, 'failed', ...) │
                    │  publisher.failed(executionId, ...)          │
                    │       ↓                                      │
                    │  StepExecutionCompletionListener             │
                    │  → runJobExecution.handleJobFailed()         │
                    └──────────────────────────────────────────────┘
```

---

## Completion Routing (`StepExecutionCompletionListener`)

Lives in `WorkflowStepExecutionModule`. Subscribes to the in-process domain event bus for `execution.completed`, `execution.failed`, and `execution.reaped`, but **only acts on `workflow_step` kind executions** (others are silently ignored via `resolveWorkflowStepContext`).

### Reaped-event handling and terminal-state guard

When `execution.reaped` fires, before calling `handleJobFailed`, the listener checks whether any execution for the same `(workflow_run_id, context_id)` pair is already in `completed` state:

```typescript
const siblings = await executionRepo.findByWorkflowRunAndJob(
  workflowRunId,
  jobId,
);
const alreadyCompleted = siblings.some((e) => e.state === "completed");
if (alreadyCompleted) return; // skip retry — job already succeeded
```

**Why this guard exists:** A BullMQ consumer retry or an `applyTransition` race can leave a stale `ExecutionEntity` in `running` state after the job has already succeeded. Without the guard, the supervisor reaps the stale entity and `handleJobFailed` schedules a retry — launching a second container alongside the already-running successor job. The guard is the last line of defence.

---

## Failure Reasons

| Code                   | Meaning                                                                                              | Who sets it          |
| ---------------------- | ---------------------------------------------------------------------------------------------------- | -------------------- |
| `idle_timeout`         | No heartbeat for 15 min (subagent/chat) or expired owner lease with quiescent workflow-step activity | Supervisor           |
| `max_runtime_exceeded` | Execution exceeded 4h ceiling                                                                        | Supervisor           |
| `container_lost`       | Docker container no longer exists                                                                    | Supervisor           |
| `agent_error`          | `runAgentJobAndPublishResult` caught an exception                                                    | Orchestrator         |
| `step_failed`          | Step-level logic failure                                                                             | Step executor        |
| `provision_failed`     | Container could not be provisioned                                                                   | Container support    |
| `cancelled_by_user`    | User-initiated cancellation                                                                          | Cancellation service |
| `parent_terminated`    | Parent execution terminated (subagent cascade)                                                       | Cascade listener     |
| `never_dispatched`     | Entity created but execution never started                                                           | Reconciler / cleanup |

---

## Subagent Stability Mechanisms

This section documents structural safeguards that prevent orphaning, duplicate spawning, and cascading failures in subagent execution trees.

### Shutdown Gate (`ShutdownStateService`)

When the API process is shutting down (`ServiceLifecycleStateService` phase → `draining`), the supervisor sweep and stale-run watchdog stand down and skip scheduling any retries. This prevents recovery actions from interfering with a clean shutdown:

- Execution supervisor continues sweeping but does not emit `execution.reaped` events.
- Stale-run watchdog does not schedule retries for stalled BullMQ jobs.
- Executions are preserved in their current state so the startup resume phase can pick them up (see [Service shutdown freeze/resume](./README.md#service-shutdown-freezeresume)).

### Subagent Orphan Reconciler (`SubagentOrphanReconcilerService`)

Runs on every startup and every 60 seconds thereafter. Scans all non-terminal subagent executions and cancels any whose parent workflow run is already terminal. This ensures that a parent run's terminal event (whether success, failure, or cancellation) always cascades to dependent subagents, even if the parent-to-child event pathway is missed or delayed.

### Fire-and-Poll Exemption: Structural Watchdog Immunity

A `workflow_step` parent that is currently awaiting a live (non-terminal) child subagent is exempt from the stale-run watchdog's `container_lost` reaping strategy. The watchdog recognizes this structural dependency via `immuniseRunsWithLiveChild()` and defers reaping to the supervisor's `idle_timeout` and `max_runtime_exceeded` paths, which are:

- **Heartbeat-independent:** They fire based on absolute elapsed time, not activity gaps.
- **Applied directly to subagent executions:** The child's own supervisor rules will reap it if it is hung beyond the ceiling.
- **Decoupled from the fire-and-poll pattern:** They don't race with normal completion events.

**Why this matters:** The fire-and-poll executor releases the BullMQ lock immediately after launching a subagent, so the parent step (the `workflow_step` container) has no heartbeat signal until the child completes and resumes. Without the exemption, a normal subagent child that takes >15 min to complete would cause the watchdog to reap the parent prematurely and spawn a duplicate subagent. The exemption preserves the structural invariant: _a parent awaiting a child is considered active, and child supervision is delegated to the supervisor's absolute-time rules_.

### Container-Liveness Immunity (long-running steps)

A stale-heartbeat `workflow_step` execution that still holds a **live container** is also exempt from the stale-run watchdog. After the heartbeat pass, the watchdog probes each such candidate's container via the shared `SubagentContainerLivenessProbe` (`immuniseRunsWithLiveStepContainer()`); a run whose step container is alive is immunised. This mirrors the supervisor's treatment of `workflow_step` executions (which don't heartbeat through the telemetry gateway) and defers genuine container loss to the supervisor's debounced `container_lost` reaper.

**Why this matters:** a long-running `run_command` step that buffers its output (e.g. the merge quality gate's full test suite, ~6.5 min) can outlive the 5-min stale-run grace. Without the container-liveness probe, the watchdog would kill the healthy gate container mid-suite, supersede the execution (surfacing as `socket hang up`), and retry into an unwinnable loop until `job_failed_after_retries: Run stalled`. A probe failure is non-fatal — the run is left unimmunised so a genuinely dead run is still recovered.

### Duplicate-Spawn Guard (`WorkflowSubagentsModule`)

Application-level enforcement: at most one active subagent per `(parent_container_id, role)` pair. Before provisioning a new subagent, the module queries for any existing non-terminal subagent for the same parent and role. If found, the request is queued as a durable await on the existing subagent rather than launching a duplicate.

This guard is also reinforced at the database level by a partial unique index: `UNIQUE(parent_container_id, role) WHERE state NOT IN (terminal_states)`. The index ensures that concurrent provisioning requests cannot race and create two live entries for the same parent/role pair.

---

## Observability

All execution state transitions are observable via the `event_ledger` table (domain: `execution`, event names `execution.created`, `execution.heartbeat`, `execution.reaped`, etc.). Use `bd retrieve-debug-bundle <workflow-run-id>` to pull the full event timeline for a run.

Key signals for diagnosing duplicate-container issues:

- More than one `workflow.host_mount.attached` event for the same step → two containers launched
- A `workflow.retry_scheduled` event with `reason = "No activity heartbeat"` after the step already succeeded → stale execution was reaped
- Multiple `ExecutionEntity` rows for the same `(workflow_run_id, context_id)` pair in the DB → BullMQ consumer retry created a second entity
- `expired_owner_lease_execution_ids` in workflow recovery diagnostics → background step ownership lease expired and should be correlated with event-ledger activity before manual repair

---

---

## Workflow Run Reconciliation

The `WorkflowRunReconciliationService` operates at the run level (above individual executions) and handles stale `RUNNING` workflow runs whose BullMQ jobs are no longer alive.

### What It Does

On each reconciliation sweep, the service:

1. Queries for workflow runs in `RUNNING` state beyond a configurable grace period (`WORKFLOW_STALE_RUN_GRACE_MS`).
2. For each candidate run, checks the live BullMQ states of its expected jobs.
3. **If a matching live job still exists** (active, waiting, delayed, or waiting-children) — skips the run to avoid false positives under queue load.
4. **If no live job is found** — routes the stranded run through the existing `handleJobFailed` path, so the auto-retry and repair delegation policies are applied centrally.

### Configuration

| Env Var                       | Default          | Description                                                                                                                                                                                                                                 |
| ----------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WORKFLOW_STALE_RUN_GRACE_MS` | `300000` (5 min) | How long a RUNNING run must have no live BullMQ job before the reconciler acts. Increase for heavily loaded environments where queue visibility may lag; decrease only when you need faster recovery and have confirmed no false positives. |

### Relationship to the Execution Supervisor

The `ExecutionSupervisorService` (described above) reaps stale **execution entities** (containers). The reconciliation service handles stale **workflow runs** (the higher-level state machine). They are complementary:

- A container can be reaped by the supervisor while the run-level BullMQ job is still alive (retry enqueued).
- A run can be stranded with no BullMQ job while executions are all in terminal states.

Both feed into the same `handleJobFailed` → auto-retry → repair delegation pipeline.

---

## Relationship to workflow-run-operations

`ExecutionLifecycleModule` (`apps/api/src/execution-lifecycle/`) and `WorkflowRunOperationsModule` (`apps/api/src/workflow/workflow-run-operations/`) live on opposite sides of a deliberate seam: the lifecycle module owns per-execution state, supervision, and event emission; the run-operations module owns run-level routing, reconciliation, and the run-facing HTTP surface. They are coupled in three explicit, well-named places — anything beyond these three is a layering violation.

### Cross-Module Coupling Points

1. **DI edge — `forwardRef(() => ExecutionLifecycleModule)`** in `apps/api/src/workflow/workflow-run-operations/workflow-run-operations.module.ts`. This is the only allowed entry point for run-operations code into lifecycle providers. The `forwardRef` is necessary because the lifecycle module itself depends on `WorkflowCoreModule` (via `StepExecutionCompletionListener`); new lifecycle consumers from run-operations must route through this edge rather than reaching across module boundaries.

2. **`WorkflowRunReconciliationService` injections** (`apps/api/src/workflow/workflow-run-operations/workflow-run-reconciliation.service.ts`). The reconciler is the run-level sweeper and reaches into the lifecycle module for exactly three collaborators:
   - `ExecutionRepository` — read non-terminal execution rows to immunise active runs and probe `workflow_step` containers during reconciliation.
   - `ServiceLifecycleStateService` — gate the sweep on the API shutdown/reaping phase so reconciliation defers during `draining`.
   - `SubagentContainerLivenessProbe` — confirm that a candidate run's `workflow_step` container is still alive before declaring the run stale, mirroring the supervisor's debounced `container_lost` rule.

3. **`WorkflowRunsController` execution surface** (`apps/api/src/workflow/workflow-run-operations/workflow-runs.controller.ts`). The `GET /workflows/runs/:runId/executions` endpoint injects `ExecutionRepository` directly and projects rows via `toExecutionReadModel` (from `apps/api/src/execution-lifecycle/execution-read.types.ts`). This is the only HTTP endpoint owned by run-operations that returns execution-shaped data, and its shape is intentionally the read-model DTO so the controller does not need to reach into lifecycle entities.

### Stable-Contract Vocabulary (Cross-Boundary Surface)

The following symbols are the **public** surface that other modules (including workflow-run-operations) may reference without reaching into the lifecycle module's internals. They are re-exported through `apps/api/src/execution-lifecycle/execution-lifecycle.contracts.ts` (and the supporting read-model types) and are expected to evolve as the stable vocabulary of the lifecycle domain:

- `EXECUTION_EVENT_TYPES` — the canonical event-name constants emitted by `ExecutionEventPublisher` (`execution.created`, `execution.heartbeat`, `execution.completed`, `execution.failed`, `execution.reaped`, etc.).
- `EXECUTION_STATES` — the legal execution state machine values (`pending`, `provisioning`, `running`, `awaiting_input`, `completing`, `completed`, `failed`, `reaped`, `cancelled`, `retry_scheduled`).
- `EXECUTION_FAILURE_REASONS` — the canonical failure-reason taxonomy (`provision_failed`, `idle_timeout`, `max_runtime_exceeded`, `container_lost`, `agent_error`, `step_failed`, `cancelled_by_user`, `parent_terminated`, `never_dispatched`, `spawn_timeout`, `superseded`).
- `EXECUTION_KINDS` — the execution kind enum (`workflow_step`, `workflow_chat`, `adhoc_chat`, `subagent`).
- `toExecutionReadModel` — the projection from an `ExecutionEntity` row to the public `ExecutionReadModel` DTO used by `GET /workflows/runs/:runId/executions`.
- `shouldEmitHeartbeat` — the heartbeat-throttle predicate (`apps/api/src/execution-lifecycle/heartbeat-throttle.helpers.ts`) that downstream consumers should use before emitting their own `execution.heartbeat` events so the 15 s throttle is honoured centrally.

Anything not in this list (entity fields, repository methods beyond the three named above, projector/event-publisher internals, supervisor helpers) is **private** to the lifecycle module. Consumers must negotiate a new contract symbol before reaching into it.

### See Also

- [05 — API Module Graph § WorkflowRunOperationsModule](05-api-module-graph.md#workflowrunoperationsmodule) — the WorkflowRunOperationsModule row in the module-graph table and its relationship to the execution-lifecycle column.
- [Execution-lifecycle consolidation plan, Phase 5 boundary](superpowers/plans/2026-06-14-execution-lifecycle-consolidation-plan.md#phase-5-boundary) — the north-star boundary between the two modules as the consolidation phases land.

---

## See Also

- [07 — Workflow Step Execution](07-workflow-step-execution.md) — Queue consumer, container execution, retry policy
- [09 — Workflow Subagents](09-workflow-subagents.md) — Subagent provisioning and the subagent execution kind
- [10 — Workflow Repair](10-workflow-repair.md) — Failure classification and repair dispatch
- [18 — Telemetry & Observability](18-telemetry-observability.md) — Event ledger, debug bundle retrieval
- [20 — Operations](20-operations.md) — Doctor checks, workflow recovery
- [43 — Repair Diagnostics Operator Guide](43-repair-diagnostics-operator-guide.md) — End-to-end diagnostic procedures for stuck/failed workflows
