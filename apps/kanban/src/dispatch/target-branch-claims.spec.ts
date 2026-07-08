import { describe, expect, it } from "vitest";
import type { WorkItemRecord } from "./dispatch-internal.types";
import { ownsTargetBranch } from "./target-branch-claims";

function itemWithStatus(status: string): WorkItemRecord {
  return {
    id: "item-1",
    project_id: "project-1",
    title: "Example",
    status,
    priority: "medium",
    type: "story",
    parent_work_item_id: null,
    assigned_agent_id: null,
    linked_run_id: null,
    current_execution_id: null,
    execution_config: null,
    metadata: null,
    created_at: new Date(),
    updated_at: new Date(),
  };
}

describe("ownsTargetBranch", () => {
  it("treats awaiting-pr-merge as branch-owning", () => {
    expect(ownsTargetBranch(itemWithStatus("awaiting-pr-merge"))).toBe(true);
  });

  it("keeps existing branch-owning statuses", () => {
    expect(ownsTargetBranch(itemWithStatus("in-progress"))).toBe(true);
    expect(ownsTargetBranch(itemWithStatus("in-review"))).toBe(true);
    expect(ownsTargetBranch(itemWithStatus("ready-to-merge"))).toBe(true);
  });

  it("does not treat a backlog item as branch-owning", () => {
    expect(ownsTargetBranch(itemWithStatus("backlog"))).toBe(false);
  });

  it("treats an item with a linked_run_id as branch-owning even outside branch-owning statuses", () => {
    expect(
      ownsTargetBranch({
        ...itemWithStatus("backlog"),
        linked_run_id: "run-123",
      }),
    ).toBe(true);
  });

  it("treats an item with a current_execution_id as branch-owning even outside branch-owning statuses", () => {
    expect(
      ownsTargetBranch({
        ...itemWithStatus("backlog"),
        current_execution_id: "exec-456",
      }),
    ).toBe(true);
  });

  it("does not treat an item with no linked run, execution, or branch-owning status as branch-owning", () => {
    expect(
      ownsTargetBranch({
        ...itemWithStatus("todo"),
        linked_run_id: null,
        current_execution_id: null,
      }),
    ).toBe(false);
  });
});
