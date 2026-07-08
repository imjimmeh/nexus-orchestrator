import { Injectable } from "@nestjs/common";
import type {
  InternalToolExecutionContext,
} from "@nexus/core";
import { KanbanTool } from "../kanban-tool";
import {
  UpdateProjectGoalRequestSchema,
  type UpdateProjectGoalRequest,
  type ProjectGoal,
} from "@nexus/kanban-contracts";
import { z } from "zod";
import { ProjectGoalsService } from "../../../goals/project-goals.service";
import { ContextualProjectIdSchema } from "../shared/schemas";
import { resolveProjectIdFromToolContext } from "../shared/tool-context-resolvers";

const GoalUpdateSchema = ContextualProjectIdSchema.extend({
  goal_id: z.string().min(1),
  ...UpdateProjectGoalRequestSchema.shape,
});

interface GoalUpdateParams extends UpdateProjectGoalRequest {
  project_id?: string | null;
  goal_id: string;
}

@Injectable()
export class GoalUpdateTool extends KanbanTool<
  GoalUpdateParams,
  ProjectGoal
> {
  constructor(private readonly goals: ProjectGoalsService) {
    super("kanban.goal_update", {
      name: "kanban.goal_update",
      description: "Update a project goal's fields.",
      inputSchema: GoalUpdateSchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    });
  }

  protected async run(
    context: InternalToolExecutionContext,
    params: GoalUpdateParams,
  ): Promise<ProjectGoal> {
    const projectId = resolveProjectIdFromToolContext({
      projectId: params.project_id,
      contextScopeId: context.scopeId,
      toolName: this.getName(),
    });

    return this.goals.updateGoal(projectId, params.goal_id, {
      title: params.title,
      description: params.description,
      status: params.status,
      moscow: params.moscow,
      priority: params.priority,
      target_date: params.target_date,
    });
  }
}
