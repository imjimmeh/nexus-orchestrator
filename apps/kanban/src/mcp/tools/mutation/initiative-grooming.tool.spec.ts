import type { InternalToolExecutionContext } from "@nexus/core";
import { describe, expect, it, vi } from "vitest";
import { InitiativesService } from "../../../initiatives/initiatives.service";
import { InitiativeLinkGoalTool } from "./initiative-link-goal.tool";
import { InitiativeSetPriorityTool } from "./initiative-set-priority.tool";

const context = {} as InternalToolExecutionContext;

describe("InitiativeSetPriorityTool", () => {
  it("delegates to setPriority", async () => {
    const service = { setPriority: vi.fn().mockResolvedValue({ id: "i1" }) };
    const tool = new InitiativeSetPriorityTool(
      service as unknown as InitiativesService,
    );
    expect(tool.getName()).toBe("kanban.initiative_set_priority");
    await tool.execute(context, {
      project_id: "p1",
      initiative_id: "i1",
      priority: 3,
    });
    expect(service.setPriority).toHaveBeenCalledWith("p1", "i1", 3);
  });
});

describe("InitiativeLinkGoalTool", () => {
  it("links a goal by default", async () => {
    const service = { linkGoal: vi.fn().mockResolvedValue({ id: "i1" }) };
    const tool = new InitiativeLinkGoalTool(
      service as unknown as InitiativesService,
    );
    expect(tool.getName()).toBe("kanban.initiative_link_goal");
    await tool.execute(context, {
      project_id: "p1",
      initiative_id: "i1",
      goal_id: "g1",
    });
    expect(service.linkGoal).toHaveBeenCalledWith("p1", "i1", "g1", true);
  });

  it("unlinks when linked is false", async () => {
    const service = { linkGoal: vi.fn().mockResolvedValue({ id: "i1" }) };
    const tool = new InitiativeLinkGoalTool(
      service as unknown as InitiativesService,
    );
    await tool.execute(context, {
      project_id: "p1",
      initiative_id: "i1",
      goal_id: "g1",
      linked: false,
    });
    expect(service.linkGoal).toHaveBeenCalledWith("p1", "i1", "g1", false);
  });
});
