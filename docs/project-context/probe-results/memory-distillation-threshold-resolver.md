---
project_scope_id: 458935f0-213e-4bbe-89d1-8883e0efa9ad
probe_scope_id: memory-distillation-threshold-resolver
outcome: success
inferred_status: implemented
confidence_score: 0.95
evidence_refs:
  - apps/api/src/memory/distillation-threshold.service.ts
  - apps/api/src/memory/distillation-threshold.types.ts
  - apps/api/src/memory/project-goal-override.types.ts
  - apps/api/src/memory/distillation-threshold.service.spec.ts
  - apps/api/src/memory/distillation-threshold.bullmq-integration.spec.ts
  - apps/api/src/memory/distillation.consumer.ts
  - apps/api/src/memory/memory.module.ts
  - apps/api/src/settings/distillation-threshold.constants.ts
  - apps/api/src/settings/system-settings.service.ts
  - apps/api/src/observability/autonomy-observability.types.ts
  - apps/api/src/session/session-hydration.service.ts
  - docs/project-context/CAPABILITY_MAP.md (8th-pass section)
source_paths:
  - apps/api/src/memory/distillation-threshold.service.ts
  - apps/api/src/memory/distillation-threshold.service.spec.ts
  - apps/api/src/memory/distillation-threshold.bullmq-integration.spec.ts
  - apps/api/src/memory/distillation-threshold.types.ts
  - apps/api/src/memory/project-goal-override.types.ts
  - apps/api/src/memory/distillation.consumer.ts
  - apps/api/src/memory/memory.module.ts
updated_at: 2026-06-16T16:30:00Z
---

# Probe Result: Configurable session distillation threshold resolver (3effbfa9 implementation)

## Narrative Summary

Work item 3effbfa9 ("Make session distillation trigger threshold configurable per project / system setting") is **fully implemented** across the assigned scope. The implementation introduces a new `DistillationThresholdService` (NestJS `@Injectable`) that walks a 4-step precedence chain on every call:

1. Per-resource SystemSetting — `memoryDistillationThreshold.${resourceId}` (`source: 'project-system-setting'`).
2. Global SystemSetting — `memoryDistillationThreshold.__global__` (`source: 'global-system-setting'`).
3. ProjectGoal override metadata — `ProjectGoal.metadata.memoryDistillationThreshold` surfaced via a swappable `IProjectGoalOverrideAccessor` DI token (`source: 'project-goal-metadata'`).
4. Hardcoded default — `MEMORY_DISTILLATION_THRESHOLD_DEFAULT = 0.8` (`source: 'default'`).

The 3-tier AC view (SystemSetting > ProjectGoal override metadata > global default) maps onto this 4-step walk as: {1, 2} > 3 > 4, as documented in the service JSDoc and `distillation-threshold.types.ts`.

The service is the **single source of truth** for the live threshold: it is called fresh on every `DistillationConsumer` tick (passing `sessionTreeId` as `resourceId`) and on every `SessionHydrationService.enqueueDistillationIfNeeded` call (also `sessionTreeId`). Both previously hardcoded 0.8 fallback paths in the call sites have been replaced with `thresholdService.resolve(...)`.

Change detection: the resolver caches the last `(value, source)` tuple, returns `changed: true` on drift, and emits a `MemorySettingChanged` event (`AUTONOMY_EVENT_NAMES.memorySettingChanged = 'memory.setting.changed.v1'`) to the `EventLedgerService` via `emitBestEffort` (failures are logged and swallowed so distillation scheduling cannot break on observability outages). First call has `changed: false` (baseline) — matches the `setAndEmit` semantics in `SystemSettingsService`.

## Capability Updates

- **New service:** `DistillationThresholdService` (apps/api/src/memory/distillation-threshold.service.ts) — registered in `MemoryModule.providers` and exported in `MemoryModule.exports`. `@Optional()` `EventLedgerService` injection preserves back-compat for tests.
- **New types module:** `distillation-threshold.types.ts` re-exports ProjectGoal types and defines `DistillationThresholdSource` (4-source union) and `DistillationThresholdResolution` (`value`, `source`, `changed`, `previousValue`, `previousSource`).
- **New bridge contract:** `project-goal-override.types.ts` defines the `PROJECT_GOAL_OVERRIDE_ACCESSOR` DI token, the `IProjectGoalOverrideAccessor` interface, the `ProjectGoalOverrideRecord` narrow shape (no upstream type import, respecting the api eslint boundary rule), and a `NoopProjectGoalOverrideAccessor` that always returns `null`. The noop accessor is bound as the default in `MemoryModule`; a followup bridge work item is expected to rebind the token to a real implementation that delegates to the upstream goal repository.
- **New constants:** `apps/api/src/settings/distillation-threshold.constants.ts` — `MEMORY_DISTILLATION_THRESHOLD_KEY_PREFIX` (`'memoryDistillationThreshold'`), `MEMORY_DISTILLATION_THRESHOLD_GLOBAL_KEY` (`'memoryDistillationThreshold.__global__'`), `MEMORY_DISTILLATION_THRESHOLD_DEFAULT` (0.8), `MEMORY_DISTILLATION_THRESHOLD_MIN` (0.1), `MEMORY_DISTILLATION_THRESHOLD_MAX` (0.95), `memoryDistillationThresholdKey(resourceId)` builder, and the non-throwing `coerceMemoryDistillationThreshold(value, fallback?)` helper. Mirrors the `rbac_enforcement_mode.__global__` shape and the `coerceEnforcementMode` / `sanitizeLimit` conventions.
- **SystemSetting wiring:** `SYSTEM_SETTING_DEFAULTS` in `system-settings.service.ts` includes `MEMORY_DISTILLATION_THRESHOLD_GLOBAL_KEY` with `value: 0.8` and a description that documents the per-resource override convention. `setAndEmit` (the audit hook) and `isMemorySetting` (the allowlist) both key off the `memoryDistillationThreshold*` prefix, so any `setAndEmit` call on these keys also emits `MemorySettingChanged` (complementary to the resolver's drift-detection event).
- **Consumer integration:** `DistillationConsumer` (apps/api/src/memory/distillation.consumer.ts) now takes `DistillationThresholdService` as a constructor dependency (line 40), calls `await this.thresholdService.resolve(sessionTreeId)` after decompressing nodes and before the threshold check (line 89-90), and forwards the resolved `(value, source)` to `tokenCounter.isOverThreshold(nodes, model, liveThreshold)`. A new "under live threshold" skip path (`recordThresholdSkip`) emits a `distillationCompleted` event with `outcome: 'denied'` and `reason: 'under_live_threshold'` so audit pipelines observe the no-op, plus a `'skipped'` metric. The legacy `threshold` / `thresholdSource` fields on the `DistillationJobData` interface are unused (replaced by the per-tick resolve), but retained on the interface for back-compat.
- **Session hydration integration:** `SessionHydrationService.enqueueDistillationIfNeeded` (apps/api/src/session/session-hydration.service.ts:245-301) now injects `DistillationThresholdService` and calls `await this.distillationThreshold.resolve(sessionTreeId)` — the previously-documented "still hardcodes 0.8" gap in the CAPABILITY_MAP backlog is now closed by this work item.
- **Module wiring:** `MemoryModule` registers `DistillationThresholdService` in both `providers` and `exports`, registers `NoopProjectGoalOverrideAccessor`, and binds `PROJECT_GOAL_OVERRIDE_ACCESSOR` to the noop via `useExisting` so the resolver gets a concrete implementation today and a real bridge can drop in via a single token rebind.

## Health Findings

- **Test coverage is strong.** `distillation-threshold.service.spec.ts` has 28 unit tests across 4 `describe` blocks: precedence chain (7 tests: per-resource, global, undefined per-resource, ProjectGoal, default, null/empty `resourceId`), per-tick change detection (6 tests: baseline, identical, value drift, source drift, no EventLedger back-compat, EventLedger failure tolerance), ProjectGoal override accessor (8 tests: resourceId forwarding, null record, missing field, null metadata, out-of-range coercion, non-numeric coercion, accessor throws, NoopProjectGoalOverrideAccessor), and `coerceMemoryDistillationThreshold` itself (7 tests: in-range, below min, above max, non-numeric, NaN/Infinity, null/undefined, non-finite fallback). `distillation-threshold.bullmq-integration.spec.ts` adds 3 co-located BullMQ integration tests wiring a real `DistillationThresholdService` into a real `DistillationConsumer` (SystemSetting-driven, hardcoded default fallback, value changes between ticks).
- **Consumer test updates.** `distillation.consumer.spec.ts` (apps/api/src/memory/distillation.consumer.spec.ts) adds a `threshold resolution integration` describe block with 4 tests that assert the resolver is called on every tick with `sessionTreeId` as the resourceId, that the resolved threshold flows into `isOverThreshold`, that the live-threshold skip path emits the right events/metrics, and that a ProjectGoal-override-sourced value (0.33) reaches the scheduling check. The existing consumer tests use a fake `thresholdService` (the `createThresholdService` helper at line 77), so the wiring is exercised end-to-end.
- **Code quality.** Excellent JSDoc on every public method, with the 3-tier/4-step mapping explicitly documented. The `tryCoerce` helper centralises the "missing vs invalid" distinction (undefined → null so the chain keeps walking; non-numeric / out-of-range → coerced default so a valid value is still returned). The `extractProjectGoalThreshold` free function handles the `null` record, `null` metadata, missing key, and coercion cases. The `detectChange` helper is pure and the `publishAndCache` flow is side-effect-bounded. The `EventLedger` injection is `@Optional()` so the service works without observability in unit tests. Best-effort `emitBestEffort` (rather than a thrown `emit`) is the right call for a non-blocking observability hook.
- **Churn.** All 5 implementation files in the scope carry a 2026-06-16 16:06 mtime — they landed together as part of the 3effbfa9 work item, matching the CAPABILITY_MAP 8th-pass delta-probe note (one new merge since 7th pass). No reverts or followup edits visible.
- **Wiring gap (intentional, documented).** The `NoopProjectGoalOverrideAccessor` is bound as the default for `PROJECT_GOAL_OVERRIDE_ACCESSOR`. This is an intentional, well-documented stub pending a followup bridge work item that will wire the upstream goal repository into the api DI graph. The JSDoc on `project-goal-override.types.ts` is explicit that the chain must be live code (not a TODO) and the noop accessor ensures the resolver still walks the chain in production today — operators who set a per-resource or global SystemSetting get the configurable behaviour they expect, and the ProjectGoal tier becomes live as soon as a real implementation is bound to the token.
- **Stale CAPABILITY_MAP note.** The 8th-pass "Item (d) 3effbfa9 backlog" bullet in `CAPABILITY_MAP.md` claims `SessionHydrationService.enqueueDistillationIfNeeded` still hardcodes `0.8`. This is now stale: the service injects `DistillationThresholdService` and calls `resolve(sessionTreeId)`. The `SYSTEM_SETTING_DEFAULTS` entry for `MEMORY_DISTILLATION_THRESHOLD_GLOBAL_KEY` also exists. The remaining piece of that bullet (`DISTILLATION_*` key in the canonical `SYSTEM_SETTING_DEFAULTS` table) is satisfied by the new `memoryDistillationThreshold.__global__` entry — naming is by design consistent with the `rbac_enforcement_mode.__global__` convention. The CAPABILITY_MAP item should be closed on the next pass.

## Open Questions

- **ProjectGoal bridge (separate work item).** A concrete `IProjectGoalOverrideAccessor` implementation that delegates to the upstream `ProjectGoal` repository has not landed in the `apps/api` workspace. The JSDoc on `project-goal-override.types.ts:78-80` states the bridge will "translate the resourceId to the upstream scope lookup" and that the sessionTreeId is the resourceId passed by `DistillationConsumer` and the workflowRunId will be the resourceId passed by `SessionHydrationService`. The 3-tier AC is fully satisfied at the resolver level; the 2nd tier (ProjectGoal override metadata) is reachable in code but the upstream source-of-truth is still the noop. This is explicitly scoped to a separate work item per the file's JSDoc, not a gap in 3effbfa9 itself.
- **DistillationJobData `threshold` / `thresholdSource` fields are unused.** The `DistillationJobData` interface in `distillation.consumer.ts:16-17` still carries `threshold?: number; thresholdSource?: string;` but the consumer no longer reads them — it resolves fresh on every tick. Whether to prune them or keep them for back-compat with producers that still set them is a followup cleanup question, not a correctness issue.
- **Resolver scope is process-wide.** `DistillationThresholdService` keeps `lastValue` and `lastSource` as instance state, so the change-detection cache is per-service-instance. With NestJS singleton scope this is one cache per process. In a multi-process deployment (BullMQ workers + API server) the per-process cache means each process will independently observe and emit `MemorySettingChanged` events for its first tick after a SystemSetting change. This is the documented intent (the resolver is the source of truth; the cache is just an optimisation to suppress redundant events), and the EventLedger events are deduplicated downstream by `(key, previousValue, newValue)` rather than by source, so it is operationally fine — but it is worth flagging in case the consumer of these events ever assumes single-emission semantics.
- **`SessionHydrationService` constructor parameter list grew.** Adding `DistillationThresholdService` to the constructor may have downstream test-fixture implications in `session-hydration.service.spec.ts` and the various `__tests__/agent-await.integration.spec.ts` / `step-required-tool-retry.service.spec.ts` / `workflow-await.module.spec.ts` / `subagent-*.spec.ts` style tests that provide `SessionHydrationService` directly via `useValue`. These are not in the assigned scope, but a quick `session-hydration.service.spec.ts` snippet already shows the test injects a mock `distillationThreshold` with `resolve: vi.fn().mockResolvedValue({ value: 0.8, source: 'default' })`, so the test surface has been kept current. Worth verifying the other downstream test suites compile cleanly during the next CI run.
