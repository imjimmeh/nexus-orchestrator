import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateKanbanInitiatives20260612200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS kanban_initiatives (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID NOT NULL,
        title character varying(255) NOT NULL,
        description text,
        horizon character varying(16) NOT NULL DEFAULT 'next',
        priority integer NOT NULL DEFAULT 0,
        status character varying(16) NOT NULL DEFAULT 'proposed',
        last_reviewed_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_kanban_initiatives_project_id
      ON kanban_initiatives(project_id)
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS kanban_initiative_goals (
        initiative_id UUID NOT NULL REFERENCES kanban_initiatives(id) ON DELETE CASCADE,
        goal_id UUID NOT NULL,
        PRIMARY KEY (initiative_id, goal_id)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_kanban_initiative_goals_goal_id
      ON kanban_initiative_goals(goal_id)
    `);

    await queryRunner.query(`
      ALTER TABLE kanban_work_items
      ADD COLUMN IF NOT EXISTS initiative_id UUID REFERENCES kanban_initiatives(id) ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE kanban_work_items DROP COLUMN IF EXISTS initiative_id`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS kanban_initiative_goals`);
    await queryRunner.query(`DROP TABLE IF EXISTS kanban_initiatives`);
  }
}
