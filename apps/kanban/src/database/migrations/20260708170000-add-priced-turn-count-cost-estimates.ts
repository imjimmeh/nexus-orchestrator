import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPricedTurnCountCostEstimates20260708170000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE kanban_work_item_run_costs
      ADD COLUMN IF NOT EXISTS priced_turn_count integer NOT NULL DEFAULT 0;
    `);

    if (await queryRunner.hasTable("budget_usage_events")) {
      await queryRunner.query(`
        UPDATE kanban_work_item_run_costs r
        SET priced_turn_count = COALESCE((
          SELECT COUNT(*)::integer
          FROM budget_usage_events e
          WHERE e.context_id = r.run_id
            AND e.estimated_cost_cents IS NOT NULL
        ), 0);
      `);
    }

    await queryRunner.query(`
      ALTER TABLE kanban_work_item_cost_bucket_stats
      ADD COLUMN IF NOT EXISTS mean_priced_turn_count double precision NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS p25_priced_turn_count double precision NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS p75_priced_turn_count double precision NOT NULL DEFAULT 0;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE kanban_work_item_cost_bucket_stats
      DROP COLUMN IF EXISTS p75_priced_turn_count,
      DROP COLUMN IF EXISTS p25_priced_turn_count,
      DROP COLUMN IF EXISTS mean_priced_turn_count;
    `);

    await queryRunner.query(`
      ALTER TABLE kanban_work_item_run_costs
      DROP COLUMN IF EXISTS priced_turn_count;
    `);
  }
}
