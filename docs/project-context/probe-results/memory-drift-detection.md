---
project_scope_id: 458935f0-213e-4bbe-89d1-8883e0efa9ad
probe_scope_id: memory-drift-detection
outcome: success
inferred_status: implemented
confidence_score: 0.92
evidence_refs:
  - apps/api/src/memory/memory-drift-detection.service.ts
  - apps/api/src/memory/memory-drift-detection.service.spec.ts
  - apps/api/src/memory/memory-drift-detection.integration.spec.ts
  - apps/api/src/memory/memory-drift-checkers.ts
  - apps/api/src/memory/memory-drift-indexes.ts
  - apps/api/src/memory/memory-drift-persistence.ts
  - apps/api/src/memory/memory-drift-reference.parser.ts
  - apps/api/src/memory/memory-drift.coercion.ts
  - apps/api/src/memory/memory-drift.constants.ts
  - apps/api/src/memory/memory-drift.processor.ts
  - apps/api/src/memory/memory-drift.types.ts
  - apps/api/src/memory/memory.module.ts (provider + BullMQ queue registration)
  - apps/api/src/memory/memory-cron.scheduler.ts (CRON_REGISTRATIONS includes drift)
  - apps/api/src/memory/database/entities/memory-segment.entity.ts (drift_detected_at column)
  - apps/api/src/database/migrations/20260626000000-add-memory-drift-detected-at.ts
  - apps/api/src/observability/metrics.service.ts (nexus_memory_drift_detected_total counter)
  - apps/api/src/settings/system-settings.defaults.ts (seedDefaults for 3 MEMORY_DRIFT keys)
  - apps/api/src/database/migrations/registered-migrations.ts (drift migration registered)
source_paths:
  - apps/api/src/memory/memory-drift-detection.service.ts
  - apps/api/src/memory/memory-drift-detection.service.spec.ts
  - apps/api/src/memory/memory-drift-detection.integration.spec.ts
  - apps/api/src/memory/memory-drift-checkers.ts
  - apps/api/src/memory/memory-drift-indexes.ts
  - apps/api/src/memory/memory-drift-persistence.ts
  - apps/api/src/memory/memory-drift-reference.parser.ts
  - apps/api/src/memory/memory-drift.coercion.ts
  - apps/api/src/memory/memory-drift.constants.ts
  - apps/api/src/memory/memory-drift.processor.ts
  - apps/api/src/memory/memory-drift.types.ts
updated_at: 2026-07-02T00:00:00.000Z
---

# Probe Result: Memory Segment Drift Detection (0cead042)

## Narrative Summary

The Memory Segment Drift Detection capability (work item 0cead042-e823-4e26-9386-02042252ffb0) is **fully implemented** end-to-end and exceeds every documented acceptance criterion. The capability closes the explicit gap in the AI memories "Automatically updated" goal that the eviction reaper (`bef49c3a`) and decay reaper (`3d7fb798`) do not cover: it walks `memory_segments` on a nightly cron, parses each row's `source_metadata` for code-level references (file paths, schema columns, API endpoints), cross-checks them against the live codebase, stamps `drift_detected_at` + applies a configurable confidence penalty on drift, and emits the `memory.segment.drift_detected.v1` event.

Eleven in-scope files were inspected, plus all required supporting surface (entity column + migration, metrics counter, settings seeding, module wiring, BullMQ processor, cron registration). All eleven files exist, are non-trivial real implementations, and have meaningful docstrings pinning the work-item contract. The two dedicated test files (one unit, one integration) both cover the work-item's explicit acceptance criteria and add defensive scenarios on top.

**Confidence: 0.92.** The 0.08 deduction covers minor gaps noted in Health Findings — chiefly the absence of dedicated unit tests for the five extracted helper modules (`memory-drift-checkers.ts`, `memory-drift-reference.parser.ts`, `memory-drift-indexes.ts`, `memory-drift-persistence.ts`, `memory-drift.coercion.ts`) and for the BullMQ processor; these helpers are exercised transitively through the service spec but lack standalone coverage, and the drift metric / processor are not independently spec'd.

## Capability Updates

### Core service — `memory-drift-detection.service.ts`

- NestJS `@Injectable` service implementing `runDriftPass({ now? })` as the test-friendly seam. The `now` override is honoured at three call sites (`startedAt`, per-row `drift_detected_at` stamp, recheck-window cutoff) so the test matrix is fully deterministic without monkey-patching `Date`.
- All external dependencies are `@Optional()` — `EventLedgerService`, `MemoryDriftReferenceParser`, `MemoryDriftCheckers`, plus a `loggerClass` and `options` injection seam. The service can be unit-tested via direct construction (`new MemoryDriftDetectionService(repo, dataSource, settings, metrics, ...)`).
- Settings are resolved fresh on every `runDriftPass()` (no caching at construction) via `coerceEnabled` / `coerceConfidencePenalty` / `coerceInteger`. Operator changes take effect on the next tick without restart.
- Kill switch (`memory_drift_enabled`) is read **before** the candidate query, short-circuiting with `{ skipped: true, reason: 'disabled' }` and never waking the DB.
- Per-row error containment: every candidate evaluation is wrapped in `try / catch`, the error is pushed to `summary.errors[]`, and the loop continues to the next candidate. A transient DB blip never fails the rest of the pass.
- Confidence math: `originalConfidence - confidencePenalty`, clamped to `[0, 1]` via a dedicated `clampConfidence` helper. The detector never invents a confidence value from scratch — a row with no `metadata_json.confidence` yields `null` and is left untouched.
- Schema index and code corpus are lazy-built promises cached on the service instance — the `entityMetadatas` walk and `walkSourceTree(...)` happen at most once per process.
- Metric dispatch via `recordDriftMetric(...)`: `outcome: 'detected'` on drift, `outcome: 'exempt'` on short-circuit, `outcome: 'unavailable'` on schema/corpus build failure. Rows that were evaluated but did not drift (file present, schema present, API present, `no_driftable_reference`) do NOT bump the counter — the metric is a drift-detection signal, not an evaluation counter, matching the work-item contract.

### Extracted helpers — `memory-drift-checkers.ts`, `memory-drift-indexes.ts`, `memory-drift-persistence.ts`, `memory-drift-reference.parser.ts`, `memory-drift.coercion.ts`

Each helper module is a focused file that splits one concern out of the service:

- **`memory-drift-checkers.ts`** — three pure checkers (`checkFileDrift`, `checkSchemaDrift`, `checkApiDrift`) plus a thin `@Injectable` `MemoryDriftCheckers` wrapper. File checker does `path.resolve` + traversal guard (`path_outside_repo` distinct from `file_missing`), catches `ENOENT`/`ENOTDIR` for `file_missing`, and re-throws other errors so the detector can record them. API checker regex-escapes the reference (defending against attacker-controlled metadata) and treats `/path` tail as a literal.
- **`memory-drift-indexes.ts`** — `buildSchemaIndex(dataSource)` walks `entityMetadatas` into a `Map<tableName, Set<propertyName>>` (deterministic, idempotent, non-throwing on partial metadata); `buildCodeCorpus(root)` walks `.ts/.js` files (symlinks not followed, unreadable dirs silently skipped) and exposes `read()` / `search()` per the `MemoryDriftCodeCorpus` contract.
- **`memory-drift-persistence.ts`** — `persistDriftOnSegment(...)` mutates the loaded entity (so `@UpdateDateColumn` fires) and calls `repository.save(...)`. `emitDriftEventBestEffort(...)` wraps `eventLedger.emitBestEffort` in a try/catch so a ledger outage does not roll back the row update. Mutation is idempotent; the detector never clears `drift_detected_at`.
- **`memory-drift-reference.parser.ts`** — pure `parseMemoryDriftReference(metadata)` classifies `filePath`/`schemaRef`/`apiEndpoint` keys with strict regex guards (`SCHEMA_REF_PATTERN` for `table.column[.field]`, `API_METHOD_PREFIX_PATTERN` for `METHOD /path`, `FILE_PATH_PATTERN` rejects absolute paths / URLs); plus a thin `@Injectable` `MemoryDriftReferenceParser` wrapper for DI / stub injection.
- **`memory-drift.coercion.ts`** — `coerceEnabled` and `coerceConfidencePenalty` defensive coercion helpers (accepts `boolean`/`string`/`number`, falls back to `MEMORY_DRIFT_DEFAULT_*` constants on malformed input). `recheckAfterMs` uses the shared `coerceInteger` from `apps/api/src/settings/setting-coercers.ts` with `{ min: 0, allowUndefined: true }`.

### Types & constants — `memory-drift.types.ts`, `memory-drift.constants.ts`

- Public type surface: `MemoryDriftRunSummary` (run-level counters + `startedAt`/`completedAt` + `skipped`/`reason`/`errors`), `MemoryDriftDetectionResult` (per-row outcome with all fields always populated), `MemoryDriftDetectionServiceOptions` (`repoRoot`/`codeCorpusRoot`), `MemoryDriftParsedReference`, `MemoryDriftCheckerResult`, `MemoryDriftCodeCorpus`, `MemoryDriftSettingKey` (compile-time guard against off-by-one typos).
- Constants: `MEMORY_DRIFT_EXEMPT_SOURCES` (frozen tuple: `learning_candidate`, `workflow_failure_postmortem`, `strategic_intent`, `workflow_success_postmortem`), `MEMORY_DRIFT_DEFAULT_CRON = '0 4 * * *'` (intentionally offset 60 min from eviction/decay), `MEMORY_DRIFT_DEFAULT_ENABLED = true`, `MEMORY_DRIFT_DEFAULT_CONFIDENCE_PENALTY = 0.2`, `MEMORY_DRIFT_EVENT_NAME = 'memory.segment.drift_detected.v1'`, `MEMORY_DRIFT_QUEUE = 'memory-drift-detection'`, `MEMORY_DRIFT_JOB_NAME = 'memory-drift-detection.run'`, and `MEMORY_DRIFT_SETTING_KEYS` record (`cron`, `enabled`, `confidencePenalty`, `recheckAfterMs`).

### BullMQ processor — `memory-drift.processor.ts`

- `@Processor(MEMORY_DRIFT_QUEUE)` `MemoryDriftProcessor` extending `WorkerHost`. `process(...)` dispatches by `job.name` (only `MEMORY_DRIFT_JOB_NAME` is handled; other names are debug-logged and returned as a no-op so an accidental `queue.add('something-else', ...)` does not crash the worker). Per-tick logic calls `detector.runDriftPass()` and returns `{ summary }` as the job result; re-throws on hard failure so BullMQ retry applies.

### Module wiring — `apps/api/src/memory/memory.module.ts`

- All five providers registered: `MemoryDriftDetectionService`, `MemoryDriftReferenceParser`, `MemoryDriftCheckers`, `MemoryDriftProcessor`, and (transitively) the `MemoryCronScheduler` which owns the `MEMORY_DRIFT_QUEUE` repeatable-job registration alongside eviction + decay. `MemoryDriftDetectionService` is also exported (consistent with the decay/eviction reapers' exports). `BullModule.registerQueue({ name: MEMORY_DRIFT_QUEUE })` adds the queue to the module's imports.

### Entity + migration — `MemorySegment.drift_detected_at`, `20260626000000-add-memory-drift-detected-at.ts`

- `drift_detected_at: Date | null` column added to `memory_segments` (nullable `timestamptz`); the detector stamps but never clears the column ("once drifted, always marked" for auditability).
- Two indexes added: a plain b-tree `idx_memory_segments_drift_detected_at` for `ORDER BY drift_detected_at DESC` observability queries, and a partial b-tree `idx_memory_segments_drift_detected_at_unset` (`WHERE drift_detected_at IS NULL`) for the detector's hot candidate filter.
- Migration is `IF NOT EXISTS` / `DROP COLUMN IF EXISTS` guarded and registered in `registered-migrations.ts`.

### Cron scheduling — `MemoryCronScheduler.CRON_REGISTRATIONS`

- A third entry in the unified `CRON_REGISTRATIONS` array with `queueName: MEMORY_DRIFT_QUEUE`, `jobName: MEMORY_DRIFT_JOB_NAME`, `settingKey: MEMORY_DRIFT_SETTING_KEYS.cron`, `defaultCron: MEMORY_DRIFT_DEFAULT_CRON`, `repeatJobId: 'memory-drift-cron'`. Boot-time registration reads the cron expression from `SystemSettingsService`, normalises it, calls `queue.add(...)` with `removeOnComplete: 100` / `removeOnFail: 200`, and swallows transient errors (next restart retries).

### Metrics — `nexus_memory_drift_detected_total{source, outcome}`

- Registered in `metrics.service.ts.registerMemoryDriftMetric()` and exposed as `metricsService.nexusMemoryDriftDetectedTotal`. Increment via `recordMemoryDriftDetected({ source, outcome })` where `source` is the parser's `referenceKind` (closed enum `file | schema | api`) and `outcome` is `'detected' | 'exempt' | 'unavailable' | 'error'`. Label cardinality is bounded by the closed enums.

### Settings seeding — `apps/api/src/settings/system-settings.defaults.ts`

- Three keys registered in `seedDefaults()`: `memory_drift_enabled` (default `true`, full kill-switch description), `memory_drift_cron` (default `'0 4 * * *'`, with offset-rationale docstring), `memory_drift_confidence_penalty` (default `0.2`, with `[0, 1]` clamp docstring). `memory_drift_recheck_after_ms` is intentionally absent — the absence of the setting is the documented signal "skip drifted rows", which the detector handles via `coerceInteger(..., { min: 0, allowUndefined: true })`.

## Health Findings

### Test coverage — exceeds the work-item contract

- **`memory-drift-detection.service.spec.ts`** ships **10 scenarios**, well above the documented "6+ unit tests covering missing-file, schema-changed, API-renamed, exempt sources, kill switch, settings override" acceptance:
  1. Missing-file drift (penalty applied, event emitted, metric recorded).
  2. Schema-changed drift (`schema_reference_missing`, lazy index from `DataSource`).
  3. API-renamed drift (`api_reference_missing`, code corpus + `codeCorpusRoot` override).
  4. Exempt sources short-circuit (`learning_candidate` + `workflow_failure_postmortem` skip parser / checkers / DB writes / event emission; metric recorded as `outcome: 'exempt'`).
  5. Kill switch (`memory_drift_enabled = false` short-circuits BEFORE the candidate query).
  6. Operator-tuned `confidence_penalty` override (`0.9 - 0.5 = 0.4` not `0.9 - 0.2 = 0.7`).
  7. No metric for `file_present` (pins the "metric is a drift-detection signal, not an evaluation counter" contract).
  8. `(source, outcome)` label pairs across a 4-segment mix (3 drift + 1 exempt).
  9. `recheck_after_ms` propagated to the candidate query (`< :recheckCutoff` predicate, ISO cutoff value).
  10. Per-row error containment (`errors[]` populated, loop continues, OK row still drifts).
- **`memory-drift-detection.integration.spec.ts`** is a full NestJS `TestingModule` boot with a real Postgres + real `MetricsService` + stub `EventLedgerService` + stub `SystemSettingsService`, gated on `INTEGRATION_TEST_DATABASE_URL` (skip-safe on dev machines, refuses to run against the application DB via `assertNotApplicationDatabase(...)`). It seeds the documented "10 segments / 3 drifted / 7 retained across mixed source-file reality" matrix and asserts the literal `(file|schema|api, detected)` × 1 + `(unknown, exempt)` × 2 metric increments, 3 events emitted, per-row penalty math (`0.9 - 0.2 = 0.7`), exempt short-circuit at the DB level, and the safety gate test.
- **`memory-cron.scheduler.spec.ts`** covers the drift registration (default cron, empty/whitespace settings value, `repeatJobId` byte-identical to the legacy literal `'memory-drift-cron'`, `wasRegistered(MEMORY_DRIFT_JOB_NAME)` health flag).

### Code quality — clean

- No `eslint-disable` / `@ts-nocheck` / `@ts-ignore` suppression comments in any of the eleven in-scope files (verified by code review of the docstrings and body).
- Pure functions split out of class wrappers (mirrors the `parseMemoryDriftReference` / `MemoryDriftReferenceParser` and `checkFileDrift` / `MemoryDriftCheckers` patterns) so unit tests can import the pure functions directly without spinning up the DI container.
- Constructor injection with `@Optional()` decorators means the service can be tested by direct construction (no `Test.createTestingModule(...)` required for the unit spec).
- Defensive belt-and-suspenders: `coerceEnabled` accepts strings/numbers/booleans; `coerceConfidencePenalty` rejects negative/out-of-range values (UI typo cannot invert the detector); `coerceInteger` with `allowUndefined` distinguishes "operator explicitly unset" from "missing key"; the parser is null-safe on every key access; the file checker rejects `path_outside_repo` distinctly from `file_missing` (security-shaped failure vs. routine rename).

### Idempotency & auditability

- The detector never clears `drift_detected_at` — a drifted row stays drifted for the lifetime of the segment. The `recheck_after_ms` setting only controls when the detector revisits the row, not whether it clears the stamp.
- `persistDriftOnSegment(...)` is idempotent (re-applying the same result to the same row is a no-op; the penalty is already applied).
- Two indexes (plain b-tree + partial b-tree) keep the hot candidate filter cheap as the drifted subset grows; the partial index specifically serves `WHERE drift_detected_at IS NULL`.

### Architectural consistency

- Mirrors the `MemoryDecayReaper` / `MemoryEvictionReaper` patterns: same `MemoryCronScheduler` scaffold, same `@Injectable` + `OnApplicationBootstrap` conventions, same `MEMORY_*_EXEMPT_SOURCES` allowlist style (frozen tuple), same `MEMORY_*_SETTING_KEYS` canonical-keys record, same per-row error containment, same `summary.skipped` / `summary.reason` short-circuit reporting.
- Splits the service into service file + checkers + indexes + persistence + reference parser + coercion + constants + types — the same split the decay reaper / eviction reaper use, so a future developer can navigate the code base by mirroring either reaper.

### Gaps

- **Helper modules lack dedicated unit tests.** `memory-drift-checkers.ts`, `memory-drift-reference.parser.ts`, `memory-drift-indexes.ts`, `memory-drift-persistence.ts`, and `memory-drift.coercion.ts` are all exercised transitively through `memory-drift-detection.service.spec.ts` and the integration suite, but no standalone `*.spec.ts` exists for any of them. Compare with the decay reaper's `memory-decay.classify.spec.ts` and `memory-decay.value-predicate.spec.ts` which DO have dedicated unit tests for similar extracted helpers.
- **`memory-drift.processor.ts` has no dedicated processor spec.** The processor is wired and registered, but the bullmq unit spec that exercises it under controlled job-name dispatch + retry-on-failure does not exist. Compare with `memory-decay.processor.spec.ts` and `memory-eviction.processor.ts`'s forwarder coverage.
- **`recordMemoryDriftDetected(...)` and `nexusMemoryDriftDetectedTotal` are not directly asserted in `metrics.service.spec.ts`.** The drift metric is incremented correctly via the integration test, but the metrics-service spec does not have a dedicated test for the counter shape or label normalization. (Confirmed via grep — no matches for `drift` in `metrics.service.spec.ts`.)
- **No direct unit test for the `recheck_after_ms = undefined` short-circuit.** The unit spec covers the `recheckAfterMs = 86_400_000` case but not the "operator explicitly unset" case. The detector's behaviour on this code path is implicit (the `andWhere('segment.drift_detected_at IS NULL')` branch) and could regress silently.

## Open Questions

- **No standalone unit tests for the five extracted helper modules** — `memory-drift-checkers.ts`, `memory-drift-reference.parser.ts`, `memory-drift-indexes.ts`, `memory-drift-persistence.ts`, `memory-drift.coercion.ts`. The service spec exercises them transitively, but a pure-function unit test on each (e.g. file checker `path_outside_repo`, API checker regex escaping, parser's three-way classification, index build on partial metadata, coercers' malformed-input fallbacks) would lock the helper contracts more durably. Recommendation: file a low-priority followup to extract these spec files mirroring `memory-decay.classify.spec.ts` / `memory-decay.value-predicate.spec.ts`.
- **No dedicated `memory-drift.processor.spec.ts`** — the BullMQ processor's job-name dispatch (`_job.name !== MEMORY_DRIFT_JOB_NAME` returns `null`) and per-tick wrapper logging are not pinned by a standalone spec. Compare with `memory-decay.processor.spec.ts` which exercises the same shape.
- **No direct `recordMemoryDriftDetected` test in `metrics.service.spec.ts`** — the prom-client counter is exercised via the integration test, but a focused unit test on `recordMemoryDriftDetected` (label normalization for non-finite `source`, all four `outcome` values) would harden the metrics-service surface.
- **`memory_drift_recheck_after_ms` is absent from `system-settings.defaults.ts`** — the constant is documented in `memory-drift.constants.ts` but not registered in `seedDefaults()`. This appears intentional ("the absence of the setting is the documented signal that the recheck window is unset"), but is worth confirming with the implementing team. Compare with the decay reaper's `memory_decay_*` keys which ARE all registered in `seedDefaults()`.
- **No docs entry in `docs/guide/`** — the drift detection capability is referenced in `docs/epics/EPIC-212-memory-learning-loop-rebuild.md`, `superpowers/plans/2026-06-25-memory-learning-loop-phase-1-pgvector-embeddings.md`, and `superpowers/plans/2026-06-26-memory-learning-loop-phase-3-lifecycle-measurement.md`, but there is no dedicated `docs/guide/memory-drift-detection.md` deep-dive document analogous to the decay reaper's `memory-decay-reaper` guide entries.
- **The drift integration test's `INTEGRATION_TEST_DATABASE_URL` gate is correct but requires CI to provision a dedicated throwaway DB.** A dev machine running `npm run test:api` with no env var set will skip the integration suite entirely — the destructive TRUNCATE safety is good, but the trade-off is that the integration suite is not exercised on every dev test run.
