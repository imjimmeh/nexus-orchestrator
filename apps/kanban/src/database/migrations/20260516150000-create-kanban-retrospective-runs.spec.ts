import { describe, expect, it, vi } from "vitest";
import type { QueryRunner } from "typeorm";
import { CreateKanbanRetrospectiveRuns20260516150000 } from "./20260516150000-create-kanban-retrospective-runs";

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

describe("CreateKanbanRetrospectiveRuns20260516150000", () => {
  const migration = new CreateKanbanRetrospectiveRuns20260516150000();

  it("up creates kanban_retrospective_runs", async () => {
    const qr = createQueryRunnerMock();

    await migration.up(asQueryRunner(qr));

    const calls = qr.query.mock.calls.map((c) => c[0] as string);
    expect(
      calls.some(
        (query) =>
          query.includes(
            "CREATE TABLE IF NOT EXISTS kanban_retrospective_runs",
          ) &&
          query.includes("id UUID PRIMARY KEY DEFAULT gen_random_uuid()") &&
          query.includes(
            "learning_candidate_ids jsonb NOT NULL DEFAULT '[]'::jsonb",
          ),
      ),
    ).toBe(true);
  });

  it("up creates the unique idempotency index", async () => {
    const qr = createQueryRunnerMock();

    await migration.up(asQueryRunner(qr));

    const calls = qr.query.mock.calls.map((c) => c[0] as string);
    expect(
      calls.some(
        (query) =>
          query.includes(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_kanban_retrospective_runs_idempotency_key",
          ) && query.includes("ON kanban_retrospective_runs(idempotency_key)"),
      ),
    ).toBe(true);
  });

  it("up creates project and status lookup indexes", async () => {
    const qr = createQueryRunnerMock();

    await migration.up(asQueryRunner(qr));

    const calls = qr.query.mock.calls.map((c) => c[0] as string);
    expect(
      calls.some(
        (query) =>
          query.includes(
            "CREATE INDEX IF NOT EXISTS idx_kanban_retrospective_runs_project_created",
          ) &&
          query.includes(
            "ON kanban_retrospective_runs(project_id, created_at)",
          ),
      ),
    ).toBe(true);
    expect(
      calls.some(
        (query) =>
          query.includes(
            "CREATE INDEX IF NOT EXISTS idx_kanban_retrospective_runs_status_created",
          ) &&
          query.includes("ON kanban_retrospective_runs(status, created_at)"),
      ),
    ).toBe(true);
  });

  it("down drops kanban_retrospective_runs", async () => {
    const qr = createQueryRunnerMock();

    await migration.down(asQueryRunner(qr));

    expect(qr.query).toHaveBeenCalledWith(
      "DROP TABLE IF EXISTS kanban_retrospective_runs",
    );
  });
});
