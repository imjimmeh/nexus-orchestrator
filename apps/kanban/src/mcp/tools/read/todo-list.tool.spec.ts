import { describe, expect, it, vi } from "vitest";
import type { InternalToolExecutionContext } from "@nexus/core";
import { TodoListTool } from "./todo-list.tool";
import type { WorkItemService } from "../../../work-item/work-item.service";

describe("TodoListTool", () => {
  it("derives project_id from context.scopeId when omitted", async () => {
    const items = [
      { id: "wi-1", status: "todo" },
      { id: "wi-2", status: "blocked" },
    ];
    const service = { listWorkItems: vi.fn().mockResolvedValue(items) };
    const tool = new TodoListTool(service as unknown as WorkItemService);

    await expect(
      tool.execute({ scopeId: "project-from-context" }, {}),
    ).resolves.toEqual([{ id: "wi-1", status: "todo" }]);
    expect(service.listWorkItems).toHaveBeenCalledWith("project-from-context");
  });

  it("excludes container items (epic, or story with a child) from the todo list", async () => {
    // Regression coverage for the shared filterDispatchableTodo container
    // guard (epics and any item with children are never individually
    // dispatchable).
    const items = [
      { id: "epic-1", status: "todo", type: "epic" },
      { id: "story-with-child", status: "todo", type: "story" },
      {
        id: "child-1",
        status: "todo",
        type: "task",
        parentWorkItemId: "story-with-child",
      },
      { id: "lone-todo", status: "todo", type: "task" },
    ];
    const service = { listWorkItems: vi.fn().mockResolvedValue(items) };
    const tool = new TodoListTool(service as unknown as WorkItemService);

    const result = (await tool.execute(
      { scopeId: "project-from-context" },
      {},
    )) as Array<{ id: string }>;

    expect(result.map((item) => item.id).sort()).toEqual([
      "child-1",
      "lone-todo",
    ]);
  });
});
