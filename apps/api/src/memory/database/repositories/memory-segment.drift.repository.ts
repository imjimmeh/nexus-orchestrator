import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { MemorySegment } from '../entities/memory-segment.entity';

/**
 * Read-path surface for the nightly `MemoryDriftDetectionService`
 * (work item 0cead042-e823-4e26-9386-02042252ffb0). Mirrors the
 * `findDriftCandidates` method on the original
 * `MemorySegmentRepository`.
 *
 * ⚠️ DEAD-CODE STATUS: this class is intentionally retained even
 * though the drift detector service currently has no production
 * consumer. The candidate query is a load-bearing primitive for
 * the detector's idempotency contract (partial-index-friendly
 * `drift_detected_at IS NULL` filter) and removing the method
 * would silently drop the contract. The detector is currently
 * gated behind the `memory_drift_detection_enabled` setting
 * (default off); the method MUST stay wired so the gate can be
 * flipped without a code change.
 *
 * The method is query-builder-shaped and does not use the
 * `find({ where })` helper — the `buildReadWhere` helper targets
 * the criteria shape, while this query needs composite drift +
 * recheck-window filters that are not expressible via TypeORM's
 * criteria DSL.
 */
@Injectable()
export class MemorySegmentDriftRepository {
  constructor(
    @InjectRepository(MemorySegment)
    private readonly repository: Repository<MemorySegment>,
  ) {}

  /**
   * Find memory segments that the nightly
   * `MemoryDriftDetectionService` (work item
   * 0cead042-e823-4e26-9386-02042252ffb0) should consider for
   * drift detection.
   *
   * A row is a drift candidate when ALL of the following hold:
   *   - `archived_at IS NULL` (already-archived rows are never
   *     re-candidates; the drift detector must never touch a
   *     row that the decay reaper has already archived — they
   *     are preserved for auditability).
   *   - `drift_detected_at IS NULL` (rows the detector has
   *     already flagged are excluded from the candidate set so
   *     the detector is idempotent — the detector never clears
   *     the column, so a row that has drifted once is
   *     permanently marked unless an operator manually resets
   *     it).
   *   - OR, when `recheckAfterMs` is supplied:
   *     `drift_detected_at < now - recheckAfterMs` (rows that
   *     were drifted longer ago than the recheck window are
   *     eligible for a re-pass). This is opt-in: omitting
   *     `recheckAfterMs` (the default) means "only check
   *     un-drifted rows", which matches the documented contract
   *     of the `memory_drift_recheck_after_ms` SystemSetting
   *     (default unset).
   *
   * The candidate list does NOT exclude exempt sources. The
   * decision is documented in the detector service: the service
   * owns the `MEMORY_DRIFT_EXEMPT_SOURCES` allowlist so a single
   * SQL query can hand the full candidate set to the service and
   * the allowlist logic stays in one place (mirroring the decay
   * reaper's `findDecayCandidates` shape). The service still
   * counts exempt rows in `checkedCount` so the summary's
   * accounting stays uniform.
   *
   * The optional `limit` parameter caps the candidate set for
   * testing and disaster-recovery scenarios. The default is
   * unbounded; the BullMQ scheduler (milestone 3) is expected to
   * chunk a long pass across multiple ticks rather than rely on
   * this limit.
   *
   * The partial index
   * `idx_memory_segments_drift_detected_at_unset`
   * (`WHERE drift_detected_at IS NULL`, added by the
   * `20260626000000-add-memory-drift-detected-at` migration)
   * targets the "never-drifted" set the detector hits most
   * often. The plain `idx_memory_segments_drift_detected_at`
   * b-tree index alongside targets the rarer "find recent drift"
   * observability queries (`ORDER BY drift_detected_at DESC`).
   *
   * Implementation note: the candidate query uses an `OR` clause
   * on `drift_detected_at` (`IS NULL` OR `< :recheckCutoff`) so
   * Postgres can use either partial index depending on which
   * branch dominates the active dataset. When the recheck window
   * is unset, the `OR` collapses to the partial-index-friendly
   * `drift_detected_at IS NULL` branch.
   */
  async findDriftCandidates(
    params: {
      now?: Date;
      recheckAfterMs?: number;
      limit?: number;
    } = {},
  ): Promise<MemorySegment[]> {
    const now = params.now ?? new Date();
    const limit = params.limit;

    const query = this.repository
      .createQueryBuilder('segment')
      // Already-archived rows are excluded for the same reason
      // as the eviction / decay reapers — the drift detector
      // operates on the active set and a row the decay reaper
      // has archived must never be re-checked by the detector.
      .where('segment.archived_at IS NULL');

    if (params.recheckAfterMs !== undefined && params.recheckAfterMs >= 0) {
      // Recheck window supplied. Rows whose most recent drift
      // detection is older than `now - recheckAfterMs` are
      // eligible for another pass — the bound is computed
      // application-side so the SQL plan stays parameter-bound
      // and the `now` value used in tests is honoured
      // deterministically.
      const recheckCutoffIso = new Date(
        now.getTime() - params.recheckAfterMs,
      ).toISOString();
      query.andWhere(
        '(segment.drift_detected_at IS NULL OR segment.drift_detected_at < :recheckCutoff)',
        { recheckCutoff: recheckCutoffIso },
      );
    } else {
      // Default: only un-drifted rows. The partial index
      // `idx_memory_segments_drift_detected_at_unset` is the
      // planner-friendly form of this branch.
      query.andWhere('segment.drift_detected_at IS NULL');
    }

    if (typeof limit === 'number' && limit > 0) {
      query.limit(limit);
    }

    return query.getMany();
  }
}
