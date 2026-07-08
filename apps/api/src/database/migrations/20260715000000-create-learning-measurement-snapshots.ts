import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Create the `learning_measurement_snapshots` table for the daily
 * convergence recorder (work item
 * 946a3c8b-5814-4e76-a804-b557e589600b, milestone 1, AC-1).
 *
 * The daily recorder reads the `computeConvergenceSnapshots` /
 * `decideMemoryRetentionKeep` pair from the existing memory-decay
 * value-predicate helpers and persists a single row per pass with:
 *
 *   - `id` (uuid) — row identity / primary key required by
 *     TypeORM for persisted entities.
 *   - `computed_at` (timestamptz) — wall-clock timestamp of the
 *     snapshot pass. `DEFAULT now()` so the application can omit
 *     it on insert (the recorder service records at the start of
 *     the pass and lets the server stamp it; the recorder also
 *     re-reads the row to confirm the stamp it persisted).
 *   - `source_window` (varchar(8)) — one of the recorder's three
 *     operating windows (`24h` | `7d` | `30d`). The `length: 8`
 *     cap matches the longest supported window string (`'30d'` is
 *     3 chars; the 8-char ceiling leaves room for future windows
 *     like `'90d'` without a schema change). NOT NULL — every
 *     snapshot must declare the window it computed over so the
 *     `listRecentByWindow` repository method can filter without
 *     an extra join.
 *   - `promoted_to_bound_score` (numeric) — the convergence
 *     `ratio` from `computeConvergenceSnapshots`
 *     (`successes_after_lesson / runs_after_lesson`) aggregated
 *     across all scopes in the window. Persisted as `numeric`
 *     so future recorder passes can store higher-precision
 *     aggregates without an upgrade migration. NOT NULL.
 *   - `bound_to_reused_score` (numeric) — the cross-rate from
 *     `decideMemoryRetentionKeep`: the fraction of segments
 *     deemed worth keeping by the value predicate (`keep` =
 *     `true`) among the segment set the recorder scanned in the
 *     window. Persisted as `numeric` for the same future-proofing
 *     reason as above. NOT NULL.
 *   - `usefulness_histogram` (jsonb) — the full
 *     per-bucket usefulness histogram the recorder computed over
 *     the window (e.g. `{ "0": 12, "1": 3, ... }` or a richer
 *     shape that the recorder milestones will fill in). The
 *     histogram is the primary input the milestone-2
 *     decision-distribution plot reads so the operator can see
 *     "did useful mass shift toward the threshold". NOT NULL
 *     with `DEFAULT '{}'` so a recorder pass that crashes before
 *     assembling the histogram still leaves a valid row.
 *   - `retention_decision_distribution` (jsonb) — the recorder's
 *     per-reason verdict distribution
 *     (`{ "useful": n, "pinned": n, "insufficient_samples": n,
 *     "low_usefulness": n, ... }`). NOT NULL with `DEFAULT '{}'`
 *     for the same crash-recovery reason as above.
 *
 * Indexes:
 *   - `(computed_at DESC)` — supports the recorder's
 *     "show me the most recent N snapshots" query and the
 *     `countWithinLast24h` AC-4 temporal assertion. The `DESC`
 *     ordering matches the "newest first" direction of every
 *     read so the planner can satisfy the `ORDER BY` without a
 *     separate sort step.
 *
 * Purely additive: `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX
 * IF NOT EXISTS`. Down migration drops the index then the
 * table — no data migration is needed because the only consumer
 * (the recorder) is also being introduced in this work item.
 */
export class CreateLearningMeasurementSnapshots20260715000000 implements MigrationInterface {
  public readonly transaction = false as const;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS learning_measurement_snapshots (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "computed_at" timestamptz NOT NULL DEFAULT now(),
        "source_window" varchar(8) NOT NULL,
        "promoted_to_bound_score" numeric NOT NULL,
        "bound_to_reused_score" numeric NOT NULL,
        "usefulness_histogram" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "retention_decision_distribution" jsonb NOT NULL DEFAULT '{}'::jsonb
      );
    `);

    // Non-covering single-column B-tree on (computed_at DESC) —
    // supports the recorder's "most recent N snapshots" /
    // `countWithinLast24h` reads. The `DESC` ordering matches
    // every read direction so the planner can satisfy the
    // `ORDER BY computed_at DESC` directly from the index.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS learning_measurement_snapshots_computed_at_idx
        ON learning_measurement_snapshots ("computed_at" DESC);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS learning_measurement_snapshots_computed_at_idx;`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS learning_measurement_snapshots;`,
    );
  }
}
