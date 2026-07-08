import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateKanbanProjectCharterItems20260624120000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS kanban_project_charter_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID NOT NULL,
        category character varying(64) NOT NULL,
        content text NOT NULL,
        memory_type character varying(32) NOT NULL DEFAULT 'fact',
        source character varying(64) NOT NULL DEFAULT 'user_edit',
        version integer NOT NULL DEFAULT 1,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_kanban_project_charter_items_project
        ON kanban_project_charter_items(project_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "DROP TABLE IF EXISTS kanban_project_charter_items",
    );
  }
}
