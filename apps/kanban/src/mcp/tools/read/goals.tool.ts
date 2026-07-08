import { Injectable } from "@nestjs/common";
import type {
  InternalToolExecutionContext,
} from "@nexus/core";
import { KanbanTool } from "../kanban-tool";
import { ProjectGoalsService } from "../../../goals/project-goals.service";
import { ContextualProjectIdSchema } from "../shared/schemas";
import { resolveProjectIdFromToolContext } from "../shared/tool-context-resolvers";
import { z } from "zod";

type GoalsParams = z.infer<typeof ContextualProjectIdSchema>;

@Injectable()
export class GoalsTool extends KanbanTool<GoalsParams, unknown[]> {
  constructor(private readonly goals: ProjectGoalsService) {
    super("kanban.goals", {
      name: "kanban.goals",
      description: "List kanban project goals.",
      inputSchema: ContextualProjectIdSchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    });
  }

  protected async run(context: InternalToolExecutionContext, params: GoalsParams) {
    const projectId = resolveProjectIdFromToolContext({
      projectId: params.project_id,
      contextScopeId: context.scopeId,
      toolName: this.getName(),
    });

    return this.goals.listGoals(projectId);
  }
}
