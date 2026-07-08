import { Injectable } from "@nestjs/common";
import type {
  InternalToolExecutionContext,
} from "@nexus/core";
import { KanbanTool } from "../kanban-tool";
import { z } from "zod";
import { ProjectOrchestrationWakeupService } from "../../../orchestration/project-orchestration-wakeup.service";
import { OrchestrationRequestWakeupSchema } from "../shared/schemas";
import { resolveProjectIdFromToolContext } from "../shared/tool-context-resolvers";

type OrchestrationRequestWakeupParams = z.infer<
  typeof OrchestrationRequestWakeupSchema
>;

@Injectable()
export class OrchestrationRequestWakeupTool extends KanbanTool<
  OrchestrationRequestWakeupParams,
  unknown
> {
  constructor(private readonly wakeup: ProjectOrchestrationWakeupService) {
    super("kanban.orchestration_request_wakeup", {
      name: "kanban.orchestration_request_wakeup",
      description:
        "Request a project orchestration wakeup through Kanban's auto-wakeup suppression, cooldown, and coalescing gates.",
      inputSchema: OrchestrationRequestWakeupSchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    });
  }

  protected async run(
    context: InternalToolExecutionContext,
    params: OrchestrationRequestWakeupParams,
  ): Promise<unknown> {
    const projectId = resolveProjectIdFromToolContext({
      projectId: params.project_id,
      contextScopeId: context.scopeId,
      toolName: this.getName(),
    });

    const result = await this.wakeup.requestWakeup({
      projectId,
      reason: params.reason,
      source: params.source,
      dedupeKey: params.dedupe_key,
    });

    return {
      ok: true,
      project_id: projectId,
      ...result,
    };
  }
}
