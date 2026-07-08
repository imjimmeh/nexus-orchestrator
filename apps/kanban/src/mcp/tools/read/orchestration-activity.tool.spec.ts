import { describe, expect, it, vi } from "vitest";
import { OrchestrationActivityTool } from "./orchestration-activity.tool";
import type { OrchestrationService } from "../../../orchestration/orchestration.service";

describe("OrchestrationActivityTool", () => {
  const summary = { totalActionCount: 3, recent: [] };

  function buildTool() {
    const service = {
      getActivitySummary: vi.fn().mockResolvedValue(summary),
    };
    const tool = new OrchestrationActivityTool(
      service as unknown as OrchestrationService,
    );
    return { service, tool };
  }

  it("exposes a stable tool name and runner-local definition", () => {
    const { tool } = buildTool();

    expect(tool.getName()).toBe("kanban.orchestration_activity");
    const definition = tool.getDefinition();
    expect(definition).toMatchObject({
      name: "kanban.orchestration_activity",
      tierRestriction: 2,
      transport: "runner_local",
      runtimeOwner: "runner",
    });
    expect(typeof definition.description).toBe("string");
    expect(definition.description.length).toBeGreaterThan(0);
  });

  it("forwards the resolved project_id and limit to getActivitySummary", async () => {
    const { service, tool } = buildTool();

    await expect(
      tool.execute(
        { scopeId: "ignored" },
        { project_id: "project-1", limit: 7 },
      ),
    ).resolves.toEqual(summary);
    expect(service.getActivitySummary).toHaveBeenCalledWith("project-1", {
      limit: 7,
    });
  });

  it("derives project_id from context.scopeId and omits limit when not provided", async () => {
    const { service, tool } = buildTool();

    await expect(
      tool.execute({ scopeId: "project-from-context" }, {}),
    ).resolves.toEqual(summary);
    expect(service.getActivitySummary).toHaveBeenCalledWith(
      "project-from-context",
      {},
    );
  });
});
