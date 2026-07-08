import { Injectable } from "@nestjs/common";
import type {
  InternalToolExecutionContext,
} from "@nexus/core";
import { KanbanTool } from "../kanban-tool";
import { z } from "zod";
import { ProbeResultsService } from "../../../orchestration/probe-results.service";
import { WriteProbeResultSchema } from "../shared/schemas";

type WriteProbeResultParams = z.infer<typeof WriteProbeResultSchema>;

@Injectable()
export class WriteProbeResultTool extends KanbanTool<WriteProbeResultParams> {
  constructor(private readonly probeResults: ProbeResultsService) {
    super("kanban.write_probe_result", {
      name: "kanban.write_probe_result",
      description:
        "Record an imported-repository probe result in kanban orchestration state.",
      inputSchema: WriteProbeResultSchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    });
  }

  protected async run(
    _context: InternalToolExecutionContext,
    params: WriteProbeResultParams,
  ): Promise<Record<string, unknown>> {
    const result = await this.probeResults.recordProbeResult({
      projectId: params.project_id,
      probeScopeId: params.scope_id,
      outcome: params.outcome,
      result: params.result,
      recordedAt: new Date().toISOString(),
      probeType: params.probe_type,
      expectedOutputSchema: params.expected_output_schema,
      evidenceRefs: params.evidence_refs,
      narrativeSummary: params.narrative_summary,
    });

    return {
      ...result,
      project_id: params.project_id,
      scope_id: params.scope_id,
      outcome: params.outcome,
    };
  }
}
