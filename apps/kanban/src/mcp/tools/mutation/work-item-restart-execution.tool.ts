import { Injectable } from "@nestjs/common";
import type {
  InternalToolExecutionContext,
} from "@nexus/core";
import { KanbanTool } from "../kanban-tool";
import { z } from "zod";
import { WorkItemService } from "../../../work-item/work-item.service";
import { ContextualWorkItemIdSchema } from "../shared/schemas";
import { resolveProjectIdFromToolContext } from "../shared/tool-context-resolvers";

const RestartExecutionSchema = ContextualWorkItemIdSchema.extend({});

type RestartExecutionParams = z.infer<typeof RestartExecutionSchema>;

@Injectable()
export class WorkItemRestartExecutionTool extends KanbanTool<
  RestartExecutionParams,
  unknown
> {
  constructor(private readonly workItems: WorkItemService) {
    super("kanban.work_item_restart_execution", {
      name: "kanban.work_item_restart_execution",
      description:
        "Replay the current Kanban work-item lifecycle status event to restart a stalled or failed work-item automation.",
      inputSchema: RestartExecutionSchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    });
  }

  protected async run(
    context: InternalToolExecutionContext,
    params: RestartExecutionParams,
  ): Promise<unknown> {
    const projectId = resolveProjectIdFromToolContext({
      projectId: params.project_id,
      contextScopeId: context.scopeId,
      toolName: this.getName(),
    });
    return this.workItems.restartExecution(projectId, params.workItemId);
  }
}
