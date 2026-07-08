import { MigrationInterface, QueryRunner } from 'typeorm';
import { MEMORY_DECAY_USEFULNESS_THRESHOLD_DEFAULT } from '../../settings/memory-decay-value.settings.constants';

/**
 * Create the `memory_retention_policy` singleton table for the
 * daily convergence recorder (work item
 * 946a3c8b-5814-4e76-a804-b557e589600b, milestone 1, AC-2).
 *
 * The recorder reads / writes the singleton row each pass to
 * persist the *current* (latest-calibrated) usefulness threshold
 * the `decideMemoryRetentionKeep` value predicate should use on
 * the next pass. The single-row shape matches the
 * `scoped_variables` / `system_settings` global-config idiom:
 *
 *   - `id` (smallint PRIMARY KEY DEFAULT 1) — the singleton
 *     discriminator. The `smallint` choice matches the existing
 *     `system_settings` and `provider_cooldowns` global-config
 *     table precedent (low-cardinality PK, no UUID noise for a
 *     one-row table).
 *   - `usefulness_threshold` (numeric NOT NULL) — the threshold
 *     `decideMemoryRetentionKeep` compares a segment's rolling
 *     usefulness ratio against. Numeric so future recorder
 *     passes can store higher-precision thresholds without a
 *     schema change. NOT NULL — the singleton is meaningless
 *     without a threshold.
 *   - `recalibrated_at` (timestamptz NOT NULL DEFAULT now()) —
 *     the wall-clock timestamp the recorder last rewrote the
 *     row. Indexed implicitly by the recorder's "most recent
 *     calibration" query via the same scan. NOT NULL.
 *   - `sample_size` (int NOT NULL DEFAULT 0) — the count of
 *     segments / segments-votes the recorder used when picking
 *     the threshold on the most recent calibration. Carried on
 *     the row so the operator UI can show
 *     "threshold recalibrated to N from M samples at T".
 *     `int` matches the conventional counter type in the
 *     sibling `learning_candidate` / `memory_segment_feedback`
 *     tables. NOT NULL.
 *   - `CHECK (id = 1)` named
 *     `memory_retention_policy_singleton_check` — defensive
 *     guard so a stray `INSERT INTO memory_retention_policy
 *     (id, ...) VALUES (2, ...)` is rejected by the database
 *     before it can shadow the singleton. The `smallint` PK
 *     alone does NOT enforce a singleton shape — an application
 *     that picks a different id can still create a "second
 *     row" that the recorder would never see (its queries are
 *     filtered by `id = 1`).
 *
 * The migration pre-inserts one row via `INSERT ... ON CONFLICT
 * (id) DO NOTHING` so a fresh database boots with a usable
 * singleton and an existing database (idempotent rerun) does not
 * lose operator-tuned values. The seed value uses
 * `MEMORY_DECAY_USEFULNESS_THRESHOLD_DEFAULT` (the hardcoded
 * fallback `MemoryDecayReaperService` consults when the live
 * setting is absent) so the singleton and the reaper agree on
 * the default.
 *
 * Purely additive: `CREATE TABLE IF NOT EXISTS` + `INSERT ...
 * ON CONFLICT (id) DO NOTHING`. Down migration drops the table
 * — no data migration is needed because the only consumer (the
 * recorder) is also being introduced in this work item.
 */
export class CreateMemoryRetentionPolicy20260715000001 implements MigrationInterface {
  public readonly transaction = false as const;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS memory_retention_policy (
        "id" smallint PRIMARY KEY DEFAULT 1,
        "usefulness_threshold" numeric NOT NULL,
        "recalibrated_at" timestamptz NOT NULL DEFAULT now(),
        "sample_size" integer NOT NULL DEFAULT 0,
        CONSTRAINT "memory_retention_policy_singleton_check"
          CHECK ("id" = 1)
      );
    `);

    // Seed the singleton with the canonical
    // `MEMORY_DECAY_USEFULNESS_THRESHOLD_DEFAULT` so a fresh
    // database boots with a usable row and an existing
    // database's operator-tuned value is preserved on rerun.
    // `ON CONFLICT (id) DO NOTHING` makes the seed idempotent
    // — the recorder service may have already moved the row to
    // a recalibrated state and we must not clobber it.
    await queryRunner.query(
      `INSERT INTO memory_retention_policy ("id", "usefulness_threshold", "recalibrated_at", "sample_size")
       VALUES (1, $1, now(), 0)
       ON CONFLICT ("id") DO NOTHING;`,
      [MEMORY_DECAY_USEFULNESS_THRESHOLD_DEFAULT],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS memory_retention_policy;`);
  }
}
