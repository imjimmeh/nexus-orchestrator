import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add the `drift_detected_at` column to `memory_segments` for the
 * `MemoryDriftDetectionService` (work item
 * 0cead042-e823-4e26-9386-02042252ffb0, Milestone 1).
 *
 * The drift detector walks the table on a cron schedule and applies
 * a configurable confidence penalty to rows whose `source_metadata`
 * (file path, schema column, or API endpoint the segment
 * references) no longer matches the codebase. When drift is
 * detected:
 *
 *   - The detector stamps `drift_detected_at = NOW()` on the row
 *     alongside the confidence penalty applied to
 *     `metadata_json.confidence` (default -0.2).
 *   - The detector emits a `memory.segment.drift_detected.v1`
 *     observability event carrying the original confidence and the
 *     new decayed confidence.
 *   - The detector increments the `nexus_memory_drift_detected_total{source,outcome}`
 *     prom-client counter.
 *
 * Rows whose `source` is in the `MEMORY_DRIFT_EXEMPT_SOURCES`
 * allowlist (`learning_candidate`, `workflow_failure_postmortem`,
 * `strategic_intent`, `workflow_success_postmortem`) are exempt
 * from drift detection — they are validated by promotion gates,
 * not by code-level reality checks. The detector is
 * kill-switchable via the `memory_drift_enabled` SystemSetting
 * (default `true`) and re-registers its schedule when the operator
 * updates `memory_drift_cron` (default `0 4 * * *` — daily 04:00
 * UTC).
 *
 * Schema additions:
 *   - `drift_detected_at` — nullable `timestamptz`. Set by the
 *     `MemoryDriftDetectionService` when a segment's underlying
 *     reality (file path, schema column, API endpoint) no longer
 *     matches the codebase. The detector never clears the column —
 *     a segment that has drifted once is permanently marked for
 *     auditability, even if the operator later corrects the
 *     underlying reality (operators can manually update the row).
 *     Indexed via a partial index
 *     `idx_memory_segments_drift_detected_at_unset`
 *     (`WHERE drift_detected_at IS NULL`) so the detector's hot
 *     candidate filter `WHERE drift_detected_at IS NULL` stays
 *     cheap as the drifted subset grows. The plain
 *     `idx_memory_segments_drift_detected_at` b-tree index
 *     alongside targets the detector's secondary "find recent drift"
 *     queries (`ORDER BY drift_detected_at DESC`) for observability.
 *
 * Notes:
 *   - The column is nullable to keep the migration non-disruptive
 *     for existing memory-write flows that did not populate the
 *     field. The detector treats `NULL` as "never detected as
 *     drifted" and the candidate query is
 *     `WHERE drift_detected_at IS NULL`.
 *   - No backfill is performed — a `NULL` value is the correct
 *     starting state for every existing row, and the detector's
 *     first pass will populate the column for any drifted legacy
 *     rows it encounters.
 *   - The partial index targets the "active, never-drifted" set.
 *     Most production rows will be un-drifted, so the planner can
 *     serve the detector's `WHERE drift_detected_at IS NULL`
 *     candidate filter directly from the index without reading
 *     drifted rows. The plain `idx_memory_segments_drift_detected_at`
 *     b-tree index covers the rarer "show me the most recent drift
 *     events" observability queries.
 *
 * @see apps/api/src/memory/memory-drift.constants.ts (milestone 2)
 * @see work item 0cead042-e823-4e26-9386-02042252ffb0
 */
export class AddMemoryDriftDetectedAt20260626000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "memory_segments"
        ADD COLUMN IF NOT EXISTS "drift_detected_at" TIMESTAMP WITH TIME ZONE;
    `);

    // Plain b-tree index on `drift_detected_at`. The detector's
    // secondary "find recent drift" observability queries
    // (`ORDER BY drift_detected_at DESC`) and any future
    // per-segment drift-history lookups read through this column;
    // a sequential scan would dominate query latency as the
    // drifted subset grows. The `idx_<table>_<column>` naming
    // convention mirrors the `idx_memory_segments_last_reinforced_at`
    // index added by the
    // `20260623000000-add-memory-segment-decay-columns` migration.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_memory_segments_drift_detected_at"
        ON "memory_segments" ("drift_detected_at");
    `);

    // Partial b-tree index on the "never-drifted" set, named
    // `idx_memory_segments_drift_detected_at_unset` per the
    // milestone plan (the same `<column>_<partial-condition>`
    // suffix convention used by the project's existing partial
    // indexes, e.g.
    // `idx_memory_segments_pinned_unpinned` and the spec-named
    // `idx_memory_segments_archived_at` for the sibling decay
    // reaper column). The detector's hot candidate filter is
    // `drift_detected_at IS NULL`; a partial index keeps the
    // working set small as the drifted subset grows.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_memory_segments_drift_detected_at_unset"
        ON "memory_segments" ("drift_detected_at")
        WHERE "drift_detected_at" IS NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_memory_segments_drift_detected_at_unset";
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_memory_segments_drift_detected_at";
    `);
    await queryRunner.query(`
      ALTER TABLE "memory_segments"
        DROP COLUMN IF EXISTS "drift_detected_at";
    `);
  }
}
