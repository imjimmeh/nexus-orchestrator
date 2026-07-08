import { Injectable } from "@nestjs/common";
import type {
  InternalToolExecutionContext,
} from "@nexus/core";
import { KanbanTool } from "../kanban-tool";
import type { Initiative } from "@nexus/kanban-contracts";
import { z } from "zod";
import { InitiativesService } from "../../../initiatives/initiatives.service";
import { ContextualProjectIdSchema } from "../shared/schemas";
import { resolveProjectIdFromToolContext } from "../shared/tool-context-resolvers";

const InitiativeLinkGoalSchema = ContextualProjectIdSchema.extend({
  initiative_id: z.string().min(1),
  goal_id: z.string().min(1),
  linked: z.boolean().optional().default(true),
});

interface InitiativeLinkGoalParams {
  project_id?: string | null;
  initiative_id: string;
  goal_id: string;
  linked?: boolean;
}

@Injectable()
export class InitiativeLinkGoalTool extends KanbanTool<
  InitiativeLinkGoalParams,
  Initiative
> {
  constructor(private readonly initiatives: InitiativesService) {
    super("kanban.initiative_link_goal", {
      name: "kanban.initiative_link_goal",
      description: "Link or unlink a goal to an initiative.",
      inputSchema: InitiativeLinkGoalSchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    });
  }

  protected async run(
    context: InternalToolExecutionContext,
    params: InitiativeLinkGoalParams,
  ): Promise<Initiative> {
    const projectId = resolveProjectIdFromToolContext({
      projectId: params.project_id,
      contextScopeId: context.scopeId,
      toolName: this.getName(),
    });
    return this.initiatives.linkGoal(
      projectId,
      params.initiative_id,
      params.goal_id,
      params.linked ?? true,
    );
  }
}
