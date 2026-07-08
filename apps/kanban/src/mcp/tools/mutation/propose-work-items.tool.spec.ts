import type { InternalToolExecutionContext } from "@nexus/core";
import type { WorkItemRecord } from "@nexus/kanban-contracts";
import { describe, expect, it, vi } from "vitest";
import { WorkItemService } from "../../../work-item/work-item.service";
import { ProposeWorkItemsTool } from "./propose-work-items.tool";

describe("kanban.propose_work_items", () => {
  const context = {} as InternalToolExecutionContext;
  const projectId = "project-1";

  it("has the kanban-prefixed name and runner transport", () => {
    const tool = new ProposeWorkItemsTool({} as WorkItemService);
    expect(tool.getName()).toBe("kanban.propose_work_items");
    expect(tool.getDefinition().transport).toBe("runner_local");
  });

  it("persists decomposed children parented to the epic with types", async () => {
    const store = new Map<string, WorkItemRecord>();
    let nextId = 0;

    const workItems = {
      createWorkItem: vi.fn(
        (project: string, input: Record<string, unknown>) => {
          nextId += 1;
          const record = {
            id: `child-${nextId}`,
            project_id: project,
            title: input.title,
            type: input.type,
            storyPoints: input.storyPoints ?? null,
            parentWorkItemId: input.parentWorkItemId ?? null,
          } as unknown as WorkItemRecord;
          store.set(record.id, record);
          return Promise.resolve(record);
        },
      ),
      listWorkItems: vi.fn((project: string) =>
        Promise.resolve(
          [...store.values()].filter((item) => item.project_id === project),
        ),
      ),
      resolveParentType: vi.fn((_project: string, parentId: string | null) => {
        if (!parentId) return Promise.resolve(null);
        const parent = store.get(parentId);
        return Promise.resolve(parent ? (parent.type ?? null) : null);
      }),
    };
    const tool = new ProposeWorkItemsTool(
      workItems as unknown as WorkItemService,
    );

    const epic = await workItems.createWorkItem(projectId, {
      title: "Epic",
      type: "epic",
    });

    const result = await tool.execute(context, {
      project_id: projectId,
      parentWorkItemId: epic.id,
      items: [
        { title: "Story A", type: "story", storyPoints: 5 },
        { title: "Bug B", type: "bug", storyPoints: 2 },
      ],
    });

    const children = await workItems.listWorkItems(projectId);
    const created = children.filter(
      (item) => item.parentWorkItemId === epic.id,
    );

    expect(created.map((item) => item.type).sort()).toEqual(["bug", "story"]);
    expect(result).toEqual({
      created_ids: created.map((item) => item.id),
    });
    expect(workItems.createWorkItem).toHaveBeenNthCalledWith(2, projectId, {
      title: "Story A",
      type: "story",
      description: undefined,
      storyPoints: 5,
      parentWorkItemId: epic.id,
    });
    expect(workItems.createWorkItem).toHaveBeenNthCalledWith(3, projectId, {
      title: "Bug B",
      type: "bug",
      description: undefined,
      storyPoints: 2,
      parentWorkItemId: epic.id,
    });
  });

  it("persists nothing when any item in the batch fails invariant validation", async () => {
    const store = new Map<string, WorkItemRecord>();
    let nextId = 0;

    const workItems = {
      createWorkItem: vi.fn(
        (project: string, input: Record<string, unknown>) => {
          nextId += 1;
          const record = {
            id: `child-${nextId}`,
            project_id: project,
            title: input.title,
            type: input.type,
            storyPoints: input.storyPoints ?? null,
            parentWorkItemId: input.parentWorkItemId ?? null,
          } as unknown as WorkItemRecord;
          store.set(record.id, record);
          return Promise.resolve(record);
        },
      ),
      listWorkItems: vi.fn((project: string) =>
        Promise.resolve(
          [...store.values()].filter((item) => item.project_id === project),
        ),
      ),
      resolveParentType: vi.fn((_project: string, parentId: string | null) => {
        if (!parentId) return Promise.resolve(null);
        const parent = store.get(parentId);
        return Promise.resolve(parent ? (parent.type ?? null) : null);
      }),
    };
    const tool = new ProposeWorkItemsTool(
      workItems as unknown as WorkItemService,
    );

    const epic = await workItems.createWorkItem(projectId, {
      title: "Epic",
      type: "epic",
    });
    workItems.createWorkItem.mockClear();

    await expect(
      tool.execute(context, {
        project_id: projectId,
        parentWorkItemId: epic.id,
        items: [
          { title: "Story A", type: "story", storyPoints: 5 },
          // invalid: an epic cannot have a parent
          { title: "Nested Epic", type: "epic" },
        ],
      }),
    ).rejects.toThrow();

    // Item 1 was valid on its own, but the whole batch must be
    // pre-validated before anything is persisted — zero items created.
    expect(workItems.createWorkItem).not.toHaveBeenCalled();
    const children = await workItems.listWorkItems(projectId);
    expect(
      children.filter((item) => item.parentWorkItemId === epic.id),
    ).toEqual([]);
  });
});
