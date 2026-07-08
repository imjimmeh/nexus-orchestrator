import type { InternalToolExecutionContext } from "@nexus/core";
import { describe, expect, it, vi } from "vitest";
import { ProjectOrchestrationWakeupService } from "../../../orchestration/project-orchestration-wakeup.service";
import { OrchestrationRequestWakeupTool } from "./orchestration-request-wakeup.tool";

interface MockWakeupService {
  requestWakeup: ReturnType<typeof vi.fn>;
}

describe("OrchestrationRequestWakeupTool", () => {
  const context = {} as InternalToolExecutionContext;

  function createTool(overrides?: { wakeup?: MockWakeupService }): {
    tool: OrchestrationRequestWakeupTool;
    wakeup: MockWakeupService;
  } {
    const wakeup = overrides?.wakeup ?? {
      requestWakeup: vi.fn().mockResolvedValue({ emitted: true }),
    };
    const tool = new OrchestrationRequestWakeupTool(
      wakeup as unknown as ProjectOrchestrationWakeupService,
    );
    return { tool, wakeup };
  }

  it("has the kanban orchestration request wakeup tool name", () => {
    const { tool } = createTool();

    expect(tool.getName()).toBe("kanban.orchestration_request_wakeup");
    expect(tool.getDefinition().name).toBe(
      "kanban.orchestration_request_wakeup",
    );
  });

  it("routes wakeup requests through the project wakeup service", async () => {
    const { tool, wakeup } = createTool();

    const result = await tool.execute(context, {
      project_id: "project-1",
      source: "revision_complete",
      reason: "Spec revision workflow completed",
      dedupe_key:
        "project-orchestration-cycle:project-1:revision_complete:spec_revision_completed",
    });

    expect(wakeup.requestWakeup).toHaveBeenCalledWith({
      projectId: "project-1",
      source: "revision_complete",
      reason: "Spec revision workflow completed",
      dedupeKey:
        "project-orchestration-cycle:project-1:revision_complete:spec_revision_completed",
    });
    expect(result).toEqual({
      ok: true,
      project_id: "project-1",
      emitted: true,
    });
  });

  it("returns suppression outcomes without emitting a direct cycle event", async () => {
    const { tool } = createTool({
      wakeup: {
        requestWakeup: vi.fn().mockResolvedValue({
          emitted: false,
          reason: "orchestration_auto_wake_suppressed",
        }),
      },
    });

    await expect(
      tool.execute(context, {
        project_id: "project-1",
        source: "revision_complete",
        reason: "Spec revision workflow completed",
      }),
    ).resolves.toEqual({
      ok: true,
      project_id: "project-1",
      emitted: false,
      reason: "orchestration_auto_wake_suppressed",
    });
  });

  it("derives project_id from context.scopeId when omitted", async () => {
    const { tool, wakeup } = createTool();

    await tool.execute(
      { scopeId: "project-from-context" },
      {
        reason: "Spec revision workflow completed",
        source: "revision_complete",
      },
    );

    expect(wakeup.requestWakeup).toHaveBeenCalledWith({
      projectId: "project-from-context",
      source: "revision_complete",
      reason: "Spec revision workflow completed",
      dedupeKey: undefined,
    });
  });
});
