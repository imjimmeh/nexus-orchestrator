import { describe, expect, it, vi } from "vitest";
import type { QueryRunner } from "typeorm";
import { BackfillWorkItemTokenSpend20260619090000 } from "./20260619090000-backfill-work-item-token-spend";

type QueryRunnerMock = {
  hasTable: ReturnType<typeof vi.fn>;
  hasColumn: ReturnType<typeof vi.fn>;
  query: ReturnType<typeof vi.fn>;
};

function createQueryRunnerMock(): QueryRunnerMock {
  return {
    hasTable: vi.fn().mockResolvedValue(true),
    hasColumn: vi.fn().mockResolvedValue(true),
    query: vi.fn().mockResolvedValue(undefined),
  };
}

function asQueryRunner(qr: QueryRunnerMock): QueryRunner {
  return qr as unknown as QueryRunner;
}

describe("BackfillWorkItemTokenSpend20260619090000", () => {
  const migration = new BackfillWorkItemTokenSpend20260619090000();

  it("backfills only already-terminal runs onto untouched rows", async () => {
    const qr = createQueryRunnerMock();

    await migration.up(asQueryRunner(qr));

    const sql = qr.query.mock.calls.map((c) => c[0] as string).join("\n");
    expect(sql).toContain("UPDATE kanban_work_items");
    expect(sql).toContain(
      "JOIN budget_usage_events b ON b.context_id = p.run_id",
    );
    expect(sql).toContain("p.status IN ('COMPLETED', 'FAILED', 'CANCELLED')");
    expect(sql).toContain("p.work_item_id <> '__orchestration_lifecycle__'");
    expect(sql).toContain("wi.token_spend = 0");
    expect(sql).toContain("wi.cost_cents = 0");
  });

  it("is a no-op when budget_usage_events is absent", async () => {
    const qr = createQueryRunnerMock();
    // up() probes work items, then projections, then budget_usage_events.
    qr.hasTable
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    await migration.up(asQueryRunner(qr));

    expect(qr.query).not.toHaveBeenCalled();
  });

  it("is a no-op when the cost_cents column is absent", async () => {
    const qr = createQueryRunnerMock();
    qr.hasColumn.mockResolvedValue(false);

    await migration.up(asQueryRunner(qr));

    expect(qr.query).not.toHaveBeenCalled();
  });

  it("down is a no-op and does not throw", async () => {
    await expect(migration.down()).resolves.toBeUndefined();
  });
});
