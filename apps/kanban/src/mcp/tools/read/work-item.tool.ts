import { Injectable, NotFoundException } from "@nestjs/common";
import type {
  InternalToolExecutionContext,
} from "@nexus/core";
import { KanbanTool } from "../kanban-tool";
import { WorkItemService } from "../../../work-item/work-item.service";
import { ContextualWorkItemIdSchema } from "../shared/schemas";
import { resolveProjectIdFromToolContext } from "../shared/tool-context-resolvers";

interface WorkItemParams {
  project_id?: string | null;
  workItemId: string;
}

@Injectable()
export class WorkItemTool extends KanbanTool<
  WorkItemParams,
  unknown
> {
  constructor(private readonly workItems: WorkItemService) {
    super("kanban.work_item", {
      name: "kanban.work_item",
      description: "Read one kanban work item.",
      inputSchema: ContextualWorkItemIdSchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    });
  }

  protected async run(context: InternalToolExecutionContext, params: WorkItemParams) {
    const projectId = resolveProjectIdFromToolContext({
      projectId: params.project_id,
      contextScopeId: context.scopeId,
      toolName: this.getName(),
    });
    const items = await this.workItems.listWorkItems(projectId);
    const item = items.find((candidate) => candidate.id === params.workItemId);
    if (!item) {
      throw new NotFoundException(
        `Work item ${params.workItemId} not found for project ${projectId}`,
      );
    }
    return item;
  }
}
