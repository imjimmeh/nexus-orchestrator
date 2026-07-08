import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, type Repository } from 'typeorm';
import { MemorySegment } from '../entities/memory-segment.entity';

/**
 * Read-path surface for the nightly `MemoryDecayReaper` (work item
 * 3d7fb798-f54d-40ff-a803-438224474912) and the read-path
 * reinforcement half of the decay loop. Mirrors the
 * `findDecayCandidates` and `touchReinforcedAt` methods on the
 * original `MemorySegmentRepository`.
 *
 * Both methods are query-builder / criteria-shaped and do not use
 * the `find({ where })` helper directly — `findDecayCandidates`
 * builds a query builder with explicit `archived_at IS NULL` and
 * allowlist / composite-filter clauses; `touchReinforcedAt` uses
 * TypeORM's `update({ ... })` criteria shape.
 */
@Injectable()
export class MemorySegmentDecayRepository {
  constructor(
    @InjectRepository(MemorySegment)
    private readonly repository: Repository<MemorySegment>,
  ) {}

  /**
   * Find memory segments that the nightly `MemoryDecayReaper`
   * (work item 3d7fb798-f54d-40ff-a803-438224474912) should
   * consider for confidence decay.
   *
   * The decay reaper's candidate set is intentionally distinct
   * from the eviction reaper's set:
   *   - the eviction reaper's WHERE clause is anchored on
   *     `pinned = false` and `access_count < :minAccessCount` —
   *     the decay reaper does NOT apply either filter (a pinned
   *     row can still decay, and the access count is a property
   *     the eviction reaper cares about for load-bearing
   *     detection that the decay reaper does not).
   *   - the decay reaper's "effective last touch" is
   *     `max(last_accessed_at, last_reinforced_at)`, so the
   *     time-anchored filter uses `GREATEST(...)` rather than
   *     `last_accessed_at < :cutoff` alone. A `NULL` argument to
   *     `GREATEST(...)` is treated as "no data" (the composite
   *     falls back to the non-null sibling), matching the
   *     reaper's in-process `effectiveTouch(segment)` helper.
   *   - the protected-source allowlist is
   *     `MEMORY_DECAY_EXEMPT_SOURCES` (the decay-specific set
   *     from `memory-decay.constants.ts`), NOT
   *     `MEMORY_SEGMENT_EVICTION_PROTECTED_SOURCES` (the
   *     eviction-specific allowlist from
   *     `learning-settings.constants.ts`).
   *
   * A row is a decay candidate when ALL of the following hold:
   *   - `archived_at IS NULL`                  (already-archived
   *     rows are never re-candidates)
   *   - `source IS NULL OR source NOT IN (:exemptSources)`
   *                                            (the decay-exempt
   *     allowlist)
   *   - `COALESCE(GREATEST(...), last_accessed_at, last_reinforced_at) < :graceCutoff`
   *                                            (the composite
   *     last-touch is older than `now - graceDays`; the
   *     `COALESCE` chain implements the "fall back to the
   *     non-null column" rule for partial-NULL rows; a brand-new
   *     row whose both columns are `NULL` is filtered out by the
   *     surrounding `IS NOT NULL` guard)
   *
   * The query does not perform any per-row update — the reaper
   * service iterates the candidate set and applies the
   * subtractive-decay math to each row in turn, catching per-row
   * errors so a single bad row does not abort the pass.
   */
  async findDecayCandidates(params: {
    exemptSources: readonly string[];
    graceCutoff: Date;
    treatDriftedAsEligible?: boolean;
  }): Promise<MemorySegment[]> {
    const { exemptSources, graceCutoff, treatDriftedAsEligible } = params;
    const cutoffIso = graceCutoff.toISOString();
    const exemptList = [...exemptSources];

    const query = this.repository
      .createQueryBuilder('segment')
      // Already-archived rows are excluded — the decay reaper
      // sets `archived_at` when a row's decayed confidence falls
      // below the configured floor. A second pass on the same
      // row would be a no-op at best, and a confusing
      // double-archive at worst. The partial index
      // `idx_memory_segments_archived_at` (added by the
      // `20260623000000-add-memory-segment-decay-columns`
      // migration) targets the active set so this WHERE clause
      // is index-friendly.
      .where('segment.archived_at IS NULL');

    if (exemptList.length > 0) {
      query.andWhere(
        '(segment.source IS NULL OR segment.source NOT IN (:...exemptSources))',
        { exemptSources: exemptList },
      );
    }

    // The composite last-touch filter — the same SQL pattern the
    // reaper's `effectiveTouch(segment)` helper implements in
    // code, lifted into the SQL surface so the candidate set is
    // bounded by the index. The surrounding
    // `IS NOT NULL` guard mirrors the reaper's
    // "no-data → skip" rule for brand-new rows that have not
    // been touched or reinforced yet.
    //
    // The `COALESCE(GREATEST(...), last_accessed_at,
    // last_reinforced_at)` pattern handles the `NULL` behaviour
    // of `GREATEST(...)` in PostgreSQL: the function returns
    // `NULL` if any argument is `NULL`, so a row whose
    // `last_reinforced_at` is `NULL` would otherwise drop out of
    // the candidate set (the `NULL < :graceCutoff` comparison is
    // `NULL` / falsy). The reaper's "fall back to the non-null
    // column" rule is encoded in the `COALESCE` chain: a row
    // with `last_reinforced_at = NULL` is evaluated against
    // `last_accessed_at` and vice versa. A row with BOTH
    // columns `NULL` falls through to the surrounding
    // `IS NOT NULL` guard and is filtered out.
    // The composite last-touch grace filter. When
    // `treatDriftedAsEligible` is set (EPIC-212 Phase-3 Task 4,
    // gated by `memory_decay_drift_invalidation_enabled`), a row
    // whose `drift_detected_at` is stamped is OR-ed in so it is
    // selected even inside its grace window — a drifted fact
    // should decay faster. The
    // `idx_memory_segments_drift_detected_at` b-tree index from
    // the `20260626000000-add-memory-drift-detected-at`
    // migration keeps the OR branch index-friendly. The
    // exempt-source allowlist above remains a hard floor in all
    // modes.
    const graceFilter =
      'COALESCE(GREATEST(segment.last_accessed_at, segment.last_reinforced_at), segment.last_accessed_at, segment.last_reinforced_at) IS NOT NULL AND COALESCE(GREATEST(segment.last_accessed_at, segment.last_reinforced_at), segment.last_accessed_at, segment.last_reinforced_at) < :graceCutoff';

    if (treatDriftedAsEligible) {
      query.andWhere(
        `((${graceFilter}) OR segment.drift_detected_at IS NOT NULL)`,
        { graceCutoff: cutoffIso },
      );
    } else {
      query.andWhere(graceFilter, { graceCutoff: cutoffIso });
    }

    return query.getMany();
  }

  /**
   * Bump `last_reinforced_at` on the supplied segment ids — the
   * read-path reinforcement half of the decay loop (work item
   * 3d7fb798-f54d-40ff-a803-438224474912, milestone 3).
   *
   * Called by `MemoryManagerService.getMemorySegments` and
   * `MemoryManagerService.searchMemory` on every read so
   * frequently-consumed segments stay "fresh" in the
   * `effective_last_touch = max(last_accessed_at,
   * last_reinforced_at)` composite that the
   * `MemoryDecayReaperService` uses as its stale anchor.
   * Without the bump, a hot segment could still decay just
   * because nothing refreshed its `last_reinforced_at`.
   *
   * Best-effort / fire-and-forget by contract:
   *   - `empty ids` short-circuits to a no-op — the SQL
   *     round-trip is pointless when there is nothing to update.
   *   - `archived_at IS NOT NULL` rows are SKIPPED via the
   *     criteria (`archived_at: IsNull()`). This is defensive:
   *     the read methods on this repository already default to
   *     `archived_at IS NULL`, so the caller should never pass
   *     an archived id here. The clause is included so a future
   *     caller (or a Honcho-side id that doesn't exist in
   *     `memory_segments` at all) cannot resurrect an archived
   *     row by accident. Non-matching ids are also a no-op at
   *     the SQL level (the `IN (...)` set is empty after the
   *     join).
   *   - Connection / transient errors are caught and swallowed
   *     — the method ALWAYS resolves normally so a DB blip
   *     cannot bubble out of a read path. The caller still
   *     wraps the invocation in `.catch(() => undefined)` to
   *     avoid an unhandled-rejection warning in case a future
   *     refactor removes the internal try/catch.
   *
   * Implementation note: the existing chat-profile-memory repo
   * uses the simpler `repository.update({ id: In(memoryIds) }, {
   * last_accessed_at: new Date() })` shape for the analogous
   * `touchAccessed` helper. We adopt the same shape here because
   * TypeORM's criteria system expands `IsNull()` into `IS NULL`
   * in the generated `UPDATE ... WHERE` clause, which is what we
   * need to skip archived rows without dropping into a custom
   * query builder. The `last_reinforced_at` value is set to the
   * current application clock (`new Date()`); the column is a
   * `timestamptz`, so TypeORM's parameter binding handles the
   * timezone normalisation on the way to PostgreSQL.
   */
  async touchReinforcedAt(ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    try {
      await this.repository.update(
        { id: In(ids), archived_at: IsNull() },
        { last_reinforced_at: new Date() },
      );
    } catch {
      // Swallow transient / connection errors so a DB blip never
      // breaks the read path. The caller is expected to invoke
      // this fire-and-forget (no `await`) and additionally attach
      // a `.catch(() => undefined)` for belt-and-suspenders
      // unhandled-rejection protection.
    }
  }
}
