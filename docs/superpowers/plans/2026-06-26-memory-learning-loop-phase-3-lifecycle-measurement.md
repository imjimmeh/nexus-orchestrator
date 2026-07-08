# Phase 3 — Lifecycle, contradiction, feedback-tuning, causal measurement: the loop self-corrects, self-measures, and self-tunes

**Epic:** [EPIC-212](../../epics/EPIC-212-memory-learning-loop-rebuild.md) · proposed EPIC-212-M3
**Created:** 2026-06-26
**Status:** Ready to execute (after Phase 2 landed; branch `epic-212-memory-learning-loop`)
**Scope:** Wire and populate the lifecycle + measurement layer on top of the Phase-0/1/2 primitives. This phase WIRES existing reapers/observers/feedback into a closed self-correcting loop and adds three greenfield services (contradiction, probation evaluator, weight tuner). It is reuse-heavy: almost nothing here is built from scratch except `MemoryContradictionService`, `FeedbackWeightTunerService`, and two additive migrations.

## Goal

Stale memories self-invalidate (drift-anchored); contradicted memories supersede rather than duplicate; bad auto-promotions self-revert past probation; decay becomes usefulness-weighted (never archiving useful-but-unread lessons); and the loop's value is measurable on a Learning Health dashboard (convergence, behaviour-change, holdout lift, cost-per-promoted-memory, suppressed-noise). Every behaviour change is flag-gated and shadow-moded so the default-OFF state leaves the deterministic Phase-0/1/2 loop byte-for-byte intact.

## Non-Goals (Phase 3)

- No new analyst/router/governance logic — those landed in Phase 2; Phase 3 only **consumes** `governance_state='provisional'` + `metadata_json.probation_until`.
- No new embedding machinery, no new vector store — reuse `EmbeddingSimilarityService` / `MemoryRetrievalService` / `CANDIDATE_SIMILARITY` as-is.
- No skill-durability hardening (`SkillValidationService` at runtime, reseed preservation) — that is Phase 4.
- No replacement of the convergence machinery — it already exists and is wired (see Pre-flight #1); Phase 3 only **verifies** it and adds sibling metrics.
- No Kanban-domain logic in `apps/api`/`packages/core`; `signals_json`, `signal_weight_history`, and contradiction metadata carry no Kanban identifiers.

## Phase 0/1/2 landed — what Phase 3 builds on (verified in this checkout, do not re-create)

**Lifecycle reapers (all registered in `apps/api/src/memory/memory.module.ts` and BullMQ-scheduled):**

- `MemoryDecayReaperService` (`memory-decay.reaper.ts`) — runs on `memory_decay_cron`; selects via `MemorySegmentRepository.findDecayCandidates({ exemptSources, graceCutoff })`; the exempt set is the **hardcoded `MEMORY_DECAY_EXEMPT_SOURCES` Set** (`memory-decay.constants.ts`). Decays `metadata_json.confidence` per-day; archives (`archived_at = now`) when decayed below `memory_decay_floor`. **This is the exempt-by-source predicate Phase 3 replaces.**
- `MemoryEvictionReaperService` (`memory-eviction.reaper.ts`) — scheduled (`memory-eviction.scheduler.ts` + `.processor.ts`); selects via `findEvictionCandidates({ protectedSources, minAccessCount, idleCutoff })`; deletes idle low-access rows. (The "TODO: wire scheduler" comment in the reaper is **stale** — the scheduler exists.)
- `MemoryDriftDetectionService` (`memory-drift-detection.service.ts`) — scheduled (`memory-drift.scheduler.ts` + `.processor.ts`); full `file`/`schema`/`api` checkers (`memory-drift-checkers.ts`), parses references from `metadata_json` via `MemoryDriftReferenceParser`, stamps `drift_detected_at = now` + applies `memory_drift_confidence_penalty`. **Already self-invalidates via the confidence penalty; what's missing is (a) attaching drift references onto promoted code-anchored facts, and (b) the decay reaper treating a drifted row as decay-eligible.**

**Usefulness feedback (collected, UNCONSUMED — the wire-up target):**

- `MemorySegmentFeedbackService` (`memory-segment-feedback.service.ts`) — `computeUsefulnessForSegment(id, now?)` and the batch `computeUsefulnessForSegments(ids, now?)` returning `Map<id, { usefulness: number | null; sampleSize }>` over a `memory_feedback_window_days` rolling window. `usefulness === null` means "no votes yet" (distinct from 0). **Nothing reads this today.**

**Measurement scaffold (~70% built; convergence numerator is WIRED):**

- `MemoryMetricsService` (`memory-metrics.service.ts`) — in-memory snapshot with per-scope convergence ring buffers; `recordLearningLessonInjected(payload, { workflowRunId })`, `consumeRunLessonInjects(runId)`, `recordWorkflowRunOutcomeAfterLesson(...)`, `computeConvergenceSnapshotsForWindow(windowDays)`. `snapshot()` (sync) + `getSnapshot()` (async, honours live `learning_convergence_window_days`).
- **The terminal-outcome observer EXISTS and is wired:** `WorkflowRunOutcomeAfterLessonListener` (`apps/api/src/workflow/workflow-repair/workflow-run-outcome-after-lesson.listener.ts`, registered in `workflow-repair.module.ts`) subscribes to `WORKFLOW_RUN_COMPLETED_EVENT`/`WORKFLOW_RUN_FAILED_EVENT`, drains the per-run inject set, and emits one outcome-after-lesson event per injected lesson. The inject side is populated by `StepSupportService.buildPromotedLearningContext`. **Convergence is therefore already closed — Phase 3 Task 1 is verification + behaviour-change extension, not new wiring.**
- `MemoryMetricsRefreshService` (`memory-metrics-refresh.service.ts`) — self-rescheduling tick, kill-switched on `memory_metrics_gauge_use_refresh`, currently only overwrites the `active_segments` gauge from a live DB count. **This is the host for the probation evaluator + the new measurement passes.**
- `MemoryMetricsController` (`GET /memory/metrics`, permission `memory:read`) → `getSnapshot()`. Web hook `apps/web/src/hooks/useMemoryMetrics.ts` already polls it (30s). **The Learning Health panel reuses this hook + endpoint.**
- prom-client instruments on `MetricsService` (`observability/metrics.service.ts`): `learningPromotedTotal`, `learningLessonInjectedTotal`, `learningRunOutcomeAfterLessonTotal`, `learningLoopConvergenceRatio` (gauge), `memoryDecayEvaluated/ArchivedTotal`, `nexusMemoryDriftDetectedTotal`. **New gauges/counters (behaviour-change, lift, cost) are added here in the same style.**

**Governance state (Phase-2 Tasks 9/10 — the probation evaluator's input):**

- `memory_segments.governance_state varchar(24)` (`provisional`|`confirmed`|null-legacy) on `memory-segment.entity.ts`; auto-promotions stamp `governance_state='provisional'` + `metadata_json.probation_until` (ISO) + `metadata_json.routing_target`. `LearningPromotionService.dispatchByRoute` emits `memory.learning.routed.v1`.

**Contradiction hook seam (Phase-2 Task 6 carry-forward):**

- `RetrospectiveAnalysisService` (`workflow-retrospective/retrospective-analysis.service.ts`) already dedups findings against KNOWN memory via `MemoryRetrievalService.retrieve(...)` + `EmbeddingSimilarityService.findNearest(text, k, scope)` with `ownerType:'memory_segment'` at threshold `candidate_similarity_threshold` (0.85). **This near-neighbour seam is exactly where `MemoryContradictionService` inserts: a near-vector hit with an OPPOSING stance is a contradiction, not a dedup.** The same seam is reachable from `LearningPromotionService.dispatchByRoute` at the moment a segment is created.

**Conventions:**

- Migrations: `class Xxx<ts> implements MigrationInterface`, idempotent `IF NOT EXISTS`, **prepended** to `apps/api/src/database/migrations/registered-migrations.ts`. Latest is `20260706000000-add-memory-segment-governance-state` → **Phase 3 starts `20260707000000`**. Migration "is registered" specs assert membership via `toContain`, NOT `names[0]` position (Phase-2 Task 11 already de-fragilised these — keep that pattern).
- `tsc` build (`apps/api/tsconfig.build.json`) **excludes specs**, so adding a required entity column compiles clean but breaks existing spec object-literals that build `MemorySegment`/`LearningCandidate` fixtures. **Every task that adds an entity column MUST also fix the spec literals** (Phase-2 Tasks 8/9 were bitten by this — make the new column nullable and grep for fixture literals; insert fixes CRLF-safely to avoid prettier rewriting whole files).
- Settings: single source `SYSTEM_SETTING_DEFAULTS` (`settings/system-settings.defaults.ts`); per-feature `*-settings.constants.ts` fragments with a `coerceX` non-throwing helper, spread in.
- Pure decision logic separated from I/O (mirror `PromotionGovernancePolicyService` — async settings read wrapping a pure `decideX(input, thresholds, nowMs)`), interfaces in `*.types.ts`, `max-lines:500`, `complexity ≤14`, no `eslint-disable`/`@ts-ignore`, Kanban-neutral.

---

## Pre-flight verification (do before writing code)

1. **Confirm the convergence loop is closed (terminal-outcome observer).** Verified present: `WorkflowRunOutcomeAfterLessonListener` is registered in `workflow-repair.module.ts` and consumes `MemoryMetricsService.consumeRunLessonInjects`. Run `npm run test:api -- workflow-run-outcome-after-lesson` and `memory-learning-feedback-loop.integration` to confirm green. **Record:** the convergence numerator IS wired; Task 1 only adds the behaviour-change discriminator and a guard test — it does not re-build the observer. If the integration spec is red, fix it FIRST (it is the measurement foundation).
2. **Confirm `supersedes`/`superseded_by` are absent.** Verified: `memory-segment.entity.ts` has no such columns. Task 5 adds migration `20260707000000` + entity columns.
3. **Confirm `signal_weight_history` is absent.** Verified: no table/entity. Task 9 adds migration `20260708000000` + entity.
4. **Confirm how the decay reaper learns a row is "useful".** `MemorySegmentFeedbackService.computeUsefulnessForSegments(ids)` is the only usefulness source and is **batch by segment id**. Confirm the decay/eviction candidate set size is bounded enough to compute usefulness in one batch call per pass (the reaper already loads the full candidate entity list; pass `candidates.map(c => c.id)`). Record the call shape the shadow predicate will use.
5. **Confirm the drift→decay handshake.** Verify `findDecayCandidates` currently has NO `drift_detected_at` clause (verified — it only filters `archived_at IS NULL` + exempt sources + grace). Confirm the cleanest seam to make a drifted row decay-eligible is a new repository param (`includeDrifted` / `driftedExemptOverride`) rather than a second query, and that `drift_detected_at` is indexed (`idx_memory_segments_drift_detected_at` exists from `20260626000000`).
6. **Confirm the behaviour-change signal source.** A promoted lesson anchors a tool/path in `metadata_json` (the `evidence` / drift-reference fields). The behaviour-change counter asks "after injection, did the run actually USE that anchored tool/path?" Confirm `event_ledger` tool-execution rows (the same `EventLedgerRepository.query` the struggle detector + digest use, `domain:'tool'`, capped 1000) expose the tool name + command/path needed to match against a lesson's anchor. Record the match contract (exact tool name + substring path match) before coding Task 6.
7. **Confirm the holdout assignment seam.** The A/B holdout splits a scope (or a run) into "lessons injected" vs "lessons suppressed" arms. Confirm whether `StepSupportService.buildPromotedLearningContext` (the inject site) is the right place to deterministically bucket by a hash of `scopeId` (so a scope is stably in the holdout arm) and to record the arm onto the inject record. Record whether a new `metadata_json.holdout_arm` on the inject event is needed.

---

## Task 1 — Verify terminal-outcome observer + convergence; add behaviour-change anchor capture · S

Cheapest and foundational: confirm the measurement floor is solid, then capture the data the later metrics need.

- **Verify (no new code):** run the convergence specs (Pre-flight #1). Document in `docs/guide/35-memory-learning.md` that the convergence loop is closed by `WorkflowRunOutcomeAfterLessonListener`.
- **Capture the behaviour-change anchor at inject time.** EDIT `MemoryMetricsService.recordLearningLessonInjected` payload (`memory-metrics.types.ts` `LearningLessonInjectedPayload`) to carry an optional `anchored_tool?: string` + `anchored_path?: string` derived from the injected segment's `metadata_json` at the call site (`StepSupportService.buildPromotedLearningContext` / `promotedLearningHelpers`). Store it alongside the per-run inject set so the terminal observer can later attribute behaviour-change. Keep it **additive + optional** — a lesson with no anchor records as before.
- Add a pure helper `extractLessonAnchor(metadataJson): { tool?: string; path?: string }` in `memory/signals/` (or `memory-metrics.types.ts` sibling) with its own unit tests.

**TDD:**

- _Red:_ a spec asserting `recordLearningLessonInjected` stores the anchor on the per-run set; `consumeRunLessonInjects` returns it; a lesson with no anchor yields `{}`; the existing convergence behaviour is unchanged (regression guard on `memory-metrics.service.spec.ts`).
- _Green:_ thread the optional anchor through the payload + per-run record; implement `extractLessonAnchor`.
- _Refactor:_ keep `recordLearningLessonInjected` under complexity cap by delegating anchor extraction to the helper.

**Acceptance:** convergence specs green; injected lessons now carry their anchored tool/path through to the terminal observer; no behaviour change when anchors are absent. **Effort: S.**

## Task 2 — Usefulness-aware decay/eviction predicate in SHADOW MODE · M

Replace exempt-by-source with a value/usefulness predicate, but **observe only** — never archive differently than today until the shadow comparison passes.

- **Repository:** EDIT `MemorySegmentRepository.findDecayCandidates` to accept an optional `usefulnessThreshold`/`mode` param is NOT needed; instead keep candidate selection as-is and compute the usefulness verdict in the reaper (the reaper already has the full candidate entities). The predicate change lives in the **reaper**, not the SQL.
- **Decay reaper:** EDIT `MemoryDecayReaperService.runDecayPass`. Add a settings-resolved `decay_value_predicate_mode` (`legacy` | `shadow` | `enforce`, default `legacy`). When `shadow`/`enforce`, batch-call `MemorySegmentFeedbackService.computeUsefulnessForSegments(candidateIds, now)` and compute, per candidate, a pure `decideDecayKeep({ pinned, usefulness, sampleSize, injectedAndHelped, source }, thresholds)` → `{ keep, reason }`. The new predicate: **keep if `pinned` OR `usefulness >= memory_decay_usefulness_threshold` (with `sampleSize >= min`) OR `injected_and_helped`** (the segment appears as a behaviour-change/convergence success). Otherwise fall through to today's confidence-decay math.
  - **`shadow` mode:** compute the would-archive set under the NEW predicate, log + emit a `memory.decay.shadow.v1` event comparing it against the OLD exempt-by-source set and against usefulness votes (the documented "compare would-archive against usefulness votes" gate), but **apply the OLD behaviour** to the DB. Zero behaviour change.
  - Extract the value predicate into a pure `memory-decay.value-predicate.ts` (mirror `applyDecay`) with exhaustive unit tests.
- **Never archive useful-but-unread (the documented risk):** the predicate keeps a row with `usefulness >= θ` even if `last_accessed_at` is stale, and keeps a row with `usefulness === null` AND `sampleSize === 0` (no votes yet) — a never-voted lesson is never archived by the value predicate (it falls back to confidence-decay only, exactly as today).
- Inject `MemorySegmentFeedbackService` into the decay reaper as `@Optional()` (fail-soft: feedback service down → behave as `legacy`).

**TDD:**

- _Red:_ in `shadow` mode the DB mutations are byte-identical to `legacy` (assert no extra archive); the shadow event lists a useful-but-stale row as "would-NOT-archive under new predicate, WOULD-archive under old"; a never-voted row is in neither archive set; a low-usefulness stale row is "would-archive under new". `legacy` mode is unchanged (regression on `memory-decay.reaper.spec.ts`). Pure `decideDecayKeep` matrix unit-tested.
- _Green:_ implement the predicate + shadow emit; batch usefulness call.
- _Refactor:_ pure predicate in its own file; thresholds in `memory-decay-value.settings.constants.ts`.

**Acceptance:** with `decay_value_predicate_mode=shadow` the reaper changes nothing in the DB but logs the divergence set; useful-but-unread lessons appear on the "would-keep" side. **Effort: M.**

## Task 3 — Enable usefulness-weighted decay + eviction (flip predicate behind enforce flag) · S

After the shadow window, let the predicate actually drive archival — still gated.

- **Decay:** when `decay_value_predicate_mode=enforce`, the value predicate's `keep` short-circuits archival (a useful row is preserved even if confidence decayed below floor; a low-value stale row is archived once confidence floor is hit). Default stays `legacy`/`shadow`.
- **Eviction parity:** EDIT `MemoryEvictionReaperService` to consult the same pure predicate before deleting — a high-usefulness row is never evicted even if idle + low-access (add `@Optional() MemorySegmentFeedbackService`, same `enforce` gate via `eviction_value_predicate_enabled` default false). Reuse `decideDecayKeep` (rename to `decideMemoryRetentionKeep` in the shared file).
- Keep `MEMORY_DECAY_EXEMPT_SOURCES` as a hard floor in ALL modes (promoted lessons / postmortems / strategic-intent never decay regardless of predicate) — the value predicate only ever ADDS protection, never removes the source allowlist.

**TDD:**

- _Red:_ `enforce` mode archives a low-usefulness stale row that `legacy` would have kept-in-grace, and KEEPS a high-usefulness stale row that `legacy` would have decayed-to-archive; exempt sources still never decay in any mode; eviction with the flag on skips a high-usefulness idle row.
- _Green:_ wire the predicate into both reapers' keep/skip branches behind their flags.
- _Refactor:_ ensure both reapers call the one shared pure predicate.

**Acceptance:** flipping `decay_value_predicate_mode=enforce` makes decay usefulness-weighted; eviction honours usefulness; default-off leaves both reapers identical to Phase-2. **Effort: S.**

## Task 4 — Drift-anchored self-invalidation (attach refs on promotion + decay consumes drift) · M

Close the loop between the drift detector and the lifecycle reapers so a memory whose anchored fact drifted self-invalidates.

- **Attach drift references on promotion.** EDIT the segment-creation path in `LearningPromotionService` (`dispatchByRoute` / `buildMetadata`) so a code-anchored fact (a lesson whose evidence cites a file path / schema column / API endpoint) writes a `metadata_json.drift_reference` in the shape `MemoryDriftReferenceParser` already parses (`memory-drift-reference.parser.ts`). Derive the reference from the candidate's evidence/anchor (reuse the `extractLessonAnchor` helper from Task 1). Non-code-anchored lessons write nothing (drift detector skips them as `no_driftable_reference`, exactly as today). This makes the EXISTING drift detector start catching promoted lessons it currently ignores.
- **Make drifted rows decay-eligible.** EDIT `findDecayCandidates` to add an optional `treatDriftedAsEligible` param: when set (gated by `memory_decay_drift_invalidation_enabled`, default false), a row with `drift_detected_at IS NOT NULL` bypasses the grace-window check (a drifted fact should decay faster). The decay reaper passes the flag and, for drifted rows, applies an accelerated `memory_decay_drift_penalty_multiplier` to `daysElapsed`. Fail-soft + additive.
- No new drift checker logic — reuse `MemoryDriftCheckers` wholesale.

**TDD:**

- _Red:_ a promoted code-anchored fact gets a `metadata_json.drift_reference` the parser can classify; a non-code lesson gets none; with the flag on, a `drift_detected_at`-stamped row is selected as a decay candidate even inside its grace window and decays faster; with the flag off, drifted rows behave exactly as today (regression).
- _Green:_ thread `drift_reference` through promotion metadata; add the repository param + reaper multiplier.
- _Refactor:_ share the anchor→reference mapping between Task 1 and here.

**Acceptance:** a promoted memory referencing a now-deleted file is flagged by the existing drift pass and (flag-on) decays/archives faster; default-off keeps current drift-only-confidence-penalty behaviour. **Effort: M.**

## Task 5 — `MemoryContradictionService` + `supersedes`/`superseded_by` migration · L

Detect a new memory contradicting an existing one and supersede/version instead of duplicating. Greenfield service, additive migration.

- **Migration:** ADD `apps/api/src/database/migrations/20260707000000-add-memory-segment-supersession.ts` — `ALTER TABLE memory_segments ADD COLUMN IF NOT EXISTS supersedes uuid NULL`, `ADD COLUMN IF NOT EXISTS superseded_by uuid NULL` (self-referential, nullable, no FK constraint to avoid ordering issues — store the UUID; + optional `idx_memory_segments_superseded_by`). `down` drops both. Add the two columns to `memory-segment.entity.ts` (nullable). Prepend to `registered-migrations.ts`; add a `toContain` membership migration spec mirroring `20260702000000-create-memory-embeddings.spec.ts`. **Fix any `MemorySegment` fixture literals broken by the new columns** (grep specs; columns are nullable so most literals are fine, but builder objects that spread a full entity may need the keys).
- ADD `apps/api/src/memory/learning/memory-contradiction.service.ts` (+ `.types.ts` `ContradictionDecision { kind: 'none'|'supersede'|'version'|'ambiguous'; existingSegmentId?; reason; similarity }`). Pure-ish decision separated from I/O:
  - **Detect:** given a new lesson `{ content, scopeId, metadata }`, call `EmbeddingSimilarityService.findNearest(content, k, scope)` filtered to `ownerType:'memory_segment'`. A neighbour above `contradiction_similarity_threshold` (default ≥ the dedup `candidate_similarity_threshold` 0.85) is a candidate.
  - **Stance check:** a pure `detectOpposingStance(newContent, existingContent)` heuristic (negation/antonym/`always`↔`never`/numeric-value mismatch on the same anchor) → if same topic + opposing stance ⇒ `supersede`; if same topic + refined/extended stance ⇒ `version`; ambiguous ⇒ `ambiguous` (route to human diff, never silently keep both). LLM confirm ONLY on an ambiguous hit (bounded, fail-soft → `ambiguous`).
  - **Apply (I/O, gated by `memory_contradiction_enabled`, default false, shadow-first):** on `supersede`, set the new segment's `supersedes = existing.id` and the existing segment's `superseded_by = new.id` + `archived_at = now` (preserved for audit, invisible to reads); on `version`, bump `version` + link; on `ambiguous`, emit `memory.contradiction.detected.v1` + leave both for the operator diff (the Phase-2 `LearningTabDiffPreview` `memory_update` branch is already built for this surface). In `shadow` mode, emit the event but do not mutate.
- **Hook:** invoke `MemoryContradictionService.evaluate(...)` from `LearningPromotionService.dispatchByRoute` immediately AFTER `createMemorySegment` on the auto-promote path (and expose it for the `RetrospectiveAnalysisService` dedup-against-known seam to call instead of pure-skip when stances oppose). Register in `MemorySignalsModule` (it depends on `CANDIDATE_SIMILARITY`/`EmbeddingSimilarityService`, which live there — avoids a `LearningModule` cycle, mirroring `LearningRouterService`'s placement).

**TDD:**

- _Red:_ a new lesson semantically near an existing one with an OPPOSING stance → `supersede` (existing gets `superseded_by` + `archived_at`, new gets `supersedes`); a refinement → `version`; an ambiguous near-hit → `ambiguous` + event, both rows preserved; a near-hit with the SAME stance → `none` (that's dedup, not contradiction — defer to existing reinforce); `shadow` mode mutates nothing but emits; with `memory_contradiction_enabled=false` the promotion path is unchanged (regression on `learning-promotion.service.spec.ts`).
- _Green:_ implement detection + pure stance heuristic + gated apply; migration + entity columns.
- _Refactor:_ pure `detectOpposingStance` + `decideContradiction` in their own files with exhaustive unit tests; thresholds in `memory-contradiction.settings.constants.ts`.

**Acceptance:** a contradicting memory supersedes the stale one (never two live contradictory rows); ambiguous cases surface as an operator diff; flag-off + shadow leave promotion untouched. **Effort: L.**

## Task 6 — Measurement: behaviour-change counter + A/B holdout lift + cost-per-promoted-memory · M

The causal-measurement trio, added to the in-memory snapshot + prom-client, computed in `MemoryMetricsRefreshService`.

- **Behaviour-change counter.** In the terminal observer (Task 1 gave it the anchored tool/path), after draining inject records, run a cheap `EventLedgerRepository.query` (the capped tool-execution scan) for the run and check whether the lesson's `anchored_tool`/`anchored_path` was actually invoked post-injection. Record `recordLearningBehaviourChange({ lesson_id, scope, changed: boolean })` on `MemoryMetricsService` + a `nexus_learning_behaviour_change_total{scope,changed}` prom-client counter. Pure matcher `matchesAnchor(toolRows, anchor)` with unit tests.
- **A/B holdout lift `nexus_learning_lift{scope}`.** At the inject site (Pre-flight #7), deterministically bucket a fraction of scopes into a holdout arm (`learning_holdout_fraction`, default `0`, i.e. OFF) where promoted lessons are computed but NOT injected; stamp `holdout_arm` on the inject/outcome record. In `MemoryMetricsService`, maintain per-scope per-arm success ring buffers (mirror the convergence rings) and expose `lift = convergence(injected_arm) − convergence(holdout_arm)` as a snapshot field + `learningLoopLiftRatio` gauge. With `learning_holdout_fraction=0` the holdout arm is empty and lift is reported `null` (no behaviour change).
- **Cost-per-promoted-memory.** Add a `MemoryMetricsRefreshService` pass (gated by the existing refresh kill switch) computing `cost_per_promoted_memory = analyst+embedding spend in window / promoted count in window`. Source spend from the existing `budget_usage_events` (the embedding/analyst providers already record there per Phase-1/2 carry-forwards) and promoted count from `learning_candidates`/`memory_segments`. Expose as a snapshot field + `nexus_learning_cost_per_promoted_memory` gauge. Fail-soft (no budget data → `null`).
- Extend `MemoryMetricsSnapshot` / `LearningMetrics` (`memory-metrics.types.ts`) with `behaviour_change`, `lift`, `cost_per_promoted_memory`, and a `suppressed_noise_count` rollup (read the template-filtered count the Phase-1 sweep contract already computes).

**TDD:**

- _Red:_ a run that invokes the lesson's anchored tool post-injection increments `behaviour_change{changed=true}`; one that doesn't → `changed=false`; with `holdout_fraction=0`, `lift` is `null`; with a seeded two-arm fixture, `lift = injected − holdout`; cost-per-memory is `spend/promoted` and `null` when no spend rows; snapshot carries all four fields.
- _Green:_ implement the counter, the holdout buckets, the refresh-pass cost computation; wire gauges in lock-step.
- _Refactor:_ pure matcher + pure lift computation in their own files; settings in `learning-measurement.settings.constants.ts`.

**Acceptance:** `GET /memory/metrics` returns behaviour-change, lift, cost-per-promoted-memory, suppressed-noise; all default to inert/`null` with holdout off and no budget data. **Effort: M.**

## Task 7 — Provisional-memory probation evaluator (confirm always; auto-revert flag-gated) · M

Past `probation_until`, confirm good provisional auto-promotions or revert/archive bad ones. Runs in `MemoryMetricsRefreshService` per the epic.

- ADD `apps/api/src/memory/learning/memory-probation-evaluator.service.ts` (+ `.types.ts` `ProbationVerdict { segmentId; action: 'confirm'|'revert'|'hold'; reason; usefulness; sampleSize }`). Pure `decideProbation({ usefulness, sampleSize, accessCount, contradicted, drifted, nowMs, probationUntilMs }, thresholds)`:
  - past probation + (usefulness ≥ θ OR injected_and_helped) ⇒ `confirm` (`governance_state='confirmed'`).
  - past probation + (usefulness < θ with enough votes OR `access_count===0`/unused OR `superseded_by!=null`/contradicted OR `drift_detected_at!=null`) ⇒ `revert` (archive the bad auto-promotion).
  - inside probation, or insufficient votes ⇒ `hold`.
- **Repository:** ADD `MemorySegmentRepository.findProvisionalPastProbation(now)` selecting `governance_state='provisional'` AND `metadata_json->>'probation_until' < now`.
- **Gating + safety (riskiest path):** the **confirm** action is safe (no data loss) and runs when `memory_probation_evaluator_enabled` (default false) is on. The **revert/auto-archive** action is additionally gated by `memory_probation_auto_revert_enabled` (default false) and runs in **shadow mode first** (emit `memory.probation.shadow.v1` listing would-revert rows without archiving). Auto-revert only ever sets `archived_at` (never hard-deletes) so a wrong revert is recoverable.
- **Wire:** add a probation pass to `MemoryMetricsRefreshService.runRefreshOnce` (after the gauge refresh, same kill-switch + try/catch fail-soft envelope). Record `recordProbationOutcome({ confirmed, reverted, held })` on `MemoryMetricsService` for the Learning Health panel.

**TDD:**

- _Red:_ a useful provisional past probation → `confirm` (state flips to `confirmed`); an unused/low-usefulness one past probation → `revert` (archived) ONLY when auto-revert flag on, else shadow-event-only; a contradicted (`superseded_by`) provisional → `revert`; inside probation → `hold`; `confirmed`/legacy-null rows are untouched; evaluator-disabled → no-op. Pure `decideProbation` matrix unit-tested.
- _Green:_ implement the evaluator + repository query + refresh wiring; thread the flags.
- _Refactor:_ pure decision in its own file; thresholds in `memory-probation.settings.constants.ts`.

**Acceptance:** good auto-promotions self-confirm; bad ones self-revert (flag-on, archive-only, shadow-first); probation counts surface on the snapshot; everything default-off. **Effort: M.**

## Task 8 — Learning Health web panel · M

Roll up convergence, behaviour-change, holdout lift, cost-per-memory, suppressed-noise (and probation) on a presentation-only surface.

- ADD `apps/web/src/pages/project-workspace/LearningHealthPanel.tsx` (presentation-only) + extend the existing `useMemoryMetrics` hook / `MemoryMetricsResponse` type (`apps/web/src/lib/api/memory.types.ts`) with the new `learning.{behaviour_change, lift, cost_per_promoted_memory, suppressed_noise_count, probation}` fields (additive, optional). No new endpoint — reuse `GET /memory/metrics`. Side effects stay in the hook (web quality gate: components are presentation-only).
- Render: convergence ratio (per scope), behaviour-change rate, holdout lift (with an "enable holdout to measure" empty state when `null`), cost-per-promoted-memory ("no spend data" empty state), suppressed-noise count, probation confirmed/reverted/held tiles. Wire into the `LearningTab.tsx` shell alongside `LearningTabStatusCard`.

**TDD (`test:unit:web`):**

- _Red:_ given a metrics payload, the panel renders each tile; `lift:null` renders the holdout-disabled empty state; `cost:null` renders the no-data state; loading/empty render without crashing.
- _Green:_ implement the panel + hook/type extension.
- _Refactor:_ share tile/format helpers with existing status-card components.

**Acceptance:** an operator sees convergence, behaviour-change, lift, cost, suppressed-noise, and probation at a glance; inert metrics show informative empty states. **Effort: M.**

## Task 9 — `FeedbackWeightTunerService` + `signal_weight_history` migration (nice-to-have, last/riskiest) · L

Weekly bounded logistic-regression retune of the candidate-scoring weights over promoted+usefulness labels. Bounded, versioned, reversible — and last because it mutates the scoring weights the whole loop depends on.

- **Migration:** ADD `apps/api/src/database/migrations/20260708000000-create-signal-weight-history.ts` — `CREATE TABLE IF NOT EXISTS signal_weight_history` (`id uuid pk`, `weights_json jsonb`, `previous_weights_json jsonb`, `training_sample_size int`, `bounded_delta double precision`, `applied boolean default false`, `reason varchar(64)`, `created_at`). `down` drops. Entity + repository (`adding-entity-migration` skill); register in `DatabaseModule`; prepend + `toContain` spec.
- ADD `apps/api/src/memory/signals/feedback-weight-tuner.service.ts` (+ `.types.ts`). Weekly BullMQ repeatable (mirror the `candidate-clusterer` scheduler/processor/constants trio in `MemorySignalsModule`), gated by `feedback_weight_tuner_enabled` (default false):
  - **Labels:** promoted candidates that subsequently earned high usefulness / behaviour-change = positive; promoted-then-reverted/contradicted/low-usefulness = negative. Features = the populated `signals_json` axes (recurrence, stage diversity, recency decay, source quality, similarity).
  - **Train:** pure L2-regularised logistic regression (own small gradient-descent helper, fully unit-tested — no new dependency) over the labels.
  - **Bound + version + reverse:** clamp each new weight to within `feedback_weight_tuner_max_delta` of the current `candidate_scoring_*` setting (no weight moves more than the bound per run); write a `signal_weight_history` row (new + previous weights) BEFORE applying; apply only when `applied` and the sample size ≥ `feedback_weight_tuner_min_samples`. A revert is just re-applying `previous_weights_json` from history. Fail-soft (too few samples → write a `reason='insufficient_samples'` row, apply nothing).

**TDD:**

- _Red:_ a separable fixture yields weights that improve training accuracy; every weight stays within `max_delta` of the prior; a `signal_weight_history` row is written with previous+new before apply; below `min_samples` nothing is applied; disabled flag → no-op; a revert restores the prior weights exactly. Pure logistic-regression helper unit-tested on a tiny known dataset.
- _Green:_ implement trainer + bounded apply + history; scheduler/processor.
- _Refactor:_ pure regression + bounding in their own files; settings in `feedback-weight-tuner.settings.constants.ts`.

**Acceptance:** with the flag on, weights retune weekly within bounds, every change is versioned in `signal_weight_history` and reversible; default-off leaves the hand-set Phase-1 weights untouched. **Effort: L.**

## Task 10 — Wiring, settings, docs, verification · M

- **Settings:** register all Phase-3 keys in `SYSTEM_SETTING_DEFAULTS` (table below), each with a `coerceX` fragment.
- **Module wiring:** confirm `MemoryContradictionService` + `FeedbackWeightTunerService` register in `MemorySignalsModule` (no `LearningModule` cycle); `MemoryProbationEvaluatorService` registers in `MemoryModule` (it consumes `MemorySegmentRepository` + `MemorySegmentFeedbackService`, both there); the decay/eviction reaper edits stay in `MemoryModule`. Verify no new import cycle (`MemorySignalsModule` must not import `LearningModule`).
- **Docs:** update `docs/guide/35-memory-learning.md` (lifecycle predicate, drift self-invalidation, contradiction, probation, measurement, Learning Health), the EPIC-212 progress table (mark Phase 3), and `.superpowers/sdd/progress.md` per-task completion lines.
- **Verification gate:** `npm run build --workspace=packages/core` → `build:api` → `build:web`; `test:api` + `test:unit:web` green; `lint:api`/`lint:web` clean (no suppressions, `max-lines:500`, `complexity ≤14`, interfaces in `*.types.ts`); both migrations idempotent + registered (`toContain` specs); `validate:seed-data` 7/7.

**Acceptance:** all Phase-3 settings seed on a fresh DB; modules boot with no cycle; docs reflect the new lifecycle/measurement; full suite green. **Effort: M.**

---

## Settings introduced (Phase 3)

| Setting                                     | Default     | Purpose                                                                                  |
| ------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------- |
| `decay_value_predicate_mode`                | `legacy`    | `legacy`\|`shadow`\|`enforce` — usefulness-aware decay predicate (shadow = observe only) |
| `memory_decay_usefulness_threshold`         | `0.6`       | Usefulness ratio at/above which a stale row is kept by the value predicate               |
| `memory_decay_usefulness_min_samples`       | `3`         | Minimum votes before usefulness can drive a keep/archive verdict                         |
| `eviction_value_predicate_enabled`          | `false`     | Apply the same usefulness keep-predicate in the eviction reaper                          |
| `memory_decay_drift_invalidation_enabled`   | `false`     | Treat `drift_detected_at` rows as decay-eligible (bypass grace)                          |
| `memory_decay_drift_penalty_multiplier`     | `3`         | Accelerate decay for drifted rows                                                        |
| `memory_contradiction_enabled`              | `false`     | Master switch for `MemoryContradictionService` (shadow until on)                         |
| `memory_contradiction_mode`                 | `shadow`    | `shadow`\|`enforce` — emit-only vs supersede/version/archive                             |
| `memory_contradiction_similarity_threshold` | `0.85`      | Vector-near threshold for a contradiction candidate                                      |
| `learning_behaviour_change_enabled`         | `true`      | Compute the post-injection anchored-tool-used counter                                    |
| `learning_holdout_fraction`                 | `0`         | Fraction of scopes bucketed into the suppress-lessons holdout arm (0 = off)              |
| `memory_probation_evaluator_enabled`        | `false`     | Run the provisional probation evaluator (confirm path)                                   |
| `memory_probation_auto_revert_enabled`      | `false`     | Allow the evaluator to archive bad auto-promotions (shadow-first)                        |
| `memory_probation_usefulness_threshold`     | `0.5`       | Usefulness floor to confirm a provisional segment past probation                         |
| `feedback_weight_tuner_enabled`             | `false`     | Enable the weekly bounded weight retune                                                  |
| `feedback_weight_tuner_max_delta`           | `0.1`       | Per-run clamp on each scoring-weight change                                              |
| `feedback_weight_tuner_min_samples`         | `50`        | Minimum labelled samples before applying a retune                                        |
| `feedback_weight_tuner_cron`                | `0 4 * * 0` | Weekly schedule (Sunday 04:00)                                                           |

> Reuses existing `learning_convergence_window_days`, `memory_feedback_window_days`, `memory_metrics_gauge_use_refresh`, `candidate_scoring_*`, `memory_decay_*`, `memory_drift_*` keys.

## Rollback

- **Every flag default OFF** → the deterministic Phase-0/1/2 loop is byte-for-byte intact: `decay_value_predicate_mode=legacy` (exempt-by-source decay), `memory_contradiction_enabled=false` (no supersede), `memory_probation_evaluator_enabled=false` (no confirm/revert), `feedback_weight_tuner_enabled=false` (hand-set weights), `learning_holdout_fraction=0` (no suppression).
- Both migrations are **additive** (`ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS`); `down` drops. `supersedes`/`superseded_by`/`signal_weight_history` left null/empty are inert. No data migration.
- Shadow modes (decay, contradiction, probation auto-revert) **emit events but never mutate**, so an operator can compare the would-do set against reality before flipping `enforce`.
- Auto-revert and contradiction archival only ever set `archived_at` (never hard-delete) — recoverable. The weight tuner versions every change in `signal_weight_history` and a revert re-applies `previous_weights_json`.

## Carry-forwards to Phase 4 (skill durability)

- The `superseded_by`/`governance_state='confirmed'` lifecycle interacts with reseed: Phase 4 must preserve confirmed + non-superseded runtime-created skills/scopes across reseed (the EPIC-101 risk). Until then, treat probation-confirmed memories as the durable set the reseed-preservation logic anchors on.
- The `signal_weight_history` + behaviour-change/lift labels become the training signal the Phase-4 skill-quality work can reuse for skill-proposal ranking.
- `MemoryContradictionService` (supersede/version) is the seam Phase 4's skill-patch flow should reuse so a skill patch that contradicts an existing skill supersedes rather than forks it.
