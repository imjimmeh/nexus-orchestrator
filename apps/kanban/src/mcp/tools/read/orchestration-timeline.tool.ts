import { Injectable } from "@nestjs/common";
import type {
  InternalToolExecutionContext,
} from "@nexus/core";
import { KanbanTool } from "../kanban-tool";
import { OrchestrationService } from "../../../orchestration/orchestration.service";
import { OrchestrationTimelineSchema } from "../shared/schemas";
import { resolveProjectIdFromToolContext } from "../shared/tool-context-resolvers";
import { z } from "zod";

type OrchestrationTimelineParams = z.infer<typeof OrchestrationTimelineSchema>;

interface OrchestrationTimelineResult {
  state: unknown;
  diagnostics: unknown;
}

@Injectable()
export class OrchestrationTimelineTool extends KanbanTool<
  OrchestrationTimelineParams,
  OrchestrationTimelineResult
> {
  constructor(private readonly orchestration: OrchestrationService) {
    super("kanban.orchestration_timeline", {
      name: "kanban.orchestration_timeline",
      description:
        "Read kanban orchestration state and diagnostics for a project. " +
        "Returns the most-recent orchestration decisions (default cap), with " +
        "the full decision total in diagnostics.decisionCount. Supports " +
        "`limit` and `offset` to page backwards through decision history.",
      inputSchema: OrchestrationTimelineSchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    });
  }

  protected async run(
    context: InternalToolExecutionContext,
    params: OrchestrationTimelineParams,
  ) {
    const projectId = resolveProjectIdFromToolContext({
      projectId: params.project_id,
      contextScopeId: context.scopeId,
      toolName: this.getName(),
    });

    const window = { limit: params.limit, offset: params.offset };
    const [state, diagnostics] = await Promise.all([
      this.orchestration.get(projectId, window),
      this.orchestration.getDiagnostics(projectId, window),
    ]);
    return { state, diagnostics };
  }
}
