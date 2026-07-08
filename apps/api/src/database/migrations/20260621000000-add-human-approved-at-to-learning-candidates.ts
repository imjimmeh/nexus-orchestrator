import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddHumanApprovedAtToLearningCandidates20260621000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "learning_candidates"
      ADD COLUMN IF NOT EXISTS "human_approved_at" TIMESTAMP WITH TIME ZONE;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "learning_candidates"
      DROP COLUMN IF EXISTS "human_approved_at";
    `);
  }
}
