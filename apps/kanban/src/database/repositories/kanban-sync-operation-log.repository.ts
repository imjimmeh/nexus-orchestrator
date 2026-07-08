import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { KanbanSyncOperationLogEntity } from "../entities/kanban-sync-operation-log.entity";
import type { CreateSyncOperationLogInput } from "./kanban-sync-operation-log.repository.types";

const DEFAULT_LIMIT = 50;
const DEFAULT_OFFSET = 0;

@Injectable()
export class KanbanSyncOperationLogRepository {
  constructor(
    @InjectRepository(KanbanSyncOperationLogEntity)
    private readonly repo: Repository<KanbanSyncOperationLogEntity>,
  ) {}

  createOperation(
    input: CreateSyncOperationLogInput,
  ): Promise<KanbanSyncOperationLogEntity> {
    return this.repo.save({
      connection_id: input.connection_id,
      project_id: input.project_id,
      work_item_id: input.work_item_id ?? null,
      external_id: input.external_id ?? null,
      direction: input.direction,
      operation: input.operation,
      status: input.status,
      message: input.message ?? null,
      details: input.details ?? {},
      started_at: new Date(),
    });
  }

  async completeOperation(
    id: string,
    status: string,
    message?: string | null,
    details?: Record<string, unknown>,
  ): Promise<KanbanSyncOperationLogEntity | null> {
    const updatePayload: Record<string, unknown> = {
      status,
      message: message ?? null,
      completed_at: new Date(),
    };

    if (details !== undefined) {
      updatePayload.details = details;
    }

    const updateResult = await this.repo.update(id, updatePayload);

    if (updateResult.affected === 0) {
      return null;
    }

    return this.repo.findOne({ where: { id } });
  }

  listByConnection(
    connectionId: string,
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET,
  ): Promise<KanbanSyncOperationLogEntity[]> {
    return this.repo.find({
      where: { connection_id: connectionId },
      order: { created_at: "DESC" },
      take: limit,
      skip: offset,
    });
  }

  listByProject(
    projectId: string,
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET,
  ): Promise<KanbanSyncOperationLogEntity[]> {
    return this.repo.find({
      where: { project_id: projectId },
      order: { created_at: "DESC" },
      take: limit,
      skip: offset,
    });
  }

  listByWorkItem(
    workItemId: string,
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET,
  ): Promise<KanbanSyncOperationLogEntity[]> {
    return this.repo.find({
      where: { work_item_id: workItemId },
      order: { created_at: "DESC" },
      take: limit,
      skip: offset,
    });
  }
}
