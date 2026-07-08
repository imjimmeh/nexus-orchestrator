import { describe, expect, it } from "vitest";
import {
  deriveLiveState,
  getAllowedStatusTransitions,
  getKanbanColumnTitle,
  groupWorkItemsByDependencyReadiness,
  groupWorkItemsByStatus,
  validateWorkItemForm,
} from "./kanban.utils";
import { WorkItem } from "@/lib/api/work-items.types";

function makeItem(overrides: Partial<WorkItem>): WorkItem {
  return {
    id: "default",
    project_id: "p-1",
    title: "Default Task",
    status: "backlog",
    type: "story",
    priority: "p2",
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

describe("kanban.utils", () => {
  it("groups items by status", () => {
    const result = groupWorkItemsByStatus([
      makeItem({ id: "1", status: "todo" }),
      makeItem({ id: "2", status: "refinement" }),
      makeItem({ id: "3", status: "in-progress" }),
    ]);

    expect(result.todo).toHaveLength(1);
    expect(result.refinement).toHaveLength(1);
    expect(result["in-progress"]).toHaveLength(1);
    expect(result["ready-to-merge"]).toHaveLength(0);
    expect(result.blocked).toHaveLength(0);
    expect(result.done).toHaveLength(0);
  });

  it("groups items by dependency readiness", () => {
    const items: WorkItem[] = [
      makeItem({ id: "a", title: "A", status: "todo" }),
      makeItem({ id: "b", title: "B", status: "todo", dependsOn: ["a"] }),
      makeItem({ id: "c", title: "C", status: "in-progress" }),
      makeItem({ id: "d", title: "D", status: "blocked" }),
      makeItem({ id: "e", title: "E", status: "done" }),
      makeItem({ id: "f", title: "F", status: "refinement" }),
    ];

    const groups = groupWorkItemsByDependencyReadiness(items);

    const ready = groups.find((group) => group.key === "ready");
    const blocked = groups.find((group) => group.key === "blocked");
    const inFlight = groups.find((group) => group.key === "in-flight");
    const done = groups.find((group) => group.key === "done");

    expect(ready?.items.map((item) => item.id).sort()).toEqual(["a"]);
    expect(blocked?.items.map((item) => item.id).sort()).toEqual(["b", "d"]);
    expect(inFlight?.items.map((item) => item.id).sort()).toEqual(["c", "f"]);
    expect(done?.items.map((item) => item.id).sort()).toEqual(["e"]);
  });

  it("derives live states from lastExecutionStatus and column status", () => {
    expect(
      deriveLiveState({
        status: "in-progress",
        lastExecutionStatus: "FAILED",
        currentExecutionId: "run-1",
      } as never),
    ).toBe("error");

    expect(
      deriveLiveState({
        status: "in-progress",
        lastExecutionStatus: "CANCELLED",
        currentExecutionId: "run-1",
      } as never),
    ).toBe("error");

    expect(
      deriveLiveState({
        status: "in-progress",
        lastExecutionStatus: "RUNNING",
        currentExecutionId: "run-1",
      } as never),
    ).toBe("running");

    expect(
      deriveLiveState({
        status: "in-progress",
        lastExecutionStatus: "RUNNING",
        currentExecutionId: "run-1",
        waitingForInput: true,
      } as never),
    ).toBe("awaiting-input");

    expect(
      deriveLiveState({
        status: "in-progress",
        lastExecutionStatus: "PENDING",
        currentExecutionId: "run-1",
      } as never),
    ).toBe("queued");

    expect(
      deriveLiveState({
        status: "in-progress",
        lastExecutionStatus: "COMPLETED",
        currentExecutionId: "run-1",
      } as never),
    ).toBe("completed");

    expect(deriveLiveState({ status: "blocked" } as never)).toBe("blocked");
    expect(deriveLiveState({ status: "done" } as never)).toBe("completed");
    expect(deriveLiveState({ status: "todo" } as never)).toBe("idle");
  });

  describe("validateWorkItemForm", () => {
    it("returns empty errors for valid data", () => {
      const errors = validateWorkItemForm({
        title: "Valid task",
        description: "",
        priority: "p1",
        dependencyIds: [],
      });
      expect(errors).toEqual({});
    });

    it("returns title error when title is empty", () => {
      const errors = validateWorkItemForm({
        title: "  ",
        description: "",
        priority: "p1",
        dependencyIds: [],
      });
      expect(errors.title).toBe("Title is required.");
    });

    it("returns priority error when priority is empty", () => {
      const errors = validateWorkItemForm({
        title: "Task",
        description: "",
        priority: "",
        dependencyIds: [],
      });
      expect(errors.priority).toBe("Priority is required.");
    });

    it("returns dependencyIds error when dependencies exceed max", () => {
      const errors = validateWorkItemForm({
        title: "Task",
        description: "",
        priority: "p1",
        dependencyIds: Array.from({ length: 201 }, (_, idx) => `dep-${idx}`),
      });
      expect(errors.dependencyIds).toBe(
        "A work item can have at most 200 dependencies.",
      );
    });

    it("rejects an epic with story points", () => {
      const errors = validateWorkItemForm({
        title: "Task",
        description: "",
        priority: "p1",
        dependencyIds: [],
        type: "epic",
        storyPoints: 5,
      });
      expect(errors.storyPoints).toBeTruthy();
    });

    it("rejects an illegal parent/child type pairing", () => {
      const errors = validateWorkItemForm({
        title: "Task",
        description: "",
        priority: "p1",
        dependencyIds: [],
        type: "bug",
        parentType: "task",
      });
      expect(errors.parentWorkItemId).toBeTruthy();
    });

    it("allows a legal parent/child type pairing", () => {
      const errors = validateWorkItemForm({
        title: "Task",
        description: "",
        priority: "p1",
        dependencyIds: [],
        type: "task",
        parentType: "epic",
        storyPoints: 3,
      });
      expect(errors).toEqual({});
    });
  });

  it("returns all other known statuses as status move targets", () => {
    expect(getAllowedStatusTransitions("done")).toEqual([
      "backlog",
      "refinement",
      "todo",
      "in-progress",
      "in-review",
      "ready-to-merge",
      "awaiting-pr-merge",
      "blocked",
    ]);
  });

  it("returns the configured kanban column title for a status", () => {
    expect(getKanbanColumnTitle("todo")).toBe("To Do");
    expect(getKanbanColumnTitle("ready-to-merge")).toBe("Ready to Merge");
  });
});
