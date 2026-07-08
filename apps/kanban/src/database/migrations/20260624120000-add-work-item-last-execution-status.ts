import { MigrationInterface, QueryRunner } from "typeorm";

export class AddWorkItemLastExecutionStatus20260624120000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "ALTER TABLE kanban_work_items ADD COLUMN last_execution_status varchar NULL",
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "ALTER TABLE kanban_work_items DROP COLUMN last_execution_status",
    );
  }
}
