import { Injectable } from "@nestjs/common";
import type {
  InternalToolExecutionContext,
} from "@nexus/core";
import { KanbanTool } from "../kanban-tool";
import type {
  Initiative,
  UpdateInitiativeRequest,
} from "@nexus/kanban-contracts";
import { z } from "zod";
import { InitiativesService } from "../../../initiatives/initiatives.service";
import { ContextualProjectIdSchema } from "../shared/schemas";
import { resolveProjectIdFromToolContext } from "../shared/tool-context-resolvers";

const InitiativeUpdateSchema = ContextualProjectIdSchema.extend({
  initiative_id: z.string().min(1),
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  horizon: z.enum(["now", "next", "later"]).optional(),
  priority: z.number().int().optional(),
});

interface InitiativeUpdateParams extends UpdateInitiativeRequest {
  project_id?: string | null;
  initiative_id: string;
}

@Injectable()
export class InitiativeUpdateTool extends KanbanTool<
  InitiativeUpdateParams,
  Initiative
> {
  constructor(private readonly initiatives: InitiativesService) {
    super("kanban.initiative_update", {
      name: "kanban.initiative_update",
      description:
        "Update an initiative's title, description, horizon, or priority.",
      inputSchema: InitiativeUpdateSchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    });
  }

  protected async run(
    context: InternalToolExecutionContext,
    params: InitiativeUpdateParams,
  ): Promise<Initiative> {
    const projectId = resolveProjectIdFromToolContext({
      projectId: params.project_id,
      contextScopeId: context.scopeId,
      toolName: this.getName(),
    });
    return this.initiatives.updateInitiative(projectId, params.initiative_id, {
      title: params.title,
      description: params.description,
      horizon: params.horizon,
      priority: params.priority,
    });
  }
}
