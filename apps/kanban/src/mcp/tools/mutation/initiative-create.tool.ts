import { Injectable } from "@nestjs/common";
import type {
  InternalToolExecutionContext,
} from "@nexus/core";
import { KanbanTool } from "../kanban-tool";
import type {
  CreateInitiativeRequest,
  Initiative,
} from "@nexus/kanban-contracts";
import { InitiativesService } from "../../../initiatives/initiatives.service";
import { ContextualProjectIdSchema } from "../shared/schemas";
import { resolveProjectIdFromToolContext } from "../shared/tool-context-resolvers";
import { z } from "zod";

const InitiativeCreateSchema = ContextualProjectIdSchema.extend({
  title: z.string().min(1),
  description: z.string().optional(),
  horizon: z.enum(["now", "next", "later"]).optional(),
  priority: z.number().int().optional(),
  status: z
    .enum(["proposed", "active", "paused", "done", "dropped"])
    .optional(),
  goalIds: z.array(z.string().min(1)).optional(),
});

interface InitiativeCreateParams extends CreateInitiativeRequest {
  project_id?: string | null;
}

@Injectable()
export class InitiativeCreateTool extends KanbanTool<
  InitiativeCreateParams,
  Initiative
> {
  constructor(private readonly initiatives: InitiativesService) {
    super("kanban.initiative_create", {
      name: "kanban.initiative_create",
      description:
        "Create a strategic initiative (planning altitude between goals and work items).",
      inputSchema: InitiativeCreateSchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    });
  }

  protected async run(
    context: InternalToolExecutionContext,
    params: InitiativeCreateParams,
  ): Promise<Initiative> {
    const projectId = resolveProjectIdFromToolContext({
      projectId: params.project_id,
      contextScopeId: context.scopeId,
      toolName: this.getName(),
    });
    return this.initiatives.createInitiative(projectId, {
      title: params.title,
      description: params.description,
      horizon: params.horizon,
      priority: params.priority,
      status: params.status,
      goalIds: params.goalIds,
    });
  }
}
