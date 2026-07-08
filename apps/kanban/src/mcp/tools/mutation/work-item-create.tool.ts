import { Injectable } from "@nestjs/common";
import type {
  InternalToolExecutionContext,
} from "@nexus/core";
import { KanbanTool } from "../kanban-tool";
import {
  CreateWorkItemInputSchema,
  type CreateWorkItemInput,
} from "@nexus/kanban-contracts";
import { z } from "zod";
import { WorkItemService } from "../../../work-item/work-item.service";
import { ContextualProjectIdSchema } from "../shared/schemas";
import { resolveProjectIdFromToolContext } from "../shared/tool-context-resolvers";

const WorkItemCreateSchema = ContextualProjectIdSchema.extend({
  parentWorkItemId: z.string().min(1).optional(),
  workItem: CreateWorkItemInputSchema,
});

interface WorkItemCreateParams {
  project_id?: string | null;
  parentWorkItemId?: string;
  workItem: CreateWorkItemInput;
}

@Injectable()
export class WorkItemCreateTool extends KanbanTool<
  WorkItemCreateParams,
  unknown
> {
  constructor(private readonly workItems: WorkItemService) {
    super("kanban.work_item_create", {
      name: "kanban.work_item_create",
      description: "Create a kanban work item.",
      inputSchema: WorkItemCreateSchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    });
  }

  protected async run(
    context: InternalToolExecutionContext,
    params: WorkItemCreateParams,
  ): Promise<unknown> {
    const projectId = resolveProjectIdFromToolContext({
      projectId: params.project_id,
      contextScopeId: context.scopeId,
      toolName: this.getName(),
    });

    return this.workItems.createWorkItem(projectId, params.workItem);
  }
}
