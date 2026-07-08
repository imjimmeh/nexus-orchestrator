import { Injectable } from "@nestjs/common";
import type {
  InternalToolExecutionContext,
} from "@nexus/core";
import { KanbanTool } from "../kanban-tool";
import { z } from "zod";
import { OrchestrationLeaseService } from "../../../orchestration/control-plane/orchestration-lease.service";
import { OrchestrationResetIntentsSchema } from "../shared/schemas";
import { resolveProjectIdFromToolContext } from "../shared/tool-context-resolvers";

type OrchestrationResetIntentsParams = z.infer<
  typeof OrchestrationResetIntentsSchema
>;

@Injectable()
export class OrchestrationResetIntentsTool extends KanbanTool<
  OrchestrationResetIntentsParams,
  unknown
> {
  constructor(private readonly leaseService: OrchestrationLeaseService) {
    super("kanban.reset_orchestration_intents", {
      name: "kanban.reset_orchestration_intents",
      description:
        "Release all active orchestration leases for a project. Use when the CEO cycle is stuck because conflicting leases are held. This releases the lease backlog so the next cycle can proceed.",
      inputSchema: OrchestrationResetIntentsSchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    });
  }

  protected async run(
    context: InternalToolExecutionContext,
    params: OrchestrationResetIntentsParams,
  ): Promise<unknown> {
    const projectId = resolveProjectIdFromToolContext({
      projectId: params.project_id,
      contextScopeId: context.scopeId,
      toolName: this.getName(),
    });

    const count = await this.leaseService.releaseAllForProject(projectId);

    return {
      ok: true,
      project_id: projectId,
      reset_count: count,
      message:
        count > 0
          ? `${count} leases released. The next CEO cycle can proceed.`
          : "No active leases found — nothing to release.",
    };
  }
}
