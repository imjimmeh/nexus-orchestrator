import { Injectable } from "@nestjs/common";
import type {
  InternalToolExecutionContext,
} from "@nexus/core";
import { KanbanTool } from "../kanban-tool";
import { z } from "zod";
import { OrchestrationService } from "../../../orchestration/orchestration.service";
import { OrchestrationClearCycleDecisionSchema } from "../shared/schemas";
import { resolveProjectIdFromToolContext } from "../shared/tool-context-resolvers";

type OrchestrationClearCycleDecisionParams = z.infer<
  typeof OrchestrationClearCycleDecisionSchema
>;

@Injectable()
export class OrchestrationClearCycleDecisionTool extends KanbanTool<
  OrchestrationClearCycleDecisionParams,
  unknown
> {
  constructor(private readonly orchestration: OrchestrationService) {
    super("kanban.orchestration_clear_cycle_decision", {
      name: "kanban.orchestration_clear_cycle_decision",
      description:
        "Clear a persisted orchestration cycle decision while preserving the decision log audit trail.",
      inputSchema: OrchestrationClearCycleDecisionSchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    });
  }

  protected async run(
    context: InternalToolExecutionContext,
    params: OrchestrationClearCycleDecisionParams,
  ): Promise<unknown> {
    const projectId = resolveProjectIdFromToolContext({
      projectId: params.project_id,
      contextScopeId: context.scopeId,
      toolName: this.getName(),
    });

    await this.orchestration.clearCycleDecision(projectId, {
      reason: params.reason,
    });

    return {
      ok: true,
      project_id: projectId,
    };
  }
}
