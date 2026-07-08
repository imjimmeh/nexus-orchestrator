import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, type Repository } from 'typeorm';
import { LearningMeasurementSnapshot } from '../entities/learning-measurement-snapshot.entity';
import type {
  LearningMeasurementSnapshotInput,
  LearningMeasurementSnapshotSourceWindow,
} from './learning-measurement-snapshot.repository.types';

export type {
  LearningMeasurementSnapshotInput,
  LearningMeasurementSnapshotSourceWindow,
} from './learning-measurement-snapshot.repository.types';

/**
 * Persistence surface for the daily convergence recorder's
 * snapshot rows (work item
 * 946a3c8b-5814-4e76-a804-b557e589600b, milestone 1).
 *
 * Mirrors the project's domain-local repository convention
 * (see `MemorySegmentFeedbackRepository`,
 * `LearningCandidateRepository`): the entity is imported via a
 * relative path within the same domain, the repository is
 * `@Injectable()` and delegates to TypeORM's `Repository<T>`
 * for the underlying SQL surface, and the read / write methods
 * are narrow and named for their caller-facing intent rather
 * than for the SQL they generate.
 *
 * The recorder reads / writes one row per pass via
 * {@link insertSnapshot}, so the repository surface is
 * intentionally minimal: a single insert path plus two
 * read-side helpers (`listRecentByWindow`,
 * `countWithinLast24h`) that the operator UI / temporal
 * assertion (AC-4) need. The `(computed_at DESC)` index added
 * by the migration keeps every read bounded by the index — no
 * full-table scans.
 */
@Injectable()
export class LearningMeasurementSnapshotRepository {
  constructor(
    @InjectRepository(LearningMeasurementSnapshot)
    private readonly repository: Repository<LearningMeasurementSnapshot>,
  ) {}

  /**
   * Persist a new snapshot row. Returns the saved entity so
   * the caller (the recorder service) can inspect the
   * server-assigned `computed_at` for logging / downstream
   * event emission.
   *
   * The `numeric` columns (`promoted_to_bound_score`,
   * `bound_to_reused_score`) accept the application-side
   * numeric strings verbatim — Postgres' `numeric` type
   * preserves arbitrary precision and the entity maps the
   * column back to `string` (NOT `number`) for the same
   * reason. The recorder is responsible for canonicalising
   * the value (e.g. via `.toFixed(6)`) before insert so the
   * precision drift the column tolerates is bounded.
   */
  async insertSnapshot(
    input: LearningMeasurementSnapshotInput,
  ): Promise<LearningMeasurementSnapshot> {
    const entity = this.repository.create({
      source_window: input.source_window,
      promoted_to_bound_score: input.promoted_to_bound_score,
      bound_to_reused_score: input.bound_to_reused_score,
      usefulness_histogram: input.usefulness_histogram,
      retention_decision_distribution: input.retention_decision_distribution,
    });
    return this.repository.save(entity);
  }

  /**
   * List the most recent `limit` snapshots for a given
   * `window`, newest first. Used by the operator UI's
   * decision-distribution surface so the operator can scroll
   * the recorder's history per window without paginating the
   * full table.
   *
   * Bounded by the `(computed_at DESC)` index — the planner
   * can satisfy the `ORDER BY computed_at DESC` directly from
   * the index and apply the `LIMIT` without scanning the
   * heap, so the read cost is O(limit) regardless of how many
   * snapshots the recorder has written.
   */
  async listRecentByWindow(
    window: LearningMeasurementSnapshotSourceWindow,
    limit: number,
  ): Promise<LearningMeasurementSnapshot[]> {
    return this.repository.find({
      where: { source_window: window },
      order: { computed_at: 'DESC' },
      take: limit,
    });
  }

  /**
   * Count of snapshots whose `computed_at` is within the last
   * 24 hours (rolling, anchored at `now`). Used by AC-4's
   * temporal assertion ("did the recorder run in the last
   * day?") and by the operator UI's heartbeat widget.
   *
   * Returns 0 (NOT throws) when no snapshots are present —
   * the temporal assertion is the source of truth for the
   * "no data yet" case. Bounded by the `(computed_at DESC)`
   * index so the read is a single index range scan.
   */
  async countWithinLast24h(now: Date = new Date()): Promise<number> {
    const windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    return this.repository.count({
      where: {
        computed_at: MoreThanOrEqual(windowStart),
      },
    });
  }
}
