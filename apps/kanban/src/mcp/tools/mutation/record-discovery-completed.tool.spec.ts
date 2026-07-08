import type { InternalToolExecutionContext } from "@nexus/core";
import { describe, expect, it, vi } from "vitest";
import { OrchestrationService } from "../../../orchestration/orchestration.service";
import { RecordDiscoveryCompletedTool } from "./record-discovery-completed.tool";

interface MockOrchestration {
  recordDiscoveryCompleted: ReturnType<typeof vi.fn>;
}

describe("RecordDiscoveryCompletedTool", () => {
  const FIXED_TIMESTAMP = "2026-06-13T00:00:00.000Z";

  function createMockOrchestration(): MockOrchestration {
    return {
      recordDiscoveryCompleted: vi.fn().mockResolvedValue(undefined),
    };
  }

  function createTool(overrides?: { orchestration?: MockOrchestration }): {
    tool: RecordDiscoveryCompletedTool;
    orchestration: MockOrchestration;
  } {
    const orchestration = overrides?.orchestration ?? createMockOrchestration();
    const tool = new RecordDiscoveryCompletedTool(
      orchestration as unknown as OrchestrationService,
    );
    return { tool, orchestration };
  }

  it("getName returns 'kanban.record_discovery_completed'", () => {
    const { tool } = createTool();
    expect(tool.getName()).toBe("kanban.record_discovery_completed");
    expect(tool.getDefinition().name).toBe("kanban.record_discovery_completed");
  });

  it("stamps the provided completed_at and returns { project_id, last_discovery_at }", async () => {
    const orchestration = createMockOrchestration();
    const { tool } = createTool({ orchestration });
    const context = {} as InternalToolExecutionContext;

    const result = await tool.execute(context, {
      project_id: "project-1",
      completed_at: FIXED_TIMESTAMP,
    });

    expect(orchestration.recordDiscoveryCompleted).toHaveBeenCalledTimes(1);
    expect(orchestration.recordDiscoveryCompleted).toHaveBeenCalledWith(
      "project-1",
      FIXED_TIMESTAMP,
    );
    expect(result).toEqual({
      project_id: "project-1",
      last_discovery_at: FIXED_TIMESTAMP,
    });
  });

  it("defaults completed_at to an ISO timestamp when omitted, using context.scopeId for project resolution", async () => {
    const orchestration = createMockOrchestration();
    const { tool } = createTool({ orchestration });

    const before = new Date().toISOString();
    const result = await tool.execute({ scopeId: "project-from-context" }, {});
    const after = new Date().toISOString();

    expect(orchestration.recordDiscoveryCompleted).toHaveBeenCalledWith(
      "project-from-context",
      expect.any(String),
    );

    const calledWith = (
      orchestration.recordDiscoveryCompleted.mock.calls[0] as [string, string]
    )[1];
    expect(calledWith >= before).toBe(true);
    expect(calledWith <= after).toBe(true);

    expect(result.project_id).toBe("project-from-context");
    expect(result.last_discovery_at).toBe(calledWith);
  });
});
