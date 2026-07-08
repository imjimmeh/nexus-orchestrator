import type { InternalToolExecutionContext } from "@nexus/core";
import { describe, expect, it, vi } from "vitest";
import { ImportedRepositoryFindingsTool } from "./imported-repository-findings.tool";
import { ImportedRepositoryFindingResolutionService } from "../../../orchestration/imported-repository-finding-resolution.service";

describe("ImportedRepositoryFindingsTool", () => {
  function createTool() {
    const listFindings = vi.fn().mockResolvedValue([]);
    const resolutionService = {
      listFindings,
    } as unknown as ImportedRepositoryFindingResolutionService;
    const tool = new ImportedRepositoryFindingsTool(resolutionService);
    return { tool, listFindings };
  }

  it("uses explicit project_id when provided", async () => {
    const { tool, listFindings } = createTool();

    await tool.execute({}, { project_id: "explicit-project" });

    expect(listFindings).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "explicit-project" }),
    );
  });

  it("derives project_id from context.scopeId when project_id is omitted", async () => {
    const { tool, listFindings } = createTool();
    const context: InternalToolExecutionContext = {
      scopeId: "project-from-context",
    };

    await tool.execute(context, {});

    expect(listFindings).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "project-from-context" }),
    );
  });

  it("throws when neither project_id nor context.scopeId is available", async () => {
    const { tool } = createTool();

    await expect(tool.execute({}, {})).rejects.toThrow();
  });
});
