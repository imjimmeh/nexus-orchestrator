import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLearningCandidateDecisionColumns20260711000000 implements MigrationInterface {
  name = 'AddLearningCandidateDecisionColumns20260711000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE learning_candidates
      ADD COLUMN IF NOT EXISTS rejected_by character varying(128),
      ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
      ADD COLUMN IF NOT EXISTS archived_by character varying(128),
      ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS archive_reason TEXT;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE learning_candidates
      DROP COLUMN IF EXISTS archive_reason,
      DROP COLUMN IF EXISTS archived_at,
      DROP COLUMN IF EXISTS archived_by,
      DROP COLUMN IF EXISTS rejection_reason,
      DROP COLUMN IF EXISTS rejected_at,
      DROP COLUMN IF EXISTS rejected_by;
    `);
  }
}
