import { describe, expect, it, vi } from "vitest";
import { WorkItemGlobalController } from "./work-item-global.controller";
import type { WorkItemService } from "./work-item.service";

describe("WorkItemGlobalController", () => {
  it("listAll returns the paginated envelope with parsed defaults", async () => {
    const envelope = { items: [], total: 0, limit: 50, offset: 0 };
    const queryAllWorkItems = vi.fn().mockResolvedValue(envelope);
    const service = { queryAllWorkItems } as unknown as WorkItemService;
    const controller = new WorkItemGlobalController(service);

    await expect(controller.listAll({})).resolves.toEqual({
      success: true,
      data: envelope,
    });

    expect(queryAllWorkItems).toHaveBeenCalledWith({
      sortBy: "updated_at",
      sortDir: "desc",
      limit: 50,
      offset: 0,
      projectId: undefined,
    });
  });

  it("honors a projectId query param as a filter", async () => {
    const queryAllWorkItems = vi
      .fn()
      .mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 });
    const service = { queryAllWorkItems } as unknown as WorkItemService;
    const controller = new WorkItemGlobalController(service);

    await controller.listAll({ projectId: "p1", status: "todo" });

    expect(queryAllWorkItems).toHaveBeenCalledWith({
      status: ["todo"],
      sortBy: "updated_at",
      sortDir: "desc",
      limit: 50,
      offset: 0,
      projectId: "p1",
    });
  });

  it("returns cost estimate accuracy from the work item service", async () => {
    const accuracy = {
      sampleCount: 2,
      meanAbsoluteErrorCents: 15,
      meanAbsolutePercentageError: 0.1,
    };
    const getCostEstimateAccuracy = vi.fn().mockResolvedValue(accuracy);
    const service = { getCostEstimateAccuracy } as unknown as WorkItemService;
    const controller = new WorkItemGlobalController(service);

    await expect(controller.getCostEstimateAccuracy()).resolves.toEqual({
      success: true,
      data: accuracy,
    });

    expect(getCostEstimateAccuracy).toHaveBeenCalledWith();
  });
});
