import type { InternalToolExecutionContext } from "@nexus/core";
import { describe, expect, it, vi } from "vitest";
import { ProjectGoalsService } from "../../../goals/project-goals.service";
import { GoalUpdateTool } from "./goal-update.tool";

describe("GoalUpdateTool", () => {
  const context = {} as InternalToolExecutionContext;

  it("delegates to ProjectGoalsService.updateGoal", async () => {
    const goals = {
      updateGoal: vi
        .fn()
        .mockResolvedValue({ id: "g1", title: "Updated Title" }),
    };
    const tool = new GoalUpdateTool(goals as unknown as ProjectGoalsService);

    expect(tool.getName()).toBe("kanban.goal_update");

    const result = await tool.execute(context, {
      project_id: "p1",
      goal_id: "g1",
      title: "Updated Title",
    });

    expect(goals.updateGoal).toHaveBeenCalledWith(
      "p1",
      "g1",
      expect.objectContaining({ title: "Updated Title" }),
    );
    expect(result).toEqual({ id: "g1", title: "Updated Title" });
  });

  it("passes all optional fields to updateGoal", async () => {
    const goals = { updateGoal: vi.fn().mockResolvedValue({ id: "g1" }) };
    const tool = new GoalUpdateTool(goals as unknown as ProjectGoalsService);

    await tool.execute(context, {
      project_id: "p1",
      goal_id: "g1",
      title: "New title",
      description: "New description",
      status: "completed",
      moscow: "should",
      priority: "p2",
      target_date: "2026-06-30",
    });

    expect(goals.updateGoal).toHaveBeenCalledWith(
      "p1",
      "g1",
      expect.objectContaining({
        title: "New title",
        description: "New description",
        status: "completed",
        moscow: "should",
        priority: "p2",
        target_date: "2026-06-30",
      }),
    );
  });

  it("derives project_id from context.scopeId when omitted", async () => {
    const goals = { updateGoal: vi.fn().mockResolvedValue({ id: "g2" }) };
    const tool = new GoalUpdateTool(goals as unknown as ProjectGoalsService);

    await tool.execute(
      { scopeId: "project-from-context" },
      {
        goal_id: "g2",
        title: "Context title",
      },
    );

    expect(goals.updateGoal).toHaveBeenCalledWith(
      "project-from-context",
      "g2",
      expect.objectContaining({ title: "Context title" }),
    );
  });
});
