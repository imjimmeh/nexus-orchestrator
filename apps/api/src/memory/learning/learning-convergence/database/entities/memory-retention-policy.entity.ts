import {
  Check,
  Column,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * TypeORM entity for the memory-retention-policy singleton
 * (work item 946a3c8b-5814-4e76-a804-b557e589600b, milestone 1,
 * AC-2).
 *
 * One row holds the *current* (latest-calibrated) usefulness
 * threshold the `decideMemoryRetentionKeep` value predicate
 * should use on the next recorder pass. The TypeORM migration
 * that created the underlying table lives at
 * `apps/api/src/database/migrations/20260715000001-create-memory-retention-policy.ts`.
 *
 * Decoration style mirrors the sibling memory-domain entities
 * (`MemorySegment`, `MemorySegmentFeedback`,
 * `LearningCandidate`) and the singleton-table precedent in
 * `system_settings` / `provider_cooldowns`:
 *   - `@PrimaryColumn({ type: 'smallint', default: 1 })` for
 *     the singleton discriminator. `smallint` matches the
 *     existing global-config table convention (low-cardinality
 *     PK, no UUID noise for a one-row table).
 *   - `@Check('memory_retention_policy_singleton_check', 'id = 1')`
 *     decorator mirrors the `CHECK (id = 1)` constraint the
 *     migration creates — the decorator metadata keeps
 *     TypeORM's reflection-based schema sync in lock-step with
 *     the migration when the database is running in development
 *     mode.
 *   - `@Column({ type, ... })` for the typed numeric / int /
 *     timestamptz columns; column names are snake_case to match
 *     the underlying PostgreSQL column casing.
 *   - `@UpdateDateColumn({ name: 'recalibrated_at' })` for the
 *     wall-clock timestamp the recorder last rewrote the row.
 *     The migration sets the same column with a `DEFAULT now()`
 *     so inserts that omit the field still get a server-side
 *     timestamp.
 *
 * The migration also adds a raw-SQL `CHECK (id = 1)
 * CONSTRAINT memory_retention_policy_singleton_check` as a
 * defensive backstop: the `@Check` decorator is enough for
 * TypeORM's reflection-based sync, but the raw-SQL constraint
 * guarantees the singleton invariant even if a future
 * non-TypeORM write path bypasses the decorator metadata.
 */
@Entity('memory_retention_policy')
@Check('memory_retention_policy_singleton_check', '"id" = 1')
export class MemoryRetentionPolicy {
  /**
   * Singleton discriminator. The `smallint` choice matches the
   * existing `system_settings` / `provider_cooldowns`
   * global-config table precedent. The DB-level `CHECK (id = 1)`
   * constraint (mirrored by the `@Check` decorator above)
   * rejects any other value at write time so a stray
   * `INSERT INTO memory_retention_policy (id, ...) VALUES (2, ...)`
   * cannot shadow the singleton.
   */
  @PrimaryColumn({ type: 'smallint', default: 1 })
  id!: number;

  /**
   * Usefulness threshold `decideMemoryRetentionKeep` compares
   * a segment's rolling usefulness ratio against on the next
   * pass. Persisted as `numeric` so future recorder passes can
   * store higher-precision thresholds without an upgrade
   * migration. TypeORM maps `numeric` to `string` by default
   * (Postgres returns arbitrary-precision numbers as
   * strings); callers that need a JS number should explicitly
   * coerce at the boundary. NOT NULL.
   */
  @Column({ name: 'usefulness_threshold', type: 'numeric' })
  usefulness_threshold!: string;

  /**
   * Wall-clock timestamp the recorder last rewrote the row.
   * The migration sets the same column with a `DEFAULT now()`
   * so the seed insert (and any subsequent writes that omit
   * the field) still get a server-side timestamp. NOT NULL.
   */
  @UpdateDateColumn({
    name: 'recalibrated_at',
    type: 'timestamptz',
  })
  recalibrated_at!: Date;

  /**
   * Count of segments / segment-votes the recorder used when
   * picking the threshold on the most recent calibration.
   * Carried on the row so the operator UI can show
   * "threshold recalibrated to N from M samples at T".
   * NOT NULL.
   */
  @Column({ name: 'sample_size', type: 'int', default: 0 })
  sample_size!: number;
}
