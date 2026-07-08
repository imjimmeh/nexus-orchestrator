import { describe, expect, it, vi } from "vitest";
import { LANE_CAPACITY_CONFLICT_PREFIX } from "./control-plane.types";
import { OrchestrationLeaseService } from "./orchestration-lease.service";

function makeRepo(overrides: Record<string, unknown> = {}) {
  return {
    acquire: vi.fn().mockResolvedValue({ acquired: true, leaseIds: ["l1"] }),
    heartbeat: vi.fn().mockResolvedValue(undefined),
    release: vi.fn().mockResolvedValue(true),
    countActiveByLane: vi.fn().mockResolvedValue(0),
    listActiveByLane: vi.fn().mockResolvedValue([]),
    listActiveByProject: vi.fn().mockResolvedValue([]),
    releaseAllForProject: vi.fn().mockResolvedValue(0),
    ...overrides,
  };
}

describe("OrchestrationLeaseService.acquireCycleLease", () => {
  it("acquires the workflow_scope cycle lease for a project", async () => {
    const repo = makeRepo();
    const service = new OrchestrationLeaseService(repo as never);

    const result = await service.acquireCycleLease("p1", "corr-1");

    expect(result.acquired).toBe(true);
    expect(repo.acquire).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "p1",
        lane: "strategy",
        owner: { kind: "cycle_request", id: "corr-1" },
        conflictKeys: [
          {
            kind: "workflow_scope",
            value: "project_orchestration_cycle_ceo:p1",
          },
        ],
      }),
    );
  });

  it("blocks a lane-capped mutation when the lane is full", async () => {
    const holder = {
      conflict_key_kind: "workflow_scope",
      conflict_key_value: "project_orchestration_cycle_ceo:p1",
      owner_kind: "cycle_request",
      owner_id: "corr-existing",
      expires_at: new Date("2026-06-22T14:00:00.000Z"),
    };
    const repo = makeRepo({
      countActiveByLane: vi.fn().mockResolvedValue(1),
      listActiveByLane: vi.fn().mockResolvedValue([holder]),
    });
    const service = new OrchestrationLeaseService(repo as never);

    const result = await service.acquireMutationLeases({
      projectId: "p1",
      lane: "strategy",
      ownerId: "corr-2",
      conflictKeys: [{ kind: "work_item", value: "wi-1" }],
      laneCapacity: 1,
    });

    expect(result.acquired).toBe(false);
    expect(repo.acquire).not.toHaveBeenCalled();
    if (result.acquired) throw new Error("expected denial");
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].heldByOwnerKind).toBe("cycle_request");
    expect(result.conflicts[0].heldByOwnerId).toBe("corr-existing");
    expect(result.conflicts[0].conflictKey.value).toBe(
      `${LANE_CAPACITY_CONFLICT_PREFIX}strategy`,
    );
  });

  it("reports the real lane holders when capacity is exhausted", async () => {
    const heldLease = {
      conflict_key_kind: "workflow_scope",
      conflict_key_value: "project_orchestration_cycle_ceo:p1",
      owner_kind: "cycle_request",
      owner_id: "core_lifecycle_stream:work_item_completed",
      expires_at: new Date("2026-06-22T13:52:01.000Z"),
    };
    const leases = {
      countActiveByLane: vi.fn().mockResolvedValue(1),
      listActiveByLane: vi.fn().mockResolvedValue([heldLease]),
      acquire: vi.fn(),
    };
    const service = new OrchestrationLeaseService(leases as never);

    const result = await service.acquireMutationLeases({
      projectId: "p1",
      lane: "strategy",
      ownerId: "kanban.work_item_transition_status:ceo-decision:p1:hash",
      conflictKeys: [{ kind: "work_item", value: "a9a08b37" }],
      laneCapacity: 1,
    });

    expect(result.acquired).toBe(false);
    if (result.acquired) throw new Error("expected denial");
    expect(leases.acquire).not.toHaveBeenCalled();
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].heldByOwnerKind).toBe("cycle_request");
    expect(result.conflicts[0].heldByOwnerId).toBe(
      "core_lifecycle_stream:work_item_completed",
    );
    expect(result.conflicts[0].conflictKey.value).toBe(
      `${LANE_CAPACITY_CONFLICT_PREFIX}strategy`,
    );
  });

  it("proceeds with acquire when count reports full but no active holders exist (empty-holder race)", async () => {
    // Simulate race: countActiveByLane returns 1 (>= capacity 1) but
    // listActiveByLane returns [] because the holder expired/released between the two queries.
    const repo = makeRepo({
      countActiveByLane: vi.fn().mockResolvedValue(1),
      listActiveByLane: vi.fn().mockResolvedValue([]),
    });
    const service = new OrchestrationLeaseService(repo as never);

    const result = await service.acquireMutationLeases({
      projectId: "p1",
      lane: "strategy",
      ownerId: "corr-3",
      conflictKeys: [{ kind: "work_item", value: "wi-2" }],
      laneCapacity: 1,
    });

    expect(result.acquired).toBe(true);
    expect(repo.acquire).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "p1",
        lane: "strategy",
        owner: { kind: "direct_mutation", id: "corr-3" },
        conflictKeys: [{ kind: "work_item", value: "wi-2" }],
      }),
    );
  });
});
