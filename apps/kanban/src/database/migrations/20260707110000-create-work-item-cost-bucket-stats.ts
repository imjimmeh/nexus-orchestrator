import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateWorkItemCostBucketStats20260707110000 implements MigrationInterface {
  name = "CreateWorkItemCostBucketStats20260707110000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS kanban_work_item_cost_bucket_stats (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tier character varying(32) NOT NULL,
        workflow_id character varying NULL,
        type character varying(16) NOT NULL,
        story_points smallint NULL,
        sample_count integer NOT NULL,
        mean_input_tokens double precision NOT NULL,
        p25_input_tokens double precision NOT NULL,
        p75_input_tokens double precision NOT NULL,
        mean_output_tokens double precision NOT NULL,
        p25_output_tokens double precision NOT NULL,
        p75_output_tokens double precision NOT NULL,
        computed_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_kanban_cost_bucket_stats_key
      ON kanban_work_item_cost_bucket_stats(
        tier,
        COALESCE(workflow_id, ''),
        type,
        COALESCE(story_points, -1)
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "DROP TABLE IF EXISTS kanban_work_item_cost_bucket_stats",
    );
  }
}
