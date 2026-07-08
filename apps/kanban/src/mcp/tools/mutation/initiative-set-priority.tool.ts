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

const InitiativeSetPrioritySchema = ContextualProjectIdSchema.extend({
  initiative_id: z.string().min(1),
  priority: z.number().int(),
});

interface InitiativeSetPriorityParams {
  project_id?: string | null;
  initiative_id: string;
  priority: number;
}

@Injectable()
export class InitiativeSetPriorityTool extends KanbanTool<
  InitiativeSetPriorityParams,
  Initiative
> {
  constructor(private readonly initiatives: InitiativesService) {
    super("kanban.initiative_set_priority", {
      name: "kanban.initiative_set_priority",
      description: "Re-prioritise an initiative within its horizon (grooming).",
      inputSchema: InitiativeSetPrioritySchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    });
  }

  protected async run(
    context: InternalToolExecutionContext,
    params: InitiativeSetPriorityParams,
  ): Promise<Initiative> {
    const projectId = resolveProjectIdFromToolContext({
      projectId: params.project_id,
      contextScopeId: context.scopeId,
      toolName: this.getName(),
    });
    return this.initiatives.setPriority(
      projectId,
      params.initiative_id,
      params.priority,
    );
  }
}
