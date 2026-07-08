import { describe, expect, it, vi } from "vitest";
import type { QueryRunner } from "typeorm";
import { DeduplicateWorkItemCostBucketStats20260708150000 } from "./20260708150000-deduplicate-work-item-cost-bucket-stats";

type QueryRunnerMock = {
  query: ReturnType<typeof vi.fn>;
};

function createQueryRunnerMock(): QueryRunnerMock {
  return {
    query: vi.fn().mockResolvedValue(undefined),
  };
}

function asQueryRunner(qr: QueryRunnerMock): QueryRunner {
  return qr as unknown as QueryRunner;
}

describe("DeduplicateWorkItemCostBucketStats20260708150000", () => {
  const migration = new DeduplicateWorkItemCostBucketStats20260708150000();

  it("keeps the newest duplicate bucket and makes nullable bucket keys unique", async () => {
    const qr = createQueryRunnerMock();

    await migration.up(asQueryRunner(qr));

    const sql = qr.query.mock.calls.map((call) => call[0] as string).join("\n");
    expect(sql).toContain("ROW_NUMBER() OVER");
    expect(sql).toContain("ORDER BY computed_at DESC");
    expect(sql).toContain(
      "DROP INDEX IF EXISTS idx_kanban_cost_bucket_stats_key",
    );
    expect(sql).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_kanban_cost_bucket_stats_key",
    );
    expect(sql).toContain("NULLS NOT DISTINCT");
    expect(sql).toContain("tier, workflow_id, type, story_points");
  });

  it("restores the previous nullable-column unique index on rollback", async () => {
    const qr = createQueryRunnerMock();

    await migration.down(asQueryRunner(qr));

    const sql = qr.query.mock.calls.map((call) => call[0] as string).join("\n");
    expect(sql).toContain(
      "DROP INDEX IF EXISTS idx_kanban_cost_bucket_stats_key",
    );
    expect(sql).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_kanban_cost_bucket_stats_key",
    );
    expect(sql).toContain(
      "ON kanban_work_item_cost_bucket_stats(tier, workflow_id, type, story_points)",
    );
  });
});
