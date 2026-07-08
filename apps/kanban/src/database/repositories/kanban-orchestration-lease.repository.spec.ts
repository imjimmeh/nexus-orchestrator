import { describe, expect, it, vi } from "vitest";
import type { DataSource, EntityManager } from "typeorm";
import { KanbanOrchestrationLeaseRepository } from "./kanban-orchestration-lease.repository";

interface ManagerMock {
  query: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
}

function makeManagerMock(overrides: Partial<ManagerMock> = {}): ManagerMock {
  return {
    query: vi.fn().mockResolvedValue([]),
    insert: vi.fn().mockResolvedValue({ identifiers: [{ id: "lease-1" }] }),
    ...overrides,
  };
}

function makeDataSource(mock: ManagerMock): DataSource {
  return {
    transaction: vi.fn(async (cb: (m: EntityManager) => Promise<unknown>) =>
      cb(mock as unknown as EntityManager),
    ),
  } as unknown as DataSource;
}

describe("KanbanOrchestrationLeaseRepository.acquire", () => {
  it("acquires when no active lease exists for the key", async () => {
    const mock = makeManagerMock();
    const repo = new KanbanOrchestrationLeaseRepository(makeDataSource(mock));

    const result = await repo.acquire({
      projectId: "p1",
      lane: "strategy",
      owner: { kind: "cycle_request", id: "corr-1" },
      conflictKeys: [
        { kind: "workflow_scope", value: "project_orchestration_cycle_ceo:p1" },
      ],
      ttlMs: 600000,
    });

    expect(result.acquired).toBe(true);
    // lazy reclaim first, then insert
    expect(mock.query).toHaveBeenCalled();
    expect(mock.insert).toHaveBeenCalledTimes(1);
  });

  it("fails and returns the live holder on unique violation (23505)", async () => {
    const mock = makeManagerMock({
      insert: vi.fn().mockRejectedValue({ code: "23505" }),
      query: vi
        .fn()
        .mockResolvedValueOnce([]) // reclaim update
        .mockResolvedValueOnce([
          {
            conflict_key_kind: "workflow_scope",
            conflict_key_value: "project_orchestration_cycle_ceo:p1",
            owner_kind: "workflow_run",
            owner_id: "run-9",
            expires_at: new Date("2026-06-12T19:00:00Z"),
          },
        ]),
    });
    const repo = new KanbanOrchestrationLeaseRepository(makeDataSource(mock));

    const result = await repo.acquire({
      projectId: "p1",
      lane: "strategy",
      owner: { kind: "cycle_request", id: "corr-2" },
      conflictKeys: [
        { kind: "workflow_scope", value: "project_orchestration_cycle_ceo:p1" },
      ],
      ttlMs: 600000,
    });

    expect(result.acquired).toBe(false);
    if (!result.acquired) {
      expect(result.conflicts[0].heldByOwnerId).toBe("run-9");
    }
  });
});

describe("KanbanOrchestrationLeaseRepository.countActiveByLane", () => {
  it("counts only active leases that have not expired", async () => {
    const count = vi.fn().mockResolvedValue(0);
    const dataSource = {
      getRepository: vi.fn().mockReturnValue({ count }),
    } as unknown as DataSource;
    const repo = new KanbanOrchestrationLeaseRepository(dataSource);

    await repo.countActiveByLane("p1", "strategy");

    const whereArg = count.mock.calls[0][0].where;
    expect(whereArg.project_id).toBe("p1");
    expect(whereArg.lane).toBe("strategy");
    expect(whereArg.status).toBe("active");
    // expires_at must be a MoreThan(now) operator, not absent.
    expect(whereArg.expires_at).toBeDefined();
    expect(whereArg.expires_at._type).toBe("moreThan");
  });
});

describe("KanbanOrchestrationLeaseRepository.listActiveByLane", () => {
  it("returns active unexpired leases scoped to the lane", async () => {
    const find = vi.fn().mockResolvedValue([]);
    const dataSource = {
      getRepository: vi.fn().mockReturnValue({ find }),
    } as unknown as DataSource;
    const repo = new KanbanOrchestrationLeaseRepository(dataSource);

    await repo.listActiveByLane("p1", "strategy");

    const whereArg = find.mock.calls[0][0].where;
    expect(whereArg.project_id).toBe("p1");
    expect(whereArg.lane).toBe("strategy");
    expect(whereArg.status).toBe("active");
    expect(whereArg.expires_at._type).toBe("moreThan");
  });
});
