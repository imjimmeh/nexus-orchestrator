import type { InternalToolExecutionContext } from "@nexus/core";
import { describe, expect, it, vi } from "vitest";
import { WorkItemService } from "../../../work-item/work-item.service";
import { WorkItemCreateTool } from "./work-item-create.tool";

describe("WorkItemCreateTool", () => {
  const context = {} as InternalToolExecutionContext;

  it("forwards omitted status to the service so canonical backlog default applies", async () => {
    const workItems = {
      createWorkItem: vi.fn().mockResolvedValue({
        id: "work-item-1",
        status: "backlog",
      }),
    };
    const tool = new WorkItemCreateTool(
      workItems as unknown as WorkItemService,
    );

    const result = await tool.execute(context, {
      project_id: "project-1",
      workItem: {
        title: "Plan autonomous backlog work",
      },
    });

    expect(workItems.createWorkItem).toHaveBeenCalledWith("project-1", {
      title: "Plan autonomous backlog work",
    });
    expect(result).toEqual({ id: "work-item-1", status: "backlog" });
  });

  it("derives project_id from context.scopeId when omitted", async () => {
    const workItems = {
      createWorkItem: vi.fn().mockResolvedValue({ id: "work-item-2" }),
    };
    const tool = new WorkItemCreateTool(
      workItems as unknown as WorkItemService,
    );

    await tool.execute(
      { scopeId: "project-from-context" },
      {
        workItem: {
          title: "Context work item",
        },
      },
    );

    expect(workItems.createWorkItem).toHaveBeenCalledWith(
      "project-from-context",
      {
        title: "Context work item",
      },
    );
  });
});
