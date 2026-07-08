import type { InternalToolExecutionContext } from "@nexus/core";
import type { WorkItemRecord } from "@nexus/kanban-contracts";
import { describe, expect, it, vi } from "vitest";
import { WorkItemService } from "../../../work-item/work-item.service";
import { EstimateWorkItemTool } from "./estimate-work-item.tool";

describe("kanban.estimate_work_item", () => {
  const context = {} as InternalToolExecutionContext;
  const projectId = "project-1";

  it("has the kanban-prefixed name and runner transport", () => {
    const tool = new EstimateWorkItemTool({} as WorkItemService);
    expect(tool.getName()).toBe("kanban.estimate_work_item");
    expect(tool.getDefinition().transport).toBe("runner_local");
  });

  it("delegates to updateWorkItem and persists story points on a task", async () => {
    const updated = {
      id: "item-1",
      project_id: projectId,
      type: "task",
      storyPoints: 8,
    } as unknown as WorkItemRecord;
    const workItems = {
      updateWorkItem: vi.fn().mockResolvedValue(updated),
    };
    const tool = new EstimateWorkItemTool(
      workItems as unknown as WorkItemService,
    );

    const result = await tool.execute(context, {
      project_id: projectId,
      workItemId: "item-1",
      storyPoints: 8,
    });

    expect(workItems.updateWorkItem).toHaveBeenCalledWith(projectId, "item-1", {
      storyPoints: 8,
    });
    expect(result).toEqual(updated);
  });

  it("propagates the service's invariant rejection when estimating an epic", async () => {
    const workItems = {
      updateWorkItem: vi
        .fn()
        .mockRejectedValue(
          new Error("story points are not allowed on epic items"),
        ),
    };
    const tool = new EstimateWorkItemTool(
      workItems as unknown as WorkItemService,
    );

    await expect(
      tool.execute(context, {
        project_id: projectId,
        workItemId: "epic-1",
        storyPoints: 8,
      }),
    ).rejects.toThrow("story points are not allowed on epic items");
  });
});
