import { describe, expect, it, vi } from "vitest";
import type { InternalToolExecutionContext } from "@nexus/core";
import { GoalsTool } from "./goals.tool";
import type { ProjectGoalsService } from "../../../goals/project-goals.service";

describe("GoalsTool", () => {
  it("derives project_id from context.scopeId when omitted", async () => {
    const service = { listGoals: vi.fn().mockResolvedValue([]) };
    const tool = new GoalsTool(service as unknown as ProjectGoalsService);

    await tool.execute({ scopeId: "project-from-context" }, {});

    expect(service.listGoals).toHaveBeenCalledWith("project-from-context");
  });
});
