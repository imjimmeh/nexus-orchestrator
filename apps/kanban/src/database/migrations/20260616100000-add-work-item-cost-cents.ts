import { MigrationInterface, QueryRunner } from "typeorm";

export class AddWorkItemCostCents20260616100000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "ALTER TABLE kanban_work_items ADD COLUMN cost_cents integer NOT NULL DEFAULT 0",
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "ALTER TABLE kanban_work_items DROP COLUMN cost_cents",
    );
  }
}
