import { Injectable, NotFoundException } from "@nestjs/common";
import type {
  CreateInitiativeRequest,
  Initiative,
  UpdateInitiativeRequest,
  UpdateInitiativeStatusRequest,
} from "@nexus/kanban-contracts";
import type { KanbanInitiativeEntity } from "../database/entities/kanban-initiative.entity";
import { KanbanInitiativeRepository } from "../database/repositories/kanban-initiative.repository";

@Injectable()
export class InitiativesService {
  constructor(private readonly initiatives: KanbanInitiativeRepository) {}

  async listInitiatives(project_id: string): Promise<Initiative[]> {
    const rows = await this.initiatives.findByProjectId(project_id);
    return Promise.all(rows.map((row) => this.toRecord(row)));
  }

  async createInitiative(
    project_id: string,
    input: CreateInitiativeRequest,
  ): Promise<Initiative> {
    const created = await this.initiatives.create(project_id, {
      title: input.title,
      description: input.description ?? null,
      horizon: input.horizon,
      priority: input.priority,
      status: input.status,
    });
    for (const goalId of input.goalIds ?? []) {
      await this.initiatives.linkGoal(created.id, goalId);
    }
    return this.toRecord(created);
  }

  async updateInitiative(
    project_id: string,
    initiativeId: string,
    input: UpdateInitiativeRequest,
  ): Promise<Initiative> {
    const existing = await this.requireInitiative(project_id, initiativeId);
    if (input.title !== undefined) existing.title = input.title;
    if (input.description !== undefined)
      existing.description = input.description;
    if (input.horizon !== undefined) existing.horizon = input.horizon;
    if (input.priority !== undefined) existing.priority = input.priority;
    return this.toRecord(await this.initiatives.save(existing));
  }

  async updateStatus(
    project_id: string,
    initiativeId: string,
    input: UpdateInitiativeStatusRequest,
  ): Promise<Initiative> {
    const existing = await this.requireInitiative(project_id, initiativeId);
    existing.status = input.status;
    return this.toRecord(await this.initiatives.save(existing));
  }

  async setPriority(
    project_id: string,
    initiativeId: string,
    priority: number,
  ): Promise<Initiative> {
    const existing = await this.requireInitiative(project_id, initiativeId);
    existing.priority = priority;
    existing.last_reviewed_at = new Date();
    return this.toRecord(await this.initiatives.save(existing));
  }

  async linkGoal(
    project_id: string,
    initiativeId: string,
    goalId: string,
    linked: boolean,
  ): Promise<Initiative> {
    const existing = await this.requireInitiative(project_id, initiativeId);
    if (linked) {
      await this.initiatives.linkGoal(existing.id, goalId);
    } else {
      await this.initiatives.unlinkGoal(existing.id, goalId);
    }
    return this.toRecord(existing);
  }

  async assignWorkItem(
    project_id: string,
    workItemId: string,
    initiativeId: string | null,
  ): Promise<void> {
    if (initiativeId !== null) {
      await this.requireInitiative(project_id, initiativeId);
    }
    await this.initiatives.assignWorkItem(project_id, workItemId, initiativeId);
  }

  private async requireInitiative(
    project_id: string,
    initiativeId: string,
  ): Promise<KanbanInitiativeEntity> {
    const initiative = await this.initiatives.findById(
      project_id,
      initiativeId,
    );
    if (!initiative) {
      throw new NotFoundException(
        `Initiative ${initiativeId} not found for project ${project_id}`,
      );
    }
    return initiative;
  }

  private async toRecord(entity: KanbanInitiativeEntity): Promise<Initiative> {
    const goalIds = await this.initiatives.findGoalIds(entity.id);
    return {
      id: entity.id,
      project_id: entity.project_id,
      title: entity.title,
      description: entity.description,
      horizon: entity.horizon as Initiative["horizon"],
      priority: entity.priority,
      status: entity.status as Initiative["status"],
      goalIds,
      lastReviewedAt: entity.last_reviewed_at?.toISOString() ?? null,
      created_at: entity.created_at.toISOString(),
      updated_at: entity.updated_at.toISOString(),
    };
  }
}
