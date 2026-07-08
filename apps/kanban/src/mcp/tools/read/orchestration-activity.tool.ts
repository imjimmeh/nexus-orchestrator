import { Injectable } from "@nestjs/common";
import type {
  InternalToolExecutionContext,
} from "@nexus/core";
import { KanbanTool } from "../kanban-tool";
import { OrchestrationService } from "../../../orchestration/orchestration.service";
import { OrchestrationActivitySchema } from "../shared/schemas";
import { resolveProjectIdFromToolContext } from "../shared/tool-context-resolvers";
import { z } from "zod";

type OrchestrationActivityParams = z.infer<typeof OrchestrationActivitySchema>;

type OrchestrationActivityResult = Awaited<
  ReturnType<OrchestrationService["getActivitySummary"]>
>;

@Injectable()
export class OrchestrationActivityTool extends KanbanTool<
  OrchestrationActivityParams,
  OrchestrationActivityResult
> {
  constructor(private readonly orchestration: OrchestrationService) {
    super("kanban.orchestration_activity", {
      name: "kanban.orchestration_activity",
      description:
        "Read a short, bounded feed of the most recent kanban orchestration " +
        "activity (decisions and action requests) for a project. Prefer this " +
        "over orchestration_timeline for routine checks.",
      inputSchema: OrchestrationActivitySchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    });
  }

  protected async run(
    context: InternalToolExecutionContext,
    params: OrchestrationActivityParams,
  ): Promise<OrchestrationActivityResult> {
    const projectId = resolveProjectIdFromToolContext({
      projectId: params.project_id,
      contextScopeId: context.scopeId,
      toolName: this.getName(),
    });

    return this.orchestration.getActivitySummary(
      projectId,
      params.limit !== undefined ? { limit: params.limit } : {},
    );
  }
}
