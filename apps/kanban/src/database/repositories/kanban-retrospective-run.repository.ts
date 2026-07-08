import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import type { FindOptionsWhere } from "typeorm";
import type { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";
import { Repository } from "typeorm";
import { KanbanRetrospectiveRunEntity } from "../entities/kanban-retrospective-run.entity";
import type {
  CompleteKanbanRetrospectiveRunRecord,
  CreateKanbanRetrospectiveRunRecord,
  FailKanbanRetrospectiveRunRecord,
  ListKanbanRetrospectiveRunsParams,
  SkipKanbanRetrospectiveRunRecord,
} from "../../retrospectives/retrospective.types";

@Injectable()
export class KanbanRetrospectiveRunRepository {
  constructor(
    @InjectRepository(KanbanRetrospectiveRunEntity)
    private readonly repository: Repository<KanbanRetrospectiveRunEntity>,
  ) {}

  createRun(
    input: CreateKanbanRetrospectiveRunRecord,
  ): Promise<KanbanRetrospectiveRunEntity> {
    return this.repository.save({
      idempotency_key: input.idempotency_key,
      project_id: input.project_id,
      orchestration_id: input.orchestration_id,
      trigger_type: input.trigger_type,
      trigger_revision_marker: input.trigger_revision_marker,
      replay_of_run_id: input.replay_of_run_id ?? null,
      status: "running",
      skip_reason: null,
      failure_reason: null,
      candidate_count: 0,
      learning_candidate_ids: [],
      delta_snapshot_json: null,
      diagnostics_json: input.diagnostics_json ?? null,
      started_at: input.started_at,
      completed_at: null,
    });
  }

  findById(id: string): Promise<KanbanRetrospectiveRunEntity | null> {
    return this.repository.findOne({
      where: { id },
    });
  }

  findByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<KanbanRetrospectiveRunEntity | null> {
    return this.repository.findOne({
      where: { idempotency_key: idempotencyKey },
    });
  }

  findLatestByProject(
    projectId: string,
  ): Promise<KanbanRetrospectiveRunEntity | null> {
    return this.repository.findOne({
      where: { project_id: projectId },
      order: { created_at: "DESC" },
    });
  }

  findLatestCompletedByProject(
    projectId: string,
  ): Promise<KanbanRetrospectiveRunEntity | null> {
    return this.repository.findOne({
      where: { project_id: projectId, status: "completed" },
      order: { completed_at: "DESC", created_at: "DESC" },
    });
  }

  list(
    params: ListKanbanRetrospectiveRunsParams,
  ): Promise<KanbanRetrospectiveRunEntity[]> {
    const where: FindOptionsWhere<KanbanRetrospectiveRunEntity> = {};

    if (params.projectId !== undefined) {
      where.project_id = params.projectId;
    }

    if (params.status !== undefined) {
      where.status = params.status;
    }

    return this.repository.find({
      where,
      order: { created_at: "DESC" },
      take: params.limit,
      skip: params.offset,
    });
  }

  async markCompleted(
    id: string,
    input: CompleteKanbanRetrospectiveRunRecord,
  ): Promise<void> {
    const update: QueryDeepPartialEntity<KanbanRetrospectiveRunEntity> = {
      status: "completed",
      candidate_count: input.candidate_count,
      learning_candidate_ids: input.learning_candidate_ids,
      delta_snapshot_json: toNullableJsonUpdate(input.delta_snapshot_json),
      diagnostics_json: toNullableJsonUpdate(input.diagnostics_json),
      completed_at: input.completed_at,
    };

    await this.repository.update(id, update);
  }

  async markSkipped(
    id: string,
    input: SkipKanbanRetrospectiveRunRecord,
  ): Promise<void> {
    const update: QueryDeepPartialEntity<KanbanRetrospectiveRunEntity> = {
      status: "skipped",
      skip_reason: input.skip_reason,
      diagnostics_json: toNullableJsonUpdate(input.diagnostics_json),
      completed_at: input.completed_at,
    };

    await this.repository.update(id, update);
  }

  async markFailed(
    id: string,
    input: FailKanbanRetrospectiveRunRecord,
  ): Promise<void> {
    const update: QueryDeepPartialEntity<KanbanRetrospectiveRunEntity> = {
      status: "failed",
      failure_reason: input.failure_reason,
      diagnostics_json: toNullableJsonUpdate(input.diagnostics_json),
      completed_at: input.completed_at,
    };

    await this.repository.update(id, update);
  }
}

function toNullableJsonUpdate(
  value: Record<string, unknown> | null | undefined,
): QueryDeepPartialEntity<KanbanRetrospectiveRunEntity>["diagnostics_json"] {
  if (value === null || value === undefined) {
    return () => "NULL";
  }

  return value as unknown as QueryDeepPartialEntity<KanbanRetrospectiveRunEntity>["diagnostics_json"];
}
