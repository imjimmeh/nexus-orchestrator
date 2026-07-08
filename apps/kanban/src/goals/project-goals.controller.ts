import {
  Body,
  Controller,
  Get,
  Param,
  ParseBoolPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import type {
  CreateProjectGoalWorklogRequest,
  CreateProjectGoalRequest,
  LinkProjectGoalWorkItemRequest,
  ReorderProjectGoalsRequest,
  UpdateProjectGoalRequest,
  UpdateProjectGoalStatusRequest,
} from "@nexus/kanban-contracts";
import { KanbanPermissionsGuard } from "../common/kanban-permissions.guard";
import { RequirePermission } from "../common/require-permission.decorator";
import { ProjectGoalsService } from "./project-goals.service";

@Controller("projects/:project_id/goals")
@UseGuards(KanbanPermissionsGuard)
export class ProjectGoalsController {
  constructor(private readonly goals: ProjectGoalsService) {}

  @Get()
  @RequirePermission("goals:read")
  async list(
    @Param("project_id") project_id: string,
    @Query("include_archived", new ParseBoolPipe({ optional: true }))
    includeArchived?: boolean,
  ) {
    const data = await this.goals.listGoals(
      project_id,
      includeArchived === true,
    );
    return { success: true, data };
  }

  @Post()
  @RequirePermission("goals:write")
  async create(
    @Param("project_id") project_id: string,
    @Body() body: CreateProjectGoalRequest,
  ) {
    const data = await this.goals.createGoal(project_id, body);
    return { success: true, data };
  }

  @Patch("reorder")
  @RequirePermission("goals:write")
  async reorder(
    @Param("project_id") project_id: string,
    @Body() body: ReorderProjectGoalsRequest,
  ) {
    const data = await this.goals.reorderGoals(project_id, body.goal_ids);
    return { success: true, data };
  }

  @Patch(":goalId")
  @RequirePermission("goals:write")
  async update(
    @Param("project_id") project_id: string,
    @Param("goalId") goalId: string,
    @Body() body: UpdateProjectGoalRequest,
  ) {
    const data = await this.goals.updateGoal(project_id, goalId, body);
    return { success: true, data };
  }

  @Patch(":goalId/status")
  @RequirePermission("goals:write")
  async updateStatus(
    @Param("project_id") project_id: string,
    @Param("goalId") goalId: string,
    @Body() body: UpdateProjectGoalStatusRequest,
  ) {
    const data = await this.goals.updateStatus(project_id, goalId, body);
    return { success: true, data };
  }

  @Post(":goalId/archive")
  @RequirePermission("goals:write")
  async archive(
    @Param("project_id") project_id: string,
    @Param("goalId") goalId: string,
  ) {
    const data = await this.goals.setArchived(project_id, goalId, true);
    return { success: true, data };
  }

  @Post(":goalId/unarchive")
  @RequirePermission("goals:write")
  async unarchive(
    @Param("project_id") project_id: string,
    @Param("goalId") goalId: string,
  ) {
    const data = await this.goals.setArchived(project_id, goalId, false);
    return { success: true, data };
  }

  @Get(":goalId/worklogs")
  @RequirePermission("goals:read")
  async listWorklogs(
    @Param("project_id") project_id: string,
    @Param("goalId") goalId: string,
  ) {
    const data = await this.goals.listWorklogs(project_id, goalId);
    return { success: true, data };
  }

  @Post(":goalId/worklogs")
  @RequirePermission("goals:write")
  async createWorklog(
    @Param("project_id") project_id: string,
    @Param("goalId") goalId: string,
    @Body() body: CreateProjectGoalWorklogRequest,
  ) {
    const data = await this.goals.createWorklog(project_id, goalId, body);
    return { success: true, data };
  }

  @Post(":goalId/worklogs/link-work-item")
  @RequirePermission("goals:write")
  async linkWorkItem(
    @Param("project_id") project_id: string,
    @Param("goalId") goalId: string,
    @Body() body: LinkProjectGoalWorkItemRequest,
  ) {
    const data = await this.goals.linkWorkItem(project_id, goalId, body);
    return { success: true, data };
  }
}
