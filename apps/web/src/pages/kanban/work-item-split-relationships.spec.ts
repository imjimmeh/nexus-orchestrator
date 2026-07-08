import { describe, expect, it } from "vitest";
import { WorkItem } from "@/lib/api/work-items.types";
import { getSplitRelationshipView } from "./work-item-split-relationships";

function makeWorkItem(overrides: Partial<WorkItem>): WorkItem {
  return {
    id: "item-1",
    project_id: "project-1",
    title: "Work item",
    description: "Description",
    status: "todo",
    type: "story",
    priority: "p2",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as WorkItem;
}

describe("getSplitRelationshipView", () => {
  it("returns child rows and done progress for umbrella parents", () => {
    const view = getSplitRelationshipView(
      makeWorkItem({
        id: "parent",
        metadata: { split: { proposedChildIds: ["c1", "c2"] } },
      }),
      [
        makeWorkItem({ id: "parent", title: "Parent", status: "blocked" }),
        makeWorkItem({ id: "c1", title: "Child 1", status: "done" }),
        makeWorkItem({ id: "c2", title: "Child 2", status: "todo" }),
      ],
    );

    expect(view.children).toHaveLength(2);
    expect(view.children[0]).toMatchObject({ id: "c1" });
    expect(view.children[0]?.item?.title).toBe("Child 1");
    expect(view.childrenDone).toBe(1);
    expect(view.childrenTotal).toBe(2);
  });

  it("resolves persisted split children by metadata sourceId", () => {
    const view = getSplitRelationshipView(
      makeWorkItem({
        id: "parent",
        metadata: { split: { proposedChildIds: ["parent-child-1"] } },
      }),
      [
        makeWorkItem({
          id: "real-child-uuid",
          title: "Persisted Child",
          status: "done",
          metadata: { sourceId: "parent-child-1" },
        }),
      ],
    );

    expect(view.children).toHaveLength(1);
    expect(view.children[0]).toMatchObject({ id: "parent-child-1" });
    expect(view.children[0]?.item?.id).toBe("real-child-uuid");
    expect(view.children[0]?.item?.title).toBe("Persisted Child");
    expect(view.childrenDone).toBe(1);
  });

  it("returns parent rows for legacy child metadata", () => {
    const view = getSplitRelationshipView(
      makeWorkItem({ id: "c1", metadata: { parent_context_id: "parent" } }),
      [makeWorkItem({ id: "parent", title: "Parent", status: "blocked" })],
    );

    expect(view.parent?.id).toBe("parent");
    expect(view.parent?.item?.title).toBe("Parent");
  });

  it("returns unloaded child and parent rows when relationship ids are missing", () => {
    const parentView = getSplitRelationshipView(
      makeWorkItem({
        id: "parent",
        metadata: { split: { proposedChildIds: ["missing-child"] } },
      }),
      [],
    );
    const childView = getSplitRelationshipView(
      makeWorkItem({
        id: "c1",
        metadata: { split: { parentId: "missing-parent" } },
      }),
      [],
    );

    expect(parentView.children).toEqual([
      { id: "missing-child", item: undefined },
    ]);
    expect(childView.parent).toEqual({ id: "missing-parent", item: undefined });
  });
});
