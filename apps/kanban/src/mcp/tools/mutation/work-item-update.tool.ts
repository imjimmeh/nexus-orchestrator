import { Injectable } from "@nestjs/common";
import type {
  InternalToolExecutionContext,
} from "@nexus/core";
import { KanbanTool } from "../kanban-tool";
import { z } from "zod";
import { WorkItemService } from "../../../work-item/work-item.service";
import { ContextualWorkItemIdSchema } from "../shared/schemas";
import { resolveProjectIdFromToolContext } from "../shared/tool-context-resolvers";

const WorkItemUpdateSchema = ContextualWorkItemIdSchema.extend({
  updates: z.record(z.string(), z.unknown()),
});

interface WorkItemUpdateParams {
  project_id?: string | null;
  workItemId: string;
  updates: Record<string, unknown>;
}

@Injectable()
export class WorkItemUpdateTool extends KanbanTool<
  WorkItemUpdateParams,
  unknown
> {
  constructor(private readonly workItems: WorkItemService) {
    super("kanban.work_item_update", {
      name: "kanban.work_item_update",
      description: "Update kanban-owned work item fields.",
      inputSchema: WorkItemUpdateSchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    });
  }

  protected async run(
    context: InternalToolExecutionContext,
    params: WorkItemUpdateParams,
  ): Promise<unknown> {
    const projectId = resolveProjectIdFromToolContext({
      projectId: params.project_id,
      contextScopeId: context.scopeId,
      toolName: this.getName(),
    });
    return this.workItems.updateWorkItem(
      projectId,
      params.workItemId,
      params.updates,
    );
  }
}
