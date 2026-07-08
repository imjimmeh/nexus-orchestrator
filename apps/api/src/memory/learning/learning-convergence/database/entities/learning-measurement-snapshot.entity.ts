import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { LearningMeasurementSnapshotSourceWindow } from './learning-measurement-snapshot.entity.types';

/**
 * TypeORM entity for the daily convergence recorder's snapshot
 * rows (work item 946a3c8b-5814-4e76-a804-b557e589600b,
 * milestone 1, AC-1).
 *
 * One row per recorder pass; the recorder computes
 * `promoted_to_bound_score`, `bound_to_reused_score`,
 * `usefulness_histogram`, and
 * `retention_decision_distribution` from
 * `computeConvergenceSnapshots` /
 * `decideMemoryRetentionKeep` and persists a snapshot for the
 * operator / decision-distribution surface to read. The
 * TypeORM migration that created the underlying table lives at
 * `apps/api/src/database/migrations/20260715000000-create-learning-measurement-snapshots.ts`.
 *
 * Decoration style mirrors the sibling memory-domain entities
 * (`MemorySegment`, `MemorySegmentFeedback`,
 * `LearningCandidate`):
 *   - `@PrimaryGeneratedColumn('uuid')` for the row identity
 *     TypeORM requires on persisted entities.
 *   - `@CreateDateColumn({ name: 'computed_at' })` for the
 *     wall-clock timestamp (the migration sets the same column
 *     with a `DEFAULT now()` so inserts that omit the field
 *     still get a server-side timestamp).
 *   - `@Column({ type, length })` for the typed varchar /
 *     numeric / jsonb columns; column names are snake_case to
 *     match the underlying PostgreSQL column casing.
 *   - `@Index('learning_measurement_snapshots_computed_at_idx',
 *     ['computed_at'])` decorator mirrors the raw-SQL index the
 *     migration creates — the decorator metadata keeps
 *     TypeORM's reflection-based schema sync in lock-step with
 *     the migration when the database is running in development
 *     mode.
 *
 * `usefulness_histogram` and
 * `retention_decision_distribution` are stored as `jsonb` — the
 * recorder milestones control the shape (free-form per-bucket
 * histogram + per-reason verdict count) and the operator UI
 * reads them back without an extra round trip through a
 * normalised table.
 *
 * `source_window` is a closed enum of the recorder's three
 * operating windows (`'24h' | '7d' | '30d'`). The migration
 * enforces the `varchar(8)` length ceiling — the entity
 * captures the same constraint via `length: 8` so the
 * reflection-based sync agrees.
 */

@Entity('learning_measurement_snapshots')
@Index('learning_measurement_snapshots_computed_at_idx', ['computed_at'])
export class LearningMeasurementSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /**
   * Wall-clock timestamp the snapshot was recorded. The migration
   * sets the same column with a `DEFAULT now()` so inserts that
   * omit the field still get a server-side timestamp. Indexed
   * `DESC` (via the migration) so the recorder's
   * "most recent N snapshots" / `countWithinLast24h` reads can
   * satisfy the `ORDER BY computed_at DESC` directly from the
   * index without a sort step.
   */
  @CreateDateColumn({ name: 'computed_at', type: 'timestamptz' })
  computed_at!: Date;

  /**
   * Source window the snapshot computed over. Closed enum
   * (`'24h' | '7d' | '30d'`); stored as `varchar(8)` to leave
   * room for future windows like `'90d'` without a schema
   * change. NOT NULL — every snapshot must declare the window
   * it computed over so the `listRecentByWindow` repository
   * method can filter without an extra join.
   */
  @Column({
    name: 'source_window',
    type: 'varchar',
    length: 8,
  })
  source_window!: LearningMeasurementSnapshotSourceWindow;

  /**
   * Convergence `ratio` from `computeConvergenceSnapshots`
   * aggregated across all scopes in the window. Persisted as
   * `numeric` so future recorder passes can store
   * higher-precision aggregates without an upgrade migration.
   * TypeORM maps `numeric` to `string` by default (Postgres
   * returns arbitrary-precision numbers as strings); callers
   * that need a JS number should explicitly coerce at the
   * boundary. NOT NULL.
   */
  @Column({
    name: 'promoted_to_bound_score',
    type: 'numeric',
  })
  promoted_to_bound_score!: string;

  /**
   * Cross-rate from `decideMemoryRetentionKeep`: the fraction
   * of segments the value predicate deemed worth keeping
   * (`keep = true`) among the segment set the recorder scanned
   * in the window. Persisted as `numeric` for the same
   * future-proofing reason as `promoted_to_bound_score`. NOT
   * NULL.
   */
  @Column({
    name: 'bound_to_reused_score',
    type: 'numeric',
  })
  bound_to_reused_score!: string;

  /**
   * Per-bucket usefulness histogram the recorder computed over
   * the window. The shape is owned by the recorder milestones;
   * the entity deliberately types it as `Record<string, unknown>`
   * so the column can carry either a coarse
   * `{ "0": 12, "1": 3, ... }` shape or a richer bucket
   * structure without a schema change. `jsonb` so the operator
   * UI can filter / aggregate inside the database without an
   * application round trip. NOT NULL with a `DEFAULT '{}'`
   * server-side fallback so a recorder pass that crashes before
   * assembling the histogram still leaves a valid row.
   */
  @Column({
    name: 'usefulness_histogram',
    type: 'jsonb',
  })
  usefulness_histogram!: Record<string, unknown>;

  /**
   * Per-reason verdict distribution from
   * `decideMemoryRetentionKeep` — e.g.
   * `{ "useful": n, "pinned": n, "insufficient_samples": n,
   * "low_usefulness": n, ... }`. `jsonb` for the same
   * crash-recovery reason as `usefulness_histogram`. NOT NULL.
   */
  @Column({
    name: 'retention_decision_distribution',
    type: 'jsonb',
  })
  retention_decision_distribution!: Record<string, unknown>;
}
