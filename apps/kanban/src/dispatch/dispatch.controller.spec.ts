import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { DispatchController } from "./dispatch.controller";

describe("DispatchController", () => {
  it("dispatches selected context ids with the Kanban-owned default workflow", async () => {
    const dispatch = {
      dispatchSelectedWorkItems: vi.fn().mockResolvedValue({ dispatched: [] }),
    };
    const controller = new DispatchController(dispatch as never);

    await expect(
      controller.dispatchSelectedContextItems("project-1", {
        context_ids: [" ctx-1 ", "ctx-2"],
        requested_by: "agent",
        max_concurrent_per_agent: 2,
      }),
    ).resolves.toEqual({ success: true, data: { dispatched: [] } });

    expect(dispatch.dispatchSelectedWorkItems).toHaveBeenCalledWith({
      projectId: "project-1",
      workItemIds: ["ctx-1", "ctx-2"],
      workflowId: "work_item_in_progress_default",
      requestedBy: "agent",
      maxConcurrentPerAgent: 2,
    });
  });

  it("rejects invalid context_ids", async () => {
    const dispatch = { dispatchSelectedWorkItems: vi.fn() };
    const controller = new DispatchController(dispatch as never);

    await expect(
      controller.dispatchSelectedContextItems("project-1", {
        context_ids: ["ctx-1", "   "],
      }),
    ).rejects.toThrow(BadRequestException);
    expect(dispatch.dispatchSelectedWorkItems).not.toHaveBeenCalled();
  });

  it("rejects empty context_ids", async () => {
    const dispatch = { dispatchSelectedWorkItems: vi.fn() };
    const controller = new DispatchController(dispatch as never);

    await expect(
      controller.dispatchSelectedContextItems("project-1", {
        context_ids: [],
      }),
    ).rejects.toThrow(BadRequestException);
    expect(dispatch.dispatchSelectedWorkItems).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, "1", null])(
    "rejects invalid max_concurrent_per_agent value %s",
    async (maxConcurrentPerAgent) => {
      const dispatch = { dispatchSelectedWorkItems: vi.fn() };
      const controller = new DispatchController(dispatch as never);

      await expect(
        controller.dispatchSelectedContextItems("project-1", {
          context_ids: ["ctx-1"],
          max_concurrent_per_agent: maxConcurrentPerAgent,
        } as never),
      ).rejects.toThrow(BadRequestException);
      expect(dispatch.dispatchSelectedWorkItems).not.toHaveBeenCalled();
    },
  );

  it("trims and uses an explicit workflow id", async () => {
    const dispatch = {
      dispatchSelectedWorkItems: vi.fn().mockResolvedValue({ dispatched: [] }),
    };
    const controller = new DispatchController(dispatch as never);

    await controller.dispatchSelectedContextItems("project-1", {
      context_ids: ["ctx-1"],
      workflow_id: " override-workflow ",
    });

    expect(dispatch.dispatchSelectedWorkItems).toHaveBeenCalledWith(
      expect.objectContaining({ workflowId: "override-workflow" }),
    );
  });
});
