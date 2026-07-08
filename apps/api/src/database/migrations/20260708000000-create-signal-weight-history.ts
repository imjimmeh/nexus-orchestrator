import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the `signal_weight_history` table (EPIC-212 Phase-3 Task 9).
 *
 * Each row is a versioned, reversible snapshot of one weekly
 * `FeedbackWeightTunerService` pass over the candidate-scoring weights:
 *  - `weights_json` — the new (bounded) scoring-weight vector.
 *  - `previous_weights_json` — the live weights at the time of the pass, so a
 *    revert is a pure re-apply of this column with no recomputation.
 *  - `training_sample_size` — how many labelled samples the retrain saw.
 *  - `bounded_delta` — the largest per-weight change actually applied (the
 *    clamp magnitude), for auditability.
 *  - `applied` — whether the new weights were persisted to the live settings
 *    (false for an `insufficient_samples` / shadow row).
 *  - `reason` — short machine-readable reason (`retuned`, `insufficient_samples`,
 *    `revert`).
 *
 * Idempotent (`CREATE TABLE IF NOT EXISTS`); `down` drops the table. No FK on
 * the JSON weight columns — they are self-contained snapshots.
 */
export class CreateSignalWeightHistory20260708000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS signal_weight_history (
        "id"                    uuid             NOT NULL DEFAULT gen_random_uuid(),
        "weights_json"          jsonb            NOT NULL,
        "previous_weights_json" jsonb,
        "training_sample_size"  int              NOT NULL DEFAULT 0,
        "bounded_delta"         double precision,
        "applied"               boolean          NOT NULL DEFAULT false,
        "reason"                varchar(64),
        "created_at"            timestamptz      NOT NULL DEFAULT now(),
        CONSTRAINT "PK_signal_weight_history_id" PRIMARY KEY ("id")
      );
    `);

    // Covers the "latest applied retune" lookup the revert path uses.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_signal_weight_history_applied_created
        ON signal_weight_history ("applied", "created_at");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_signal_weight_history_applied_created;`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS signal_weight_history;`);
  }
}
