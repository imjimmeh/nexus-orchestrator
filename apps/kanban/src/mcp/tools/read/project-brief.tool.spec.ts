import { describe, expect, it, vi } from "vitest";
import type { InternalToolExecutionContext } from "@nexus/core";
import { ProjectBriefTool } from "./project-brief.tool";
import type { ProjectService } from "../../../project/project.service";

describe("ProjectBriefTool", () => {
  it("derives project_id from context.scopeId when omitted", async () => {
    const project = { id: "project-from-context" };
    const service = { get: vi.fn().mockResolvedValue(project) };
    const tool = new ProjectBriefTool(service as unknown as ProjectService);

    await expect(
      tool.execute({ scopeId: "project-from-context" }, {}),
    ).resolves.toBe(project);
    expect(service.get).toHaveBeenCalledWith("project-from-context");
  });
});
