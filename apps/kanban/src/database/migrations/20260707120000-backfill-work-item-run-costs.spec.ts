import { describe, expect, it, vi } from "vitest";
import type { QueryRunner } from "typeorm";
import { BackfillWorkItemRunCosts20260707120000 } from "./20260707120000-backfill-work-item-run-costs";

type QueryRunnerMock = {
  hasTable: ReturnType<typeof vi.fn>;
  query: ReturnType<typeof vi.fn>;
};

function createQueryRunnerMock(): QueryRunnerMock {
  return {
    hasTable: vi.fn().mockResolvedValue(true),
    query: vi.fn().mockResolvedValue(undefined),
  };
}

function asQueryRunner(qr: QueryRunnerMock): QueryRunner {
  return qr as unknown as QueryRunner;
}

describe("BackfillWorkItemRunCosts20260707120000", () => {
  const migration = new BackfillWorkItemRunCosts20260707120000();

  it("backfills one per-run cost row for already-terminal runs with surviving work-item linkage", async () => {
    const qr = createQueryRunnerMock();

    await migration.up(asQueryRunner(qr));

    const sql = qr.query.mock.calls.map((call) => call[0] as string).join("\n");
    expect(sql).toContain("INSERT INTO kanban_work_item_run_costs");
    expect(sql).toContain(
      "JOIN kanban_work_items wi ON wi.id::text = p.work_item_id",
    );
    expect(sql).toContain("FROM budget_usage_events");
    expect(sql).toContain("p.status IN ('COMPLETED', 'FAILED', 'CANCELLED')");
    expect(sql).toContain("p.work_item_id <> '__orchestration_lifecycle__'");
    expect(sql).toContain("COALESCE(agg.cost_cents, 0) > 0");
    expect(sql).toContain("ON CONFLICT (run_id) DO NOTHING");
  });

  it("is a no-op when the run-cost table is absent", async () => {
    const qr = createQueryRunnerMock();
    qr.hasTable
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    await migration.up(asQueryRunner(qr));

    expect(qr.query).not.toHaveBeenCalled();
  });

  it("down is a no-op and does not throw", async () => {
    await expect(migration.down()).resolves.toBeUndefined();
  });
});
