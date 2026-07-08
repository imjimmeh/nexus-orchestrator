import { describe, expect, it, vi } from "vitest";
import { OrchestrationTimelineTool } from "./orchestration-timeline.tool";
import type { OrchestrationService } from "../../../orchestration/orchestration.service";

describe("OrchestrationTimelineTool", () => {
  it("derives project_id from context.scopeId and forwards an empty window when paging params are omitted", async () => {
    const state = { project_id: "project-from-context" };
    const diagnostics = { project_id: "project-from-context" };
    const service = {
      get: vi.fn().mockResolvedValue(state),
      getDiagnostics: vi.fn().mockResolvedValue(diagnostics),
    };
    const tool = new OrchestrationTimelineTool(
      service as unknown as OrchestrationService,
    );

    await expect(
      tool.execute({ scopeId: "project-from-context" }, {}),
    ).resolves.toEqual({ state, diagnostics });
    expect(service.get).toHaveBeenCalledWith("project-from-context", {
      limit: undefined,
      offset: undefined,
    });
    expect(service.getDiagnostics).toHaveBeenCalledWith(
      "project-from-context",
      {
        limit: undefined,
        offset: undefined,
      },
    );
  });

  it("forwards the limit/offset paging window to both get and getDiagnostics", async () => {
    const service = {
      get: vi.fn().mockResolvedValue({ project_id: "project-a" }),
      getDiagnostics: vi.fn().mockResolvedValue({ project_id: "project-a" }),
    };
    const tool = new OrchestrationTimelineTool(
      service as unknown as OrchestrationService,
    );

    await tool.execute(
      { scopeId: "project-a" },
      { project_id: "project-a", limit: 5, offset: 10 },
    );

    expect(service.get).toHaveBeenCalledWith("project-a", {
      limit: 5,
      offset: 10,
    });
    expect(service.getDiagnostics).toHaveBeenCalledWith("project-a", {
      limit: 5,
      offset: 10,
    });
  });
});
