import type { MigrationInterface, QueryRunner } from "typeorm";

export class DeduplicateWorkItemCostBucketStats20260708150000 implements MigrationInterface {
  name = "DeduplicateWorkItemCostBucketStats20260708150000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      WITH ranked AS (
        SELECT
          id,
          ROW_NUMBER() OVER (
            PARTITION BY tier, workflow_id, type, story_points
            ORDER BY computed_at DESC, id DESC
          ) AS row_number
        FROM kanban_work_item_cost_bucket_stats
      )
      DELETE FROM kanban_work_item_cost_bucket_stats stats
      USING ranked
      WHERE stats.id = ranked.id
        AND ranked.row_number > 1;
    `);

    await queryRunner.query(
      "DROP INDEX IF EXISTS idx_kanban_cost_bucket_stats_key",
    );

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_kanban_cost_bucket_stats_key
      ON kanban_work_item_cost_bucket_stats(tier, workflow_id, type, story_points)
      NULLS NOT DISTINCT;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "DROP INDEX IF EXISTS idx_kanban_cost_bucket_stats_key",
    );

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_kanban_cost_bucket_stats_key
      ON kanban_work_item_cost_bucket_stats(tier, workflow_id, type, story_points);
    `);
  }
}
