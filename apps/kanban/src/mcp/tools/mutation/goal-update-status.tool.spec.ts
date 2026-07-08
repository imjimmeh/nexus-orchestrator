import type { InternalToolExecutionContext } from "@nexus/core";
import { describe, expect, it, vi } from "vitest";
import { ProjectGoalsService } from "../../../goals/project-goals.service";
import { GoalUpdateStatusTool } from "./goal-update-status.tool";

describe("GoalUpdateStatusTool", () => {
  const context = {} as InternalToolExecutionContext;

  it("delegates to ProjectGoalsService.updateStatus", async () => {
    const goals = {
      updateStatus: vi
        .fn()
        .mockResolvedValue({ id: "g1", status: "completed" }),
    };
    const tool = new GoalUpdateStatusTool(
      goals as unknown as ProjectGoalsService,
    );

    expect(tool.getName()).toBe("kanban.goal_update_status");

    const result = await tool.execute(context, {
      project_id: "p1",
      goal_id: "g1",
      status: "completed",
    });

    expect(goals.updateStatus).toHaveBeenCalledWith(
      "p1",
      "g1",
      expect.objectContaining({ status: "completed" }),
    );
    expect(result).toEqual({ id: "g1", status: "completed" });
  });

  it("defaults author_type to 'agent' when not provided", async () => {
    const goals = {
      updateStatus: vi
        .fn()
        .mockResolvedValue({ id: "g1", status: "in_progress" }),
    };
    const tool = new GoalUpdateStatusTool(
      goals as unknown as ProjectGoalsService,
    );

    await tool.execute(context, {
      project_id: "p1",
      goal_id: "g1",
      status: "in_progress",
    });

    expect(goals.updateStatus).toHaveBeenCalledWith(
      "p1",
      "g1",
      expect.objectContaining({ author_type: "agent" }),
    );
  });

  it("uses the provided author_type when specified", async () => {
    const goals = {
      updateStatus: vi.fn().mockResolvedValue({ id: "g1", status: "blocked" }),
    };
    const tool = new GoalUpdateStatusTool(
      goals as unknown as ProjectGoalsService,
    );

    await tool.execute(context, {
      project_id: "p1",
      goal_id: "g1",
      status: "blocked",
      author_type: "user",
      note: "Blocked by dependency",
    });

    expect(goals.updateStatus).toHaveBeenCalledWith(
      "p1",
      "g1",
      expect.objectContaining({
        author_type: "user",
        note: "Blocked by dependency",
      }),
    );
  });

  it("derives project_id from context.scopeId when omitted", async () => {
    const goals = {
      updateStatus: vi
        .fn()
        .mockResolvedValue({ id: "g2", status: "completed" }),
    };
    const tool = new GoalUpdateStatusTool(
      goals as unknown as ProjectGoalsService,
    );

    await tool.execute(
      { scopeId: "project-from-context" },
      {
        goal_id: "g2",
        status: "completed",
      },
    );

    expect(goals.updateStatus).toHaveBeenCalledWith(
      "project-from-context",
      "g2",
      expect.objectContaining({ status: "completed" }),
    );
  });
});
