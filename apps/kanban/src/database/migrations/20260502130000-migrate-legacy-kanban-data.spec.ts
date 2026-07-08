import { describe, it, expect, vi, type Mock } from "vitest";
import type { QueryRunner } from "typeorm";
import { MigrateLegacyKanbanData20260502130000 } from "./20260502130000-migrate-legacy-kanban-data";

type QueryRunnerMock = {
  hasTable: Mock<(table: string) => Promise<boolean>>;
  hasColumn: Mock<(table: string, column: string) => Promise<boolean>>;
  query: Mock<(query: string, parameters?: any[]) => Promise<any>>;
};

function createQueryRunnerMock(): QueryRunnerMock {
  return {
    hasTable: vi.fn<(table: string) => Promise<boolean>>(),
    hasColumn: vi
      .fn<(table: string, column: string) => Promise<boolean>>()
      .mockResolvedValue(true),
    query: vi
      .fn<(query: string, parameters?: any[]) => Promise<any>>()
      .mockResolvedValue(undefined),
  };
}

function asQueryRunner(qr: QueryRunnerMock): QueryRunner {
  return qr as unknown as QueryRunner;
}

describe("MigrateLegacyKanbanData20260502130000", () => {
  const migration = new MigrateLegacyKanbanData20260502130000();

  function setupTablesExist(
    qr: QueryRunnerMock,
    tables: { old?: string[]; new?: string[] } = {},
  ): void {
    const oldSet = new Set(tables.old ?? []);
    const newSet = new Set(tables.new ?? []);
    qr.hasTable.mockImplementation((table: string) => {
      if (oldSet.has(table) || newSet.has(table)) return Promise.resolve(true);
      return Promise.resolve(false);
    });
  }

  it("runs all migration steps when old and new tables exist", async () => {
    const qr = createQueryRunnerMock();
    setupTablesExist(qr, {
      old: [
        "projects",
        "work_items",
        "work_item_dependencies",
        "work_item_subtasks",
        "project_goals",
        "project_goal_worklogs",
        "project_orchestrations",
        "project_orchestration_action_requests",
        "project_agent_capacities",
        "project_members",
      ],
      new: [
        "kanban_projects",
        "kanban_work_items",
        "kanban_work_item_dependencies",
        "kanban_work_item_subtasks",
        "kanban_project_goals",
        "kanban_project_goal_worklogs",
        "kanban_orchestrations",
      ],
    });

    await migration.up(asQueryRunner(qr));

    const calls = qr.query.mock.calls.map((c) => c[0]);

    // Verify each table migration was attempted
    expect(calls.some((q) => q.includes("kanban_projects"))).toBe(true);
    expect(calls.some((q) => q.includes("kanban_work_items"))).toBe(true);
    expect(calls.some((q) => q.includes("kanban_work_item_dependencies"))).toBe(
      true,
    );
    expect(calls.some((q) => q.includes("kanban_work_item_subtasks"))).toBe(
      true,
    );
    expect(calls.some((q) => q.includes("kanban_project_goals"))).toBe(true);
    expect(calls.some((q) => q.includes("kanban_project_goal_worklogs"))).toBe(
      true,
    );
    expect(calls.some((q) => q.includes("kanban_orchestrations"))).toBe(true);
    expect(calls.some((q) => q.includes("_legacy_agent_capacities"))).toBe(
      true,
    );
    expect(calls.some((q) => q.includes("_legacy_members"))).toBe(true);
  });

  it("skips migration when old tables do not exist", async () => {
    const qr = createQueryRunnerMock();
    setupTablesExist(qr, { new: ["kanban_projects"] });

    await migration.up(asQueryRunner(qr));

    expect(qr.query).not.toHaveBeenCalled();
  });

  it("skips migration when new tables do not exist", async () => {
    const qr = createQueryRunnerMock();
    setupTablesExist(qr, { old: ["projects"] });

    await migration.up(asQueryRunner(qr));

    expect(qr.query).not.toHaveBeenCalled();
  });

  it("idempotent project migration skips existing rows", async () => {
    const qr = createQueryRunnerMock();
    setupTablesExist(qr, {
      old: ["projects"],
      new: ["kanban_projects"],
    });

    await migration.up(asQueryRunner(qr));

    const projectQuery = qr.query.mock.calls.find((c) =>
      c[0].includes("kanban_projects"),
    );
    expect(projectQuery?.[0]).toContain("NOT EXISTS");
    expect(projectQuery?.[0]).toContain("kp.id = projects.id");
  });

  it("folds discovery columns into metadata for work items", async () => {
    const qr = createQueryRunnerMock();
    setupTablesExist(qr, {
      old: ["work_items"],
      new: ["kanban_work_items"],
    });

    await migration.up(asQueryRunner(qr));

    const workItemQuery = qr.query.mock.calls.find((c) =>
      c[0].includes("kanban_work_items"),
    );
    expect(workItemQuery?.[0]).toContain("_legacy_provenance");
    expect(workItemQuery?.[0]).toContain("_legacy_source_id");
    expect(workItemQuery?.[0]).toContain("_legacy_source_path");
  });

  it("migrates action requests as JSONB array", async () => {
    const qr = createQueryRunnerMock();
    setupTablesExist(qr, {
      old: ["project_orchestrations", "project_orchestration_action_requests"],
      new: ["kanban_orchestrations"],
    });

    await migration.up(asQueryRunner(qr));

    const orchestrationQueries = qr.query.mock.calls.filter((c) =>
      c[0].includes("kanban_orchestrations"),
    );
    expect(orchestrationQueries.length).toBeGreaterThanOrEqual(2);

    const actionRequestQuery = orchestrationQueries.find((c) =>
      c[0].includes("jsonb_agg"),
    );
    expect(actionRequestQuery?.[0]).toContain("jsonb_agg");
    expect(actionRequestQuery?.[0]).toContain(
      "project_orchestration_action_requests",
    );
  });

  it("folds agent capacities into project metadata", async () => {
    const qr = createQueryRunnerMock();
    setupTablesExist(qr, {
      old: ["project_agent_capacities", "projects"],
      new: ["kanban_projects"],
    });

    await migration.up(asQueryRunner(qr));

    const capacityQuery = qr.query.mock.calls.find((c) =>
      c[0].includes("_legacy_agent_capacities"),
    );
    expect(capacityQuery?.[0]).toContain("kanban_projects");
    expect(capacityQuery?.[0]).toContain("project_agent_capacities");
  });

  it("folds project members into project metadata", async () => {
    const qr = createQueryRunnerMock();
    setupTablesExist(qr, {
      old: ["project_members", "projects"],
      new: ["kanban_projects"],
    });

    await migration.up(asQueryRunner(qr));

    const memberQuery = qr.query.mock.calls.find((c) =>
      c[0].includes("_legacy_members"),
    );
    expect(memberQuery?.[0]).toContain("kanban_projects");
    expect(memberQuery?.[0]).toContain("project_members");
  });

  it("down() truncates all kanban tables", async () => {
    const qr = createQueryRunnerMock();
    await migration.down(asQueryRunner(qr));

    const calls = qr.query.mock.calls.map((c) => c[0]);
    expect(calls).toHaveLength(7);
    expect(calls.every((q) => q.includes("TRUNCATE"))).toBe(true);
  });
});
