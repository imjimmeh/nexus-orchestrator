import { MigrationInterface, QueryRunner } from "typeorm";

export class AddProjectOrchestrationSettings20260628120000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "ALTER TABLE kanban_projects ADD COLUMN orchestration_settings jsonb NULL",
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "ALTER TABLE kanban_projects DROP COLUMN orchestration_settings",
    );
  }
}
