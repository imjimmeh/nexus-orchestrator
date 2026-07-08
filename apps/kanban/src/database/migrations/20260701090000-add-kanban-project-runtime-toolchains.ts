import { MigrationInterface, QueryRunner } from "typeorm";

export class AddKanbanProjectRuntimeToolchains20260701090000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "ALTER TABLE kanban_projects ADD COLUMN IF NOT EXISTS runtime_toolchains jsonb",
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "ALTER TABLE kanban_projects DROP COLUMN IF EXISTS runtime_toolchains",
    );
  }
}
