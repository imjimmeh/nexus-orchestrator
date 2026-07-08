---
project_scope_id: 458935f0-213e-4bbe-89d1-8883e0efa9ad
probe_scope_id: memory-segment-feedback-channel
outcome: success
inferred_status: implemented
confidence_score: 0.93
evidence_refs:
  - apps/api/src/memory/memory-segment-feedback.service.ts
  - apps/api/src/memory/memory-segment-feedback.service.types.ts
  - apps/api/src/memory/memory-learning-feedback-loop.integration.spec.ts
  - apps/api/src/memory/learning-convergence.helper.ts (actual: apps/api/src/memory/learning-convergence.helper.ts — see Open Questions)
  - apps/api/src/memory/database/entities/memory-segment-feedback.entity.ts
  - apps/api/src/memory/database/repositories/memory-segment-feedback.repository.ts
  - apps/api/src/memory/database/repositories/memory-segment-feedback.repository.types.ts
  - apps/api/src/database/migrations/20260626000000-create-memory-segment-feedback.ts
  - apps/api/src/settings/memory-feedback-window-days.constants.ts
  - apps/api/src/memory/memory.module.ts (provider registration at lines 46/120/192)
  - apps/api/src/workflow/workflow-internal-tools/handlers/memory-tools.handler.ts (recordFeedbackIfPresent + projectSegmentsWithUsefulness)
  - apps/api/src/workflow/workflow-internal-tools/handlers/memory-tools.handler.spec.ts (mock at line ~1244)
  - apps/api/src/memory/memory-decay.reaper.ts (optional feedback dependency, line ~154)
  - apps/api/src/memory/memory-eviction.reaper.ts (optional feedback dependency, line ~119)
  - apps/api/src/workflow/workflow-repair/workflow-run-outcome-after-lesson.listener.ts (terminal-event consumer that feeds the convergence ring the integration spec exercises)
  - apps/api/src/memory/memory-metrics.service.ts (computeConvergenceSnapshotsForWindow + getSnapshot publish path)
  - docs/work-items/66ea23d1-59f2-451b-a090-a292fad8f21b.md
  - docs/guide/35-memory-learning.md (section on MemorySegmentFeedbackService)
source_paths:
  - apps/api/src/memory/memory-segment-feedback.service.ts
  - apps/api/src/memory/memory-segment-feedback.service.types.ts
  - apps/api/src/memory/memory-learning-feedback-loop.integration.spec.ts
  - apps/api/src/memory/learning-convergence.helper.ts
updated_at: 2026-07-02T17:15:00.000Z
---

# Probe Result: Memory Segment Feedback Channel (66ea23d1 agent feedback)

## Narrative Summary

The Memory Segment Feedback Channel (work item `66ea23d1-59f2-451b-a090-a292fad8f21b`)
is **fully implemented** end-to-end. All four assigned paths exist (with one
path-correctness note below); the persistence layer, service layer, settings,
module wiring, runtime integration with the `queryMemory` internal tool, and
the convergence-feedback integration test are all in place. The kanban state
for the work item is still `backlog`, but the _code_ behind it is in main and
already consumed by three downstream consumers.

The channel records explicit `useful` / `not_useful` agent votes on
`memory_segments` rows, computes a rolling-window `usefulness_ratio`
(`count(useful) / count(total)` over `memory_feedback_window_days`, default
30 days), emits a `memory.feedback.recorded.v1` audit event per vote, and
attaches a `usefulness` field to every segment returned by `queryMemory`
(null when no votes exist — backfill-safe).

**One path discrepancy:** the playbook lists
`apps/api/src/memory/learning/learning-convergence.helper.ts`, but the actual
location is `apps/api/src/memory/learning-convergence.helper.ts` (one level
above the `learning/` directory, mirroring the placement of
`memory-learning-feedback-loop.integration.spec.ts`). The file is real, the
implementation is complete, and the integration test at the assigned path
imports `MemoryMetricsService` (which itself imports the helper) so the
discrepancy does not block any verification.

## Capability Updates

### 1. Service layer — `MemorySegmentFeedbackService`

- **Path:** `apps/api/src/memory/memory-segment-feedback.service.ts` (~280
  lines including extensive inline documentation).
- **Public surface (3 methods):**
  - `recordFeedback(input: RecordFeedbackInput): Promise<MemorySegmentFeedback>`
    — persists via `MemorySegmentFeedbackRepository.createAndSave`, then emits
    `memory.feedback.recorded.v1` via `EventLedgerService.emitBestEffort`
    (best-effort: never bubbles EventLedger outages back to the feedback
    write). Reason field is trimmed + capped at 2_000 chars with a trailing
    `'…'` if truncated.
  - `computeUsefulnessForSegment(segmentId, now?)` — single-segment
    rolling-window ratio via two `count` queries against the composite
    `(segment_id, created_at)` index. Returns `{ usefulness, sampleSize }`
    where `usefulness === null` when `sampleSize === 0` (backfill-safe).
  - `computeUsefulnessForSegments(segmentIds, now?)` — batch variant using
    one `GROUP BY segment_id` round trip via
    `MemorySegmentFeedbackRepository.findUsefulnessSince`. Returns
    `Map<segmentId, { usefulness, sampleSize }>` with `usefulness: null` for
    segments absent from the result.
- **DI:** `@Optional()` on `SystemSettingsService` and `EventLedgerService`
  so the service can be constructed in unit tests via
  `new MemorySegmentFeedbackService(...)`.
- **Setting resolution:** `coerceMemoryFeedbackWindowDays(raw,
MEMORY_FEEDBACK_WINDOW_DAYS_DEFAULT)` with try/catch fall-through to the
  hardcoded default — same defensive pattern as `MemoryMetricsService.resolveWindowDays`.

### 2. Service-layer type — `RecordFeedbackInput`

- **Path:** `apps/api/src/memory/memory-segment-feedback.service.types.ts`.
- Decoupled from the snake_case repository input so the service is the
  single boundary translating API camelCase ↔ persistence snake_case.
- Required: `segmentId`, `queryId`, `agentProfileId`, `workflowRunId`,
  `useful`. Optional: `reason`.
- File exists to honour the project's `no-restricted-syntax` lint rule
  that bans exported interfaces from non-`.types.ts` files.

### 3. Convergence helper — `learning-convergence.helper.ts`

- **Actual path:** `apps/api/src/memory/learning-convergence.helper.ts`
  (playbook listed `apps/api/src/memory/learning/learning-convergence.helper.ts`
  — see Open Questions).
- **Exports:** `computeConvergenceSnapshots(injectTimestampsByScope,
outcomeTimestampsByScope, windowDays): Record<string,
LearningConvergenceSnapshot>`. Pure / I/O-free; ring buffers are trimmed
  in place.
- **Snapshot shape:** `{ ratio, window_days, runs_after_lesson,
successes_after_lesson, computed_at }`.
- **Behaviour:** scopes with zero in-window signal are omitted; scopes with
  injections but zero outcomes return `ratio: 0` so operators can tell
  "injected but no run yet" from "no signal at all".
- Consumed by `MemoryMetricsService.computeConvergenceSnapshotsForWindow`
  (both the sync `snapshot()` path with hardcoded 7-day default and the
  async `getSnapshot()` path that honours the live
  `learning_convergence_window_days` SystemSetting). Publishes each scope's
  ratio into the prom-client `nexus_learning_loop_convergence_ratio`
  gauge via `MetricsService.setLearningLoopConvergenceRatio`.

### 4. Integration test — `memory-learning-feedback-loop.integration.spec.ts`

- **Path:** `apps/api/src/memory/memory-learning-feedback-loop.integration.spec.ts`
  (~270 lines).
- Wires `MemoryMetricsService`, `MetricsService`, and
  `WorkflowRunOutcomeAfterLessonListener` through `Test.createTestingModule`
  with the real Nest `EventEmitter2` bus (booted via `EventEmitterModule.forRoot()`)
  so the `@OnEvent` decorator wiring is exercised end-to-end — not stubbed.
- Drives 5 terminal events (4 × `WORKFLOW_RUN_COMPLETED_EVENT` + 1 ×
  `WORKFLOW_RUN_FAILED_EVENT`) and asserts the per-process snapshot:
  - `learning.lesson_injected_total === 5`
  - `learning.last_lesson_injected` carries the shared `(lesson_id, scope)`
  - `learning.run_outcome_after_lesson_total === 5`
  - `learning.last_run_outcome_after_lesson.outcome === 'failure'`
  - `learning.convergence[SCOPE].ratio === 4/5 = 0.8` (with `ratio`,
    `runs_after_lesson`, `successes_after_lesson`, `window_days`, and
    `computed_at` all asserted present and numeric).
- Confirms the consume-once contract (`consumeRunLessonInjects` returns
  `[]` on a second pass per run).

### 5. Persistence — entity, repository, migration

- **Entity:** `apps/api/src/memory/database/entities/memory-segment-feedback.entity.ts`
  — TypeORM `@Entity('memory_segment_feedback')` with 4 `@Index` decorators
  mirroring the migration.
- **Repository:** `apps/api/src/memory/database/repositories/memory-segment-feedback.repository.ts`
  — `createAndSave` (with empty-string `reason` → `null` trim),
  `countUsefulSince`, `countTotalSince`, `findUsefulnessSince` (GROUP BY
  batch aggregation), `findById`.
- **Migration:** `apps/api/src/database/migrations/20260626000000-create-memory-segment-feedback.ts`
  — `CREATE TABLE memory_segment_feedback` with 4 indexes
  (`(segment_id, created_at)`, `(agent_profile_id, created_at)`,
  `(workflow_run_id)`, `(query_id)`). Transaction set to `false as const`.

### 6. Settings — `memory_feedback_window_days`

- **Path:** `apps/api/src/settings/memory-feedback-window-days.constants.ts`.
- `MEMORY_FEEDBACK_WINDOW_DAYS_SETTING = 'memory_feedback_window_days'`.
- Default 30; range `[1, 365]`; integer-only; with the `coerceMemoryFeedbackWindowDays`
  helper that falls back to the default for non-numeric / out-of-range
  values.

### 7. Module wiring — `MemoryModule`

- `MemorySegmentFeedbackService` is registered in `MemoryModule.providers`
  (line 120) and exported through `MemoryModule.exports` (line 192).

### 8. Runtime integration — `queryMemory` internal tool

- `MemoryToolsHandler` (`apps/api/src/workflow/workflow-internal-tools/handlers/memory-tools.handler.ts`)
  injects `MemorySegmentFeedbackService` (line 61) and exposes it through:
  - `recordFeedbackIfPresent` (line 133) — invoked from `queryMemory` when
    the tool is called with `feedback: { segment_id, useful, reason? }`.
    Returns a `QueryMemoryFeedbackAck` with `{ id, segment_id, useful }`.
  - `projectSegmentsWithUsefulness` (line 162) — batch-call
    `computeUsefulnessForSegments(segmentIds)` and attach the
    `usefulness: number | null` per segment.
  - `attachUsefulnessToLearning` (line 187) — same attach for the
    promoted-lesson projection when `include_learning: true`.
- The unit-spec for this handler
  (`memory-tools.handler.spec.ts`) mocks `recordFeedback` (line ~1253)
  with a fabricated row, so the handler-level feedback contract is covered.

### 9. Downstream consumers

- `MemoryDecayReaperService` (`memory-decay.reaper.ts`) — injects
  `@Optional() MemorySegmentFeedbackService` (line ~154) and calls
  `computeUsefulnessForSegments(candidateIds)` in the
  `resolveUsefulnessForPredicate` shadow/`enforce` branch (lines 296-418).
  Fail-soft: if the service is unwired or throws, the reaper degrades to
  `legacy` mode for the pass.
- `MemoryEvictionReaperService` (`memory-eviction.reaper.ts`) — also
  `@Optional() feedback?: MemorySegmentFeedbackService` (line ~119) for
  the value-predicate retention decision.
- `MemoryMetricsService` (`memory-metrics.service.ts`) — owns the
  per-scope convergence ring buffers; `recordWorkflowRunOutcomeAfterLesson`
  appends to the ring and `computeConvergenceSnapshotsForWindow` (via the
  helper) emits the snapshot consumed by the integration test.

## Health Findings

### Test coverage (the only material gap)

- **No dedicated unit-test file for `memory-segment-feedback.service.ts`.**
  The header even contains a comment referring to a planned
  `// the unit-test spec for this file (added by milestone 4)`. The
  service is exercised only indirectly through:
  - `workflow-internal-tools/handlers/memory-tools.handler.spec.ts`
    (which mocks `recordFeedback`, so it covers the call sites but not
    the service's normalisation, audit emission, or window-coercion
    branches).
  - The integration spec `memory-learning-feedback-loop.integration.spec.ts`
    (which exercises the convergence-feedback half but not the
    record-feedback half — the `recordFeedback` path is not driven end-to-end
    through the real service).
- **No dedicated unit-test file for `learning-convergence.helper.ts`.**
  The pure `computeConvergenceSnapshots` is covered only via
  `memory-metrics.service.spec.ts` (convergence-ratio tests at lines
  798-1226, covering 0.8 ratio, empty-scope omit, inject-only zero-ratio,
  age-out trim, and live-setting resolution), `memory-metrics.controller.spec.ts`,
  and the integration spec. The helper itself has no isolated assertions on
  its in-place ring trim, the union of scopes across both maps, or the
  empty-after-trim delete-callback.
- **No repository unit-test file.** `MemorySegmentFeedbackRepository` is
  exercised only via the integration-level handlers and the service layer.
  The GROUP BY batch aggregation (`findUsefulnessSince`) is not directly
  asserted.

### Code quality observations

- All four paths honour the project's
  `controller-handles-transport / service-owns-domain /
repository-owns-persistence` quality gate.
- The repository deliberately does NOT declare a TypeORM `@ManyToOne`
  relation to `MemorySegment` — the entity doc explains the rationale
  (feedback for segments the API has cached but not re-fetched, plus DB
  foreign-key management deferred to a follow-up milestone).
- The service uses `@Optional()` on `SystemSettingsService` and
  `EventLedgerService` for unit-test compatibility — same pattern as
  `MemoryDecayReaperService` and `MemoryEvictionReaperService`.
- The integration test's reasoning block (lines 28-70) explicitly cites
  acceptance criterion (c) of work item `88d7654e` (the convergence loop)
  and the milestone-by-milestone test coverage shape — this is the
  closeout acceptance test for the convergence half of the work item,
  driven through the listener wiring.

### Module / wiring health

- Service is properly registered (`providers` AND `exports`) in
  `MemoryModule`.
- Migration is listed in the registered-migrations file (the migration
  file is at the expected `20260626` date prefix).
- No circular-import risk: the service depends only on its own
  repository, `MemorySegmentRepository`, `SystemSettingsService`, and
  `EventLedgerService` — all of which it already imports via clean
  relative paths.

## Open Questions

1. **Path discrepancy on `learning-convergence.helper.ts`:** the playbook
   lists `apps/api/src/memory/learning/learning-convergence.helper.ts`,
   but the actual location is `apps/api/src/memory/learning-convergence.helper.ts`
   (one level above the `learning/` subdirectory). The file is real,
   complete, and imported by `MemoryMetricsService`. The prior
   `learning-convergence-feedback` probe already flagged the same
   discrepancy. If the probe harness expects the `learning/` prefix
   literally, the file at `apps/api/src/memory/learning/` does not
   exist — the closest siblings are the promoted-lesson services, not
   the convergence helper. This is likely a stale path recorded against
   the work-item scope manifest and does not block verification.

2. **Missing dedicated unit-test for `MemorySegmentFeedbackService`:**
   the header comment promises a "milestone 4" unit spec that has not
   landed. The service's normalisation branches (`normaliseReason` trim
   - 2_000-char cap, audit-emit best-effort swallow, segment-source
     fallback to `null`, settings-service swallow with default fall-through)
     are uncovered by direct unit assertions. Recommend a future probe or
     follow-up to land a `memory-segment-feedback.service.spec.ts`.

3. **Status of work item `66ea23d1` in the kanban:** the work item is
   `backlog` in `docs/work-items/66ea23d1-…md`, but the implementation is
   in main and already integrated with downstream consumers. Recommend
   reconciling the kanban status with the code reality (either move to
   `done` or document why it remains `backlog` if a milestone is still
   outstanding — the `// added by milestone 4` comment hints at one).

4. **Repository foreign-key status:** the entity deliberately omits the
   TypeORM `@ManyToOne` relation and the migration does not declare a
   `FOREIGN KEY` constraint on `segment_id`. The doc cites a "follow-up
   milestone once the referential story is settled". If that follow-up
   has not landed, a deleted segment could leave dangling feedback rows
   that the service's best-effort `resolveSegmentSource` would surface
   as `source: null` on the audit event — acceptable, but worth noting
   for the data-architecture review.
