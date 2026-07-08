import type { InternalToolExecutionContext } from "@nexus/core";
import { describe, expect, it, vi } from "vitest";
import { ImportedRepositoryFindingResolutionService } from "../../../orchestration/imported-repository-finding-resolution.service";
import { ResolveImportedRepositoryFindingTool } from "./resolve-imported-repository-finding.tool";

describe("ResolveImportedRepositoryFindingTool", () => {
  function createTool() {
    const resolveFinding = vi.fn().mockResolvedValue({});
    const resolutionService = {
      resolveFinding,
    } as unknown as ImportedRepositoryFindingResolutionService;
    const tool = new ResolveImportedRepositoryFindingTool(resolutionService);
    return { tool, resolveFinding };
  }

  const baseParams = {
    finding_id: "finding-123",
    disposition: "suppress" as const,
    rationale: "Already addressed upstream",
  };

  it("uses explicit project_id when provided", async () => {
    const { tool, resolveFinding } = createTool();

    await tool.execute(
      {},
      {
        ...baseParams,
        project_id: "explicit-project",
      },
    );

    expect(resolveFinding).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "explicit-project" }),
    );
  });

  it("derives project_id from context.scopeId when project_id is omitted", async () => {
    const { tool, resolveFinding } = createTool();

    await tool.execute({ scopeId: "project-from-context" }, baseParams);

    expect(resolveFinding).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "project-from-context" }),
    );
  });

  it("throws when neither project_id nor context.scopeId is available", async () => {
    const { tool } = createTool();

    await expect(tool.execute({}, baseParams)).rejects.toThrow();
  });
});
