import { Injectable } from "@nestjs/common";
import type {
  InternalToolExecutionContext,
} from "@nexus/core";
import { KanbanTool } from "../kanban-tool";
import {
  CreateProjectGoalRequestSchema,
  type CreateProjectGoalRequest,
  type ProjectGoal,
} from "@nexus/kanban-contracts";
import { ProjectGoalsService } from "../../../goals/project-goals.service";
import { ContextualProjectIdSchema } from "../shared/schemas";
import { resolveProjectIdFromToolContext } from "../shared/tool-context-resolvers";

const GoalCreateSchema = ContextualProjectIdSchema.extend({
  ...CreateProjectGoalRequestSchema.shape,
});

interface GoalCreateParams extends CreateProjectGoalRequest {
  project_id?: string | null;
}

@Injectable()
export class GoalCreateTool extends KanbanTool<
  GoalCreateParams,
  ProjectGoal
> {
  constructor(private readonly goals: ProjectGoalsService) {
    super("kanban.goal_create", {
      name: "kanban.goal_create",
      description: "Create a project goal.",
      inputSchema: GoalCreateSchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    });
  }

  protected async run(
    context: InternalToolExecutionContext,
    params: GoalCreateParams,
  ): Promise<ProjectGoal> {
    const projectId = resolveProjectIdFromToolContext({
      projectId: params.project_id,
      contextScopeId: context.scopeId,
      toolName: this.getName(),
    });

    return this.goals.createGoal(projectId, {
      title: params.title,
      description: params.description,
      status: params.status,
      moscow: params.moscow,
      priority: params.priority,
      target_date: params.target_date,
    });
  }
}
