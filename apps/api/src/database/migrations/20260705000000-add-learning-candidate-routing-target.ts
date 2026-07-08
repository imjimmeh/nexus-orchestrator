import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * EPIC-212 Phase-2 Task 8 — add the deterministic `routing_target` column to
 * `learning_candidates`.
 *
 * The nightly clusterer pass writes one of `project | global | agent_preference
 * | skill_new | skill_patch | drop` onto every pending candidate (via
 * `LearningRouterService`) so the column is populated BEFORE the 2am sweep /
 * promotion consults it. Additive + idempotent: a null value falls back to the
 * legacy `project`-default promotion behaviour, so the change is non-destructive
 * and reversible.
 */
export class AddLearningCandidateRoutingTarget20260705000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE learning_candidates
        ADD COLUMN IF NOT EXISTS routing_target varchar(24) NULL;
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_learning_candidates_routing_target
        ON learning_candidates (routing_target);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_learning_candidates_routing_target;
    `);
    await queryRunner.query(`
      ALTER TABLE learning_candidates
        DROP COLUMN IF EXISTS routing_target;
    `);
  }
}
