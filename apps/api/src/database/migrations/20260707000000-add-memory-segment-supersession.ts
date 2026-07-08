import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * EPIC-212 Phase-3 Task 5 — add the `supersedes` / `superseded_by` self-
 * referential UUID columns to `memory_segments`.
 *
 * When the `MemoryContradictionService` detects a new memory that contradicts
 * an existing one, it links the pair: the new segment's `supersedes` points at
 * the segment it replaced, and the replaced segment's `superseded_by` points at
 * the replacement (and is archived for audit). Both columns are nullable
 * self-referential UUIDs with NO foreign-key constraint — storing the raw UUID
 * avoids insert-ordering issues and follows the project convention of keeping
 * referential integrity at the application layer.
 *
 * Additive + idempotent: a NULL default keeps every existing row valid, so the
 * change is non-destructive and reversible. The partial-free b-tree index on
 * `superseded_by` keeps the "is this segment still live?" reverse lookup cheap
 * as the superseded subset grows.
 */
export class AddMemorySegmentSupersession20260707000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE memory_segments
        ADD COLUMN IF NOT EXISTS supersedes uuid NULL,
        ADD COLUMN IF NOT EXISTS superseded_by uuid NULL;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_memory_segments_superseded_by
        ON memory_segments ("superseded_by");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_memory_segments_superseded_by;
    `);

    await queryRunner.query(`
      ALTER TABLE memory_segments
        DROP COLUMN IF EXISTS supersedes,
        DROP COLUMN IF EXISTS superseded_by;
    `);
  }
}
