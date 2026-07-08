import type { InternalToolExecutionContext } from "@nexus/core";
import { describe, expect, it, vi } from "vitest";
import { OrchestrationService } from "../../../orchestration/orchestration.service";
import { RecordStrategicIntentTool } from "./record-strategic-intent.tool";

interface MockOrchestration {
  recordStrategicIntent: ReturnType<typeof vi.fn>;
}

describe("RecordStrategicIntentTool", () => {
  const context = {} as InternalToolExecutionContext;

  function createMockOrchestration(): MockOrchestration {
    return {
      recordStrategicIntent: vi.fn().mockResolvedValue({
        kind: "strategic_intent",
        focus_initiative_id: "init-1",
        rationale: "Focusing on authentication",
        planned_next_steps: ["Implement OAuth"],
        staleness_actions: [],
        created_at: "2026-06-13T00:00:00.000Z",
      }),
    };
  }

  function createTool(overrides?: { orchestration?: MockOrchestration }): {
    tool: RecordStrategicIntentTool;
    orchestration: MockOrchestration;
  } {
    const orchestration = overrides?.orchestration ?? createMockOrchestration();
    const tool = new RecordStrategicIntentTool(
      orchestration as unknown as OrchestrationService,
    );
    return { tool, orchestration };
  }

  it("getName returns 'kanban.record_strategic_intent'", () => {
    const { tool } = createTool();
    expect(tool.getName()).toBe("kanban.record_strategic_intent");
    expect(tool.getDefinition().name).toBe("kanban.record_strategic_intent");
  });

  it("delegates to OrchestrationService.recordStrategicIntent with resolved project id", async () => {
    const orchestration = createMockOrchestration();
    const { tool } = createTool({ orchestration });

    const result = await tool.execute(context, {
      project_id: "project-1",
      focus_initiative_id: "init-1",
      rationale: "Focusing on authentication initiative",
      planned_next_steps: ["Implement OAuth", "Add MFA"],
      staleness_actions: ["Review open PRs"],
    });

    expect(orchestration.recordStrategicIntent).toHaveBeenCalledTimes(1);
    expect(orchestration.recordStrategicIntent).toHaveBeenCalledWith(
      "project-1",
      {
        focus_initiative_id: "init-1",
        rationale: "Focusing on authentication initiative",
        planned_next_steps: ["Implement OAuth", "Add MFA"],
        staleness_actions: ["Review open PRs"],
      },
    );
    expect(result).toMatchObject({
      kind: "strategic_intent",
      focus_initiative_id: "init-1",
    });
  });

  it("derives project id from context.scopeId when project_id is omitted", async () => {
    const orchestration = createMockOrchestration();
    const { tool } = createTool({ orchestration });

    await tool.execute(
      { scopeId: "project-from-context" },
      {
        focus_initiative_id: null,
        rationale: "No specific initiative in focus",
        planned_next_steps: [],
        staleness_actions: [],
      },
    );

    expect(orchestration.recordStrategicIntent).toHaveBeenCalledWith(
      "project-from-context",
      {
        focus_initiative_id: null,
        rationale: "No specific initiative in focus",
        planned_next_steps: [],
        staleness_actions: [],
      },
    );
  });
});
