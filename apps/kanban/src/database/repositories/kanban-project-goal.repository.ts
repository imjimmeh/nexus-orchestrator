import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { KanbanProjectGoalWorklogEntity } from "../entities/kanban-project-goal-worklog.entity";
import { KanbanProjectGoalEntity } from "../entities/kanban-project-goal.entity";

@Injectable()
export class KanbanProjectGoalRepository {
  constructor(
    @InjectRepository(KanbanProjectGoalEntity)
    private readonly repository: Repository<KanbanProjectGoalEntity>,
    @InjectRepository(KanbanProjectGoalWorklogEntity)
    private readonly worklogs: Repository<KanbanProjectGoalWorklogEntity>,
  ) {}

  async create(
    project_id: string,
    goal: Partial<KanbanProjectGoalEntity>,
  ): Promise<KanbanProjectGoalEntity> {
    const sortOrder = await this.repository.count({
      where: { project_id: project_id },
    });

    return this.repository.save(
      this.repository.create({
        project_id: project_id,
        title: goal.title,
        description: goal.description ?? null,
        status: goal.status ?? "todo",
        moscow: goal.moscow ?? null,
        priority: goal.priority ?? null,
        sort_order: goal.sort_order ?? sortOrder,
        target_date: goal.target_date ?? null,
        completed_at: goal.completed_at ?? null,
        owner_agent_profile_id: goal.owner_agent_profile_id ?? null,
        metadata: goal.metadata ?? null,
        is_archived: goal.is_archived ?? false,
      }),
    );
  }

  save(
    goal: Partial<KanbanProjectGoalEntity>,
  ): Promise<KanbanProjectGoalEntity> {
    return this.repository.save(this.repository.create(goal));
  }

  findByproject_id(
    project_id: string,
    includeArchived = false,
  ): Promise<KanbanProjectGoalEntity[]> {
    return this.repository.find({
      where: includeArchived
        ? { project_id: project_id }
        : { project_id: project_id, is_archived: false },
      order: { sort_order: "ASC", created_at: "ASC" },
    });
  }

  findById(
    project_id: string,
    goalId: string,
  ): Promise<KanbanProjectGoalEntity | null> {
    return this.repository.findOne({
      where: { id: goalId, project_id: project_id },
    });
  }

  async setArchived(
    project_id: string,
    goalId: string,
    archived: boolean,
  ): Promise<KanbanProjectGoalEntity | null> {
    const goal = await this.findById(project_id, goalId);
    if (!goal) return null;
    goal.is_archived = archived;
    return this.repository.save(goal);
  }

  async reorder(
    project_id: string,
    goalIds: string[],
  ): Promise<KanbanProjectGoalEntity[]> {
    const goals = await this.findByproject_id(project_id, false);
    const byId = new Map(goals.map((goal) => [goal.id, goal]));
    const reordered = goalIds.flatMap((goalId, index) => {
      const goal = byId.get(goalId);
      if (!goal) return [];
      goal.sort_order = index;
      return [goal];
    });
    await this.repository.save(reordered);
    return this.findByproject_id(project_id, false);
  }

  listWorklogs(
    project_id: string,
    goalId: string,
  ): Promise<KanbanProjectGoalWorklogEntity[]> {
    return this.worklogs.find({
      where: { project_id: project_id, goal_id: goalId },
      order: { created_at: "DESC", id: "DESC" },
    });
  }

  createWorklog(
    project_id: string,
    goalId: string,
    worklog: Partial<KanbanProjectGoalWorklogEntity>,
  ): Promise<KanbanProjectGoalWorklogEntity> {
    return this.worklogs.save(
      this.worklogs.create({
        project_id: project_id,
        goal_id: goalId,
        work_item_id: worklog.work_item_id ?? null,
        entry_type: worklog.entry_type ?? "note",
        author_type: worklog.author_type ?? "user",
        author_id: worklog.author_id ?? null,
        author_name: worklog.author_name ?? null,
        note: worklog.note ?? "",
        linked_run_id: worklog.linked_run_id ?? null,
        metadata: worklog.metadata ?? null,
      }),
    );
  }

  async deleteByproject_id(project_id: string): Promise<void> {
    await this.worklogs.delete({ project_id: project_id });
    await this.repository.delete({ project_id: project_id });
  }
}
