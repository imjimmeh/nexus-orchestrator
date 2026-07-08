import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, Like } from "typeorm";
import { KanbanBoardStateSnapshotEntity } from "../entities/kanban-board-state-snapshot.entity";

@Injectable()
export class BoardStateRepository {
  constructor(
    @InjectRepository(KanbanBoardStateSnapshotEntity)
    private readonly repository: Repository<KanbanBoardStateSnapshotEntity>,
  ) {}

  save(
    snapshot: Partial<KanbanBoardStateSnapshotEntity>,
  ): Promise<KanbanBoardStateSnapshotEntity> {
    return this.repository.save(this.repository.create(snapshot));
  }

  findLatestByProjectId(
    projectId: string,
  ): Promise<KanbanBoardStateSnapshotEntity | null> {
    return this.repository.findOne({
      where: { project_id: projectId },
      order: { created_at: "DESC" },
    });
  }

  findByProjectIdAndIdempotencyKey(
    projectId: string,
    idempotencyKey: string,
  ): Promise<KanbanBoardStateSnapshotEntity | null> {
    return this.repository.findOne({
      where: {
        project_id: projectId,
        idempotency_key: idempotencyKey,
      },
    });
  }

  findLatestByProjectIdAndIdempotencyKeyPrefix(
    projectId: string,
    idempotencyKeyPrefix: string,
  ): Promise<KanbanBoardStateSnapshotEntity | null> {
    return this.repository.findOne({
      where: {
        project_id: projectId,
        idempotency_key: Like(`${idempotencyKeyPrefix}%`),
      },
      order: { created_at: "DESC" },
    });
  }
}
