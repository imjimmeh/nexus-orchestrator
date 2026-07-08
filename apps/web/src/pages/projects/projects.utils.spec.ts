import { describe, expect, it } from "vitest";
import { buildProjectSummary, getProgressPercentage } from "./projects.utils";
import { Project } from "@/lib/api/projects.types";
import { WorkItem } from "@/lib/api/work-items.types";

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "p-1",
    name: "Test Project",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "wi-1",
    project_id: "p-1",
    title: "Test Task",
    status: "backlog",
    type: "story",
    priority: "p1",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("projects.utils", () => {
  describe("buildProjectSummary", () => {
    it("returns zero counts for an empty work item list", () => {
      const summary = buildProjectSummary(makeProject(), []);

      expect(summary.totalItems).toBe(0);
      expect(summary.statusCounts).toEqual({});
      expect(summary.activeAgentCount).toBe(0);
      expect(summary.totalTokenSpend).toBe(0);
    });

    it("counts items by status", () => {
      const items = [
        makeWorkItem({ id: "1", status: "backlog" }),
        makeWorkItem({ id: "2", status: "backlog" }),
        makeWorkItem({ id: "3", status: "in-progress" }),
        makeWorkItem({ id: "4", status: "done" }),
      ];

      const summary = buildProjectSummary(makeProject(), items);

      expect(summary.totalItems).toBe(4);
      expect(summary.statusCounts).toEqual({
        backlog: 2,
        "in-progress": 1,
        done: 1,
      });
    });

    it("counts active agents from in-progress items with execution ids", () => {
      const items = [
        makeWorkItem({
          id: "1",
          status: "in-progress",
          currentExecutionId: "run-1",
        }),
        makeWorkItem({
          id: "2",
          status: "in-progress",
          currentExecutionId: null,
        }),
        makeWorkItem({
          id: "3",
          status: "in-review",
          currentExecutionId: "run-2",
        }),
        makeWorkItem({
          id: "5",
          status: "refinement",
          currentExecutionId: "run-4",
        }),
        makeWorkItem({ id: "4", status: "done", currentExecutionId: "run-3" }),
      ];

      const summary = buildProjectSummary(makeProject(), items);

      expect(summary.activeAgentCount).toBe(3);
    });

    it("sums token spend across all items", () => {
      const items = [
        makeWorkItem({ id: "1", tokenSpend: 1000 }),
        makeWorkItem({ id: "2", tokenSpend: 2500 }),
        makeWorkItem({ id: "3" }),
      ];

      const summary = buildProjectSummary(makeProject(), items);

      expect(summary.totalTokenSpend).toBe(3500);
    });

    it("attaches the project reference", () => {
      const project = makeProject({ id: "p-42", name: "My Project" });
      const summary = buildProjectSummary(project, []);

      expect(summary.project).toBe(project);
    });
  });

  describe("getProgressPercentage", () => {
    it("returns 0 when there are no items", () => {
      const summary = buildProjectSummary(makeProject(), []);
      expect(getProgressPercentage(summary)).toBe(0);
    });

    it("returns 100 when all items are done", () => {
      const items = [
        makeWorkItem({ id: "1", status: "done" }),
        makeWorkItem({ id: "2", status: "done" }),
      ];
      const summary = buildProjectSummary(makeProject(), items);

      expect(getProgressPercentage(summary)).toBe(100);
    });

    it("returns rounded percentage of done items", () => {
      const items = [
        makeWorkItem({ id: "1", status: "done" }),
        makeWorkItem({ id: "2", status: "in-progress" }),
        makeWorkItem({ id: "3", status: "backlog" }),
      ];
      const summary = buildProjectSummary(makeProject(), items);

      expect(getProgressPercentage(summary)).toBe(33);
    });
  });
});
