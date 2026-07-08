import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { KanbanExternalConnectionEntity } from "../entities/kanban-external-connection.entity";
import type {
  CreateExternalConnectionInput,
  UpdateExternalConnectionInput,
} from "./kanban-external-connection.repository.types";

@Injectable()
export class KanbanExternalConnectionRepository {
  constructor(
    @InjectRepository(KanbanExternalConnectionEntity)
    private readonly repo: Repository<KanbanExternalConnectionEntity>,
  ) {}

  create(
    input: CreateExternalConnectionInput,
  ): Promise<KanbanExternalConnectionEntity> {
    return this.repo.save({
      project_id: input.project_id,
      provider_type: input.provider_type,
      name: input.name,
      status: input.status ?? "active",
      sync_mode: input.sync_mode ?? "bidirectional",
      sync_transport: input.sync_transport ?? "manual",
      config: input.config ?? {},
      field_mapping: input.field_mapping ?? {},
      webhook_secret_ref: input.webhook_secret_ref ?? null,
      poll_interval_seconds: input.poll_interval_seconds ?? null,
    });
  }

  findById(id: string): Promise<KanbanExternalConnectionEntity | null> {
    return this.repo.findOne({
      where: { id },
    });
  }

  findByProjectAndId(
    projectId: string,
    id: string,
  ): Promise<KanbanExternalConnectionEntity | null> {
    return this.repo.findOne({
      where: { id, project_id: projectId },
    });
  }

  listByProject(projectId: string): Promise<KanbanExternalConnectionEntity[]> {
    return this.repo.find({
      where: { project_id: projectId },
      order: { created_at: "DESC" },
    });
  }

  async updateByProjectAndId(
    projectId: string,
    id: string,
    patch: UpdateExternalConnectionInput,
  ): Promise<KanbanExternalConnectionEntity | null> {
    const updateResult = await this.repo.update(
      { id, project_id: projectId },
      patch as Record<string, unknown>,
    );

    if (updateResult.affected === 0) {
      return null;
    }

    return this.repo.findOne({ where: { id, project_id: projectId } });
  }

  async deleteByProjectAndId(projectId: string, id: string): Promise<boolean> {
    const deleteResult = await this.repo.delete({ id, project_id: projectId });

    return (deleteResult.affected ?? 0) > 0;
  }

  listActivePollingConnections(): Promise<KanbanExternalConnectionEntity[]> {
    return this.repo.find({
      where: {
        status: "active",
        sync_transport: In(["polling", "both"]),
        sync_mode: In(["inbound", "bidirectional"]),
      },
    });
  }

  async markSyncSuccess(id: string, when: Date): Promise<void> {
    await this.repo.update(id, {
      last_sync_at: when,
      last_sync_error: null,
    });
  }

  async markSyncFailure(id: string, error: string): Promise<void> {
    await this.repo.update(id, {
      last_sync_error: error,
      last_sync_at: new Date(),
    });
  }
}
