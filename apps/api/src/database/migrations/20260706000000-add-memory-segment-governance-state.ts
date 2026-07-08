import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * EPIC-212 Phase-2 Task 9 — add the `governance_state` column to
 * `memory_segments`.
 *
 * Values: `provisional` (an auto-promotion still inside its probation window —
 * Phase 3 confirms or reverts it), `confirmed` (a settled segment), or NULL
 * (a legacy row written before governance existed; readers treat NULL as
 * confirmed). Additive + idempotent: a NULL default keeps every existing row
 * valid, so the change is non-destructive and reversible.
 */
export class AddMemorySegmentGovernanceState20260706000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE memory_segments
        ADD COLUMN IF NOT EXISTS governance_state varchar(24) NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE memory_segments
        DROP COLUMN IF EXISTS governance_state;
    `);
  }
}
