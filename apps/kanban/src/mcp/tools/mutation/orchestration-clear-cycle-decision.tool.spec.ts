import type { InternalToolExecutionContext } from "@nexus/core";
import { describe, expect, it, vi } from "vitest";
import { OrchestrationService } from "../../../orchestration/orchestration.service";
import { OrchestrationClearCycleDecisionSchema } from "../shared/schemas";
import { OrchestrationClearCycleDecisionTool } from "./orchestration-clear-cycle-decision.tool";

interface MockOrchestration {
  clearCycleDecision: ReturnType<typeof vi.fn>;
}

describe("OrchestrationClearCycleDecisionTool", () => {
  const context = {} as InternalToolExecutionContext;

  function createMockOrchestration(): MockOrchestration {
    return {
      clearCycleDecision: vi.fn().mockResolvedValue(undefined),
    };
  }

  function createTool(overrides?: { orchestration?: MockOrchestration }): {
    tool: OrchestrationClearCycleDecisionTool;
    orchestration: MockOrchestration;
  } {
    const orchestration = overrides?.orchestration ?? createMockOrchestration();
    const tool = new OrchestrationClearCycleDecisionTool(
      orchestration as unknown as OrchestrationService,
    );
    return { tool, orchestration };
  }

  it("has tool name kanban.orchestration_clear_cycle_decision from both getName and getDefinition", () => {
    const { tool } = createTool();

    expect(tool.getName()).toBe("kanban.orchestration_clear_cycle_decision");
    expect(tool.getDefinition().name).toBe(
      "kanban.orchestration_clear_cycle_decision",
    );
  });

  it("calls service clearCycleDecision with project id and reason", async () => {
    const orchestration = createMockOrchestration();
    const { tool } = createTool({ orchestration });

    const result = await tool.execute(context, {
      project_id: "project-1",
      reason: "Ready work was restored",
    });

    expect(orchestration.clearCycleDecision).toHaveBeenCalledTimes(1);
    expect(orchestration.clearCycleDecision).toHaveBeenCalledWith("project-1", {
      reason: "Ready work was restored",
    });
    expect(result).toEqual({ ok: true, project_id: "project-1" });
  });

  it("parses the input schema", () => {
    expect(
      OrchestrationClearCycleDecisionSchema.parse({
        project_id: "project-1",
        reason: "Ready work was restored",
      }),
    ).toEqual({
      project_id: "project-1",
      reason: "Ready work was restored",
    });
  });

  it("normalizes blank project id and rejects blank reason", () => {
    expect(
      OrchestrationClearCycleDecisionSchema.parse({
        project_id: "",
        reason: "Ready work was restored",
      }),
    ).toEqual({
      project_id: undefined,
      reason: "Ready work was restored",
    });
    expect(() =>
      OrchestrationClearCycleDecisionSchema.parse({
        project_id: "project-1",
        reason: "",
      }),
    ).toThrow();
  });
});
