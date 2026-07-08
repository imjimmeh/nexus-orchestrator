import { Injectable } from "@nestjs/common";
import type { InternalToolExecutionContext } from "@nexus/core";
import { KanbanTool } from "../kanban-tool";
import { WorkItemService } from "../../../work-item/work-item.service";
import { filterDispatchableTodo } from "../../../work-item/work-item-dispatchable.helper";
import { ContextualProjectIdSchema } from "../shared/schemas";
import { resolveProjectIdFromToolContext } from "../shared/tool-context-resolvers";
import { z } from "zod";

type TodoListParams = z.infer<typeof ContextualProjectIdSchema>;

@Injectable()
export class TodoListTool extends KanbanTool<TodoListParams, unknown[]> {
  constructor(private readonly workItems: WorkItemService) {
    super("kanban.todo_list", {
      name: "kanban.todo_list",
      description: "List todo status work items for a kanban project.",
      inputSchema: ContextualProjectIdSchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    });
  }

  protected async run(
    context: InternalToolExecutionContext,
    params: TodoListParams,
  ) {
    const projectId = resolveProjectIdFromToolContext({
      projectId: params.project_id,
      contextScopeId: context.scopeId,
      toolName: this.getName(),
    });

    const items = await this.workItems.listWorkItems(projectId);
    const dispatchableIds = new Set(
      filterDispatchableTodo(
        items.map((item) => ({
          id: item.id,
          status: item.status,
          type: item.type,
          parent_work_item_id: item.parentWorkItemId ?? null,
        })),
      ).map((item) => item.id),
    );
    return items.filter((item) => dispatchableIds.has(item.id));
  }
}
