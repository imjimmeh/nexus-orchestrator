import { Injectable } from "@nestjs/common";
import type { InternalToolExecutionContext } from "@nexus/core";
import { KanbanTool } from "../kanban-tool";
import { ContextualWorkItemIdSchema } from "../shared/schemas";
import { resolveProjectIdFromToolContext } from "../shared/tool-context-resolvers";
import { z } from "zod";

const WorkItemSubtaskValidateBlueprintLocalSchema =
  ContextualWorkItemIdSchema.extend({
    blueprint: z.array(
      z.object({
        subtask_id: z.string().min(1),
        title: z.string().min(1),
        order_index: z.number().int(),
        depends_on_subtask_ids: z.array(z.string()),
      }),
    ),
  });

interface WorkItemSubtaskValidateBlueprintParams {
  project_id?: string | null;
  workItemId: string;
  blueprint: {
    subtask_id: string;
    title: string;
    order_index: number;
    depends_on_subtask_ids: string[];
  }[];
}

@Injectable()
export class WorkItemSubtaskValidateBlueprintTool extends KanbanTool<
  WorkItemSubtaskValidateBlueprintParams,
  { ok: true; count: number }
> {
  constructor() {
    super("kanban.work_item_subtask_validate_blueprint", {
      name: "kanban.work_item_subtask_validate_blueprint",
      description: "Validate a subtask blueprint for a kanban work item.",
      inputSchema: WorkItemSubtaskValidateBlueprintLocalSchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    });
  }

  protected run(
    context: InternalToolExecutionContext,
    params: WorkItemSubtaskValidateBlueprintParams,
  ): Promise<{ ok: true; count: number }> {
    resolveProjectIdFromToolContext({
      projectId: params.project_id,
      contextScopeId: context.scopeId,
      toolName: this.getName(),
    });
    return Promise.resolve({ ok: true, count: params.blueprint.length });
  }
}
