import { Injectable } from "@nestjs/common";
import type { InternalToolExecutionContext } from "@nexus/core";
import { StoryPointsSchema } from "@nexus/kanban-contracts";
import { WorkItemService } from "../../../work-item/work-item.service";
import { KanbanTool } from "../kanban-tool";
import { ContextualWorkItemIdSchema } from "../shared/schemas";
import { resolveProjectIdFromToolContext } from "../shared/tool-context-resolvers";

const TOOL_NAME = "kanban.estimate_work_item" as const;

const estimateWorkItemInputSchema = ContextualWorkItemIdSchema.extend({
  storyPoints: StoryPointsSchema,
});

type EstimateWorkItemInput = {
  project_id?: string | null;
  workItemId: string;
  storyPoints: number;
};

@Injectable()
export class EstimateWorkItemTool extends KanbanTool<
  EstimateWorkItemInput,
  unknown
> {
  constructor(private readonly workItems: WorkItemService) {
    super(TOOL_NAME, {
      name: TOOL_NAME,
      description:
        "Set the Fibonacci story-point estimate on a work item. Rejects epics and non-Fibonacci values via the work-item invariants.",
      inputSchema: estimateWorkItemInputSchema,
      tierRestriction: 1,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
      policyTags: ["work_items"],
    });
  }

  protected async run(
    context: InternalToolExecutionContext,
    params: EstimateWorkItemInput,
  ): Promise<unknown> {
    const projectId = resolveProjectIdFromToolContext({
      projectId: params.project_id,
      contextScopeId: context.scopeId,
      toolName: this.getName(),
    });

    return this.workItems.updateWorkItem(projectId, params.workItemId, {
      storyPoints: params.storyPoints,
    });
  }
}
