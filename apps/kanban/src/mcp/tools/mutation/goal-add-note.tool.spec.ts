import type { InternalToolExecutionContext } from "@nexus/core";
import { describe, expect, it, vi } from "vitest";
import { ProjectGoalsService } from "../../../goals/project-goals.service";
import { GoalAddNoteTool } from "./goal-add-note.tool";

describe("GoalAddNoteTool", () => {
  const context = {} as InternalToolExecutionContext;

  it("delegates to ProjectGoalsService.createWorklog", async () => {
    const goals = {
      createWorklog: vi.fn().mockResolvedValue({ id: "wl1", note: "Shipped!" }),
    };
    const tool = new GoalAddNoteTool(goals as unknown as ProjectGoalsService);

    expect(tool.getName()).toBe("kanban.goal_add_note");

    const result = await tool.execute(context, {
      project_id: "p1",
      goal_id: "g1",
      note: "Shipped!",
    });

    expect(goals.createWorklog).toHaveBeenCalledWith(
      "p1",
      "g1",
      expect.objectContaining({
        note: "Shipped!",
        entry_type: "note",
        author_type: "agent",
      }),
    );
    expect(result).toEqual({ id: "wl1", note: "Shipped!" });
  });

  it("passes optional work_item_id and linked_run_id to createWorklog", async () => {
    const goals = { createWorklog: vi.fn().mockResolvedValue({ id: "wl2" }) };
    const tool = new GoalAddNoteTool(goals as unknown as ProjectGoalsService);

    await tool.execute(context, {
      project_id: "p1",
      goal_id: "g1",
      note: "Linked to work item",
      work_item_id: "wi-42",
      linked_run_id: "run-99",
    });

    expect(goals.createWorklog).toHaveBeenCalledWith(
      "p1",
      "g1",
      expect.objectContaining({
        note: "Linked to work item",
        work_item_id: "wi-42",
        linked_run_id: "run-99",
      }),
    );
  });

  it("derives project_id from context.scopeId when omitted", async () => {
    const goals = { createWorklog: vi.fn().mockResolvedValue({ id: "wl3" }) };
    const tool = new GoalAddNoteTool(goals as unknown as ProjectGoalsService);

    await tool.execute(
      { scopeId: "project-from-context" },
      {
        goal_id: "g2",
        note: "Context note",
      },
    );

    expect(goals.createWorklog).toHaveBeenCalledWith(
      "project-from-context",
      "g2",
      expect.objectContaining({ note: "Context note" }),
    );
  });

  it("derives linked_run_id from context.workflowRunId when omitted", async () => {
    const goals = { createWorklog: vi.fn().mockResolvedValue({ id: "wl4" }) };
    const tool = new GoalAddNoteTool(goals as unknown as ProjectGoalsService);

    await tool.execute(
      { scopeId: "project-from-context", workflowRunId: "run-from-context" },
      { goal_id: "goal-1", note: "Observed a useful decision." },
    );

    expect(goals.createWorklog).toHaveBeenCalledWith(
      "project-from-context",
      "goal-1",
      expect.objectContaining({ linked_run_id: "run-from-context" }),
    );
  });

  it("keeps explicit linked_run_id when provided", async () => {
    const goals = { createWorklog: vi.fn().mockResolvedValue({ id: "wl5" }) };
    const tool = new GoalAddNoteTool(goals as unknown as ProjectGoalsService);

    await tool.execute(
      { scopeId: "project-from-context", workflowRunId: "run-from-context" },
      {
        goal_id: "goal-1",
        note: "Observed a useful decision.",
        linked_run_id: "explicit-run",
      },
    );

    expect(goals.createWorklog).toHaveBeenCalledWith(
      "project-from-context",
      "goal-1",
      expect.objectContaining({ linked_run_id: "explicit-run" }),
    );
  });
});
