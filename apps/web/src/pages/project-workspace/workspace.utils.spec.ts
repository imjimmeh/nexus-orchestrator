import { describe, expect, it } from "vitest";
import {
  buildRefinementContext,
  deriveSessionSummary,
  getRunStatusBadgeVariant,
  hasSpecContent,
} from "./workspace.utils";
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

describe("workspace.utils", () => {
  describe("getRunStatusBadgeVariant", () => {
    it("returns default for in-progress", () => {
      expect(getRunStatusBadgeVariant("in-progress")).toBe("default");
    });

    it("returns default for refinement", () => {
      expect(getRunStatusBadgeVariant("refinement")).toBe("default");
    });

    it("returns secondary for in-review", () => {
      expect(getRunStatusBadgeVariant("in-review")).toBe("secondary");
    });

    it("returns destructive for blocked", () => {
      expect(getRunStatusBadgeVariant("blocked")).toBe("destructive");
    });

    it("returns outline for other statuses", () => {
      expect(getRunStatusBadgeVariant("backlog")).toBe("outline");
      expect(getRunStatusBadgeVariant("todo")).toBe("outline");
      expect(getRunStatusBadgeVariant("done")).toBe("outline");
      expect(getRunStatusBadgeVariant("ready-to-merge")).toBe("outline");
    });
  });

  describe("buildRefinementContext", () => {
    it("returns empty string for no items", () => {
      expect(buildRefinementContext([])).toBe("");
    });

    it("builds context with item details", () => {
      const items = [
        makeItem({
          title: "Add auth",
          type: "epic",
          status: "todo",
          priority: "p1",
        }),
      ];
      const ctx = buildRefinementContext(items);
      expect(ctx).toContain("1 work item(s)");
      expect(ctx).toContain('[EPIC] "Add auth" (todo, p1)');
    });

    it("includes descriptions when present", () => {
      const items = [
        makeItem({ title: "Login flow", description: "Implement JWT login" }),
      ];
      const ctx = buildRefinementContext(items);
      expect(ctx).toContain("Description: Implement JWT login");
    });

    it("handles multiple items", () => {
      const items = [
        makeItem({ title: "Item A" }),
        makeItem({ title: "Item B" }),
        makeItem({ title: "Item C" }),
      ];
      const ctx = buildRefinementContext(items);
      expect(ctx).toContain("3 work item(s)");
      expect(ctx).toContain('"Item A"');
      expect(ctx).toContain('"Item B"');
      expect(ctx).toContain('"Item C"');
    });
  });

  describe("hasSpecContent", () => {
    it("returns false for null/undefined/empty", () => {
      expect(hasSpecContent(null)).toBe(false);
      expect(hasSpecContent(undefined)).toBe(false);
      expect(hasSpecContent("")).toBe(false);
    });

    it("returns false for headers-only content", () => {
      expect(hasSpecContent("# Title\n## Section")).toBe(false);
    });

    it("returns true for content with body text", () => {
      expect(hasSpecContent("# Title\nSome actual content here.")).toBe(true);
    });

    it("returns true for non-header content", () => {
      expect(hasSpecContent("Just plain text")).toBe(true);
    });
  });

  describe("deriveSessionSummary", () => {
    it("returns running for RUNNING execution", () => {
      const item = makeItem({
        status: "in-progress",
        currentExecutionId: "exec-1",
        lastExecutionStatus: "RUNNING",
      });
      const summary = deriveSessionSummary(item);
      expect(summary.status).toBe("running");
      expect(summary.hasExecution).toBe(true);
      expect(summary.label).toBe("Agent Running");
    });

    it("returns awaiting-input for RUNNING execution with waitingForInput", () => {
      const item = makeItem({
        status: "in-progress",
        currentExecutionId: "exec-1",
        lastExecutionStatus: "RUNNING",
        waitingForInput: true,
      });
      const summary = deriveSessionSummary(item);
      expect(summary.status).toBe("awaiting-input");
      expect(summary.hasExecution).toBe(true);
      expect(summary.label).toBe("Awaiting Input");
    });

    it("returns queued for PENDING execution", () => {
      const item = makeItem({
        status: "in-progress",
        currentExecutionId: "exec-2",
        lastExecutionStatus: "PENDING",
      });
      const summary = deriveSessionSummary(item);
      expect(summary.status).toBe("queued");
      expect(summary.label).toBe("Queued");
    });

    it("returns error for FAILED execution", () => {
      const item = makeItem({
        status: "in-progress",
        currentExecutionId: "exec-3",
        lastExecutionStatus: "FAILED",
      });
      const summary = deriveSessionSummary(item);
      expect(summary.status).toBe("error");
      expect(summary.label).toBe("Execution Failed");
    });

    it("returns error for CANCELLED execution", () => {
      const item = makeItem({
        status: "in-review",
        currentExecutionId: "exec-4",
        lastExecutionStatus: "CANCELLED",
      });
      const summary = deriveSessionSummary(item);
      expect(summary.status).toBe("error");
      expect(summary.label).toBe("Execution Failed");
    });

    it("returns blocked for blocked with execution", () => {
      const item = makeItem({
        status: "blocked",
        currentExecutionId: "exec-5",
      });
      const summary = deriveSessionSummary(item);
      expect(summary.status).toBe("blocked");
      expect(summary.label).toBe("Blocked (Session Active)");
    });

    it("returns blocked for blocked without execution", () => {
      const item = makeItem({ status: "blocked" });
      const summary = deriveSessionSummary(item);
      expect(summary.status).toBe("blocked");
      expect(summary.label).toBe("Blocked");
    });

    it("returns completed for done items", () => {
      const item = makeItem({ status: "done" });
      const summary = deriveSessionSummary(item);
      expect(summary.status).toBe("completed");
      expect(summary.label).toBe("Completed");
    });

    it("returns completed for ready-to-merge items", () => {
      const item = makeItem({ status: "ready-to-merge" });
      const summary = deriveSessionSummary(item);
      expect(summary.status).toBe("completed");
      expect(summary.label).toBe("Ready to Merge");
    });

    it("returns completed for COMPLETED execution", () => {
      const item = makeItem({
        status: "in-progress",
        currentExecutionId: "exec-6",
        lastExecutionStatus: "COMPLETED",
      });
      const summary = deriveSessionSummary(item);
      expect(summary.status).toBe("completed");
      expect(summary.label).toBe("Execution Complete");
    });

    it("returns idle for todo without execution", () => {
      const item = makeItem({ status: "todo" });
      const summary = deriveSessionSummary(item);
      expect(summary.status).toBe("idle");
      expect(summary.hasExecution).toBe(false);
      expect(summary.label).toBe("No Session");
    });
  });
});
