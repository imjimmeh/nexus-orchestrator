import { BadRequestException } from "@nestjs/common";
import type { InternalToolExecutionContext } from "@nexus/core";
import { describe, expect, it, vi } from "vitest";
import { WorkItemService } from "../../../work-item/work-item.service";
import { WorkItemRestartExecutionTool } from "./work-item-restart-execution.tool";

interface MockWorkItems {
  restartExecution: ReturnType<typeof vi.fn>;
}

describe("WorkItemRestartExecutionTool", () => {
  const context = {} as InternalToolExecutionContext;

  function createTool(): {
    tool: WorkItemRestartExecutionTool;
    workItems: MockWorkItems;
  } {
    const workItems: MockWorkItems = {
      restartExecution: vi.fn().mockResolvedValue({
        workItem: {
          id: "work-item-1",
          status: "ready-to-merge",
        },
        triggeredRunIds: [],
      }),
    };

    return {
      workItems,
      tool: new WorkItemRestartExecutionTool(
        workItems as unknown as WorkItemService,
      ),
    };
  }

  it("replays the current work-item lifecycle event", async () => {
    const { tool, workItems } = createTool();

    const parsed = tool.getDefinition().inputSchema.parse({
      project_id: "project-1",
      workItemId: "work-item-1",
    });

    const result = await tool.execute(context, parsed);

    expect(tool.getName()).toBe("kanban.work_item_restart_execution");
    expect(workItems.restartExecution).toHaveBeenCalledWith(
      "project-1",
      "work-item-1",
    );
    expect(result).toMatchObject({
      workItem: {
        id: "work-item-1",
        status: "ready-to-merge",
      },
      triggeredRunIds: [],
    });
  });

  it("derives project_id from context.scopeId while keeping workItemId explicit", async () => {
    const { tool, workItems } = createTool();

    const parsed = tool.getDefinition().inputSchema.parse({
      workItemId: "work-item-1",
    });

    const result = await tool.execute(
      { scopeId: "project-from-context" },
      parsed,
    );

    expect(workItems.restartExecution).toHaveBeenCalledWith(
      "project-from-context",
      "work-item-1",
    );
    expect(result).toMatchObject({
      workItem: {
        id: "work-item-1",
        status: "ready-to-merge",
      },
    });
  });

  it("throws BadRequestException when project_id and context scope are both missing", async () => {
    const { tool } = createTool();

    await expect(
      tool.execute({}, { workItemId: "work-item-1" }),
    ).rejects.toThrow(BadRequestException);
  });
});
