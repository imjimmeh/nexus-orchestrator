import type { InternalToolExecutionContext } from "@nexus/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkItemResolveUmbrellaParentTool } from "./work-item-resolve-umbrella-parent.tool";
import type { WorkItemService } from "../../../work-item/work-item.service";

type Item = {
  id: string;
  status: string;
  parentWorkItemId: string | null;
};

describe("WorkItemResolveUmbrellaParentTool", () => {
  const context = { scopeId: "project-1" } as InternalToolExecutionContext;
  let items: Item[];
  let childIdsByParent: Record<string, string[]>;
  let updateStatus: ReturnType<typeof vi.fn>;
  let findChildIds: ReturnType<typeof vi.fn>;
  let tool: WorkItemResolveUmbrellaParentTool;

  beforeEach(() => {
    updateStatus = vi.fn((_p: string, id: string, status: string) => {
      const item = items.find((i) => i.id === id);
      if (item) item.status = status;
      return Promise.resolve({ id, status });
    });
    findChildIds = vi.fn((parentId: string) =>
      Promise.resolve(childIdsByParent[parentId] ?? []),
    );
    const workItems = {
      listWorkItems: vi.fn(() => Promise.resolve(items)),
      updateStatus,
      findChildIds,
    } as unknown as WorkItemService;
    tool = new WorkItemResolveUmbrellaParentTool(workItems);
  });

  it("exposes the resolve-umbrella-parent tool name", () => {
    items = [];
    childIdsByParent = {};
    expect(tool.getName()).toBe("kanban.work_item_resolve_umbrella_parent");
  });

  it("no-ops when the completed child has no parent", async () => {
    items = [{ id: "solo", status: "done", parentWorkItemId: null }];
    childIdsByParent = {};
    const result = await tool.execute(context, {
      project_id: "project-1",
      workItemId: "solo",
    });
    expect(result).toEqual({ resolved: false, reason: "no_parent" });
    expect(updateStatus).not.toHaveBeenCalled();
  });

  it("no-ops when the parent referenced by the child cannot be found", async () => {
    items = [
      { id: "orphan-child", status: "done", parentWorkItemId: "missing" },
    ];
    childIdsByParent = {};
    const result = await tool.execute(context, {
      project_id: "project-1",
      workItemId: "orphan-child",
    });
    expect(result).toEqual({ resolved: false, reason: "parent_not_found" });
    expect(updateStatus).not.toHaveBeenCalled();
  });

  it("no-ops when the parent has no persisted children", async () => {
    items = [
      { id: "parent", status: "todo", parentWorkItemId: null },
      { id: "c1", status: "done", parentWorkItemId: "parent" },
    ];
    childIdsByParent = { parent: [] };
    const result = await tool.execute(context, {
      project_id: "project-1",
      workItemId: "c1",
    });
    expect(result).toEqual({ resolved: false, reason: "no_children" });
    expect(updateStatus).not.toHaveBeenCalled();
  });

  it("does not resolve while a sibling is still open", async () => {
    items = [
      { id: "parent", status: "todo", parentWorkItemId: null },
      { id: "c1", status: "done", parentWorkItemId: "parent" },
      { id: "c2", status: "in-progress", parentWorkItemId: "parent" },
    ];
    childIdsByParent = { parent: ["c1", "c2"] };
    const result = await tool.execute(context, {
      project_id: "project-1",
      workItemId: "c1",
    });
    expect(result).toEqual({ resolved: false, reason: "children_pending" });
    expect(updateStatus).not.toHaveBeenCalled();
  });

  it("transitions the parent to done when all children are done", async () => {
    items = [
      { id: "parent", status: "todo", parentWorkItemId: null },
      { id: "c1", status: "done", parentWorkItemId: "parent" },
      { id: "c2", status: "done", parentWorkItemId: "parent" },
    ];
    childIdsByParent = { parent: ["c1", "c2"] };
    const result = await tool.execute(context, {
      project_id: "project-1",
      workItemId: "c2",
    });
    expect(result).toEqual({ resolved: true, parentId: "parent" });
    expect(updateStatus).toHaveBeenCalledWith("project-1", "parent", "done");
    expect(findChildIds).toHaveBeenCalledWith("parent");
  });

  it("does not re-resolve a parent that is already done", async () => {
    items = [
      { id: "parent", status: "done", parentWorkItemId: null },
      { id: "c1", status: "done", parentWorkItemId: "parent" },
    ];
    childIdsByParent = { parent: ["c1"] };
    const result = await tool.execute(context, {
      project_id: "project-1",
      workItemId: "c1",
    });
    expect(result).toEqual({ resolved: false, reason: "already_resolved" });
    expect(updateStatus).not.toHaveBeenCalled();
  });
});
