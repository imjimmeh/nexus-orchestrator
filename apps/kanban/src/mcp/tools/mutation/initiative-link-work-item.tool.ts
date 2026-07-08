import { Injectable } from "@nestjs/common";
import type {
  InternalToolExecutionContext,
} from "@nexus/core";
import { KanbanTool } from "../kanban-tool";
import { z } from "zod";
import { InitiativesService } from "../../../initiatives/initiatives.service";
import { ContextualProjectIdSchema } from "../shared/schemas";
import { resolveProjectIdFromToolContext } from "../shared/tool-context-resolvers";

const InitiativeLinkWorkItemSchema = ContextualProjectIdSchema.extend({
  work_item_id: z.string().min(1),
  initiative_id: z.string().min(1).nullable(),
});

interface InitiativeLinkWorkItemParams {
  project_id?: string | null;
  work_item_id: string;
  initiative_id: string | null;
}

interface InitiativeLinkWorkItemResult {
  ok: true;
  work_item_id: string;
  initiative_id: string | null;
}

@Injectable()
export class InitiativeLinkWorkItemTool extends KanbanTool<
  InitiativeLinkWorkItemParams,
  InitiativeLinkWorkItemResult
> {
  constructor(private readonly initiatives: InitiativesService) {
    super("kanban.initiative_link_work_item", {
      name: "kanban.initiative_link_work_item",
      description:
        "Assign a work item to an initiative (or pass initiative_id=null to clear).",
      inputSchema: InitiativeLinkWorkItemSchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    });
  }

  protected async run(
    context: InternalToolExecutionContext,
    params: InitiativeLinkWorkItemParams,
  ): Promise<InitiativeLinkWorkItemResult> {
    const projectId = resolveProjectIdFromToolContext({
      projectId: params.project_id,
      contextScopeId: context.scopeId,
      toolName: this.getName(),
    });
    await this.initiatives.assignWorkItem(
      projectId,
      params.work_item_id,
      params.initiative_id,
    );
    return {
      ok: true,
      work_item_id: params.work_item_id,
      initiative_id: params.initiative_id,
    };
  }
}
