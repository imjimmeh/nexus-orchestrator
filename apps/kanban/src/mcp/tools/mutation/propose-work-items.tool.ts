import { Injectable } from "@nestjs/common";
import type { InternalToolExecutionContext } from "@nexus/core";
import { StoryPointsSchema, WorkItemTypeSchema } from "@nexus/kanban-contracts";
import { z } from "zod";
import { assertWorkItemInvariants } from "../../../work-item/work-item-invariants";
import { WorkItemService } from "../../../work-item/work-item.service";
import { KanbanTool } from "../kanban-tool";
import { ContextualProjectIdSchema } from "../shared/schemas";
import { resolveProjectIdFromToolContext } from "../shared/tool-context-resolvers";

const TOOL_NAME = "kanban.propose_work_items" as const;

const proposedWorkItemSchema = z.object({
  title: z.string().min(1),
  type: WorkItemTypeSchema,
  description: z.string().optional(),
  storyPoints: StoryPointsSchema.optional(),
});

const proposeWorkItemsInputSchema = ContextualProjectIdSchema.extend({
  parentWorkItemId: z.string().min(1).optional(),
  items: z.array(proposedWorkItemSchema).min(1),
});

type ProposeWorkItemsInput = z.infer<typeof proposeWorkItemsInputSchema>;

@Injectable()
export class ProposeWorkItemsTool extends KanbanTool<ProposeWorkItemsInput> {
  constructor(private readonly workItems: WorkItemService) {
    super(TOOL_NAME, {
      name: TOOL_NAME,
      description:
        "Decompose an epic or story into typed, story-pointed child work items parented to it.",
      inputSchema: proposeWorkItemsInputSchema,
      tierRestriction: 1,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
      policyTags: ["ingestion", "work_items"],
    });
  }

  protected async run(
    context: InternalToolExecutionContext,
    params: ProposeWorkItemsInput,
  ): Promise<Record<string, unknown>> {
    const projectId = resolveProjectIdFromToolContext({
      projectId: params.project_id,
      contextScopeId: context.scopeId,
      toolName: this.getName(),
    });

    // Pre-validate every proposed item's invariants before persisting
    // anything. Without this, a single invalid item partway through the
    // batch (e.g. an epic given a parent) would throw mid-loop after
    // earlier items were already saved, leaving them permanently
    // parented with no way to know what succeeded before the failure.
    const parentType = await this.workItems.resolveParentType(
      projectId,
      params.parentWorkItemId ?? null,
    );
    for (const item of params.items) {
      assertWorkItemInvariants({
        type: item.type,
        storyPoints: item.storyPoints ?? null,
        parentType,
      });
    }

    const createdIds: string[] = [];
    for (const item of params.items) {
      const created = await this.workItems.createWorkItem(projectId, {
        title: item.title,
        type: item.type,
        description: item.description,
        storyPoints: item.storyPoints,
        parentWorkItemId: params.parentWorkItemId,
      });
      createdIds.push(created.id);
    }

    return { created_ids: createdIds };
  }
}
