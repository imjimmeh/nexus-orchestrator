import { Injectable } from "@nestjs/common";
import type {
  InternalToolExecutionContext,
} from "@nexus/core";
import { KanbanTool } from "../kanban-tool";
import { WorkItemService } from "../../../work-item/work-item.service";
import { z } from "zod";
import { ProjectIdOptionalSchema } from "../shared/schemas";

const WorkItemsInputSchema = ProjectIdOptionalSchema.extend({
  limit: z.number().int().min(1).max(1000).optional(),
  offset: z.number().int().min(0).optional().default(0),
});

type WorkItemsParams = z.infer<typeof WorkItemsInputSchema>;

@Injectable()
export class WorkItemsTool extends KanbanTool<
  WorkItemsParams,
  unknown[]
> {
  constructor(private readonly workItems: WorkItemService) {
    super("kanban.work_items", {
      name: "kanban.work_items",
      description:
        "List kanban work items for a project, or all work items when project_id is omitted. Supports limit/offset pagination.",
      inputSchema: WorkItemsInputSchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    });
  }

  protected async run(
    _context: InternalToolExecutionContext,
    params: WorkItemsParams,
  ) {
    if (params.project_id) {
      return this.workItems.listWorkItems(params.project_id, params.limit);
    }
    return this.workItems.listAllWorkItems(params.limit);
  }
}
