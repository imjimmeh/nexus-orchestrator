import type { InternalToolExecutionContext } from "@nexus/core";
import { describe, expect, it, vi } from "vitest";
import { WriteProbeResultTool } from "./write-probe-result.tool";

describe("WriteProbeResultTool", () => {
  const context = {} as InternalToolExecutionContext;

  it("records probe results through the Kanban orchestration service", async () => {
    const probeResults = {
      recordProbeResult: vi.fn().mockResolvedValue({ ok: true }),
    };
    const tool = new WriteProbeResultTool(probeResults as never);

    const result = await tool.execute(context, {
      project_id: "project-1",
      scope_id: "web-ui",
      outcome: "success",
      result: { inferred_status: "implemented" },
      probe_type: "feature_scope",
      expected_output_schema: "probe-result-v1",
      evidence_refs: ["apps/web/src/App.tsx"],
      narrative_summary: "Web UI exists.",
    });

    expect(probeResults.recordProbeResult).toHaveBeenCalledWith({
      projectId: "project-1",
      probeScopeId: "web-ui",
      outcome: "success",
      result: { inferred_status: "implemented" },
      recordedAt: expect.any(String),
      probeType: "feature_scope",
      expectedOutputSchema: "probe-result-v1",
      evidenceRefs: ["apps/web/src/App.tsx"],
      narrativeSummary: "Web UI exists.",
    });
    expect(result).toEqual({
      ok: true,
      project_id: "project-1",
      scope_id: "web-ui",
      outcome: "success",
    });
  });
});
