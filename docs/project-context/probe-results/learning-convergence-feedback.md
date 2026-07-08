---
project_scope_id: 458935f0-213e-4bbe-89d1-8883e0efa9ad
probe_scope_id: learning-convergence-feedback
outcome: success
inferred_status: implemented
confidence_score: 0.86
evidence_refs:
  - apps/api/src/memory/learning-convergence.helper.ts
  - apps/api/src/memory/learning-measurement.state.ts
  - apps/api/src/memory/memory-decay.classify.ts
  - apps/api/src/memory/memory-decay.classify.types.ts
  - apps/api/src/memory/memory-decay.value-predicate.ts
  - apps/api/src/memory/memory-decay.value-predicate.types.ts
  - apps/api/src/memory/memory-metrics.service.ts
  - apps/api/src/settings/learning-convergence-settings.constants.ts
  - apps/api/src/settings/learning-convergence-settings.constants.spec.ts
  - apps/api/src/memory/memory-decay.value-predicate.spec.ts
  - docs/work-items/88d7654e-ca93-4ffa-8ba5-7065db9506db.md
source_paths:
  - apps/api/src/memory/learning-convergence.helper.ts
  - apps/api/src/memory/learning-measurement.state.ts
  - apps/api/src/memory/memory-decay.classify.ts
  - apps/api/src/memory/memory-decay.classify.types.ts
  - apps/api/src/memory/memory-decay.value-predicate.ts
  - apps/api/src/memory/memory-decay.value-predicate.types.ts
updated_at: 2026-07-02T16:30:00.000Z
---

# Probe Result: Learning Convergence Feedback (88d7654e promoted-lesson usage telemetry)

## Narrative Summary

All six assigned paths exist and the core "promoted-lesson usage / convergence"
capability is implemented end-to-end. The work-item `88d7654e` accepts status
`backlog` on the kanban board, but the _code_ for the self-improvement
feedback loop it describes is in place: a pure per-scope convergence ratio
helper (`learning-convergence.helper.ts`), an in-memory causal-measurement
state holder for behaviour change / A/B holdout lift / cost / suppressed
noise / probation (`learning-measurement.state.ts`), pure confidence-floor
classification helpers (`memory-decay.classify.ts` + `.types`), and a
usefulness-aware value predicate with its shadow divergence comparison
(`memory-decay.value-predicate.ts` + `.types`). These are stitched into
`MemoryMetricsService` and driven by the
`learning_convergence_window_days` setting at
`apps/api/src/settings/learning-convergence-settings.constants.ts`.

One small discrepancy in the playbook `Paths to investigate` list:
`learning-convergence.helper.ts` lives at `apps/api/src/memory/` (one level
above the `learning/` directory listed in the prompt), not inside
`apps/api/src/memory/learning/`. The other five paths match exactly.

Test coverage is uneven: the value-predicate helpers have a dedicated
spec (`memory-decay.value-predicate.spec.ts`) that exhaustively pins the
keep-decision matrix and shadow-comparison rollup. The convergence helper
and the `LearningMeasurementState` class have no dedicated unit-test
files; they are exercised only indirectly via
`memory-metrics.service.spec.ts`, `memory-metrics.controller.spec.ts`,
and `memory-learning-feedback-loop.integration.spec.ts`.
`memory-decay.classify.ts` also lacks a dedicated spec file; its
helpers are covered indirectly via `memory-decay.reaper.spec.ts`,
`memory-decay.reaper.enforce.spec.ts`,
`memory-decay.reaper.shadow.spec.ts`, and the `*.integration.spec.ts`
sibling.

Overall, the feature is implemented (logic, types, settings, integration
into the metrics service) but the per-helper unit-test coverage is
partial — pure functions like `computeConvergenceSnapshots`,
`classifyDecay`, and the `LearningMeasurementState` arm/lift/probation
track are reachable only through the reaper and metrics-service specs.

## Capability Updates

### 1. Convergence ratio computation (88d7654e milestone 3)

- **Path:** `apps/api/src/memory/learning-convergence.helper.ts` (165 lines).
- **Exports:** `computeConvergenceSnapshots(injectTimestampsByScope, outcomeTimestampsByScope, windowDays): Record<string, LearningConvergenceSnapshot>`.
- **Role:** Pure, I/O-free function. Iterates the union of scopes across
  both ring buffers, trims each in place to the rolling window
  (`now - windowDays * MS_PER_DAY`, _inclusive_ cutoff), and emits
  `LearningConvergenceSnapshot` blocks carrying
  `{ ratio, window_days, runs_after_lesson, successes_after_lesson, computed_at }`.
  Scopes with zero in-window signal after trimming are omitted; scopes
  with injections but zero outcomes return `ratio: 0` so operators can
  tell "injected but no run" from "no signal at all".
- **Header comment** explicitly cites work item
  `88d7654e-ca93-4ffa-8ba5-7065db9506db` and "milestone 3" — this is
  the file the work item converges on.

### 2. Causal-measurement state holder (EPIC-212 Phase 3 Tasks 6 & 7)

- **Path:** `apps/api/src/memory/learning-measurement.state.ts` (191 lines).
- **Exports:** Class `LearningMeasurementState` (no DI — instantiated
  inline by `MemoryMetricsService`).
- **Holds:** behaviour-change totals + last-event;
  per-scope per-arm outcome rings (`injected`/`holdout`) with a
  `MAX_ARM_RING_PER_SCOPE = 100_000` cap mirroring the convergence
  cap; `costPerPromotedMemory` and `suppressedNoiseCount` scalar
  counters; probation evaluator pass totals
  (confirmed/reverted/held) and last-pass record.
- **Maths:** Lift ratio + per-arm ratio delegated to the pure
  `learning-lift.helper.ts` (`computeLift`, `armRatio`). The class
  itself trims arm rings in place and computes the per-scope
  `LearningLiftSnapshot` blocks on the rolling window.
- **Builder methods:** `buildProbationMetrics()`, `buildBehaviourChangeMetrics()`.

### 3. Legacy confidence-floor classification (EPIC-212 Phase 3 Task 3/4)

- **Path:** `apps/api/src/memory/memory-decay.classify.ts` (165 lines)
  - `memory-decay.classify.types.ts` (20 lines).
- **Exports (the file):** `MS_PER_DAY`, `classifyDecay(candidate, settings, now): DecayClassification`, `effectiveTouch(segment)`, `readConfidence(segment)`, `applyDecay(confidence, dailyRate, daysElapsed)`.
- **Exports (the types):** `type DecayClassification = { outcome: 'skipped' } | { outcome: 'decayed' | 'archived'; decayedConfidence: number }` (discriminated union).
- **Role:** Pure (I/O-free) extraction of the pre-Task-3
  `evaluateCandidate` body so the `enforce` short-circuit can be
  reasoned about without touching the DB. Step-by-step exempt source
  → null touch → in-grace → no-confidence → floor comparison, with
  Task-4 drift-acceleration: when `settings.driftInvalidationEnabled`
  is on and the row has `drift_detected_at`, the in-grace skip is
  bypassed and `daysElapsed = daysSinceTouch * driftPenaltyMultiplier`.

### 4. Usefulness-aware value predicate (EPIC-212 Phase 3 Tasks 2/3)

- **Path:** `apps/api/src/memory/memory-decay.value-predicate.ts`
  (214 lines) + `memory-decay.value-predicate.types.ts` (131 lines).
- **Exports (the file):** `DECAY_KEEP_REASONS` (const map),
  `decideMemoryRetentionKeep(input, thresholds): DecayKeepVerdict`,
  `evaluateRetentionFromMap(candidate, usefulnessById, thresholds)`,
  `buildShadowCandidate(candidate, legacyArchive, verdict)`,
  `computeDecayShadowComparison(mode, candidates)`.
- **Exports (the types):** `DecayValuePredicateMode = 'legacy' | 'shadow' | 'enforce'`; `DecayKeepInput`, `DecayKeepThresholds`, `DecayKeepVerdict`, `SegmentUsefulness`, `DecayShadowCandidate`, `DecayShadowComparison`.
- **Role:** Pure add-only predicate that NEVER removes protection —
  only ADDS keep reasons on top of the legacy confidence-floor
  behaviour. Keep when `pinned`, `injectedAndHelped`, or
  `usefulness >= threshold && sampleSize >= minSamples`; otherwise
  fall through. `evaluateRetentionFromMap` is the SINGLE seam both
  reapers (decay and eviction) call; `buildShadowCandidate` +
  `computeDecayShadowComparison` produce the `memory.decay.shadow.v1`
  divergence payload.

### 5. Wiring + settings

- **Wiring:** `apps/api/src/memory/memory-metrics.service.ts` imports
  both `LearningMeasurementState` (instantiated as
  `private readonly measurement = new LearningMeasurementState();`)
  and `computeConvergenceSnapshots` (called from
  `computeConvergenceSnapshotsForWindow`). The `memory-manager.service.ts`
  pipeline consumes the resulting metrics blocks in the
  `/api/memory/metrics` JSON snapshot.
- **Settings:** `apps/api/src/settings/learning-convergence-settings.constants.ts`
  defines `LEARNING_CONVERGENCE_WINDOW_DAYS_SETTING =
'learning_convergence_window_days'`, default `7`, bounds `[1, 90]`,
  with non-throwing `coerceLearningConvergenceWindowDays(value, fallback)`
  consistent with the existing coerce-helper style in
  `learning-settings.constants.ts`, `distillation-threshold.constants.ts`,
  and `memory-metrics-settings.constants.ts`. A dedicated settings-spec
  exists at `apps/api/src/settings/learning-convergence-settings.constants.spec.ts`.

### 6. Work-item status is `backlog` despite code being present

- `docs/work-items/88d7654e-ca93-4ffa-8ba5-7065db9506db.md` declares
  `status: backlog` with priority p1, scope `standard`. The CODEBASE_HEALTH
  notes (36th-39th-pass rollups) record the item as still listed as a
  TODO/Backlog kanban entry; the orchestrator has repeatedly auto-cleared
  the in-progress marker (88d7654e orphan-recovery pattern at
  2026-06-19T08:42:28.622Z, 2026-06-19T08:14:49.867Z, 2026-06-18T21:48:38.629Z,
  2026-06-18T11:52:50.386Z, 2026-06-18T08:16:20.351Z).
- Inferred_status: **implemented** — the source code described by the
  work item exists end-to-end, including the explicit Acceptance
  Criterion (b) required snapshot fields
  (`runs_after_lesson`, `successes_after_lesson`, ratio, window_days,
  computed_at) and the operator-tunable
  `learning_convergence_window_days` setting. The gap is between
  board-state hygiene and code-state.

## Health Findings

### Test coverage — uneven

- ✅ **Direct unit tests** for the value predicate:
  `apps/api/src/memory/memory-decay.value-predicate.spec.ts` exercises
  `decideMemoryRetentionKeep` across the pinned / injected-and-helped
  / useful / no-votes / insufficient-samples / low-usefulness / boundary
  (usefulness === threshold, sampleSize === minSamples) matrix, plus the
  `computeDecayShadowComparison` empty / add-only-invariant / useful-but-stale
  cases. Good coverage of the pure decision and rollup logic.
- ⚠️ **No dedicated spec** for `memory-decay.classify.ts`. The four
  reaper specs cover `classifyDecay` end-to-end through the service
  boundary:
  `memory-decay.reaper.spec.ts` (12 references to `classifyDecay` /
  `readConfidence` / `applyDecay` / `effectiveTouch`),
  `memory-decay.reaper.enforce.spec.ts` (1),
  `memory-decay.reaper.shadow.spec.ts` (1),
  `memory-decay.reaper.integration.spec.ts` (4). The drift spec
  (`memory-decay.reaper.drift.spec.ts`) does NOT reference the helper —
  it only covers the drift service. A direct `classifyDecay` spec
  would isolate the drift-accelerated branch (Task 4) and the
  byte-identical pre-Task-4 behaviour from reaper plumbing.
- ⚠️ **No dedicated spec** for `learning-convergence.helper.ts`. The
  helper is exercised through `memory-metrics.service.spec.ts`,
  `memory-metrics.controller.spec.ts`, and
  `memory-learning-feedback-loop.integration.spec.ts`. Direct unit
  tests for the rolling-window trim, the
  "injected-but-no-outcomes → ratio:0", and the "empty after trimming
  → omit" semantics would be easy wins.
- ⚠️ **No dedicated spec** for `learning-measurement.state.ts`. The
  class (`LearningMeasurementState`) is instantiable without DI but
  has no isolated test for `recordBehaviourChange`,
  `setCostPerPromotedMemory`, `setSuppressedNoiseCount`,
  `recordProbationOutcome`, `appendArmOutcome` ring-cap behaviour
  (`MAX_ARM_RING_PER_SCOPE`), or the per-arm trim in
  `computeLiftSnapshots`. Direct tests would catch regressions in
  the lift-vs-cost-vs-probation wiring before they leak into the
  reaper / metrics tests.

### Code quality — strong

- Every file in scope is pure / I/O-free (`*.classify.ts`,
  `*.value-predicate.ts`, `learning-convergence.helper.ts`) or a
  cohesive state holder (`learning-measurement.state.ts`) — the
  extraction rationale (lift / classification / value-predicate logic
  out of the reaper and the metrics service) is documented in the
  file-level headers and tracked to EPIC-212 Phase 3 Task numbers.
- All exported types / interfaces live in the paired `*.types.ts`
  files, satisfying the project-wide `no-restricted-syntax` rule that
  bans exported types outside `*.types.ts`.
- The `DecayClassification` and `DecayKeepVerdict` shapes are
  discriminated unions, so the I/O layer narrows `decayedConfidence`
  without non-null assertions.
- Settings coerce helpers are non-throwing and follow the
  `coerceMemory*` style. Settings constants are `as const` literals
  so callers reference the exact key without typos.
- `applyDecay` rounds to 2dp via `Math.floor(raw * 100) / 100` to
  avoid float drift — the work-item sanity check is reproduced
  inline in the doc comment.
- `LearningMeasurementState.appendArmOutcome` enforces the same
  `MAX_ARM_RING_PER_SCOPE = 100_000` cap as the convergence rings,
  keeping the two ring buffers symmetric.

### Churn / placement

- The `learning-convergence.helper.ts` file lives at
  `apps/api/src/memory/`, NOT `apps/api/src/memory/learning/`. Five
  of the six paths in the playbook point exactly; this one is one
  level above the listed directory. The file's own header comment
  ties it unambiguously to work item `88d7654e-…/milestone 3`, so
  there is no ambiguity about intent — but anyone navigating by the
  playbook path will get a `No such file` error and needs to know
  about the actual location.
- The learning subdirectory under `apps/api/src/memory/learning/`
  remains the home of the `learning-promotion` / `learning-router` /
  `learning.service` / `learning.controller` cluster. Putting the
  convergence helper one level up keeps it tied to
  `MemoryMetricsService` (its only consumer) and avoids dragging
  `MemoryMetricsService` into `learning/`.

## Open Questions

1. **Work-item acceptance criteria (a)/(c)/(d)/(e) status.** The
   codebase confirms the gauge is wired into the `MemoryMetricsService`
   snapshot and the `learning_convergence_window_days` setting is
   plumbed. The probe could not directly verify (a) per-call-site
   instrumentation of `StepSupportService.buildPromotedLearningContext`,
   (c) the end-to-end Nest testing module boot + workflow run fixture,
   (d) the `MemoryHealthCard` WebUI rendering, and (e) per-tenant
   label cardinality beyond what's visible in
   `memory-metrics.service.ts`. Worth a follow-up probe against
   `workflow-step-execution/step-support.service.ts`, the WebUI's
   `MemoryHealthCard`, and the `memory-learning-feedback-loop.integration.spec.ts`
   fixture to confirm the full work-item surface is exercised.
2. **No direct unit tests for `computeConvergenceSnapshots`.** The
   helper is reachable only through the metrics-service spec, which
   mixes convergence math with metrics plumbing. A targeted pure-function
   spec would isolate trim-window and omit-empty semantics regressions.
3. **No direct unit tests for `LearningMeasurementState`.** The
   `MAX_ARM_RING_PER_SCOPE` cap, the probation record, and the
   `setCostPerPromotedMemory` numeric coercion branches each have
   one-line contract changes that are currently shielded only by
   integration tests. A small spec would protect against regressions
   in the lift/cost/probation counters.
4. **No direct unit tests for `classifyDecay`.** The drift-accelerated
   branch (Task 4) and the byte-identical pre-Task-4 classification
   both live in this function; the reaper-spec-only coverage is good
   but heavyweight.
5. **88d7654e board status**: the work item is `backlog` per the
   manifest but the code under that item is implemented. The
   orchestrator has repeatedly auto-cleared the in-progress marker
   because no linked workflow run exists. Whether the team intends
   to retire the kanban entry (status flip to `done` or delete)
   or to schedule a final integration run to flip it to `in_progress`
   → `in_review` is a question for the CEO / orchestrator cycle,
   not the codebase.
