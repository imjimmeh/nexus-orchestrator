import { Injectable } from "@nestjs/common";
import type {
  InternalToolExecutionContext,
} from "@nexus/core";
import { KanbanTool } from "../kanban-tool";
import { z } from "zod";
import { OrchestrationService } from "../../../orchestration/orchestration.service";
import { OrchestrationClearBlockedSchema } from "../shared/schemas";
import { resolveProjectIdFromToolContext } from "../shared/tool-context-resolvers";

type OrchestrationClearBlockedParams = z.infer<
  typeof OrchestrationClearBlockedSchema
>;

@Injectable()
export class OrchestrationClearBlockedTool extends KanbanTool<
  OrchestrationClearBlockedParams,
  unknown
> {
  constructor(private readonly orchestration: OrchestrationService) {
    super("kanban.orchestration_clear_blocked", {
      name: "kanban.orchestration_clear_blocked",
      description:
        "Clear stale blocked import hydration metadata in kanban orchestration state after successful hydration.",
      inputSchema: OrchestrationClearBlockedSchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    });
  }

  protected async run(
    context: InternalToolExecutionContext,
    params: OrchestrationClearBlockedParams,
  ): Promise<unknown> {
    const projectId = resolveProjectIdFromToolContext({
      projectId: params.project_id,
      contextScopeId: context.scopeId,
      toolName: this.getName(),
    });

    await this.orchestration.clearImportHydrationBlocked(projectId, {
      cleared_stage: params.cleared_stage,
      ready_for_cycle: params.ready_for_cycle,
    });

    return {
      ok: true,
      project_id: projectId,
      cleared_stage: params.cleared_stage,
    };
  }
}
