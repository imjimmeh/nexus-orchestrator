import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, type Repository } from 'typeorm';
import { MemorySegmentFeedback } from '../entities/memory-segment-feedback.entity';
import type { MemorySegmentFeedbackInput } from './memory-segment-feedback.repository.types';

/**
 * Persistence surface for the explicit agent usefulness
 * feedback channel (work item 66ea23d1-59f2-451b-a090-a292fad8f21b,
 * milestone 1).
 *
 * Mirrors the project's domain-local repository convention
 * (see `MemorySegmentRepository`,
 * `LearningCandidateRepository`): the entity is imported
 * via a relative path within the same domain, the repository
 * is `@Injectable()` and delegates to TypeORM's `Repository<T>`
 * for the underlying SQL surface, and the read / write methods
 * are narrow and named for their caller-facing intent rather
 * than for the SQL they generate.
 *
 * The rolling-window aggregation methods
 * ({@link countUsefulSince},
 * {@link countTotalSince},
 * {@link findUsefulnessSince}) exist as standalone queries so
 * the milestone-2 service can compute
 * `usefulness_ratio = countUsefulSince / countTotalSince` over
 * the configured `memory_feedback_window_days` window without
 * pulling a row-per-vote list into memory. Both count helpers
 * rely on the composite `(segment_id, created_at)` index added
 * by the
 * `20260626000000-create-memory-segment-feedback` migration —
 * the planner can satisfy both predicates from the index and
 * only falls back to the heap when the segment's feedback
 * history is large enough to warrant a row fetch (which is the
 * common case for a hot segment — the count is the answer, no
 * row fetch needed).
 */
@Injectable()
export class MemorySegmentFeedbackRepository {
  constructor(
    @InjectRepository(MemorySegmentFeedback)
    private readonly repository: Repository<MemorySegmentFeedback>,
  ) {}

  /**
   * Persist a new feedback row. Returns the saved entity so the
   * caller (the milestone-2 service) can inspect the
   * server-assigned `id` and `created_at` for logging /
   * downstream-event emission.
   *
   * Trims `reason` to `null` when the caller passes an empty
   * string — Postgres' `text` accepts the empty string but the
   * downstream aggregation methods filter on `useful` only,
   * so an empty-string `reason` would be invisible in the
   * audit query and surprising in the eventual user-facing UI.
   */
  async createAndSave(
    input: MemorySegmentFeedbackInput,
  ): Promise<MemorySegmentFeedback> {
    const entity = this.repository.create({
      segment_id: input.segment_id,
      query_id: input.query_id,
      agent_profile_id: input.agent_profile_id,
      workflow_run_id: input.workflow_run_id,
      useful: input.useful,
      reason:
        input.reason !== undefined && input.reason !== null
          ? input.reason.trim().length > 0
            ? input.reason
            : null
          : null,
    });
    return this.repository.save(entity);
  }

  /**
   * Count of `useful = true` votes cast on `segmentId` since
   * `windowStart`. Used by the milestone-2 service as the
   * numerator of `usefulness_ratio`.
   *
   * Returns 0 (NOT throws) when the segment has no feedback
   * in the window — the division in the caller is the source
   * of truth for the empty-window case.
   */
  async countUsefulSince(
    segmentId: string,
    windowStart: Date,
  ): Promise<number> {
    return this.repository.count({
      where: {
        segment_id: segmentId,
        useful: true,
        created_at: MoreThanOrEqual(windowStart),
      },
    });
  }

  /**
   * Total count of votes (useful or not) cast on `segmentId`
   * since `windowStart`. Used by the milestone-2 service as the
   * denominator of `usefulness_ratio`. Returns 0 when the
   * segment has no feedback in the window — the division in
   * the caller is the source of truth for the empty-window
   * case.
   */
  async countTotalSince(segmentId: string, windowStart: Date): Promise<number> {
    return this.repository.count({
      where: {
        segment_id: segmentId,
        created_at: MoreThanOrEqual(windowStart),
      },
    });
  }

  /**
   * Per-segment usefulness summary for a batch of segments.
   *
   * Returns one record per segment that received at least one
   * feedback row in the window, with the `useful` and `total`
   * counts pre-aggregated so the caller can compute the
   * `usefulness_ratio` without N+1 round trips. Segments that
   * received zero feedback in the window are NOT included in
   * the returned list — the caller is expected to treat
   * "absent" as the same as "ratio = 0" (or "ratio = null"
   * depending on its policy).
   *
   * The query uses a `GROUP BY segment_id` aggregation so a
   * single round-trip covers the whole batch. The composite
   * `(segment_id, created_at)` index from the migration keeps
   * the window filter cheap.
   *
   * The returned `useful` / `total` counts are non-negative
   * integers (`bigint` from Postgres is normalised to `number`
   * via `Number(row.count)` — feedback volume per segment in
   * the window is bounded by the voting activity, well within
   * the safe-integer range).
   */
  async findUsefulnessSince(
    segmentIds: string[],
    windowStart: Date,
  ): Promise<Array<{ segment_id: string; useful: number; total: number }>> {
    if (segmentIds.length === 0) {
      return [];
    }

    const rows = await this.repository
      .createQueryBuilder('feedback')
      .select('feedback.segment_id', 'segment_id')
      .addSelect(
        'SUM(CASE WHEN feedback.useful = true THEN 1 ELSE 0 END)',
        'useful_count',
      )
      .addSelect('COUNT(*)', 'total_count')
      .where('feedback.segment_id IN (:...segmentIds)', { segmentIds })
      .andWhere('feedback.created_at >= :windowStart', { windowStart })
      .groupBy('feedback.segment_id')
      .getRawMany<{
        segment_id: string;
        useful_count: string | number;
        total_count: string | number;
      }>();

    return rows.map((row) => ({
      segment_id: row.segment_id,
      useful:
        typeof row.useful_count === 'string'
          ? Number(row.useful_count)
          : row.useful_count,
      total:
        typeof row.total_count === 'string'
          ? Number(row.total_count)
          : row.total_count,
    }));
  }

  /**
   * Look up a single feedback row by its primary key. Used by
   * the milestone-3 tool integration's "acknowledge vote" path
   * (defensive — the row is returned verbatim for the caller
   * to inspect before deciding to retry / drop).
   */
  async findById(id: string): Promise<MemorySegmentFeedback | null> {
    return this.repository.findOne({ where: { id } });
  }
}
