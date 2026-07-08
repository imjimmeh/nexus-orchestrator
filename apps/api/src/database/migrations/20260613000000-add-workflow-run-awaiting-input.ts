import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWorkflowRunAwaitingInput20260613000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS awaiting_input boolean NOT NULL DEFAULT false;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE workflow_runs DROP COLUMN IF EXISTS awaiting_input;`,
    );
  }
}
