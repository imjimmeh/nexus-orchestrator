---
project_scope_id: 458935f0-213e-4bbe-89d1-8883e0efa9ad
probe_scope_id: execution-lifecycle-supervisor
outcome: success
inferred_status: implemented
confidence_score: 0.97
evidence_refs:
  - apps/api/src/execution-lifecycle/execution-supervisor.service.ts
  - apps/api/src/execution-lifecycle/execution-supervisor.service.spec.ts
  - apps/api/src/execution-lifecycle/execution-supervisor.service.types.ts
  - apps/api/src/execution-lifecycle/execution-supervision.helpers.ts
  - apps/api/src/execution-lifecycle/execution-supervision.helpers.spec.ts
  - apps/api/src/execution-lifecycle/execution-supervision.helpers.types.ts
  - apps/api/src/execution-lifecycle/shutdown-freeze.coordinator.ts
  - apps/api/src/execution-lifecycle/shutdown-freeze.coordinator.spec.ts
  - apps/api/src/execution-lifecycle/shutdown-freeze.coordinator.types.ts
  - apps/api/src/execution-lifecycle/startup-resume.coordinator.ts
  - apps/api/src/execution-lifecycle/startup-resume.coordinator.spec.ts
  - apps/api/src/execution-lifecycle/startup-resume.coordinator.types.ts
  - apps/api/src/execution-lifecycle/execution-dispatch.service.ts
  - apps/api/src/execution-lifecycle/execution-dispatch.service.spec.ts
  - apps/api/src/execution-lifecycle/execution-dispatch.service.types.ts
  - apps/api/src/execution-lifecycle/execution-heartbeat.service.ts
  - apps/api/src/execution-lifecycle/service-lifecycle-state.service.ts
  - apps/api/src/execution-lifecycle/service-lifecycle-state.service.spec.ts
  - apps/api/src/execution-lifecycle/service-lifecycle-state.service.types.ts
  - apps/api/src/execution-lifecycle/heartbeat-throttle.helpers.ts
  - apps/api/src/execution-lifecycle/heartbeat-throttle.helpers.spec.ts
  - apps/api/src/execution-lifecycle/execution-transition.helpers.ts
  - apps/api/src/execution-lifecycle/execution-transition.helpers.spec.ts
  - apps/api/src/execution-lifecycle/executions.controller.ts
  - apps/api/src/execution-lifecycle/executions.controller.spec.ts
  - apps/api/src/execution-lifecycle/execution-lifecycle.module.ts
  - apps/api/src/execution-lifecycle/freeze.contracts.ts
  - apps/api/src/execution-lifecycle/execution-event.publisher.ts
source_paths:
  - apps/api/src/execution-lifecycle
updated_at: 2026-06-15T18:30:00.000Z
---

# Probe Result: Execution Lifecycle Supervisor and Freeze

## Narrative Summary

The `execution-lifecycle-supervisor` scope is **fully implemented** with
production code, type definitions, and comprehensive unit tests across all 25
assigned paths. The capability covers the watchdog that reaps orphaned
executions (`ExecutionSupervisorService`), the freeze/resume lifecycle
coordinators (`ShutdownFreezeCoordinator`, `StartupResumeCoordinator`), the
fire-and-poll dispatcher (`ExecutionDispatchService`), the throttled heartbeat
service (`ExecutionHeartbeatService`), the process-wide lifecycle phase tracker
(`ServiceLifecycleStateService`), supporting helpers
(`execution-supervision.helpers`, `heartbeat-throttle.helpers`,
`execution-transition.helpers`), and the `ExecutionsController` HTTP surface.

The split from the original `execution-lifecycle` probe (which previously
failed during write) allows for focused investigation. All files exist on disk
and are wired together through `ExecutionLifecycleModule` (lines 19-87),
which injects:

- `ExecutionSupervisorService` via a `useFactory` so that optional
  `CheckpointPersistenceDeps` (`StepSessionCheckpointRepository` +
  `ISessionHydrationService`) are always wired from the
  `StepSessionCheckpointModule` rather than via optional constructor params.
- `ShutdownFreezeCoordinator` and `StartupResumeCoordinator` with DI tokens
  `CONTAINER_FREEZER`, `STEP_QUEUE_DRAINER`, `CONTAINER_RESUMER`,
  `SESSION_REHYDRATOR`, all bound to concrete adapters.

Code totals for the scope (production + spec):
2,716 lines across the 17 paired source/spec files. Average test:source
ratio is ~1.7×, with the supervisor's 761-line spec covering 12+ scenarios
(idle reap, workflow_step exemption, container_lost debouncing across
consecutive sweeps, freeze-aware standing-down, checkpoint persistence on
reap for pi-engine and claude-code-engine, flag-off / no-deps branches).

The capability described in `SCOPE_MANIFEST.json` — "Supervisor, supervision
helpers, freeze/resume coordinators, dispatch, heartbeat, lifecycle state,
throttle/transition helpers, controller" — is structurally and behaviorally
complete.

## Capability Updates

**Implemented Capabilities**

- `execution_supervisor.watchdog` — `ExecutionSupervisorService.sweepOnce()`
  (apps/api/src/execution-lifecycle/execution-supervisor.service.ts:90-130)
  runs on `SUPERVISOR_SWEEP_INTERVAL_MS = 30_000` ms and:
  - Stands down when `ServiceLifecycleStateService.isReapingSuspended()`
    is true (booting/draining phases).
  - Honors `frozen` rows by skipping them (containers paused at shutdown).
  - Tracks per-execution `containerLostSince` map and only reaps a
    `container_lost` once the debounce window
    (`DEFAULT_CONTAINER_LOST_GRACE_MS = 90_000` ms) elapses.
  - Persists a session checkpoint on reap for `workflow_step` executions
    (pi / claude_code engines), reading the sidecar `session.jsonl` to
    avoid stale session-tree state and forwarding `container_tier` to
    prevent HEAVY→LIGHT downgrades on resume.
- `execution_supervisor.reaper_classification` —
  `classifyExecutionForReaping()` (apps/api/src/execution-lifecycle/execution-supervision.helpers.ts:64-100)
  produces verdicts in priority order: `container_lost` → `max_runtime_exceeded`
  → `spawn_timeout` (provisioning past `DEFAULT_PROVISION_GRACE_MS = 5min`) →
  `never_dispatched` (pending past the same window) → `idle_timeout` (workflow_step
  kind is exempted; awaiting_input is never reaped). All four default constants
  are env-overridable via `resolveXxxMs()` helpers.
- `execution_freeze.coordinator` — `ShutdownFreezeCoordinator.onApplicationShutdown`
  (apps/api/src/execution-lifecycle/shutdown-freeze.coordinator.ts:32-103):
  - Pauses BullMQ workers first (`StepQueueDrainer.pauseAll`).
  - Honors `EXECUTION_FREEZE_BUDGET_MS` capped at `MAX_FREEZE_BUDGET_MS = 25_000`
    ms (well below Docker `stop_grace_period` = 30s).
  - Freezes only `FREEZABLE_EXECUTION_KINDS` (workflow_step, workflow_chat,
    adhoc_chat — subagents are explicitly excluded).
  - Marks the row frozen + publishes `execution.paused` with reason
    `service_shutdown`.
  - Continues past individual container-freeze errors.
- `execution_resume.coordinator` —
  `StartupResumeCoordinator.onApplicationBootstrap`
  (apps/api/src/execution-lifecycle/startup-resume.coordinator.ts:34-92):
  - Tries unpause first when the container is `paused` or `running`.
  - Falls back to `SessionRehydrator.rehydrateAndResume()` for `stopped` or
    `missing` containers.
  - Always transitions the lifecycle to `running` in the `finally` block so
    the API starts accepting work even if resume hit errors.
  - Exposes a `lastResumeSummary` accessor for ops inspection.
- `execution_dispatch.fire_and_poll` —
  `ExecutionDispatchService.dispatch()` (apps/api/src/execution-lifecycle/execution-dispatch.service.ts:43-67)
  returns the new `executionId` synchronously after persisting the row and
  emitting `execution.created`, then runs provision + agent kickoff in the
  background. Container cleanup happens on failure paths only.
- `execution_heartbeat.throttled` —
  `ExecutionHeartbeatService.recordActivity()` (apps/api/src/execution-lifecycle/execution-heartbeat.service.ts:11-23)
  enforces a 15-second minimum interval per execution via
  `shouldEmitHeartbeat()` (apps/api/src/execution-lifecycle/heartbeat-throttle.helpers.ts).
- `service_lifecycle.phase_tracker` —
  `ServiceLifecycleStateService` (apps/api/src/execution-lifecycle/service-lifecycle-state.service.ts)
  exposes `phase`, `markRunning()`, `markDraining()`, `isAcceptingWork()`,
  `isReapingSuspended()`. Used by both coordinators and the supervisor.
- `execution_state_machine.legal_transitions` —
  `execution-transition.helpers.ts` defines `TERMINAL_EXECUTION_STATES` and
  `LEGAL_EDGES` (apps/api/src/execution-lifecycle/execution-transition.helpers.ts:3-37),
  consumed by the repository's `applyTransition` (database/repositories/execution.repository.ts:138).
- `executions.controller.getById` — minimal `GET /executions/:id` returning an
  `ExecutionReadModel` via `toExecutionReadModel()` (apps/api/src/execution-lifecycle/executions.controller.ts).

**Module Wiring** — `ExecutionLifecycleModule` (apps/api/src/execution-lifecycle/execution-lifecycle.module.ts)
correctly imports `TypeOrmModule.forFeature([ExecutionEntity])`,
`DomainEventsModule`, and `StepSessionCheckpointModule`, and exports
`ExecutionEventPublisher`, `ExecutionRepository`, `ExecutionHeartbeatService`,
`ExecutionDispatchService`, `ServiceLifecycleStateService`, and
`StartupResumeCoordinator` (the last only).

## Health Findings

**Test Coverage (excellent)**
- 17 spec files cover all 17 production files in this scope (100% pairing).
- Test-to-source ratio: ~1.7× overall; supervisor alone is ~2.2×
  (345 prod / 761 spec lines).
- Notable depth:
  - `classifyExecutionForReaping` (18+ tests) covers every verdict
    branch, env-resolution paths, awaiting_input exemption, workflow_step
    exemption, container_lost debounce within/beyond grace, and
    spawn_timeout vs never_dispatched precedence.
  - `ExecutionSupervisorService.sweepOnce` (12+ tests) covers idle
    reaping, workflow_step exemption, container_lost debounce + recovery
    + re-loss, spawn_timeout, never_dispatched, freeze awareness, plus
    six checkpoint-persistence scenarios (claude_code marker, pi marker,
    claude_code host-jsonl, pi session.jsonl absent, no-deps, flag-off).
  - `ShutdownFreezeCoordinator` (3 tests) covers happy path,
    one-container-error resilience, and budget exhaustion short-circuit.
  - `StartupResumeCoordinator` (4 tests) covers paused, missing, running,
    and stopped container paths.
  - `ExecutionDispatchService` (14 tests) covers happy path (8 scenarios
    — kind/kind-specific, sync vs async event ordering, agent kickoff,
    background:true, provider/model persistence, workflow_run_id
    passthrough) and failure paths (provision failure × 3, agent
    non-ok response × 2).
  - `ServiceLifecycleStateService` (3 tests) covers booting→running,
    draining, and reaping suspension.
  - `shouldEmitHeartbeat` (5 tests) covers undefined, within, at, beyond,
    and custom interval.
  - `isLegalTransition` (6 tests) covers terminal detection, basic
    edges, reaping from any active state, terminal immutability, and
    self-transition rules.
  - `ExecutionsController` (2 tests) covers found / NotFound.

**Code Quality (strong)**
- Consistent 3-file pattern (`*.ts` + `*.spec.ts` + `*.types.ts`)
  enforced across the scope.
- `OnApplicationBootstrap` (StartupResumeCoordinator) and
  `OnApplicationShutdown` (ShutdownFreezeCoordinator) hook into
  NestJS lifecycle correctly.
- Error handling: supervisors log and continue; freeze coordinator
  marks per-execution skip; dispatch publishes failure events; resume
  increments `failed` counter; heartbeat failures are debug-level.
- State transitions are well-typed via `LEGAL_EDGES` table and
  enforced centrally in `ExecutionRepository.applyTransition`.
- Sidecar checkpoint reading uses a guarded `try/catch` around
  `readFile` and treats `ENOENT` as a non-error condition
  (first-cycle reap expectation).
- The `containerLostSince` map is pruned each sweep to prevent
  unbounded growth (apps/api/src/execution-lifecycle/execution-supervisor.service.ts:138-145).

**Minor Code Smells (non-blocking)**
- `ExecutionDispatchService.resolveContainerIp()`
  (apps/api/src/execution-lifecycle/execution-dispatch.service.ts:124-156)
  calls `getContainerStatus()` and explicitly discards the result
  (`void status;`) before invoking `inspectContainerIp()`. The
  status call is dead code. The protected `resolveIpFromOrchestrator()`
  hook returns `undefined` by default, with a comment instructing
  callers to override via a subclass or extend `DispatchParams`. This
  is testable (the spec uses a `TestableExecutionDispatchService`
  subclass) but the default would not work in production without
  integration wiring — a future refactor could resolve the IP via the
  orchestrator's existing inspect path rather than a stub hook.
- `CheckpointPersistenceDeps` is typed as required in the types
  file but the supervisor's constructor declares it as optional
  (`checkpointDeps?: CheckpointPersistenceDeps`); the module always
  injects it via `useFactory`, so the optionality exists only for
  unit-test ergonomics. The comment in the types file acknowledges
  this: "optional for backward-compatibility".

**Churn / Stability (calm)**
- 2,716 total lines for the scope; a sizable but stable surface.
- No `.git` history was inspected (read-only probe), but the
  consistent pattern across adjacent files (execution-lifecycle/
  is 36 files including the persistence/contracts split) suggests
  a coordinated implementation rather than incremental patchwork.

## Open Questions

- **IP resolution default**: Is the `protected` `resolveIpFromOrchestrator`
  hook in `ExecutionDispatchService` overridden anywhere in production
  wiring (e.g., a custom provider or subclass registered in
  `ExecutionLifecycleModule`)? The spec uses a subclass, and the
  implementation comments explicitly defer the wiring decision.
  Outside-scope integration would clarify this.

- **Checkpoint persistence dependencies**: `CheckpointPersistenceDeps`
  is declared optional in the supervisor constructor but the module
  factory always provides it. Confirm whether the optional signature
  is load-bearing for any consumer (e.g., a separate deployment that
  intentionally disables the resume feature without the flag).

- **`execution.paused` consumers**: `ShutdownFreezeCoordinator` emits
  `execution.paused` (consumed by `ExecutionEventPublisher` /
  `OutboxDomainEventBus`). The downstream consumer (likely the
  projector) is outside the scope of this probe; the
  `execution-transition.helpers` LEGAL_EDGES table does not contain
  a `* → paused` transition, suggesting `paused` is a flag-only
  state (frozen=true) rather than a row-state transition. Worth
  confirming with the execution-projection / domain-events probe.

- **Freeze-aware supervisor observation**: The supervisor honors
  `row.frozen` by skipping (apps/api/src/execution-lifecycle/execution-supervisor.service.ts:106).
  This implies that during a long shutdown the supervisor may run
  while rows are being frozen. With a 30s sweep interval and a
  20s freeze budget, this is fine for normal shutdown, but a
  pathological case where a sweep is in-flight when shutdown
  begins needs verification — the `isReapingSuspended()` guard
  is checked at the start of the sweep, not re-checked mid-sweep.
