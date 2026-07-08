---
project_scope_id: 458935f0-213e-4bbe-89d1-8883e0efa9ad
probe_scope_id: memory-decay-reaper
outcome: success
inferred_status: implemented
confidence_score: 0.9
evidence_refs:
  - apps/api/src/memory/memory-decay.reaper.ts
  - apps/api/src/memory/memory-decay.reaper.spec.ts
  - apps/api/src/memory/memory-decay.reaper.integration.spec.ts
  - apps/api/src/memory/memory-decay.constants.ts
  - apps/api/src/memory/memory-decay.types.ts
  - apps/api/src/memory/database/repositories/memory-segment.repository.ts (findDecayCandidates, save, update, touchReinforcedAt)
  - apps/api/src/memory/memory.module.ts (provider registration + BullMQ queue registration)
  - apps/api/src/memory/memory-metrics.service.ts (setMemoryDecayLastRun)
  - apps/api/src/observability/metrics.service.ts (recordMemoryDecayRun)
  - apps/api/src/settings/system-settings.service.ts (seedDefaults for all 5 memory_decay_* keys)
  - apps/api/src/database/migrations/20260623000000-add-memory-segment-decay-columns.ts
  - apps/api/src/database/migrations/registered-migrations.ts
source_paths:
  - apps/api/src/memory/memory-decay.reaper.ts
  - apps/api/src/memory/memory-decay.reaper.spec.ts
  - apps/api/src/memory/memory-decay.reaper.integration.spec.ts
  - apps/api/src/memory/memory-decay.constants.ts
  - apps/api/src/memory/memory-decay.types.ts
updated_at: 2026-06-19T00:00:00.000Z
---

# Probe Result: Memory Segment Confidence Decay Reaper (work item 3d7fb798)

## Narrative Summary

The Memory Segment Confidence Decay Reaper (work item 3d7fb798-f54d-40ff-a803-438224474912) is fully implemented across the assigned paths and is wired into the surrounding API surface. The deliverable ships:

- A `MemoryDecayReaperService` (NestJS `@Injectable`, implements `OnApplicationBootstrap`) that owns the nightly confidence-decay pass, the BullMQ cron registration, and the per-row evaluation math.
- A consolidated constants module (`memory-decay.constants.ts`) exposing the canonical `MEMORY_DECAY_SETTING_KEYS` record, the source-exempt allowlist (`learning_candidate`, `workflow_failure_postmortem`, `strategic_intent`), the hardcoded defaults (`enabled=true`, `graceDays=30`, `dailyRate=0.01`, `floor=0.2`, `cron='30 3 * * *'`), and the runtime identifiers (`MEMORY_DECAY_QUEUE = 'memory-decay'`, `MEMORY_DECAY_JOB_NAME = 'memory-decay-reaper'`).
- A public type surface (`memory-decay.types.ts`) defining `MemoryDecayRunSummary`, `MemoryDecayRunOptions`, and `MemoryDecaySettings`.
- A repository contract (`MemorySegmentRepository.findDecayCandidates(...)`) implementing the SQL filter (`archived_at IS NULL AND source NOT IN exempt AND COALESCE(GREATEST(last_accessed_at, last_reinforced_at), ...) < :graceCutoff`), plus `save(segment)` (the decay-in-place path) and `update(id, { archived_at })` (the archive path) and `touchReinforcedAt(ids)` for the read-path reinforcement half.
- Metrics wiring: `MemoryMetricsService.setMemoryDecayLastRun(value)` (the snapshot timestamp) and `MetricsService.recordMemoryDecayRun(evaluated, archived)` (the prom-client counter pair).
- Settings seeding: all five `memory_decay_*` keys are registered in `SystemSettingsService.seedDefaults()` with descriptions and hardcoded fallbacks.
- A migration (`20260623000000-add-memory-segment-decay-columns`) registered in `registered-migrations.ts` that adds the `last_reinforced_at` `timestamptz` column and the supporting b-tree indexes.
- Test coverage well exceeds the work-item acceptance criteria: 11 unit-test scenarios (vs. the documented ≥6) and a full integration suite that boots a NestJS `TestingModule` around a hand-rolled in-memory `MemorySegmentRepository` and seeds **10 segments across 3 sources**, asserting the canonical **4 archived / 6 retained** split, the exact decay math (`0.8 - 0.01 * 30 = 0.5`), and the no-double-archive idempotency invariant across consecutive runs.

The unit spec covers the documented acceptance scenarios (linear decay, floor → archive, zero-confidence no-further-decay, exempt sources skipped, kill switch short-circuit, settings override) plus defensive coverage (snapshot timestamp update on every pass including pass-throughs, prom-client counter call shape, canonical exempt allowlist passed down to the repository, empty candidate set short-circuit, `applyDecay(...)` float-drift rounding to 2 decimal places).

The reaper reads settings fresh on every `runDecayPass()` (no caching at construction), short-circuits with `{ skipped: true, reason: 'disabled' }` when `memory_decay_enabled` is false (no DB scan, no row mutation), and never throws on a per-row failure (a transient DB blip logs and continues to the next row). The BullMQ cron registration is best-effort and swallows transient Redis / `cron-parser` errors so a failed registration never crashes the app — the next process restart retries it.

**Confidence: 0.9** — every contractual piece is implemented and tested. The 0.1 deduction reflects the open question below about whether the runtime cron-tick path is fully wired (see Open Questions).

## Capability Updates

- **Confidence-decay reaper service** (`MemoryDecayReaperService`): the core service is implemented and registered as a provider in `MemoryModule`. It implements `OnApplicationBootstrap` and registers the repeatable BullMQ job at startup; `runDecayPass()` is the test-friendly seam that accepts an optional `now` for deterministic tests.
- **Per-row decay evaluation**: the reaper implements `evaluateCandidate(...)` with explicit defensive checks for exempt sources (belt-and-suspenders against a weakened repository contract), `null` last-touch (no-op), in-grace rows (preserved), missing confidence (no-op), and a per-row error handler that logs and continues. The decayed confidence is rounded to 2 decimal places to defeat the `0.5 - 0.01 = 0.48999…` float-drift.
- **Decay-in-place vs. archive branching**: rows whose post-decay confidence is `>= floor` are decayed in place via `repository.save(segment)` (mutating `metadata_json.confidence` only); rows whose post-decay confidence would fall `below floor` are archived via `repository.update(id, { archived_at: now })` with no further confidence mutation. Zero-confidence rows are pinned at 0 (never negative) and still archived because `0 < 0.2 floor`.
- **Settings resolution**: the reaper resolves `enabled / graceDays / dailyRate / floor` fresh from `SystemSettingsService` on every pass through helper functions `coerceEnabled / coerceGraceDays / coerceDailyRate / coerceFloor` (all exported for direct unit-test access). Each helper defensively rejects malformed values (NaN, out-of-range, non-numeric strings, negative numbers) and falls back to the hardcoded default.
- **Repository contract**: `MemorySegmentRepository.findDecayCandidates({ exemptSources, graceCutoff })` returns the SQL-filtered candidate set, using `COALESCE(GREATEST(last_accessed_at, last_reinforced_at), last_accessed_at, last_reinforced_at) < :graceCutoff` to handle the partial-`NULL` cases consistently with the reaper's in-process `effectiveTouch(segment)` helper.
- **Read-path reinforcement half**: `MemorySegmentRepository.touchReinforcedAt(ids)` bumps `last_reinforced_at` to `new Date()` on every read so frequently-consumed segments stay "fresh" against the composite last-touch anchor. The implementation explicitly skips `archived_at IS NOT NULL` rows for defensive reasons and is fire-and-forget by contract.
- **Metrics**: `MemoryMetricsService.setMemoryDecayLastRun(value)` updates the snapshot timestamp on every pass (including pass-throughs — "the reaper was awake"); `MetricsService.recordMemoryDecayRun(evaluated, archived)` increments the prom-client counters only on rows actually evaluated (kill-switch pass does NOT increment).
- **Settings seeding**: `SystemSettingsService.seedDefaults()` registers all five `memory_decay_*` keys with full descriptions and hardcoded fallbacks; `isUserMutable(...)` includes all five keys in the allowlist so operator UI changes are honored without restart.
- **Migration**: `20260623000000-add-memory-segment-decay-columns` adds the `last_reinforced_at` `timestamptz` column (backfilled to `NOW()` for existing rows) and supporting b-tree indexes for the active-set / last-reinforced-at scans. The migration is registered in `apps/api/src/database/migrations/registered-migrations.ts`.

## Health Findings

- **Test coverage is well above the work-item contract**: 11 unit-test scenarios vs. the documented ≥6, and the integration suite asserts the literal "10 segments / 3 sources / 4 archived / 6 retained" contract end-to-end through a hand-rolled in-memory repository that mirrors the production SQL filter. Test style matches the existing `memory-eviction.reaper.*` files (deterministic `NOW` clock, fixed `MS_PER_DAY` anchor, hand-rolled fake services for `SystemSettingsService` / `MemoryMetricsService` / `MetricsService`).
- **Defensive belt-and-suspenders**: the reaper's `evaluateCandidate(...)` re-checks exempt sources after the repository returns its candidates, defending against a weakened repository contract; the repository's `findDecayCandidates(...)` is the canonical defense (`WHERE source NOT IN (...)` + `archived_at IS NULL`).
- **Idempotency**: the integration suite explicitly covers a second-run-on-the-same-DB scenario and pins the no-double-archive invariant (`archived` stays at 4 across both runs; the 6 retained rows are decayed to `0.5 - 0.01*30 = 0.2` on the second pass — right at the floor).
- **Per-row error containment**: the reaper wraps both archive and decay-in-place updates in try/catch and logs on failure rather than aborting the pass, matching the documented "a transient DB blip will lose that row's contribution to the run but not the rest of the batch" contract.
- **No lint suppression in the assigned files**: the assigned files do not introduce any `eslint-disable` / `@ts-ignore` / `@ts-nocheck` comments (confirmed via grep).
- **Module wiring is consistent**: `MemoryDecayReaperService` is registered in both the `providers` and `exports` arrays of `MemoryModule`, and the `MEMORY_DECAY_QUEUE` is registered via `BullModule.registerQueue({ name: MEMORY_DECAY_QUEUE })` in the module's `imports`.
- **Float-drift guarded**: the spec's documented `0.5 - 0.01 = 0.48999…` regression is explicitly pinned by a unit test on the exported `applyDecay(...)` helper, which applies `Math.floor((raw * 100)) / 100` rounding.

## Open Questions

- ~~**BullMQ consumer (worker) for the `memory-decay` queue** (R105): the reaper service registers a repeatable job on `MEMORY_DECAY_QUEUE` with the name `MEMORY_DECAY_JOB_NAME` via `OnApplicationBootstrap → scheduleDecayJob()`, but a grep across `apps/api/src` finds **no `@Processor('memory-decay')` (or equivalent) consumer** registered to invoke `runDecayPass()` when the cron tick fires. Compare this with the eviction reaper, which has a dedicated `memory-eviction.processor.ts` with a `@Processor(MEMORY_EVICTION_QUEUE)` decorator. The reaper service's own docstring describes `runDecayPass()` as "the test-friendly seam: it is a pure method that can be invoked from a BullMQ processor, an admin trigger handler, or a unit test" — so the missing processor may be deferred to a follow-up milestone (the constants file's docstring even mentions "The BullMQ scheduler milestone will add a processor on this queue."). At runtime today, the cron-registered job would sit in the queue without a consumer; operators would need to invoke `runDecayPass()` manually (e.g., via an admin endpoint) for the reaper to actually run. **Recommendation**: confirm whether the BullMQ processor is intentionally deferred to a follow-up work item or whether it is a gap that needs to be filed.~~  **Resolved by [WI-2026-052](docs/work-items/WI-2026-052-memory-decay-bullmq-consumer.md)** (work item id `1cb060cc-3d71-4d92-b894-9d5c430c2af4`). The new `apps/api/src/memory/memory-decay.processor.ts` adds a `MemoryDecayProcessor` decorated with `@Processor(MEMORY_DECAY_QUEUE)` / `@Process(MEMORY_DECAY_JOB_NAME)` that delegates each cron-tick invocation to `MemoryDecayReaperService.runDecayPass()` and rethrows on failure so BullMQ retry/backoff applies. The processor is registered alongside `MemoryDecayReaperService` in `MemoryModule.providers`, completing the runtime cron-tick path that the 31st-pass probe flagged as missing. The remaining R106/R107/R108/R111 followups for the sibling `memory-token-budget-resolver` scope are unaffected by this resolution.
- **Settings runtime mutation flow**: the constants file and `SystemSettingsService` describe an "operator updates the cron expression" → "next bootstrap re-reads the value" flow, but the reaper service does not currently subscribe to settings-change events to re-register the repeatable job mid-process. A cron change today would only take effect after the next application restart. This matches the eviction reaper's behavior, but is worth flagging if "live cron update without restart" is a desired capability.
- **Decay-in-place path type ergonomics**: the reaper documents that `QueryDeepPartialEntity<MemorySegment>` does not accept a `Record<string, unknown>` shape for `metadata_json` (because of how the partial-entity helper unwraps nested objects) and works around this by mutating the loaded entity and calling `repository.save(segment)`. This is correct for the current schema but creates a hidden dependency on TypeORM's reflection metadata shape — a future migration that introduces stricter typed columns on `metadata_json` could surface the same friction elsewhere.
