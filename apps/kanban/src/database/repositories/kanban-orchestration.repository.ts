import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { KanbanOrchestrationEntity } from "../entities/kanban-orchestration.entity";

@Injectable()
export class KanbanOrchestrationRepository {
  constructor(
    @InjectRepository(KanbanOrchestrationEntity)
    private readonly repository: Repository<KanbanOrchestrationEntity>,
  ) {}

  save(
    orchestration: Partial<KanbanOrchestrationEntity>,
  ): Promise<KanbanOrchestrationEntity> {
    return this.repository.save(this.repository.create(orchestration));
  }

  findByproject_id(
    project_id: string,
  ): Promise<KanbanOrchestrationEntity | null> {
    return this.repository.findOne({
      where: {
        project_id: project_id,
      },
    });
  }

  findByLinkedRunId(
    linked_run_id: string,
  ): Promise<KanbanOrchestrationEntity | null> {
    return this.repository.findOne({
      where: {
        linked_run_id: linked_run_id,
      },
    });
  }

  async clearLinkedRunIfMatches(
    project_id: string,
    linked_run_id: string,
    metadataPatch: Record<string, unknown>,
  ): Promise<boolean> {
    const result = await this.repository
      .createQueryBuilder()
      .update(KanbanOrchestrationEntity)
      .set({
        linked_run_id: null,
        metadata: () =>
          "COALESCE(metadata, '{}'::jsonb) || CAST(:metadataPatch AS jsonb)",
      })
      .where("project_id = :project_id", { project_id })
      .andWhere("linked_run_id = :linked_run_id", { linked_run_id })
      .setParameter("metadataPatch", JSON.stringify(metadataPatch))
      .execute();

    return (result.affected ?? 0) > 0;
  }

  findAll(): Promise<KanbanOrchestrationEntity[]> {
    return this.repository.find();
  }

  findByStatus(status: string): Promise<KanbanOrchestrationEntity[]> {
    return this.repository.find({
      where: {
        status,
      },
    });
  }

  async updateMode(project_id: string, mode: string): Promise<void> {
    await this.repository.update({ project_id }, { mode });
  }

  async listAllModes(): Promise<Array<{ projectId: string; mode: string }>> {
    const rows = await this.repository.find({
      select: { project_id: true, mode: true },
    });
    return rows.map((row) => ({ projectId: row.project_id, mode: row.mode }));
  }

  async deleteByproject_id(project_id: string): Promise<void> {
    await this.repository.delete({ project_id: project_id });
  }
}
