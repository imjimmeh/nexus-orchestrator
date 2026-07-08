import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add confidence-decay tracking columns to `memory_segments` for the
 * nightly MemoryDecayReaper (work item
 * 3d7fb798-f54d-40ff-a803-438224474912).
 *
 * The reaper walks the table on a cron schedule and applies a per-day
 * confidence decay to rows that are:
 *   - not in a protected source allowlist
 *     (defaults to `learning_candidate`, `workflow_failure_postmortem`,
 *     `strategic_intent` — see `MEMORY_DECAY_EXEMPT_SOURCES`),
 *   - not already archived (`archived_at IS NULL`),
 *   - whose `effective_last_touch =
 *      max(last_accessed_at, last_reinforced_at)` is older than the
 *      configured grace period (`memory_decay_grace_days`, default 30).
 *
 * When a segment's `metadata_json->>'confidence'` (the canonical
 * location for the segment's confidence value, written by the
 * learning promotion pipeline) falls below the
 * `memory_decay_floor` (default 0.2) the reaper sets `archived_at`
 * rather than deleting the row — preserved for auditability.
 *
 * Two new columns are introduced:
 *   - `last_reinforced_at` — nullable `timestamptz`. Bumped by
 *     `MemoryManagerService` (best-effort, fire-and-forget) on every
 *     read of a segment via `getMemorySegments` /
 *     `searchMemory`. The reaper uses `max(last_accessed_at,
 *     last_reinforced_at)` as the "effective last touch" so
 *     frequently-consumed segments stay fresh and avoid spurious
 *     decay. Existing rows are backfilled to `NOW()` at migration
 *     time so the column doesn't read as "never reinforced" for
 *     legacy segments; new rows default to NULL and are populated
 *     by the application on first read.
 *   - `archived_at` — nullable `timestamptz`, indexed (partial on
 *     `archived_at IS NULL`, named `idx_memory_segments_archived_at`).
 *     Set by the reaper when a segment's decayed confidence falls
 *     below the floor. The partial index targets the "active" set —
 *     most production rows will be un-archived, so the planner can
 *     serve the reaper's `WHERE archived_at IS NULL` candidate
 *     filter directly from the index without reading archived
 *     rows. The plain `idx_memory_segments_last_reinforced_at`
 *     b-tree index is added alongside so the reaper's
 *     `last_reinforced_at`-window scan
 *     (`WHERE last_reinforced_at < :cutoff`) is not a sequential
 *     scan on the segments table — the same scan is the input to
 *     the eviction-style `last_accessed_at` fallback, so a
 *     separate index here keeps the reaper's hot path planner
 *     cost bounded as the segments table grows.
 *
 * The reaper is kill-switchable via the `memory_decay_enabled`
 * SystemSetting (default `true`) and re-registers its schedule when
 * the operator updates `memory_decay_cron` (default `30 3 * * *` —
 * daily 03:30 UTC).
 *
 * Notes:
 *   - Both columns are nullable to keep the migration non-disruptive
 *     for the existing memory-write flows that did not populate
 *     either field. The reaper treats `NULL` "never touched" and
 *     falls back to `created_at` when computing the effective
 *     last-touch.
 *   - `last_reinforced_at` is backfilled to `NOW()` for rows that
 *     existed before this migration so the reaper's
 *     `effective_last_touch = max(last_accessed_at,
 *     last_reinforced_at)` does not skew toward "never reinforced"
 *     for the entire pre-migration population. The backfill is a
 *     one-shot `UPDATE` issued immediately after the `ADD COLUMN`,
 *     so the partial-index / backfill ordering is atomic from the
 *     caller's perspective.
 *   - The `archived_at` index is a *partial* b-tree on
 *     `archived_at IS NULL`, named `idx_memory_segments_archived_at`
 *     to follow the convention called for by the milestone plan (the
 *     simpler `<column>` form, as opposed to the project's
 *     `<column>_<partial-condition>` convention used for
 *     `idx_memory_segments_pinned_unpinned`). PostgreSQL partial
 *     indexes are supported by this project's migration pattern
 *     (see the `pinned` index on the same table, introduced by the
 *     `20260617000000-add-memory-segment-eviction-columns`
 *     migration). The partial form is preferred because the
 *     candidate filter is the hot path; the rare "when did this row
 *     get archived" audit query can still use a sequential scan
 *     against the small archived subset.
 *   - The `last_reinforced_at` index is a plain b-tree named
 *     `idx_memory_segments_last_reinforced_at`. The reaper's
 *     "effective last touch" computation
 *     (`max(last_accessed_at, last_reinforced_at)`) does an
 *     `ORDER BY last_reinforced_at` on the candidate set; without
 *     the index that ordering step is a sequential scan, which
 *     dominates the reaper's runtime as the table grows. A plain
 *     b-tree is sufficient — the column is monotonic-ish (always
 *     increasing) so a partial index would not shrink the working
 *     set enough to be worth the loss of generality (the
 *     `last_reinforced_at IS NULL` predicate is rare, since the
 *     backfill above sets it to `NOW()` for every legacy row).
 */
export class AddMemorySegmentDecayColumns20260623000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "memory_segments"
        ADD COLUMN IF NOT EXISTS "last_reinforced_at" TIMESTAMP WITH TIME ZONE,
        ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMP WITH TIME ZONE;
    `);

    // Backfill existing rows so the column doesn't read as "never
    // reinforced" for the entire pre-migration population. New rows
    // remain free to be NULL until the application bumps them on
    // first read. The WHERE clause is defensive — newly-added rows
    // from concurrent inserts will already be NULL or set by the
    // application, so the UPDATE only touches rows that were
    // backfilled to NULL by the ADD COLUMN above.
    await queryRunner.query(`
      UPDATE "memory_segments"
        SET "last_reinforced_at" = NOW()
        WHERE "last_reinforced_at" IS NULL;
    `);

    // Plain b-tree index on `last_reinforced_at`. The reaper's
    // candidate-set ordering and "effective last touch" calculation
    // (`max(last_accessed_at, last_reinforced_at)`) reads through
    // this column on every pass; a sequential scan would dominate
    // the reaper's runtime as the table grows. The
    // `20260617000000-add-memory-segment-eviction-columns`
    // migration established the convention of naming per-column
    // indexes `idx_<table>_<column>` in raw SQL, and the
    // milestone plan for this column explicitly calls for the
    // name `idx_memory_segments_last_reinforced_at` — we adopt
    // both.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_memory_segments_last_reinforced_at"
        ON "memory_segments" ("last_reinforced_at");
    `);

    // Partial b-tree index on the "active" set, named
    // `idx_memory_segments_archived_at` per the milestone plan.
    // The reaper's hot candidate filter is `archived_at IS NULL`; a
    // partial index keeps the working set small as the archived
    // subset grows. We deliberately use the spec's literal
    // `<column>` form here even though the project's existing
    // partial-index convention (e.g.
    // `idx_memory_segments_pinned_unpinned`) uses a
    // `<column>_<partial-condition>` suffix — the spec is
    // unambiguous about the name and the convention difference
    // is not load-bearing for the reaper's hot path.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_memory_segments_archived_at"
        ON "memory_segments" ("archived_at")
        WHERE "archived_at" IS NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_memory_segments_archived_at";
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_memory_segments_last_reinforced_at";
    `);
    await queryRunner.query(`
      ALTER TABLE "memory_segments"
        DROP COLUMN IF EXISTS "archived_at",
        DROP COLUMN IF EXISTS "last_reinforced_at";
    `);
  }
}
