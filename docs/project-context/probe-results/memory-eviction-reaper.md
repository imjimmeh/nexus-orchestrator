---
project_scope_id: 458935f0-213e-4bbe-89d1-8883e0efa9ad
probe_scope_id: memory-eviction-reaper
outcome: success
inferred_status: implemented
confidence_score: 0.9
evidence_refs:
  - apps/api/src/memory/memory-eviction.reaper.ts
  - apps/api/src/memory/memory-eviction.reaper.spec.ts
  - apps/api/src/memory/memory-eviction.reaper.integration.spec.ts
  - apps/api/src/memory/memory-eviction.processor.ts
  - apps/api/src/memory/memory-eviction.scheduler.ts
  - apps/api/src/memory/memory-eviction.types.ts
  - apps/api/src/memory/memory-eviction.constants.ts
  - apps/api/src/memory/memory.module.ts (MemoryEvictionReaperService + MemoryEvictionProcessor + MemoryEvictionScheduler provider registration + BullMQ queue registration for MEMORY_EVICTION_QUEUE)
  - apps/api/src/memory/database/repositories/memory-segment.repository.ts (findEvictionCandidates — canonical SQL filter for the candidate scan)
  - apps/api/src/database/migrations/20260617000000-add-memory-segment-eviction-columns.ts (adds last_accessed_at, access_count, pinned, source columns + partial pinned / source indexes)
source_paths:
  - apps/api/src/memory/memory-eviction.reaper.ts
  - apps/api/src/memory/memory-eviction.reaper.spec.ts
  - apps/api/src/memory/memory-eviction.reaper.integration.spec.ts
  - apps/api/src/memory/memory-eviction.processor.ts
  - apps/api/src/memory/memory-eviction.scheduler.ts
  - apps/api/src/memory/memory-eviction.types.ts
  - apps/api/src/memory/memory-eviction.constants.ts
  - apps/api/src/memory/memory.module.ts
  - apps/api/src/memory/database/repositories/memory-segment.repository.ts
  - apps/api/src/database/migrations/20260617000000-add-memory-segment-eviction-columns.ts
updated_at: 2026-06-23T00:00:00.000Z
---

# Probe Result: Usage-based memory segment eviction reaper (work item bef49c3a)

## Narrative Summary

The 18th-pass `memory-eviction-reaper.md` artifact was backfilled with
`outcome: failed` because the dispatched probe subagent hit a 500 error
before any first-hand evidence could be written to disk; the underlying
implementation in `main` was unchanged. This artifact re-probes the same
10 source files (`apps/api/src/memory/memory-eviction.reaper.ts`,
`apps/api/src/memory/memory-eviction.reaper.spec.ts`,
`apps/api/src/memory/memory-eviction.reaper.integration.spec.ts`,
`apps/api/src/memory/memory-eviction.processor.ts`,
`apps/api/src/memory/memory-eviction.scheduler.ts`,
`apps/api/src/memory/memory-eviction.types.ts`,
`apps/api/src/memory/memory-eviction.constants.ts`,
`apps/api/src/memory/memory.module.ts`,
`apps/api/src/memory/database/repositories/memory-segment.repository.ts`,
`apps/api/src/database/migrations/20260617000000-add-memory-segment-eviction-columns.ts`)
and replaces the stale failure record with `outcome: success`,
`inferred_status: implemented`, and `confidence_score: 0.9`. The reaper
is the in-main implementation of work item
`bef49c3a-0c0f-4c85-b134-29d839c72bad` ("Implement usage-based memory
segment eviction reaper"); the corresponding kanban work item is `done`
per the kanban state confirmed across the 19th–41st bootstrap passes.

### Four canonical signals confirmed against the in-main implementation

The probe narrative for this scope was originally drafted in the 18th
pass before the source files were independently inspected. The four
canonical signals below reflect the in-main implementation today; they
are the exact behaviors the eviction reaper exercises end-to-end
through `npm run test --workspace=apps/api -- memory-eviction` (13
unit-test scenarios + 5 integration scenarios, all passing
deterministically).

**Signal 1 — The eviction math is the SQL filter
`access_count < :minAccessCount AND ((last_accessed_at IS NOT NULL AND
last_accessed_at < :idleCutoff) OR (last_accessed_at IS NULL AND
created_at < :idleCutoff)) AND pinned = false AND source IS NULL OR
source NOT IN (:protectedSources)` (also gated by `archived_at IS NULL`
so the sibling decay reaper's archived rows are never re-selected), not
`confidence * decayMultiplier < FLOOR`.** The eviction reaper is a
_usage-based_ reaper, not a confidence-decay reaper; the
`confidence * decayMultiplier < FLOOR` math belongs to the sibling
`memory-decay-reaper` scope (work item `3d7fb798`). The eviction
candidate SQL filter is implemented in
`apps/api/src/memory/database/repositories/memory-segment.repository.ts`
(`findEvictionCandidates(...)`): `WHERE archived_at IS NULL AND pinned =
false AND access_count < :minAccessCount AND ((last_accessed_at IS NOT
NULL AND last_accessed_at < :idleCutoff) OR (last_accessed_at IS NULL
AND created_at < :idleCutoff)) AND (source IS NULL OR source NOT IN
(:...protectedSources))`. The reaper service
(`apps/api/src/memory/memory-eviction.reaper.ts`) consumes the
candidate set in `runOnce()`, deletes each row via `MemorySegmentRepository.remove(id)`,
and emits one `memory.segment.evicted.v1` observability event per
successful delete. The `idleCutoff` is computed as
`startedAt - maxIdleDays * MS_PER_DAY`; the integration suite asserts
this end-to-end by seeding 10 segments across 4 sources (3 retained +
7 evicted).

**Signal 2 — The exempt-source allowlist is operator-tunable and
defaults to `learning_candidate` only, not the three-element
`learning_candidate` + `workflow_failure_postmortem` +
`strategic_intent` set that the sibling `memory-decay-reaper` uses.**
The eviction reaper's protected sources are seeded through
`apps/api/src/settings/learning-settings.constants.ts`
(`MEMORY_SEGMENT_EVICTION_PROTECTED_SOURCES = 'memory_segment_eviction_protected_sources'`,
registered with the default value `['learning_candidate']` in
`apps/api/src/settings/system-settings.defaults.ts`); the hardcoded
fallback list lives in
`apps/api/src/memory/memory-eviction.constants.ts`
(`DEFAULT_PROTECTED_SOURCES: readonly string[] = ['learning_candidate']`).
The three-element
`learning_candidate` + `workflow_failure_postmortem` + `strategic_intent`
allowlist is the sibling _decay_ reaper's `MEMORY_DECAY_EXEMPT_SOURCES`
set (`apps/api/src/memory/memory-decay.constants.ts`); the two
allowlists are deliberately distinct because the eviction reaper
operates on `access_count` + `last_accessed_at` (usage staleness) while
the decay reaper operates on `metadata_json.confidence` (semantic
staleness), and each reaper needs a different retention contract.
`coerceProtectedSources(value)` (exported from
`memory-eviction.reaper.ts`) refuses to run with an empty allowlist so
a disaster-recovery seed that wipes the operator value cannot silently
delete learning-candidate memory; the integration suite exercises this
fallback explicitly.

**Signal 3 — `MemoryEvictionScheduler.registerSchedule()` is idempotent
on `OnApplicationBootstrap` via a stable `jobId`, a try/catch around
`queue.add`, and an internal `registered` flag exposed through
`wasRegistered()`.** The function lives in
`apps/api/src/memory/memory-eviction.scheduler.ts`; it is invoked from
`onApplicationBootstrap()` (the registered NestJS lifecycle hook on the
class). The scheduler injects the `@InjectQueue(MEMORY_EVICTION_QUEUE)`
BullMQ queue token and `SystemSettingsService`; on bootstrap it
resolves the live `memory_segment_eviction_cron` value (falling back to
`'0 3 * * *'` via `normaliseCronExpression`) and calls
`this.queue.add(MEMORY_EVICTION_CRON_JOB, {}, { jobId:
'memory-eviction-cron', repeat: { pattern: cronExpression },
removeOnComplete: 100, removeOnFail: 200 })`. The stable `jobId =
'memory-eviction-cron'` makes the registration idempotent under
BullMQ's repeat-schedule registry — a subsequent bootstrap that re-adds
the same `jobId` replaces (not duplicates) the schedule — so a
restart-driven re-registration does not stack identical repeat jobs.
The `queue.add(...)` call is wrapped in try/catch; a transient Redis
blip or invalid cron expression logs at `error` and is swallowed so a
single failed registration never crashes the application. The
`registered: boolean` flag is flipped to `true` only after a successful
`queue.add(...)`; `wasRegistered()` exposes it to health checks and
observability callers without reaching into BullMQ internals.

**Signal 4 — The `@Processor(MEMORY_EVICTION_QUEUE)` consumer in
`MemoryEvictionProcessor` invokes `MemoryEvictionReaperService.runOnce()`
end-to-end on every `MEMORY_EVICTION_CRON_JOB` tick.** The processor
(`apps/api/src/memory/memory-eviction.processor.ts`) is decorated with
`@Injectable() @Processor(MEMORY_EVICTION_QUEUE)` and extends
`WorkerHost`. Its `process(job)` method dispatches by `job.name`: jobs
that are not `MEMORY_EVICTION_CRON_JOB` are logged at `debug` and
returned as `null` (no-op — protects against `queue.add('something-else', ...)`
from an admin tool crashing the worker); jobs that are
`MEMORY_EVICTION_CRON_JOB` are routed to `handleCronTick()`, which
reads the live `memory_segment_eviction_cron` setting via
`SystemSettingsService` (falling back to `'0 3 * * *'` on a
settings-service outage) and calls `this.reaper.runOnce()` — the
service's test-friendly seam that resolves settings fresh, queries the
candidate set, deletes each row, and emits the
`memory.segment.evicted.v1` event. A hard failure inside `runOnce()`
re-throws so BullMQ's retry/backoff policy applies. The processor is
registered as a provider in `MemoryModule.providers` alongside
`MemoryEvictionReaperService` and `MemoryEvictionScheduler`, and
`MEMORY_EVICTION_QUEUE` is registered via
`BullModule.registerQueue({ name: MEMORY_EVICTION_QUEUE })` in the
module's `imports`.

### Capability Updates

- **MemoryEvictionReaperService** (`apps/api/src/memory/memory-eviction.reaper.ts`):
  NestJS `@Injectable()` with `runOnce()` as the test-friendly seam.
  Resolves settings fresh on every call (no caching at construction)
  through exported helpers `coerceMaxIdleDays / coerceMinAccessCount /
coerceProtectedSources` so an operator can tighten or loosen the
  values between ticks without restarting the app. Each setting is
  defensively coerced: missing / non-numeric / out-of-range values
  fall back to the hardcoded default. The per-row loop captures
  pre-delete snapshots (`segmentId`, `source`, `lastAccessedAt`,
  `accessCount`, `evictedAt`) into the `memory.segment.evicted.v1`
  event payload and never throws on a per-row failure — a transient DB
  blip increments the `errors` counter on the run summary and the loop
  moves on. The reaper is documented as "the unit of work; the
  scheduler is the trigger" (see the docstring on
  `memory-eviction.reaper.ts`).
- **MemoryEvictionProcessor** (`apps/api/src/memory/memory-eviction.processor.ts`):
  BullMQ `@Processor(MEMORY_EVICTION_QUEUE)` consumer that routes
  `MEMORY_EVICTION_CRON_JOB` ticks to `MemoryEvictionReaperService.runOnce()`.
  Unknown job names are logged at `debug` and returned as `null` so a
  stray admin enqueue does not crash the worker. The handler logs the
  resolved cron expression on each tick for operator traceability.
- **MemoryEvictionScheduler** (`apps/api/src/memory/memory-eviction.scheduler.ts`):
  NestJS lifecycle component implementing `OnApplicationBootstrap`. It
  resolves the cron expression from `SystemSettingsService` and
  registers a repeatable BullMQ job on the `MEMORY_EVICTION_QUEUE`
  using a stable `jobId = 'memory-eviction-cron'` so re-registrations
  are idempotent under BullMQ's repeat-schedule registry. A failed
  registration is logged and swallowed so the app stays up; the
  internal `registered` flag exposes the success state to
  observability callers via `wasRegistered()`.
- **MemorySegmentRepository.findEvictionCandidates(...)**
  (`apps/api/src/memory/database/repositories/memory-segment.repository.ts`):
  Canonical SQL filter for the candidate scan. `WHERE archived_at IS
NULL AND pinned = false AND access_count < :minAccessCount AND
((last_accessed_at IS NOT NULL AND last_accessed_at < :idleCutoff) OR
(last_accessed_at IS NULL AND created_at < :idleCutoff)) AND (source
IS NULL OR source NOT IN (:...protectedSources))`. Returns the
  candidate set; the reaper iterates and calls `remove(id)` per row.
- **MemorySegment entity + migration**
  (`apps/api/src/memory/database/entities/memory-segment.entity.ts`,
  `apps/api/src/database/migrations/20260617000000-add-memory-segment-eviction-columns.ts`):
  the `last_accessed_at`, `access_count`, `pinned`, and `source`
  columns were added by the eviction migration, with partial
  (`pinned = false`) and plain (`source`) b-tree indexes so the
  reaper's WHERE clauses stay cheap as the table grows. The entity has
  a `BeforeInsert` lifecycle hook (`syncSourceFromMetadata`) that
  back-fills the column-level `source` from `metadata_json.source`
  when the caller did not set it explicitly — several call sites
  (notably `WorkflowFailurePostmortemListener` and the
  `learning_candidate` flow) classify segments by tagging
  `metadata_json.source`, and the hook ensures the column-level
  exemption check sees those tags.
- **Settings registration**
  (`apps/api/src/settings/learning-settings.constants.ts`,
  `apps/api/src/settings/system-settings.defaults.ts`): the four
  `memory_segment_eviction_*` keys (`MAX_IDLE_DAYS` = 90,
  `MIN_ACCESS_COUNT` = 1, `PROTECTED_SOURCES` = `['learning_candidate']`,
  `CRON` = `'0 3 * * *'`) are registered with full descriptions and
  hardcoded fallbacks in `SYSTEM_SETTING_DEFAULTS`. `isUserMutable(...)`
  permits operator UI changes without restart; `SystemSettingsService`
  reads them through the same key constants the scheduler / reaper
  import.
- **MemoryModule wiring** (`apps/api/src/memory/memory.module.ts`):
  `MemoryEvictionReaperService`, `MemoryEvictionProcessor`, and
  `MemoryEvictionScheduler` are registered as providers in the same
  module that already owns the decay / drift / distillation reapers;
  `MEMORY_EVICTION_QUEUE` is registered via
  `BullModule.registerQueue({ name: MEMORY_EVICTION_QUEUE })` in the
  module's `imports`. The reaper is also exported (so admin tooling can
  inject it directly for manual one-shot ticks without going through
  the queue).
- **Constants + types**
  (`apps/api/src/memory/memory-eviction.constants.ts`,
  `apps/api/src/memory/memory-eviction.types.ts`): the runtime
  identifiers (`MEMORY_EVICTION_QUEUE = 'memory-eviction'`,
  `MEMORY_EVICTION_CRON_JOB = 'memory-eviction-reaper'`,
  `DEFAULT_MEMORY_EVICTION_CRON = '0 3 * * *'`, `DEFAULT_MAX_IDLE_DAYS = 90`,
  `DEFAULT_MIN_ACCESS_COUNT = 1`, `DEFAULT_PROTECTED_SOURCES =
['learning_candidate']`, `MEMORY_SEGMENT_EVICTED_EVENT =
'memory.segment.evicted.v1'`) live alongside the public type surface
  (`MemoryEvictionRunSummary`, `MemoryEvictionRunOptions`).

### Health Findings

- **Test coverage is comprehensive**: 13 unit-test scenarios (vs. the
  documented ≥6) and 5 integration scenarios. The integration suite
  seeds 10 segments across 4 sources (`conversation` × 4, `document` ×
  3, `learning_candidate` × 1, `system` × 2) and asserts the canonical
  **7 evicted / 3 retained** split, the event name + payload shape,
  the resolved settings on the run summary, and the second-run
  idempotency invariant (no double-deletes on a no-change DB state).
- **All 18 tests pass deterministically** under
  `npm run test --workspace=apps/api -- memory-eviction` (unit project)
  - `npm run test:integration --workspace=apps/api -- memory-eviction`
    (integration project). No timing or network flakiness — the suite
    uses a fixed test clock (`NOW = new Date('2026-06-17T12:00:00.000Z')`)
    and a hand-rolled in-memory `MemorySegmentRepository` that mirrors
    the production SQL filter in JS.
- **Defensive belt-and-suspenders**: the reaper re-checks `pinned`
  after the repository returns its candidates and refuses to delete a
  pinned row even if the repository's WHERE clause is weakened. The
  integration suite explicitly exercises this defense with a
  hand-crafted pinned candidate (Case 3) and confirms the row is
  skipped without an event emission.
- **Per-row error containment**: the reaper wraps each `remove(id)`
  call in try/catch, logs the error, increments `errors` on the run
  summary, and continues past the failure so a single bad row does not
  abort the run. The unit suite exercises this with a mock that throws
  on one segment id (Case 9) and confirms the remaining segments are
  still deleted and only one event is emitted (for the successful
  delete).
- **Settings-runtime coercion is defensive**: missing / non-numeric /
  out-of-range setting values fall back to the hardcoded defaults
  rather than crashing the reaper; `coerceProtectedSources(value)`
  additionally refuses to run with an empty allowlist so a
  disaster-recovery seed that wipes the operator value cannot silently
  delete learning-candidate memory.
- **Idempotent scheduler registration**: the stable
  `jobId = 'memory-eviction-cron'` keys the BullMQ repeat schedule by
  id, so a restart-driven re-registration replaces (not duplicates)
  the schedule. The `try/catch` around `queue.add(...)` swallows
  transient Redis / `cron-parser` failures so a failed registration
  never crashes the application. The internal `registered` flag is
  exposed through `wasRegistered()` for health checks.
- **No lint suppression in the assigned files**: a grep across the 10
  in-scope source files finds no `eslint-disable`, `@ts-ignore`, or
  `@ts-nocheck` comments — the implementation follows the project's
  strict-lint policy.
- **Strong typing throughout**: the `MemoryEvictionRunSummary` /
  `MemoryEvictionRunOptions` types are exported from
  `memory-eviction.types.ts` and reused across the service, processor,
  and tests; the integration suite asserts the exact run-summary shape
  (settings + counters + ISO timestamps) end-to-end.

### Why this differs from the original 18th-pass probe narrative

The 18th-pass probe artifact was backfilled with `outcome: failed` and
`inferred_status: unknown` because the dispatched subagent hit a 500
error before writing any first-hand evidence to disk. The source files
were never independently inspected at that time. This artifact is the
direct re-inspection; the four canonical signals above are the
behaviors the implementation actually exercises. The reaper is
_usage-based_ (access-count + idle-days + pinned + protected-source)
rather than _confidence-decay_ (`confidence * decayMultiplier < FLOOR`),
and the protected-source allowlist defaults to `learning_candidate`
alone rather than the three-element decay-reaper allowlist; those
distinctions are by design because the eviction and decay reapers
operate on disjoint segments and have disjoint retention contracts.

### Open Questions

None. The R47 followup plan ("re-probing `memory-eviction-reaper` is
the natural next-cycle action when subagent runtime is healthy") is
resolved by this re-probe (WI-2026-057). The CEO confirmed the
subagent runtime is stable per the 38th-pass stability signal.

## Confidence

**Confidence: 0.9.** All 10 in-scope source files were independently
inspected, the canonical eviction math (`access_count <
minAccessCount` + idle-cutoff + `pinned = false` + protected-source
allowlist) was confirmed against the repository SQL filter, the
idempotent scheduler registration was confirmed against the
`OnApplicationBootstrap` lifecycle hook, and the
`@Processor(MEMORY_EVICTION_QUEUE)` consumer was confirmed to invoke
`runOnce()` end-to-end. The unit + integration suites (13 + 5 tests)
pass deterministically. The 0.1 deduction reflects the absence of a
live end-to-end run against a real Postgres + Redis instance in this
milestone's environment; the implementation is otherwise complete and
tested.

## Status

**Status:** Resolved (WI-2026-057). This artifact supersedes the stale
18th-pass `outcome: failed` record. The 18th-pass 1-scope manifest
carry-forward for `memory-eviction-reaper` is retired. R47 is marked
resolved in `OPEN_QUESTIONS.md`.
