import { Injectable } from "@nestjs/common";
import type {
  InternalToolExecutionContext,
} from "@nexus/core";
import { KanbanTool } from "../kanban-tool";
import {
  UpdateProjectGoalStatusRequestSchema,
  type UpdateProjectGoalStatusRequest,
  type ProjectGoal,
} from "@nexus/kanban-contracts";
import { z } from "zod";
import { ProjectGoalsService } from "../../../goals/project-goals.service";
import { ContextualProjectIdSchema } from "../shared/schemas";
import { resolveProjectIdFromToolContext } from "../shared/tool-context-resolvers";

const GoalUpdateStatusSchema = ContextualProjectIdSchema.extend({
  goal_id: z.string().min(1),
  ...UpdateProjectGoalStatusRequestSchema.shape,
});

interface GoalUpdateStatusParams extends UpdateProjectGoalStatusRequest {
  project_id?: string | null;
  goal_id: string;
}

@Injectable()
export class GoalUpdateStatusTool extends KanbanTool<
  GoalUpdateStatusParams,
  ProjectGoal
> {
  constructor(private readonly goals: ProjectGoalsService) {
    super("kanban.goal_update_status", {
      name: "kanban.goal_update_status",
      description: "Update a project goal's status.",
      inputSchema: GoalUpdateStatusSchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    });
  }

  protected async run(
    context: InternalToolExecutionContext,
    params: GoalUpdateStatusParams,
  ): Promise<ProjectGoal> {
    const projectId = resolveProjectIdFromToolContext({
      projectId: params.project_id,
      contextScopeId: context.scopeId,
      toolName: this.getName(),
    });

    return this.goals.updateStatus(projectId, params.goal_id, {
      status: params.status,
      note: params.note,
      author_type: params.author_type ?? "agent",
      author_id: params.author_id,
      author_name: params.author_name,
    });
  }
}
