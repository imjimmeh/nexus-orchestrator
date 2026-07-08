import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateWorkItemRunCosts20260707090000 implements MigrationInterface {
  name = "CreateWorkItemRunCosts20260707090000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS kanban_work_item_run_costs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        work_item_id UUID NOT NULL,
        run_id character varying NOT NULL,
        workflow_id character varying NULL,
        type character varying(16) NOT NULL,
        story_points smallint NULL,
        priority character varying(32) NOT NULL,
        attempt_number integer NOT NULL,
        is_retry boolean NOT NULL,
        model_breakdown jsonb NOT NULL,
        total_input_tokens integer NOT NULL,
        total_output_tokens integer NOT NULL,
        total_cost_cents integer NOT NULL,
        started_at TIMESTAMP NULL,
        completed_at TIMESTAMP NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_kanban_work_item_run_costs_run_id
      ON kanban_work_item_run_costs(run_id);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_kanban_work_item_run_costs_work_item
      ON kanban_work_item_run_costs(work_item_id);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_kanban_work_item_run_costs_bucket
      ON kanban_work_item_run_costs(workflow_id, type, story_points);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DROP TABLE IF EXISTS kanban_work_item_run_costs");
  }
}
