import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWorkflowRunWaitReason20260617010000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS wait_reason varchar(16) DEFAULT NULL;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE workflow_runs DROP COLUMN IF EXISTS wait_reason;`,
    );
  }
}
