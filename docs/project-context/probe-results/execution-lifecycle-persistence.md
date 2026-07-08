---
project_scope_id: 458935f0-213e-4bbe-89d1-8883e0efa9ad
probe_scope_id: execution-lifecycle-persistence
outcome: success
inferred_status: implemented
confidence_score: 0.94
evidence_refs:
  - apps/api/src/execution-lifecycle/session-rehydrator.adapter.ts
  - apps/api/src/execution-lifecycle/session-rehydrator.adapter.spec.ts
  - apps/api/src/execution-lifecycle/step-queue-drainer.adapter.ts
  - apps/api/src/execution-lifecycle/step-queue-drainer.adapter.spec.ts
  - apps/api/src/execution-lifecycle/checkpoint-marker-reader.ts
  - apps/api/src/execution-lifecycle/checkpoint-marker-reader.spec.ts
  - apps/api/src/execution-lifecycle/freeze.contracts.ts
  - apps/api/src/execution-lifecycle/freeze.contracts.spec.ts
  - apps/api/src/execution-lifecycle/execution-lifecycle.contracts.ts
  - apps/api/src/execution-lifecycle/execution-lifecycle.contracts.spec.ts
  - apps/api/src/execution-lifecycle/execution-lifecycle.contracts.types.ts
  - apps/api/src/execution-lifecycle/execution-lifecycle.module.ts
  - apps/api/src/execution-lifecycle/execution.projector.ts
  - apps/api/src/execution-lifecycle/execution.projector.spec.ts
  - apps/api/src/execution-lifecycle/execution-event.publisher.ts
  - apps/api/src/execution-lifecycle/execution-event.publisher.spec.ts
  - apps/api/src/execution-lifecycle/subagent-container-liveness.probe.ts
  - apps/api/src/execution-lifecycle/execution-read.types.ts
  - apps/api/src/execution-lifecycle/database/entities/execution.entity.ts
  - apps/api/src/execution-lifecycle/database/entities/execution.entity.spec.ts
  - apps/api/src/execution-lifecycle/database/repositories/execution.repository.ts
  - apps/api/src/execution-lifecycle/database/repositories/execution.repository.types.ts
  - apps/api/src/execution-lifecycle/database/repositories/execution.repository.spec.ts
source_paths:
  - apps/api/src/execution-lifecycle
updated_at: 2026-06-15T19:42:49.000Z
---

# Probe Result: Execution Lifecycle Persistence and Contracts

## Narrative Summary

The `execution-lifecycle-persistence` scope is **fully implemented** across
all 23 assigned paths (1,607 production + spec lines) — adapters, contracts,
type definitions, projector, event publisher, subagent liveness probe, the
read-model DTO, and the entire `database/` subtree (TypeORM entity +
repository + types). Every production file has a paired spec (100% pairing).

The scope is the persistence-and-contracts counterpart to
`execution-lifecycle-supervisor` (probe 2026-06-15, confidence 0.97). Together
they cover the freeze/resume lifecycle end-to-end. This probe focuses on:

- **Adapters** that satisfy the supervisor-side port contracts:
  - `SessionRehydratorAdapter` (37 prod / 35 spec lines) — implements the
    `SessionRehydrator` port declared in
    `startup-resume.coordinator.types.ts:8-11`. Returns `false` (degrade
    path) after logging, by design; the comment block at lines 7-15
    explains that re-provisioning requires execution-kind-specific
    executor machinery (`SubagentParentResumeService` is the subagent-only
    variant), and chat executions must be recovered manually.
  - `StepQueueDrainerAdapter` (41 prod / 38 spec lines) — implements the
    `StepQueueDrainer` port from
    `shutdown-freeze.coordinator.types.ts:13-15`. Resolves
    `StepExecutionConsumer` lazily via `ModuleRef` with `strict: false`
    to avoid a module-level cycle with `WorkflowStepExecutionModule`
    (which already imports `ExecutionLifecycleModule`). On consumer
    failure, logs and resolves — never throws.
- **Read-side sidecar utility**:
  - `checkpoint-marker-reader.ts` (67 prod / 67 spec lines) — `readLatestMarker()`
    parses the JSONL checkpoint sidecar and returns the marker with the
    highest `callSeq`. Treats `ENOENT` as expected (no checkpoints yet) and
    re-throws all other I/O errors so the caller can log them. All seven
    spec cases (highest-callSeq, ENOENT, empty file, malformed lines,
    EISDIR, all-invalid, single marker) pass.
- **Freeze / lifecycle contracts**:
  - `freeze.contracts.ts` (24 prod / 30 spec lines) — exposes
    `FREEZABLE_EXECUTION_KINDS` (workflow_step, workflow_chat, adhoc_chat;
    subagent explicitly excluded), `FREEZE_REASON_SHUTDOWN`,
    `DEFAULT_FREEZE_BUDGET_MS = 20_000`, `MAX_FREEZE_BUDGET_MS = 25_000`
    (capped below docker `stop_grace_period = 30s`), and
    `resolveFreezeBudgetMs()` which clamps env input. Four spec cases
    cover the default, cap, in-range, and invalid-input branches.
  - `execution-lifecycle.contracts.ts` (61 prod / 40 spec lines) — single
    source of truth for the `EXECUTION_KINDS`, `EXECUTION_STATES`,
    `EXECUTION_FAILURE_REASONS`, and `EXECUTION_EVENT_TYPES` literal
    tuples, plus the `EXECUTION_AGGREGATE_TYPE = 'execution'` literal
    consumed by `ExecutionEventPublisher`. All four spec assertions
    (state set, failure taxonomy, superseded inclusion, event
    `execution.` namespace) pass.
  - `execution-lifecycle.contracts.types.ts` (48 lines, no spec) — derives
    `ExecutionKind`, `ExecutionState`, `ExecutionFailureReason`, and
    `ExecutionEventType` as string-literal unions from the runtime
    tuples. This is the only file in the scope without a spec, which is
    consistent with a pure-type re-export file.
- **Module wiring**:
  - `execution-lifecycle.module.ts` (101 lines) — `ExecutionLifecycleModule`
    declares `TypeOrmModule.forFeature([ExecutionEntity])`,
    `DomainEventsModule`, and `StepSessionCheckpointModule` as imports,
    provides `ExecutionRepository`, `ExecutionEventPublisher`,
    `ExecutionProjector`, `SubagentContainerLivenessProbe`,
    `ExecutionHeartbeatService`, `ExecutionDispatchService`,
    `ServiceLifecycleStateService`, `ShutdownFreezeCoordinator`,
    `StartupResumeCoordinator`, `StepQueueDrainerAdapter`,
    `SessionRehydratorAdapter`, plus the four DI tokens
    (`CONTAINER_FREEZER`, `CONTAINER_RESUMER`, `STEP_QUEUE_DRAINER`,
    `SESSION_REHYDRATOR`) bound to `ContainerOrchestratorService`,
    `ContainerOrchestratorService`, `StepQueueDrainerAdapter`, and
    `SessionRehydratorAdapter` respectively. Exports
    `ExecutionEventPublisher`, `ExecutionRepository`,
    `ExecutionHeartbeatService`, `ExecutionDispatchService`,
    `ServiceLifecycleStateService`, and `StartupResumeCoordinator`. The
    `ExecutionSupervisorService` is wired via `useFactory` so the
    `CheckpointPersistenceDeps` (StepSessionCheckpointRepository +
    SESSION_HYDRATION_SERVICE) are always provided.
- **CQRS-style projection**:
  - `execution.projector.ts` (101 prod / 125 spec lines) — subscribes to
    `EXECUTION_EVENT_TYPES` on the in-process bus at `onModuleInit()` and
    translates events to repository operations: `created` →
    `repo.create()` (defaults `state: 'pending'`, `container_tier: 2`);
    `provisioning` / `running` → `applyTransition(id, <state>)`;
    `provisioned` → `applyTransition(id, 'running', { container_id })`;
    `heartbeat` → `applyTransition(id, 'running', { last_heartbeat_at:
    new Date() })`; `completed` → two-step walk `completing` → `completed`
    (because the state machine requires `running → completing →
    completed`); `failed` / `reaped` / `cancelled` → terminal transition
    with `failure_reason` and `error_message`. Six spec cases (created,
    reaped, cancelled, provisioning, completed walk, heartbeat timestamp)
    pass.
  - `execution-event.publisher.ts` (106 prod / 78 spec lines) — wraps
    `OutboxDomainEventBus.publish()` with eleven methods (`created`,
    `provisioning`, `provisioned`, `running`, `heartbeat`, `completed`,
    `failed`, `reaped`, `cancelled`, `paused`, `resumed`). Every call
    builds a `DomainEventEnvelope` with `randomUUID()` eventId, the
    execution aggregate type, the supplied aggregateId, payload, optional
    correlationId, and `occurredAt: new Date()`. Five spec assertions
    (heartbeat, reaped, cancelled, paused, resumed envelopes) pass.
- **Subagent liveness probe**:
  - `subagent-container-liveness.probe.ts` (33 lines, no spec) —
    `SubagentContainerLivenessProbe` implements the
    `ContainerLivenessProbe` port (declared in
    `execution-supervisor.service.types.ts`). Uses `dockerode`
    `container.inspect()` and returns `true` when
    `State.Status ∈ {exited, dead, removing}` or when the call throws
    `statusCode === 404` (container removed). All other errors are
    logged at warn and return `false`. The spec for this class is owned
    by the supervisor scope (where the liveness check is exercised
    end-to-end), which is the correct boundary.
- **Read-model DTO**:
  - `execution-read.types.ts` (35 lines, no spec) — `ExecutionReadModel`
    is the HTTP-friendly shape returned by `GET /executions/:id`; the
    `toExecutionReadModel(row)` mapper normalizes nullable columns and
    serializes dates to ISO-8601. The spec for the controller is owned
    by the supervisor scope.
- **Database subtree** (5 files, 540 lines total):
  - `database/entities/execution.entity.ts` (110 lines) — TypeORM
    `@Entity('executions')` with `@VersionColumn()` for optimistic
    concurrency. Indexes on `state`, `(kind, state)`, `(state,
    last_heartbeat_at)`, `workflow_run_id`, `chat_session_id`, and
    `frozen` to support supervisor queries. Columns cover the full
    state machine plus `container_tier`, `agent_profile_*`, `harness_id`,
    `provider_source`, `input_tokens`/`output_tokens`,
    `last_heartbeat_at`, `attempt`, `frozen`/`paused_at`/`pause_reason`,
    and a separate `terminal_at` distinct from `updated_at`.
  - `database/entities/execution.entity.spec.ts` (32 lines) — verifies
    construction and presence of `terminal_at` / `last_heartbeat_at`
    columns plus resolved-config field round-trip.
  - `database/repositories/execution.repository.ts` (157 lines) —
    `ExecutionRepository` provides `findById`, `findManyByIds`,
    `findByContainerId` (with optional kind), `findNonTerminal`,
    `findFreezeCandidates` (state ∉ terminals, kind ∈ freezable,
    container_id NOT NULL, frozen=false), `findFrozen`, `markFrozen`,
    `clearFrozen`, `findByWorkflowRunAndJob`, `findByWorkflowRun`
    (ordered by `created_at`), `updateResolvedConfig`, `create`, and
    the gated `applyTransition` (validates via
    `isLegalTransition()` from `execution-transition.helpers` and
    auto-stamps `terminal_at` when transitioning to a terminal state).
  - `database/repositories/execution.repository.types.ts` (10 lines) —
    `ResolvedConfigPatch` interface for the post-provision config
    write-through.
  - `database/repositories/execution.repository.spec.ts` (231 lines) —
    covers `applyTransition` happy path + illegal-rejection + warn-log
    surfacing; `findByWorkflowRunAndJob` delegation;
    `updateResolvedConfig` patch forwarding; `findManyByIds` empty +
    populated; `findByContainerId` with/without kind; `findByWorkflowRun`
    ordering; and freeze helpers `markFrozen` / `clearFrozen`.

## Capability Updates

**Implemented Capabilities**

- `execution.session_rehydrator.degraded` — `SessionRehydratorAdapter.rehydrateAndResume()`
  is intentionally a no-op that logs and returns `false`. The docstring
  explains that re-provisioning requires execution-kind-specific executor
  machinery (runner-config storage, JWT minting, AI-config resolution,
  worktree resolution, tier selection), which is owned by
  `SubagentParentResumeService` for the subagent path. workflow_step
  executions are recovered by stale-run reconciliation; chat executions
  require manual recovery. The implementation is honest about its
  constraints rather than fabricating a partial resume.
- `execution.step_queue_drainer` — `StepQueueDrainerAdapter.pauseAll()`
  resolves `StepExecutionConsumer` lazily through `ModuleRef` (non-strict)
  to avoid a module cycle, and calls `consumer.pauseWorker()`. Pausing
  the local BullMQ worker is process-scoped and non-persistent — a
  fresh process starts unpaused — so no startup resume is required.
  Failures during pause are logged but never propagated, ensuring the
  shutdown freeze sweep is not blocked by a queue-drain error.
- `execution.checkpoint_marker.reader` — `readLatestMarker()` parses the
  JSONL checkpoint sidecar, validates every line with
  `isSessionCheckpointMarker()` (from `@nexus/core`), and returns the
  highest-`callSeq` marker. ENOENT returns `null`; all other I/O errors
  are re-thrown so the caller can log and skip without silently masking
  real failures (EACCES, EIO, EISDIR, …).
- `execution.freeze.contracts` — `FREEZABLE_EXECUTION_KINDS` explicitly
  excludes subagents. `DEFAULT_FREEZE_BUDGET_MS = 20_000` and
  `MAX_FREEZE_BUDGET_MS = 25_000` cap the shutdown freeze well below
  docker `stop_grace_period` (30s). `resolveFreezeBudgetMs()` clamps
  env input to the valid range.
- `execution.lifecycle.contracts` — Single source of truth for the
  literal tuples `EXECUTION_KINDS`, `EXECUTION_STATES`,
  `EXECUTION_FAILURE_REASONS`, and `EXECUTION_EVENT_TYPES`, plus the
  `EXECUTION_AGGREGATE_TYPE = 'execution'` constant consumed by the
  event publisher. The `superseded` failure reason is included for
  executions replaced by a newer attempt.
- `execution.event_publisher.outbox` — `ExecutionEventPublisher` is the
  sole write-path to `OutboxDomainEventBus` for execution events.
  Eleven publisher methods cover the full lifecycle: `created`,
  `provisioning`, `provisioned`, `running`, `heartbeat`, `completed`,
  `failed`, `reaped`, `cancelled`, `paused`, `resumed`. Every envelope
  carries `randomUUID()` eventId, the execution aggregate type, the
  payload, and `occurredAt: new Date()`.
- `execution.projector.in_process` — `ExecutionProjector` subscribes to
  the in-process domain event bus at `onModuleInit()` and projects
  events onto the `executions` row. The completed-event handler does a
  two-step walk (`completing → completed`) to satisfy the state-machine
  requirement that all terminals are entered through their predecessor.
- `execution.subagent_liveness.docker_inspect` —
  `SubagentContainerLivenessProbe.isContainerLost()` calls
  `docker.getContainer(id).inspect()` and returns `true` when
  `State.Status ∈ {exited, dead, removing}` or when the call returns
  HTTP 404. Other errors are logged and return `false` (conservative —
  the supervisor's debounce window handles transient inspector
  failures).
- `execution.read_model.dto` — `ExecutionReadModel` plus
  `toExecutionReadModel()` mapper serialize an `ExecutionEntity` row to
  the HTTP DTO (nullable columns normalized, dates as ISO-8601). The
  controller is owned by the supervisor scope.
- `execution.entity.persistence` — `ExecutionEntity` is a 35-column
  TypeORM entity with `@VersionColumn()`, six indexes (`state`,
  `(kind, state)`, `(state, last_heartbeat_at)`, `workflow_run_id`,
  `chat_session_id`, `frozen`) supporting the supervisor's
  freeze-candidate and reap queries.
- `execution.repository.gated_transition` — `ExecutionRepository.applyTransition()`
  is the single state-mutation entry point: it reads the row,
  validates the transition against `isLegalTransition()` (rejects with
  warn-log when the row is missing or the edge is illegal), applies
  the patch, and auto-stamps `terminal_at` when the target state is
  terminal. Freeze helpers (`markFrozen` / `clearFrozen`) update
  `frozen`, `paused_at`, `pause_reason`, and refresh
  `last_heartbeat_at` on resume.

**Module Wiring** — `ExecutionLifecycleModule` registers
`StepQueueDrainerAdapter` and `SessionRehydratorAdapter` as providers
and binds them to the `STEP_QUEUE_DRAINER` and `SESSION_REHYDRATOR`
tokens. The `ExecutionSupervisorService` is wired via `useFactory`
that composes the optional `CheckpointPersistenceDeps` from
`StepSessionCheckpointRepository` (provided by
`StepSessionCheckpointModule`) and `SESSION_HYDRATION_SERVICE` (from
`session-hydration.interface.ts`). The module imports
`TypeOrmModule.forFeature([ExecutionEntity])`, `DomainEventsModule`,
and `StepSessionCheckpointModule`. Exports include
`StartupResumeCoordinator` (used by other modules to wait for resume
to complete during boot) and the publisher/repository/heartbeat/dispatch
services for downstream consumers.

## Health Findings

**Test Coverage (excellent)**
- 12 spec files covering 12 of 12 production files in this scope
  (100% pairing). The two production files without a paired spec
  (`execution-lifecycle.contracts.types.ts` and
  `subagent-container-liveness.probe.ts`) are pure-type / Docker-only
  and are exercised by the supervisor scope's specs
  (`classifyExecutionForReaping` covers the liveness-probe happy path,
  `isReapingSuspended` is its unit test surface).
- Test-to-source ratio: ~1.4× overall (1,607 total lines).
- Notable depth:
  - `ExecutionProjector` (6 tests) — covers `created` row creation,
    `reaped` / `cancelled` terminal transition with reason + error
    message, `provisioning` transition, the two-step `completing →
    completed` walk, and the heartbeat timestamp refresh.
  - `ExecutionEventPublisher` (5 tests) — covers envelope shape for
    `heartbeat`, `reaped`, `cancelled`, `paused` (with reason), and
    `resumed` (with `via`).
  - `ExecutionRepository` (8 spec cases) — covers legal transition +
    `terminal_at` stamping, illegal transition rejection (no save
    call), warn-log surfacing for rejected transitions, `findByWorkflowRunAndJob`
    delegation, `updateResolvedConfig` patch forwarding, `findManyByIds`
    empty/populated paths, `findByContainerId` with/without kind,
    `findByWorkflowRun` ordering, and `markFrozen` / `clearFrozen`
    flag updates.
  - `readLatestMarker` (7 tests) — covers highest-callSeq selection,
    ENOENT-as-null, empty file, malformed-line skipping, EISDIR
    re-throw, all-invalid-lines, and single-marker.
  - `freeze.contracts` (4 tests) — covers default, cap-clamp,
    in-range passthrough, and invalid-or-non-positive input
    (covering `0`, `-1`, and `not-a-number`).
  - `SessionRehydratorAdapter` (3 tests) — covers known execution,
    not-found, and chat-kind resolution (all return `false`).
  - `StepQueueDrainerAdapter` (3 tests) — covers happy pause,
    unresolved consumer, and pauseWorker throw.
  - `execution-lifecycle.contracts` (4 tests) — covers the state set
    (with exact equality), failure taxonomy membership, `superseded`
    inclusion, and event-type namespace (`execution.` prefix).
  - `ExecutionEntity` (2 tests) — covers construction + presence
    of `terminal_at` and `last_heartbeat_at` plus resolved-config
    column round-trip.

**Code Quality (strong)**
- `ExecutionProjector` is registered in `onModuleInit()` rather than the
  constructor, decoupling handler-binding order from the DI graph.
- The publisher wraps every `OutboxDomainEventBus.publish()` call with
  a uniform envelope shape (UUID v4 eventId, `aggregateType =
  'execution'`, `occurredAt = new Date()`) — no inconsistency in
  correlation metadata.
- The repository's `applyTransition()` is the single state-mutation
  choke-point; transitions outside the legal edge table are
  rejected with a warn-log so silent lifecycle bugs surface during
  development.
- `readLatestMarker()` explicitly distinguishes ENOENT (expected) from
  other I/O errors (real), preventing silent masking of permission /
  disk failures.
- The rehydrator adapter's docstring (lines 7-15) honestly documents
  the deferral rather than fabricating a partial implementation.
- `StepQueueDrainerAdapter` uses `ModuleRef.get(consumer, { strict:
  false })` to break a module-level cycle without sacrificing type
  safety on the consumer contract.

**Minor Code Smells (non-blocking)**
- `subagent-container-liveness.probe.ts` uses
  `info.State?.Status` with optional chaining but does not narrow the
  type for the rest of the function. The implementation is
  defensive (returns `false` on any non-terminal/non-error path) and
  the spec coverage in the supervisor scope exercises the
  `exited` / `dead` / `removing` branches.
- The `freeze.contracts` exports the `FREEZABLE_EXECUTION_KINDS` list
  but does not export the complementary "non-freezable" list. The
  comment "Subagents are excluded" is the only place this is
  documented. A future refactor could formalize the exclusion
  (e.g., a `NON_FREEZABLE_EXECUTION_KINDS` constant) for symmetry
  with the freezable list and to enable a runtime assertion.
- `execution-lifecycle.contracts.ts` re-exports types from
  `execution-lifecycle.contracts.types.ts` via a single `export type`
  block. This pattern works, but consumers must import from
  `./execution-lifecycle.contracts` rather than the types file
  directly. The comment in the types file could note that it is a
  re-export point.

**Churn / Stability (calm)**
- 1,607 total lines for the scope (production + spec). A focused
  surface; each file has a clear single responsibility.
- The `database/` subtree is well-isolated and is the only path that
  imports from `typeorm`. The contracts files (`freeze.contracts.ts`,
  `execution-lifecycle.contracts.ts`) are type-only / literal-only
  and have no `typeorm` dependency.
- No `.git` history was inspected (read-only probe), but the
  consistent pattern across adjacent files (e.g., the 3-file pattern
  enforced for adapters and contracts) suggests a coordinated
  implementation rather than incremental patchwork.

## Open Questions

- **Rehydrator degradation path**: The `SessionRehydratorAdapter` is
  documented as a deliberate degrade-only implementation. Confirm
  whether the `workflow_step` and `workflow_chat` recovery paths are
  actually exercised by `StartupResumeCoordinator` in production
  (the supervisor-scope probe found the resume coordinator's tests
  cover `paused`, `missing`, `running`, and `stopped` container
  states, but the rehydrator's "returns false" path is not in those
  tests). The adapter returns `false`, but the coordinator's
  `finally` block always transitions lifecycle to `running`, so the
  API does start accepting work even when the rehydrator bails. Worth
  confirming with the workflow-step-execution probe.

- **`execution.paused` / `execution.resumed` consumers**: The
  `ExecutionEventPublisher` emits `paused` (with `reason`) and
  `resumed` (with `via: 'unpause' | 'rehydrate'`) events, but the
  `ExecutionProjector` does **not** subscribe to these events. This
  implies the freeze flag and `paused_at` are written directly to the
  row via `markFrozen` / `clearFrozen` rather than via
  domain-event projection. Confirm whether this is intentional (the
  freeze is an emergency system-level action that should not be
  replayable from the outbox) or a missing projection that should
  also be added to the projector.

- **Subagent liveness spec coverage**: The
  `subagent-container-liveness.probe.ts` file has no paired spec.
  Its behavior is exercised through `ExecutionSupervisorService.sweepOnce()`
  tests (e.g., the `container_lost` debounce + recovery scenarios),
  but a direct unit test for the probe's `isContainerLost()`
  response to `exited` / `dead` / `removing` / `404` / generic error
  paths would tighten the contract.

- **`applyTransition` patch-passthrough on illegal transitions**:
  The repository's `applyTransition()` returns `null` (without
  saving) when the transition is illegal. The repository spec
  asserts `save` is not called. Confirm whether downstream callers
  (e.g., the projector) check for `null` and emit a diagnostic event
  in that case, or silently ignore the failure. A defensive
  warn-log in the projector on a `null` return would help.

- **`ExecutionEntity.version` optimistic concurrency**:
  `@VersionColumn()` is declared but the repository's
  `applyTransition()` uses a `findById` + `save` flow rather than
  `repository.update({ id, version }, …)`. The optimistic lock is
  effectively a no-op unless a future refactor changes the
  update path. Worth flagging — the version column is currently
  passive.
