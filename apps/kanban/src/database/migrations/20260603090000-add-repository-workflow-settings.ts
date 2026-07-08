import { MigrationInterface, QueryRunner } from "typeorm";

export class AddRepositoryWorkflowSettings20260603090000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "ALTER TABLE kanban_projects ADD COLUMN IF NOT EXISTS repository_workflow_settings jsonb",
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "ALTER TABLE kanban_projects DROP COLUMN IF EXISTS repository_workflow_settings",
    );
  }
}
