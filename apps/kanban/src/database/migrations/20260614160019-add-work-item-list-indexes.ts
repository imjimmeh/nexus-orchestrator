import { MigrationInterface, QueryRunner } from "typeorm";

export class AddWorkItemListIndexes20260614160019 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_kanban_work_items_updated_at
      ON kanban_work_items(updated_at);
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_kanban_work_items_project_updated
      ON kanban_work_items(project_id, updated_at);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_kanban_work_items_project_updated;`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_kanban_work_items_updated_at;`,
    );
  }
}
