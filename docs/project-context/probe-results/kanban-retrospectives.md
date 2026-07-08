---
project_scope_id: 458935f0-213e-4bbe-89d1-8883e0efa9ad
probe_scope_id: kanban-retrospectives
outcome: success
inferred_status: implemented
confidence_score: 0.92
evidence_refs:
  - apps/kanban/src/retrospectives/retrospectives.module.ts
  - apps/kanban/src/retrospectives/retrospectives.controller.ts
  - apps/kanban/src/retrospectives/kanban-retrospective.service.ts
  - apps/kanban/src/retrospectives/kanban-retrospective-evidence.service.ts
  - apps/kanban/src/retrospectives/cycle-decision-metadata.ts
  - apps/kanban/src/retrospectives/events/cycle-decision-event.handler.ts
  - apps/kanban/src/retrospectives/board-state-snapshot.service.ts
  - apps/kanban/src/database/entities/kanban-retrospective-run.entity.ts
  - apps/kanban/src/database/repositories/kanban-retrospective-run.repository.ts
  - apps/kanban/src/database/migrations/20260516150000-create-kanban-retrospective-runs.ts
  - apps/kanban/src/orchestration/orchestration.service.ts (runForCompletion caller)
  - apps/kanban/src/events/__tests__/cycle-decision.events.test.ts
  - apps/kanban/src/retrospectives/kanban-retrospective.service.spec.ts
  - apps/kanban/src/retrospectives/kanban-retrospective-evidence.service.spec.ts
  - apps/kanban/src/retrospectives/retrospectives.controller.spec.ts
  - apps/kanban/src/database/repositories/kanban-retrospective-run.repository.spec.ts
source_paths:
  - apps/kanban/src/retrospectives/
  - apps/kanban/src/database/entities/kanban-retrospective-run.entity.ts
  - apps/kanban/src/database/repositories/kanban-retrospective-run.repository.ts
  - apps/kanban/src/database/migrations/20260516150000-create-kanban-retrospective-runs.ts
  - apps/kanban/src/orchestration/orchestration.service.ts
  - apps/kanban/src/app.module.ts
updated_at: 2026-06-15T16:30:00.000Z
---

# Probe Result: Kanban Retrospectives

## Narrative Summary

The Kanban Retrospectives feature is fully implemented as a NestJS module
under `apps/kanban/src/retrospectives/` and is wired into the application
through `apps/kanban/src/app.module.ts` (`RetrospectivesModule` is imported).
The feature exposes three HTTP endpoints (`POST /retrospectives/run`,
`GET /retrospectives/runs`, `GET /retrospectives/projects/:projectId/status`),
persists run state in a dedicated `kanban_retrospective_runs` table, collects
project evidence (work items, orchestration decision log, action requests, and
cycle-decision delivery projections) and emits a `learning.candidate.proposed.v1`
domain event to the Core workflow client when an orchestration cycle completes
with substantive decision data.

The pipeline is triggered from `OrchestrationService` via
`KanbanRetrospectiveService.runForCompletion(...)`, which is called from
`OrchestrationCycleDecisionService` after a `complete` decision is persisted.
Manual replay is also supported via `runManualReplay(...)` driven by the
controller. Idempotency is enforced through a unique `idempotency_key` index
on the runs table, a 15-minute cooldown between completed runs (bypassed when
`manual_override` is set), and a `no_delta` short-circuit when the freshly
collected delta snapshot is byte-identical to the previous completed run.

A separate in-memory `CycleDecisionEventHandler` is registered at module init
and subscribes to `kanban.retrospective_cycle_decision_recorded` events,
storing per-project evidence with bounded capacity (default 100/project) and a
7-day rolling window. This handler's stored decisions are merged with database
event projections to enrich the `learning.candidate.proposed` payload with
substantive cycle-decision evidence entries.

## Capability Updates

- **Manual retrospective replay** — `KanbanRetrospectiveService.runManualReplay`
  consumes the `RunRetrospectiveDto` (validated by `runRetrospectiveSchema`,
  Zod) and produces a run record with `trigger_type = "manual_replay"`,
  `replay_of_run_id` linkage, and `manual_override` flag that bypasses
  cooldown.
- **Completion-triggered retrospective** — `runForCompletion` is invoked by
  `OrchestrationService` (via `OrchestrationCycleDecisionService`) when a
  `complete` cycle decision is recorded. Builds an idempotency key from
  `project_id` + `trigger_revision_marker` to prevent duplicate emissions.
- **REST API surface** — `RetrospectivesController` exposes run/list/status
  endpoints with Zod-validated DTOs and a custom `parseDto` helper that maps
  `project_id` validation failures to a clear `BadRequestException`.
- **Cooldown + dedup** — 15-minute cooldown between completed runs (constant
  `RETROSPECTIVE_COOLDOWN_MS`); duplicate idempotency keys return a
  `skipped` result with `duplicate_trigger` reason. Concurrent creates that
  hit Postgres unique constraint `23505` are caught and converted to a
  `skipped` result.
- **Delta snapshotting** — `KanbanRetrospectiveEvidenceService.collectProjectEvidence`
  produces a deterministic `KanbanRetrospectiveDeltaSnapshot` (project,
  orchestration, work items by status, decisions incl. cycle-decision marker
  booleans, action requests by status and action). Stable JSON comparison
  detects `no_delta` and short-circuits emission.
- **Cycle decision event ingestion** — Two complementary sources feed cycle
  decision evidence into retrospective payloads:
  1. `KanbanEventDeliveryProjectionRepository.listByProject` (persistent
     projections filtered on
     `kanban.retrospective_cycle_decision_recorded.v1`).
  2. In-memory `CycleDecisionEventHandler` storage keyed by `projectId`.
  The two are merged, deduplicated by idempotency key, and sorted by
  `recordedAt` descending in `KanbanRetrospectiveService.mergeCycleDecisionEvents`.
- **Learning candidate emission** — On a successful run, the service emits
  `learning.candidate.proposed.v1` via `CoreWorkflowClientService.emitDomainEventOrThrow`.
  The payload includes a lesson summary string, structured
  `kanban_retrospective_delta` evidence, an array of
  `kanban_cycle_decision_event` evidence entries, confidence `0.6`, and
  full provenance (project, orchestration, retrospective run id, trigger
  type/revision marker, cycle decision).
- **Skip/fail result states** — `RunResult` discriminated union: `completed`
  (with `candidateCount`), `skipped` (with `reason` from
  `KANBAN_RETROSPECTIVE_SKIP_REASONS`:
  `no_delta | cooldown_active | duplicate_trigger | missing_project | missing_orchestration | insufficient_evidence`),
  and `failed` (with `failureReason`).
- **Persistence** — Dedicated `kanban_retrospective_runs` table created by
  migration `20260516150000-create-kanban-retrospective-runs` with three
  indices: unique on `idempotency_key`, composite
  `(project_id, created_at)`, and composite `(status, created_at)`.
  Repository methods: `createRun`, `findById`, `findByIdempotencyKey`,
  `findLatestByProject`, `findLatestCompletedByProject`, `list`, and
  `markCompleted` / `markSkipped` / `markFailed` terminal transitions.
- **Cycle decision metadata extraction** — `cycle-decision-metadata.ts`
  provides pure functions: `extractWorkItemCounts`, `extractGoalCoverage`,
  `extractBoardStateSummary`, `determineHasBoardMutation`,
  `isNonTrivialCycleDecision`, `extractCycleDecisionMetadata`,
  `createCycleMetadata`, and `EMPTY_BOARD_STATE`. The "non-trivial" rule
  treats `BLOCKED`/`COMPLETE` always-non-trivial and `REPEAT` non-trivial
  only when a board mutation is detected (blocked tasks present).
- **Cycle decision event factories** — `events/cycle-decision.recorded.event.ts`
  exports `CYCLE_DECISION_RECORDED_EVENT_NAME`
  (`kanban.retrospective_cycle_decision_recorded.v1`), the
  `createCycleDecisionRecordedEvent` factory, the
  `CycleDecisionRecordedEventClass` class with `toPayload()` /
  `toDomainEvent()` methods, and the `KanbanDomainEvent` /
  `CycleDecisionRecordedEventPayload` types.
- **Module init** — `KanbanRetrospectiveService.onModuleInit` calls
  `this.cycleDecisionHandler.register()` so the event handler subscribes to
  the kanban event emitter on boot. The module's own `onModuleInit` is a
  no-op (placeholder comment).

## Health Findings

- **Strong test coverage** — Four dedicated `*.spec.ts` files in the scope:
  - `kanban-retrospective.service.spec.ts` (603 lines, ~10 scenarios
    covering happy-path, duplicate idempotency, cooldown, evidence
    insufficient, candidate event emission failure, no-delta replay,
    concurrent unique-constraint collision, status lookup, empty project
    status, list formatting).
  - `kanban-retrospective-evidence.service.spec.ts` (304 lines, ~6
    scenarios covering missing project, missing orchestration, ready
    snapshot, cycle decision events, insufficient evidence).
  - `retrospectives.controller.spec.ts` (117 lines, parameterised
    validation cases for query DTOs and BadRequest mapping).
  - `database/repositories/kanban-retrospective-run.repository.spec.ts`
    (187 lines, full coverage of every repository method).
  - Migration test
    `database/migrations/20260516150000-create-kanban-retrospective-runs.spec.ts`.
  - Integration coverage: `events/__tests__/cycle-decision.events.test.ts`
    (~1.8k lines) verifies the event emission rule from
    `CompleteOrchestrationCycleDecisionTool` /
    `OrchestrationRecordCycleDecisionTool`; `orchestration.service.spec.ts`
    has explicit `it("runs completion retrospectives after persisting an
    effective complete decision")` and "does not run completion
    retrospectives for ..." parameterized cases; `orchestration.service.strategic.spec.ts`
    and `orchestration-continuation.integration.spec.ts` also exercise the
    `runForCompletion` collaborator.
- **Code quality observations** —
  - `retrospectives.module.ts` declares `OnModuleInit` but the method body
    is empty (registration is actually performed in the service). The
    `featureName` field and module-level `RETROSPECTIVES_FEATURE_NAME`
    constant are not used externally.
  - `BoardStateSnapshotService` (RxJS `BehaviorSubject` based) and its
    `board-state-snapshot.types.ts` are present in the scope but are not
    referenced by the active `KanbanRetrospectiveService` /
    `KanbanRetrospectiveEvidenceService` flow. They appear to be a parallel
    in-memory snapshot facility whose primary consumer lives elsewhere
    (likely UI/board components — outside the probe scope).
  - There are two distinct cycle-decision event type files in the repo:
    `events/kanban-retrospective-cycle-decision.types.ts` (with `abandon`
    decision, `board_state_snapshot` + `cycle_metadata` shape, used by the
    `CycleDecisionEventHandler` in the scope) and
    `events/types/retrospective-cycle-decision.types.ts` (with `board_mutation_detected`
    flag, used by other emit sites). The handler subscribes to the
    constant from `events/types/retrospective-cycle-decision.types.ts`
    (`KANBAN_RETROSPECTIVE_CYCLE_DECISION_EVENT_TYPE` =
    `"kanban.retrospective_cycle_decision_recorded"`). The `v1`-suffixed
    constant used in the controller/types
    (`RETROSPECTIVE_CYCLE_DECISION_RECORDED_EVENT` /
    `CYCLE_DECISION_RECORDED_EVENT_NAME`) shares the same base name.
  - `retrospective.types.ts` carries some legacy duplicates
    (`RetrospectiveCycleDecisionRecordedEventV1` plus the canonical
    `RetrospectiveCycleDecisionRecordedEvent`, both exporting compatible
    shapes) — multiple coexisting representations of the same concept.
  - Idempotency collision handling in
    `KanbanRetrospectiveService.isIdempotencyUniqueViolation` is hard-coded
    to the constraint string `idempotency_key` which matches the migration.
  - Churn: `2026-05-16` migration date suggests the feature was added
    recently; both `run` and `evidence` spec files were last modified on
    the same day, and the controller spec on `2026-05-19`.
- **DI wiring** — `RetrospectivesModule` declares
  `forwardRef(() => CoreIntegrationModule)`, registers the controller and
  three providers (`KanbanRetrospectiveService`,
  `KanbanRetrospectiveEvidenceService`, `CycleDecisionEventHandler`), and
  exports all three. `KanbanRetrospectiveService` is also injected into
  `OrchestrationService` (which constructs `OrchestrationCycleDecisionService`
  with a closure over `runForCompletion`).

## Open Questions

- The two coexisting cycle-decision event type modules
  (`events/kanban-retrospective-cycle-decision.types.ts` and
  `events/types/retrospective-cycle-decision.types.ts`) have slightly
  different shapes (`abandon` decision + `cycle_metadata` vs
  `board_mutation_detected` flag) — confirm whether both event shapes are
  actually emitted in production and whether the handler is expected to
  process the v1 `.v1`-suffixed event name emitted by
  `createCycleDecisionRecordedEvent` in addition to the unsuffixed one it
  currently subscribes to.
- `BoardStateSnapshotService` is defined in the retrospectives directory
  but appears unused by the active run/evidence flow. Confirm whether it is
  consumed by another module (e.g. UI snapshot stream) or whether it is
  dead code that should be relocated.
- `LEARNING_CANDIDATE_PROPOSED_EVENT` constant value
  (`learning.candidate.proposed.v1`) is the candidate event name; the
  Core workflow client's `emitDomainEventOrThrow` is called with no
  retry/queue semantics visible in the scope — confirm Core's
  delivery guarantee model for this event.
- The 15-minute cooldown constant
  (`RETROSPECTIVE_COOLDOWN_MS = 15 * 60 * 1000`) and the 7-day handler
  window are hard-coded; verify whether configuration externalisation is
  planned.
- The `failure_threshold` trigger type is declared in
  `KANBAN_RETROSPECTIVE_TRIGGER_TYPES` but no code path in the scope
  emits runs with this trigger; confirm whether it is reserved for a
  future scheduler integration.
- The module-level `onModuleInit` is a no-op while registration actually
  happens inside the service's `onModuleInit`. Verify the intent — is
  the module-level hook vestigial or reserved for future wiring?
