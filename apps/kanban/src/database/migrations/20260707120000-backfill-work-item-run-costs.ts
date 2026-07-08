import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * One-time backfill of `kanban_work_item_run_costs` from already-terminal
 * runs recorded before this feature existed. Only reconstructable where
 * `kanban_core_run_projections` still links a run to a work item. Uses each
 * work item's current type/story_points/priority as the historical snapshot,
 * since the true value at execution time is not recoverable from usage alone.
 *
 * Idempotent: `run_id` is unique on `kanban_work_item_run_costs`, so
 * `INSERT ... ON CONFLICT (run_id) DO NOTHING` makes re-running safe and never
 * clobbers a row the forward-accrual path has since written.
 */
export class BackfillWorkItemRunCosts20260707120000 implements MigrationInterface {
  name = "BackfillWorkItemRunCosts20260707120000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasWorkItems = await queryRunner.hasTable("kanban_work_items");
    const hasProjections = await queryRunner.hasTable(
      "kanban_core_run_projections",
    );
    const hasUsageEvents = await queryRunner.hasTable("budget_usage_events");
    const hasRunCosts = await queryRunner.hasTable(
      "kanban_work_item_run_costs",
    );
    if (!hasWorkItems || !hasProjections || !hasUsageEvents || !hasRunCosts) {
      return;
    }

    await queryRunner.query(`
      INSERT INTO kanban_work_item_run_costs (
        work_item_id, run_id, workflow_id, type, story_points, priority,
        attempt_number, is_retry, model_breakdown,
        total_input_tokens, total_output_tokens, total_cost_cents,
        started_at, completed_at
      )
      SELECT
        wi.id,
        p.run_id,
        p.workflow_id,
        wi.type,
        wi.story_points,
        wi.priority,
        1,
        false,
        '[]'::jsonb,
        COALESCE(agg.input_tokens, 0),
        COALESCE(agg.output_tokens, 0),
        COALESCE(agg.cost_cents, 0),
        NULL,
        NULL
      FROM kanban_core_run_projections p
      JOIN kanban_work_items wi ON wi.id::text = p.work_item_id
      JOIN (
        SELECT context_id,
               SUM(input_tokens) AS input_tokens,
               SUM(output_tokens) AS output_tokens,
               SUM(estimated_cost_cents) AS cost_cents
        FROM budget_usage_events
        GROUP BY context_id
      ) agg ON agg.context_id = p.run_id
      WHERE p.work_item_id IS NOT NULL
        AND p.work_item_id <> '__orchestration_lifecycle__'
        AND p.status IN ('COMPLETED', 'FAILED', 'CANCELLED')
        AND COALESCE(agg.cost_cents, 0) > 0
      ON CONFLICT (run_id) DO NOTHING
    `);
  }

  public async down(): Promise<void> {
    // No-op: deleting rows would risk removing forward-accrued rows for the
    // same run IDs, and backfilled rows are not distinguishable afterwards.
  }
}
