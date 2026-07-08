import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add usage-tracking columns to `memory_segments` for the daily
 * MemoryEvictionReaper (work item bef49c3a-0c0f-4c85-b134-29d839c72bad).
 *
 * The reaper walks the table on a cron schedule and evicts rows that are
 *   - not pinned,
 *   - not in a protected source allowlist (e.g. `learning_candidate`),
 *   - have not been accessed within `memory_segment_eviction_max_idle_days`
 *     (the `last_accessed_at` is null OR older than the threshold), and
 *   - have an `access_count` below `memory_segment_eviction_min_access_count`.
 *
 * These columns were missing from the original baseline. Without them the
 * reaper has no schema to query against, and the downstream integration
 * test (separate milestone) that seeds 10 segments across 4 sources and
 * asserts 7 evicted / 3 retained would have no eviction surface to read
 * from. The column defaults are chosen so the new columns are non-disruptive
 * for the existing memory-write flows that write rows without populating
 * the new fields: `pinned = false`, `access_count = 0`, `source = NULL`
 * (the reaper treats null source as a candidate unless the operator later
 * tightens the allowlist).
 *
 * Notes:
 *   - `last_accessed_at` is nullable. A null value is treated by the reaper
 *     as "never touched" and is eligible for eviction when the row's
 *     `created_at` is older than the threshold (defensive: a row that
 *     existed before this migration never got a touch).
 *   - `source` is nullable. Existing rows that did not record a `source`
 *     in their `metadata_json` continue to work; the reaper treats null
 *     source as a candidate for eviction (unless the operator pins the row).
 *   - The `pinned` index is partial (pinned = false) so the reaper's
 *     "where pinned = false" predicate stays cheap as the table grows.
 *   - The `source` index supports the "where source not in (...)" allowlist
 *     lookup. Most reads will be on a small hot subset of sources, so a
 *     plain b-tree is sufficient.
 */
export class AddMemorySegmentEvictionColumns20260617000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "memory_segments"
        ADD COLUMN IF NOT EXISTS "last_accessed_at" TIMESTAMP WITH TIME ZONE,
        ADD COLUMN IF NOT EXISTS "access_count" integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "pinned" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "source" character varying(64);
    `);

    // Partial index — most rows are unpinned, so the reaper's candidate
    // filter `pinned = false` becomes a scan-friendly bitmap lookup.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_memory_segments_pinned_unpinned"
        ON "memory_segments" ("pinned")
        WHERE "pinned" = false;
    `);

    // Source index — supports the allowlist filter and ad-hoc audit
    // queries. A plain b-tree is sufficient because most production
    // segments will use one of a small set of source values.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_memory_segments_source"
        ON "memory_segments" ("source");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_memory_segments_source";
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_memory_segments_pinned_unpinned";
    `);
    await queryRunner.query(`
      ALTER TABLE "memory_segments"
        DROP COLUMN IF EXISTS "source",
        DROP COLUMN IF EXISTS "pinned",
        DROP COLUMN IF EXISTS "access_count",
        DROP COLUMN IF EXISTS "last_accessed_at";
    `);
  }
}
