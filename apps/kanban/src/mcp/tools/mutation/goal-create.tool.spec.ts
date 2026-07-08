import type { InternalToolExecutionContext } from "@nexus/core";
import { describe, expect, it, vi } from "vitest";
import { ProjectGoalsService } from "../../../goals/project-goals.service";
import { GoalCreateTool } from "./goal-create.tool";

describe("GoalCreateTool", () => {
  const context = {} as InternalToolExecutionContext;

  it("delegates to ProjectGoalsService.createGoal", async () => {
    const goals = {
      createGoal: vi.fn().mockResolvedValue({ id: "g1", title: "Ship MVP" }),
    };
    const tool = new GoalCreateTool(goals as unknown as ProjectGoalsService);

    expect(tool.getName()).toBe("kanban.goal_create");

    const result = await tool.execute(context, {
      project_id: "p1",
      title: "Ship MVP",
    });

    expect(goals.createGoal).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({ title: "Ship MVP" }),
    );
    expect(result).toEqual({ id: "g1", title: "Ship MVP" });
  });

  it("passes all optional fields to createGoal", async () => {
    const goals = {
      createGoal: vi.fn().mockResolvedValue({ id: "g2", title: "Goal" }),
    };
    const tool = new GoalCreateTool(goals as unknown as ProjectGoalsService);

    await tool.execute(context, {
      project_id: "p1",
      title: "Goal",
      description: "A description",
      status: "in_progress",
      moscow: "must",
      priority: "p1",
      target_date: "2026-12-31",
    });

    expect(goals.createGoal).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({
        title: "Goal",
        description: "A description",
        status: "in_progress",
        moscow: "must",
        priority: "p1",
        target_date: "2026-12-31",
      }),
    );
  });

  it("derives project_id from context.scopeId when omitted", async () => {
    const goals = {
      createGoal: vi
        .fn()
        .mockResolvedValue({ id: "g3", title: "Context goal" }),
    };
    const tool = new GoalCreateTool(goals as unknown as ProjectGoalsService);

    await tool.execute(
      { scopeId: "project-from-context" },
      {
        title: "Context goal",
      },
    );

    expect(goals.createGoal).toHaveBeenCalledWith(
      "project-from-context",
      expect.objectContaining({ title: "Context goal" }),
    );
  });
});
