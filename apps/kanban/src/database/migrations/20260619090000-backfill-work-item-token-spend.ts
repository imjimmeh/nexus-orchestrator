import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Migration: Backfill historical token spend and estimated cost onto work items.
 *
 * The per-work-item `token_spend` / `cost_cents` columns are denormalized
 * convenience copies; `budget_usage_events` remains the source of truth. They
 * are normally populated forward by the core lifecycle consumer when a run
 * reaches a terminal state. Runs that completed before that accrual was fixed
 * left every work item at zero, so this one-time reconciliation sums the
 * historical usage onto already-terminal runs.
 *
 * The run -> work-item association lives in `kanban_core_run_projections`
 * (kanban-owned); usage totals live in `budget_usage_events`. This migration is
 * the only place these are joined directly — the runtime path stays event-driven
 * to avoid coupling. It is guarded so it is a safe no-op where those tables are
 * absent (e.g. a kanban-only deployment).
 *
 * Idempotency / no double-count:
 *  - Only already-terminal runs (COMPLETED/FAILED/CANCELLED) are summed; in-flight
 *    runs are left to the forward accrual when they terminate.
 *  - Only rows still at zero are written, so re-running never clobbers values the
 *    forward path has since accrued.
 */
export class BackfillWorkItemTokenSpend20260619090000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasWorkItems = await queryRunner.hasTable("kanban_work_items");
    const hasProjections = await queryRunner.hasTable(
      "kanban_core_run_projections",
    );
    const hasUsageEvents = await queryRunner.hasTable("budget_usage_events");
    if (!hasWorkItems || !hasProjections || !hasUsageEvents) {
      return;
    }

    // `cost_cents` is added by a separate migration; guard so this backfill is a
    // safe no-op in any environment where cost tracking is not yet present.
    const hasCostCents = await queryRunner.hasColumn(
      "kanban_work_items",
      "cost_cents",
    );
    if (!hasCostCents) {
      return;
    }

    await queryRunner.query(`
      UPDATE kanban_work_items wi
      SET token_spend = agg.tok,
          cost_cents = agg.cents,
          updated_at = NOW()
      FROM (
        SELECT p.work_item_id,
               p.project_id,
               COALESCE(SUM(b.total_tokens), 0) AS tok,
               COALESCE(SUM(b.estimated_cost_cents), 0) AS cents
        FROM kanban_core_run_projections p
        JOIN budget_usage_events b ON b.context_id = p.run_id
        WHERE p.work_item_id IS NOT NULL
          AND p.work_item_id <> '__orchestration_lifecycle__'
          AND p.status IN ('COMPLETED', 'FAILED', 'CANCELLED')
        GROUP BY p.work_item_id, p.project_id
      ) agg
      WHERE wi.id::text = agg.work_item_id
        AND wi.project_id::text = agg.project_id
        AND wi.token_spend = 0
        AND wi.cost_cents = 0
        AND (agg.tok > 0 OR agg.cents > 0)
    `);
  }

  public async down(): Promise<void> {
    // No-op: this is a denormalized reconciliation from budget_usage_events
    // (the source of truth). Reversing it cannot distinguish backfilled values
    // from spend the forward accrual has since added, so resetting would be
    // destructive. The data is fully recoverable by re-running up().
  }
}
