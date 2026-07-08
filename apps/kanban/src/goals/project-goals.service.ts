import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  CreateProjectGoalWorklogRequest,
  CreateProjectGoalRequest,
  LinkProjectGoalWorkItemRequest,
  ProjectGoal,
  ProjectGoalWorklog,
  UpdateProjectGoalRequest,
  UpdateProjectGoalStatusRequest,
} from "@nexus/kanban-contracts";
import type { KanbanProjectGoalEntity } from "../database/entities/kanban-project-goal.entity";
import type { KanbanProjectGoalWorklogEntity } from "../database/entities/kanban-project-goal-worklog.entity";
import { KanbanProjectGoalRepository } from "../database/repositories/kanban-project-goal.repository";
import { KanbanWorkItemRepository } from "../database/repositories/kanban-work-item.repository";
import { CharterRegenEnqueuer } from "../project/charter-regen.enqueuer";

@Injectable()
export class ProjectGoalsService {
  constructor(
    private readonly goals: KanbanProjectGoalRepository,
    private readonly workItems: KanbanWorkItemRepository,
    private readonly charterRegen: CharterRegenEnqueuer,
  ) {}

  async listGoals(
    project_id: string,
    includeArchived = false,
  ): Promise<ProjectGoal[]> {
    const goals = await this.goals.findByproject_id(
      project_id,
      includeArchived,
    );
    return goals.map((goal) => this.toRecord(goal));
  }

  async createGoal(
    project_id: string,
    input: CreateProjectGoalRequest,
  ): Promise<ProjectGoal> {
    const goal = await this.goals.create(project_id, input);
    const record = this.toRecord(goal);
    await this.charterRegen.enqueue(project_id);
    return record;
  }

  async updateGoal(
    project_id: string,
    goalId: string,
    input: UpdateProjectGoalRequest,
  ): Promise<ProjectGoal> {
    const existing = await this.requireGoal(project_id, goalId);
    if (input.title) existing.title = input.title;
    if (input.description !== undefined)
      existing.description = input.description;
    if (input.status) existing.status = input.status;
    if (input.moscow !== undefined) existing.moscow = input.moscow;
    if (input.priority !== undefined) existing.priority = input.priority;
    if (input.target_date !== undefined)
      existing.target_date = input.target_date;
    const goal = await this.goals.save(existing);
    const record = this.toRecord(goal);
    await this.charterRegen.enqueue(project_id);
    return record;
  }

  async updateStatus(
    project_id: string,
    goalId: string,
    input: UpdateProjectGoalStatusRequest,
  ): Promise<ProjectGoal> {
    const existing = await this.requireGoal(project_id, goalId);
    const previousStatus = existing.status;
    existing.status = input.status;
    existing.completed_at = input.status === "completed" ? new Date() : null;
    const goal = await this.goals.save(existing);
    const note = input.note?.trim();
    if (previousStatus !== input.status || note) {
      await this.goals.createWorklog(project_id, goalId, {
        entry_type: "status_change",
        author_type: input.author_type ?? "user",
        author_id: input.author_id ?? null,
        author_name: input.author_name ?? null,
        note:
          note || `Status changed from ${previousStatus} to ${input.status}`,
      });
    }
    const record = this.toRecord(goal);
    await this.charterRegen.enqueue(project_id);
    return record;
  }

  async reorderGoals(
    project_id: string,
    goalIds: string[],
  ): Promise<ProjectGoal[]> {
    const activeGoals = await this.goals.findByproject_id(project_id, false);
    const activeIds = new Set(activeGoals.map((goal) => goal.id));
    if (
      activeIds.size !== goalIds.length ||
      goalIds.some((goalId) => !activeIds.has(goalId))
    ) {
      throw new BadRequestException(
        "Goal reorder payload must include all active project goals exactly once",
      );
    }
    const goals = await this.goals.reorder(project_id, goalIds);
    const records = goals.map((goal) => this.toRecord(goal));
    await this.charterRegen.enqueue(project_id);
    return records;
  }

  async setArchived(
    project_id: string,
    goalId: string,
    archived: boolean,
  ): Promise<ProjectGoal> {
    const goal = await this.goals.setArchived(project_id, goalId, archived);
    if (!goal) {
      throw new NotFoundException(
        `Goal ${goalId} not found for project ${project_id}`,
      );
    }
    const record = this.toRecord(goal);
    await this.charterRegen.enqueue(project_id);
    return record;
  }

  async listWorklogs(
    project_id: string,
    goalId: string,
  ): Promise<ProjectGoalWorklog[]> {
    await this.requireGoal(project_id, goalId);
    const worklogs = await this.goals.listWorklogs(project_id, goalId);
    return worklogs.map((worklog) => this.toWorklogRecord(worklog));
  }

  async createWorklog(
    project_id: string,
    goalId: string,
    input: CreateProjectGoalWorklogRequest,
  ): Promise<ProjectGoalWorklog> {
    await this.requireGoal(project_id, goalId);
    if (input.work_item_id) {
      await this.requireWorkItem(project_id, input.work_item_id);
    }
    const worklog = await this.goals.createWorklog(project_id, goalId, {
      entry_type: input.entry_type ?? "note",
      author_type: input.author_type ?? "user",
      author_id: input.author_id ?? null,
      author_name: input.author_name ?? null,
      note: input.note.trim(),
      work_item_id: input.work_item_id ?? null,
      linked_run_id: input.linked_run_id ?? null,
    });
    return this.toWorklogRecord(worklog);
  }

  async linkWorkItem(
    project_id: string,
    goalId: string,
    input: LinkProjectGoalWorkItemRequest,
  ): Promise<ProjectGoalWorklog> {
    await this.requireGoal(project_id, goalId);
    await this.requireWorkItem(project_id, input.work_item_id);
    const worklog = await this.goals.createWorklog(project_id, goalId, {
      entry_type: "link",
      author_type: "user",
      author_id: input.author_id ?? null,
      author_name: input.author_name ?? null,
      work_item_id: input.work_item_id,
      note:
        input.note?.trim() || `Linked work item ${input.work_item_id} to goal`,
    });
    return this.toWorklogRecord(worklog);
  }

  private async requireGoal(
    project_id: string,
    goalId: string,
  ): Promise<KanbanProjectGoalEntity> {
    const goal = await this.goals.findById(project_id, goalId);
    if (!goal) {
      throw new NotFoundException(
        `Goal ${goalId} not found for project ${project_id}`,
      );
    }
    return goal;
  }

  private async requireWorkItem(
    project_id: string,
    workItemId: string,
  ): Promise<void> {
    const workItem = await this.workItems.findByProjectAndId(
      project_id,
      workItemId,
    );
    if (!workItem) {
      throw new NotFoundException(
        `Work item ${workItemId} not found for project ${project_id}`,
      );
    }
  }

  private toRecord(goal: KanbanProjectGoalEntity): ProjectGoal {
    return {
      id: goal.id,
      project_id: goal.project_id,
      title: goal.title,
      description: goal.description,
      status: goal.status as ProjectGoal["status"],
      moscow: goal.moscow as ProjectGoal["moscow"],
      priority: goal.priority as ProjectGoal["priority"],
      sortOrder: goal.sort_order,
      targetDate: goal.target_date,
      completedAt: goal.completed_at?.toISOString() ?? null,
      ownerAgentProfileId: goal.owner_agent_profile_id,
      metadata: goal.metadata,
      isArchived: goal.is_archived,
      created_at: goal.created_at.toISOString(),
      updated_at: goal.updated_at.toISOString(),
    };
  }

  private toWorklogRecord(
    worklog: KanbanProjectGoalWorklogEntity,
  ): ProjectGoalWorklog {
    return {
      id: worklog.id,
      goalId: worklog.goal_id,
      project_id: worklog.project_id,
      workItemId: worklog.work_item_id,
      entryType: worklog.entry_type as ProjectGoalWorklog["entryType"],
      authorType: worklog.author_type as ProjectGoalWorklog["authorType"],
      authorId: worklog.author_id,
      authorName: worklog.author_name,
      note: worklog.note,
      linkedRunId: worklog.linked_run_id,
      metadata: worklog.metadata,
      created_at: worklog.created_at.toISOString(),
      updated_at: worklog.updated_at.toISOString(),
    };
  }
}
