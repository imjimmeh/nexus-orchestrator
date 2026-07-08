import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { KanbanInitiativeEntity } from "../entities/kanban-initiative.entity";
import { KanbanInitiativeGoalEntity } from "../entities/kanban-initiative-goal.entity";
import { KanbanWorkItemEntity } from "../entities/kanban-work-item.entity";

@Injectable()
export class KanbanInitiativeRepository {
  constructor(
    @InjectRepository(KanbanInitiativeEntity)
    private readonly initiatives: Repository<KanbanInitiativeEntity>,
    @InjectRepository(KanbanInitiativeGoalEntity)
    private readonly links: Repository<KanbanInitiativeGoalEntity>,
    @InjectRepository(KanbanWorkItemEntity)
    private readonly workItems: Repository<KanbanWorkItemEntity>,
  ) {}

  async create(
    project_id: string,
    initiative: Partial<KanbanInitiativeEntity>,
  ): Promise<KanbanInitiativeEntity> {
    const priority =
      initiative.priority ??
      (await this.initiatives.count({ where: { project_id } }));
    return this.initiatives.save(
      this.initiatives.create({
        project_id,
        title: initiative.title,
        description: initiative.description ?? null,
        horizon: initiative.horizon ?? "next",
        priority,
        status: initiative.status ?? "proposed",
        last_reviewed_at: initiative.last_reviewed_at ?? null,
      }),
    );
  }

  save(
    initiative: Partial<KanbanInitiativeEntity>,
  ): Promise<KanbanInitiativeEntity> {
    return this.initiatives.save(this.initiatives.create(initiative));
  }

  findByProjectId(project_id: string): Promise<KanbanInitiativeEntity[]> {
    return this.initiatives.find({
      where: { project_id },
      order: { priority: "ASC", created_at: "ASC" },
    });
  }

  findById(
    project_id: string,
    initiativeId: string,
  ): Promise<KanbanInitiativeEntity | null> {
    return this.initiatives.findOne({
      where: { id: initiativeId, project_id },
    });
  }

  async linkGoal(initiativeId: string, goalId: string): Promise<void> {
    await this.links.save({ initiative_id: initiativeId, goal_id: goalId });
  }

  async unlinkGoal(initiativeId: string, goalId: string): Promise<void> {
    await this.links.delete({ initiative_id: initiativeId, goal_id: goalId });
  }

  async findGoalIds(initiativeId: string): Promise<string[]> {
    const rows = await this.links.find({
      where: { initiative_id: initiativeId },
    });
    return rows.map((row) => row.goal_id);
  }

  async assignWorkItem(
    project_id: string,
    workItemId: string,
    initiativeId: string | null,
  ): Promise<void> {
    const result = await this.workItems.update(
      { id: workItemId, project_id },
      { initiative_id: initiativeId },
    );
    if (!result.affected || result.affected === 0) {
      throw new Error(
        `Work item ${workItemId} not found in project ${project_id}`,
      );
    }
  }
}
