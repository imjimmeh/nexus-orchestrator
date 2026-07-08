import { describe, expect, it, vi } from "vitest";
import { AddPricedTurnCountCostEstimates20260708170000 } from "./20260708170000-add-priced-turn-count-cost-estimates";

describe("AddPricedTurnCountCostEstimates20260708170000", () => {
  it("adds priced turn count columns and backfills run costs from usage events", async () => {
    const queryRunner = {
      hasTable: vi.fn().mockResolvedValue(true),
      query: vi.fn().mockResolvedValue(undefined),
    };
    const migration = new AddPricedTurnCountCostEstimates20260708170000();

    await migration.up(queryRunner as never);

    const sql = queryRunner.query.mock.calls.map(([query]) => query).join("\n");
    expect(queryRunner.hasTable).toHaveBeenCalledWith("budget_usage_events");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS priced_turn_count");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS mean_priced_turn_count");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS p25_priced_turn_count");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS p75_priced_turn_count");
    expect(sql).toContain("budget_usage_events");
    expect(sql).toContain("estimated_cost_cents IS NOT NULL");
    expect(sql).toContain("context_id = r.run_id");
  });

  it("skips usage-event backfill when the API usage table is absent", async () => {
    const queryRunner = {
      hasTable: vi.fn().mockResolvedValue(false),
      query: vi.fn().mockResolvedValue(undefined),
    };
    const migration = new AddPricedTurnCountCostEstimates20260708170000();

    await migration.up(queryRunner as never);

    const sql = queryRunner.query.mock.calls.map(([query]) => query).join("\n");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS priced_turn_count");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS mean_priced_turn_count");
    expect(sql).not.toContain("FROM budget_usage_events");
  });

  it("removes priced turn count columns on rollback", async () => {
    const queryRunner = { query: vi.fn().mockResolvedValue(undefined) };
    const migration = new AddPricedTurnCountCostEstimates20260708170000();

    await migration.down(queryRunner as never);

    const sql = queryRunner.query.mock.calls.map(([query]) => query).join("\n");
    expect(sql).toContain("DROP COLUMN IF EXISTS p75_priced_turn_count");
    expect(sql).toContain("DROP COLUMN IF EXISTS p25_priced_turn_count");
    expect(sql).toContain("DROP COLUMN IF EXISTS mean_priced_turn_count");
    expect(sql).toContain("DROP COLUMN IF EXISTS priced_turn_count");
  });
});
