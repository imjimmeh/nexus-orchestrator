import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUserQuestionAwaits20260619000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS user_question_awaits (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workflow_run_id UUID NOT NULL,
        job_id character varying(255) NOT NULL,
        step_id character varying(255) NOT NULL,
        questions jsonb NOT NULL,
        answers jsonb,
        status character varying(32) NOT NULL DEFAULT 'pending',
        delivered_via character varying(16),
        answered_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_user_question_awaits_run_status
      ON user_question_awaits(workflow_run_id, status);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS user_question_awaits');
  }
}
