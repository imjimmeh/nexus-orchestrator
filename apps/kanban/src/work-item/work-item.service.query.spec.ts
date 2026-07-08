import { describe, expect, it, vi } from "vitest";
import { WorkItemService } from "./work-item.service";

function buildService(queryResult: { items: unknown[]; total: number }) {
  const repo = {
    queryWorkItems: vi.fn(() => Promise.resolve(queryResult)),
    findDependenciesByWorkItemIds: vi.fn(() => Promise.resolve([])),
    findSubtasksByWorkItemIds: vi.fn(() => Promise.resolve([])),
  };
  const service = new WorkItemService(
    {} as never, // coreClient
    {} as never, // requestContext
    repo as never, // workItems
    {} as never, // lifecycleEventPublisher
    {} as never, // projects
    {} as never, // realtimePublisher
    {} as never, // realtimeGateway
    {} as never, // runLeaseService
    // Lease rollback flag enabled (default). See the rollback
    // runbook at docs/operations/README.md#work-item-run-link-lease-contention.
    {
      getBoolean: vi.fn((key: string) =>
        Promise.resolve(key === "work_item_run_lease_enabled"),
      ),
      getNumber: vi.fn(),
      get: vi.fn(),
      getAll: vi.fn(),
      set: vi.fn(),
      seedDefaults: vi.fn(),
      onModuleInit: vi.fn(),
    } as never, // kanbanSettings
    { estimate: vi.fn() } as never, // costEstimation
    { findAllForBucketAggregation: vi.fn() } as never, // runCosts
  );
  return { service, repo };
}

describe("WorkItemService paginated queries", () => {
  const baseQuery = {
    sortBy: "updated_at" as const,
    sortDir: "desc" as const,
    limit: 50,
    offset: 0,
  };

  it("queryAllWorkItems returns an envelope", async () => {
    const entity = {
      id: "wi-1",
      project_id: "p1",
      title: "T",
      description: null,
      status: "todo",
      priority: "p2",
      scope: "standard",
      assigned_agent_id: null,
      token_spend: 0,
      current_execution_id: null,
      waiting_for_input: false,
      execution_config: null,
      metadata: null,
      linked_run_id: null,
      created_at: new Date("2026-01-01T00:00:00Z"),
      updated_at: new Date("2026-01-02T00:00:00Z"),
    };
    const { service, repo } = buildService({ items: [entity], total: 1 });

    const result = await service.queryAllWorkItems(baseQuery);

    expect(repo.queryWorkItems).toHaveBeenCalledWith(baseQuery);
    expect(result.total).toBe(1);
    expect(result.limit).toBe(50);
    expect(result.offset).toBe(0);
    expect(result.items[0].id).toBe("wi-1");
    expect(result.items[0].updatedAt).toBe("2026-01-02T00:00:00.000Z");
  });

  it("queryWorkItems forces the projectId filter", async () => {
    const { service, repo } = buildService({ items: [], total: 0 });
    await service.queryWorkItems("p1", baseQuery);
    expect(repo.queryWorkItems).toHaveBeenCalledWith({
      ...baseQuery,
      projectId: "p1",
    });
  });
});
