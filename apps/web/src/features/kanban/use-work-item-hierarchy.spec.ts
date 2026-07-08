import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WorkItem } from "@/lib/api/work-items.types";
import {
  buildWorkItemHierarchy,
  useWorkItemHierarchy,
} from "./use-work-item-hierarchy";

function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "wi-1",
    project_id: "project-1",
    title: "Test work item",
    description: null,
    status: "todo",
    type: "task",
    priority: "p2",
    parentWorkItemId: null,
    storyPoints: null,
    rolledUpPoints: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as WorkItem;
}

describe("buildWorkItemHierarchy", () => {
  it("groups children under their parent by parentWorkItemId", () => {
    const epic = makeWorkItem({ id: "epic-1", type: "epic" });
    const storyA = makeWorkItem({
      id: "story-a",
      type: "story",
      parentWorkItemId: "epic-1",
    });
    const storyB = makeWorkItem({
      id: "story-b",
      type: "story",
      parentWorkItemId: "epic-1",
    });

    const hierarchy = buildWorkItemHierarchy([epic, storyA, storyB]);

    expect(hierarchy.roots).toEqual([epic]);
    expect(hierarchy.childrenByParentId["epic-1"]).toEqual([storyA, storyB]);
  });

  it("treats items without a parentWorkItemId as roots", () => {
    const taskOne = makeWorkItem({ id: "task-1" });
    const taskTwo = makeWorkItem({ id: "task-2" });

    const hierarchy = buildWorkItemHierarchy([taskOne, taskTwo]);

    expect(hierarchy.roots).toEqual([taskOne, taskTwo]);
    expect(hierarchy.childrenByParentId).toEqual({});
  });

  it("treats an item as a root when its parent is not present in the given list", () => {
    const orphan = makeWorkItem({
      id: "orphan-1",
      parentWorkItemId: "missing-parent",
    });

    const hierarchy = buildWorkItemHierarchy([orphan]);

    expect(hierarchy.roots).toEqual([orphan]);
    expect(hierarchy.childrenByParentId).toEqual({});
  });

  it("preserves child ordering and supports multi-level parents independently", () => {
    const epicOne = makeWorkItem({ id: "epic-1", type: "epic" });
    const epicTwo = makeWorkItem({ id: "epic-2", type: "epic" });
    const storyOneA = makeWorkItem({
      id: "story-1a",
      type: "story",
      parentWorkItemId: "epic-1",
    });
    const storyTwoA = makeWorkItem({
      id: "story-2a",
      type: "story",
      parentWorkItemId: "epic-2",
    });

    const hierarchy = buildWorkItemHierarchy([
      epicOne,
      storyOneA,
      epicTwo,
      storyTwoA,
    ]);

    expect(hierarchy.roots).toEqual([epicOne, epicTwo]);
    expect(hierarchy.childrenByParentId["epic-1"]).toEqual([storyOneA]);
    expect(hierarchy.childrenByParentId["epic-2"]).toEqual([storyTwoA]);
  });

  it("returns empty roots and no groups for an empty list", () => {
    const hierarchy = buildWorkItemHierarchy([]);

    expect(hierarchy.roots).toEqual([]);
    expect(hierarchy.childrenByParentId).toEqual({});
  });
});

describe("useWorkItemHierarchy", () => {
  it("returns the same hierarchy shape as the pure builder", () => {
    const epic = makeWorkItem({ id: "epic-1", type: "epic" });
    const story = makeWorkItem({
      id: "story-a",
      type: "story",
      parentWorkItemId: "epic-1",
    });

    const { result } = renderHook(() => useWorkItemHierarchy([epic, story]));

    expect(result.current.roots).toEqual([epic]);
    expect(result.current.childrenByParentId["epic-1"]).toEqual([story]);
  });
});
