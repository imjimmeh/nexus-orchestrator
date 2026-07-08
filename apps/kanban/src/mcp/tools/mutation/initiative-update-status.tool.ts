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

const InitiativeUpdateStatusSchema = ContextualProjectIdSchema.extend({
  initiative_id: z.string().min(1),
  status: z.enum(["proposed", "active", "paused", "done", "dropped"]),
});

interface InitiativeUpdateStatusParams {
  project_id?: string | null;
  initiative_id: string;
  status: Initiative["status"];
}

@Injectable()
export class InitiativeUpdateStatusTool extends KanbanTool<
  InitiativeUpdateStatusParams,
  Initiative
> {
  constructor(private readonly initiatives: InitiativesService) {
    super("kanban.initiative_update_status", {
      name: "kanban.initiative_update_status",
      description:
        "Transition an initiative's status (proposed/active/paused/done/dropped).",
      inputSchema: InitiativeUpdateStatusSchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    });
  }

  protected async run(
    context: InternalToolExecutionContext,
    params: InitiativeUpdateStatusParams,
  ): Promise<Initiative> {
    const projectId = resolveProjectIdFromToolContext({
      projectId: params.project_id,
      contextScopeId: context.scopeId,
      toolName: this.getName(),
    });
    return this.initiatives.updateStatus(projectId, params.initiative_id, {
      status: params.status,
    });
  }
}
