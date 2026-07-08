# ADR: Split `MemorySegmentRepository` into 8 per-intent repositories

**Status:** Accepted
**Date:** 2026-07-02
**Work item:** b8c754af-9037-45fb-91ed-278752284b0f
**Owner:** refactor-executor
**Module:** `apps/api/src/memory/database/`
**Related docs:** `docs/work-items/b8c754af-9037-45fb-91ed-278752284b0f.md`, `docs/architecture/memory-management.md`

> Status line (literal): `Status: Accepted`

## Context

`MemorySegmentRepository` (apps/api/src/memory/database/repositories/memory-segment.repository.ts)
was a **829-LOC** TypeORM repository exposing **21 public methods** across **8
distinct query intents**: CRUD, Search, Learning-Candidate, Postmortem, Decay,
Eviction, Drift, Aggregation. The Drift bucket contained the dead
`findDriftCandidates` — a documented public contract with no caller, preserved
only because callers in flight depended on its type signature.

The file was in active **EPIC-212 phase-3 development** (12-commit burst in the
month preceding this refactor, with at least one schema-touching migration in
flight). The blast radius of any future schema change was therefore the entire
829-LOC file: any unrelated-intent edit had to compile against all 21 methods
simultaneously, and any partial extraction without a clean seam would either
re-double the surface (facade) or leave co-located intents muddling concerns
(partial split).

The repository was injected as a single dependency by **14 consumer services**
across the memory subsystem: `MemoryManagerService`,
`MemorySegmentFeedbackService`, `MemoryDecayReaperService`,
`MemoryEvictionReaperService`, `MemoryMetricsRefreshService`, the
`embedding-write` consumer, the `feedback-weight-tuner` and `memory-retrieval`
signals services, the three `learning/*` services (`learning-promotion`,
`memory-probation-evaluator`, `memory-contradiction`), `PostgresMemoryBackendService`,
and the two `workflow-repair/workflow-failure-postmortem*` services. Each was
coupled to the **full surface** even though most consumed only 2–4 methods;
constructor mocks had to stub all 21 methods regardless of whether the test
exercised them, masking intent and inflating fixture noise.

The soft-archive contract (read methods default to hiding segments whose
`archived_at IS NOT NULL`) was enforced by a private `buildWhere` helper that
merged `archived_at: IsNull()` into the input `where` clause. This helper was
the natural seam to extract as a shared module: every per-intent read method
would need it, and centralising it would make it impossible to forget the
filter on a new method.

## Decision

Hard-split the 829-LOC repository into **8 per-intent `@Injectable()` repository
classes** via a strangler pattern:

1. **Extract the seam first.** `buildReadWhere` is extracted to
   `apps/api/src/memory/database/repositories/memory-segment.repository.helpers.ts`
   as the single source of truth for the soft-archive contract. The helper
   accepts a base `FindOptionsWhere<MemorySegment>` and an `includeArchived`
   flag, and returns a merged `where` object for `find({ where })`. The
   companion spec pins the merge semantics across include/exclude, undefined
   base, and pre-set `archived_at` overrides.
2. **Create 8 per-intent repositories** at
   `apps/api/src/memory/database/repositories/memory-segment.<intent>.repository.ts`:
   `crud`, `search`, `learning-candidate`, `postmortem`, `decay`, `eviction`,
   `drift`, `aggregation`. Per-file specifics worth pinning:
   - **`search`** — `Like('%query%')` for content, JSONB-projection for
     metadata/provenance.
   - **`postmortem`** — `source: 'workflow_failure_postmortem'` constant is
     centralised at the top of the file so the writer's source constraint is
     type-pinned.
   - **`eviction`** — protected-sources allowlist (`learning_candidate`,
     `workflow_failure_postmortem`, `strategic_intent`) is a module-level
     constant set; eviction logic cannot silently drift in one repo and not
     the other.
   - **`aggregation`** — `aggregateCountsByScope` casts Postgres bigint → JS
     number with the cast semantics documented at the call site.
   - **`drift`** — the previously-dead `findDriftCandidates` is preserved
     verbatim so a follow-up work item can migrate
     `MemoryDriftDetectionService` off its direct
     `Repository<MemorySegment>` injection onto this typed seam.
3. **Migrate all 14 consumer services** to per-intent `@InjectRepository`
   injections (each consumer declares only the repositories it actually uses).
4. **Wire the 8 new providers in `MemoryModule.providers`** (not
   `DatabaseModule.repositories` — see Consequences §M2 deviation).
5. **Delete the original `memory-segment.repository.ts` (829 LOC) +
   `memory-segment.repository.spec.ts` (768 LOC)** once all consumers
   migrated. The companion `repositories/index.ts` re-exports the 8 per-intent
   classes verbatim.
6. **Close the 17-case coverage gap** with per-intent spec files — each pins a
   branch the original monolith-spec could not reach (eviction
   protected-sources, aggregation bigint cast, postmortem source constant,
   search `Like('%query%')` shape, drift SQL).

## Alternatives

### Option 1 — Facade pattern

Keep `MemorySegmentRepository` and split it into 8 sub-repositories, each
injected on a thin facade that re-exports all 21 methods by interface
grouping. Rejected because: (1) it does not reduce the 829-LOC surface — the
facade still exposes 21 methods and the sub-repositories still hold 21 bodies;
the blast radius of a schema change is unchanged; (2) double indirection at
every call site (`this.facade.search.searchByContent(...)`) grows call-site
verbosity and inflates test mocks; (3) no seam extraction — `buildReadWhere`
would still live in one sub-repo (search, most likely) but **every read
consumer** needs it.

### Option 2 — Partial split (CRUD vs Decay vs Eviction vs Aggregation)

A 4-way split grouping the most-active buckets; leave search,
learning-candidate, postmortem, drift co-located in a "rest" repository.
Rejected because: (1) the spec's caller map revealed 8 natural intent buckets,
not 4 — search, learning-candidate, and postmortem each have distinct SQL
shapes and distinct test seams; a 4-way split would have left them co-located
in the largest leftover; (2) co-location is exactly the failure mode this
refactor closes (decay and eviction share the reaper-cron relationship but
have different guards — `exempt_sources` vs `protected_sources` — cramming
them together re-creates the original drift surface in miniature); (3)
per-intent testability is the goal — partial splits force the per-intent
branches back into the monolith-spec.

## Consequences

### Per-intent testability

Each per-intent repo is independently testable in a focused file. The new
specs pin: CRUD finder semantics + soft-archive pass-through for writes +
count-by-scope bigint semantics (`crud`); `Like('%query%')` shape +
JSONB-projection on metadata/provenance (`search`); learning-candidate finder
+ promote-writer (`learning-candidate`); failure-postmortem finder + writer's
source constant (`postmortem`); decay candidate scan + `markDecayed` writer
(`decay`); eviction protected-sources allowlist branch (`eviction`);
`findDriftCandidates` SQL regression net (`drift`); bigint → number cast in
`aggregateCountsByScope` (`aggregation`).

### Soft-archive contract preserved by single helper

`buildReadWhere` in `memory-segment.repository.helpers.ts` is the single
source of truth. A future per-intent read method calls
`buildReadWhere(where, includeArchived)`; a method that explicitly needs
archived rows passes `includeArchived: true`. The `IsNull()` output is
index-eligible with `idx_memory_segments_archived_at`.

### M2 deviation: provider wiring location

The 8 new providers are wired in **`apps/api/src/memory/memory.module.ts`**
(M2 deliverable), not in `apps/api/src/memory/database/database.module.ts`
as the spec originally specified. This works because `MemoryModule` imports
`DatabaseModule`, so the `getRepositoryToken(MemorySegment)` token propagates
through the DI graph (the token is registered in `DatabaseModule`'s
`TypeOrmModule.forFeature([MemorySegment])` and is therefore available to any
module that imports `DatabaseModule`). The original `MemorySegmentRepository`
was removed from `database.module.ts`'s `repositories` array in M4 as the
strangler final sweep. The decision to land the new providers in `MemoryModule`
keeps the DI import topology flat (one module — `MemoryModule` — knows about
the 8 per-intent classes; `DatabaseModule` continues to know only about the
`MemorySegment` entity and its `getRepositoryToken` registration), consistent
with the project's `repositories-own-persistence` quality gate.

### Pre-existing test debt explicitly out of scope

The 5 still-failed split-retries in `docs/project-context/CODEBASE_HEALTH.md`
(oauth-auth-provider, oauth-login-service, cost-governance-runtime,
war-room-lifecycle, war-room-collaboration) are in unrelated domains and do
not affect this work. The pre-existing `harness-asset.service.spec.ts`
failure (a package-resolution error in `@nexus/harness-runtime`, unrelated to
the memory segment repositories) is also out of scope.

### Test coverage increased

The 8 per-intent spec files plus the helpers spec add focused coverage for
behaviour the original monolith-spec could not reach. Total api test case
count increased by **17+ new gap-closing cases** plus the method-level
coverage pinned per-intent.

## Follow-up

A future work item must migrate `MemoryDriftDetectionService` off its direct
`Repository<MemorySegment>` injection to consume the new
`MemorySegmentDriftRepository.findDriftCandidates` method, closing the
dead-code gap. The migration is small in scope (one service, one repo) and is
left as a follow-up rather than folded into this refactor because the
drift-detection service is in a separate active workstream; folding the
migration in would have coupled two unrelated work items.

## Status

Status: Accepted. Owner: refactor-executor. The 8 per-intent repository classes (each with a per-intent spec file) and the `buildReadWhere` helper module (with a helpers spec) are in place as of M5. The 14 consumer services are migrated to per-intent injections. The original `MemorySegmentRepository` is deleted (strangler complete). The providers are wired in `MemoryModule.providers`. The 8-way split is the canonical form going forward, `buildReadWhere` is the single source of truth for the soft-archive contract, and `MemorySegmentDriftRepository.findDriftCandidates` is the future seam for the drift-detection service migration.

## References

- `apps/api/src/memory/database/repositories/memory-segment.{crud,search,learning-candidate,postmortem,decay,eviction,drift,aggregation}.repository.ts`
- `apps/api/src/memory/database/repositories/memory-segment.repository.helpers.ts` (the `buildReadWhere` seam)
- `apps/api/src/memory/memory.module.ts` (provider wiring)
- `docs/work-items/b8c754af-9037-45fb-91ed-278752284b0f.md` (the spec); `docs/architecture/memory-management.md`, `docs/project-context/CODEBASE_HEALTH.md`, `.github/instructions/api-quality-gate.instructions.md`
