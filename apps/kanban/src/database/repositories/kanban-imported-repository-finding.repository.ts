import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import type { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";
import type {
  ImportedRepositoryFindingDecision,
  ImportedRepositoryFindingStatus,
  ResolveImportedRepositoryFindingInput,
  UpsertImportedRepositoryFindingInput,
} from "../../orchestration/imported-repository-finding.types";
import { KanbanImportedRepositoryFindingEntity } from "../entities/kanban-imported-repository-finding.entity";

@Injectable()
export class KanbanImportedRepositoryFindingRepository {
  constructor(
    @InjectRepository(KanbanImportedRepositoryFindingEntity)
    private readonly repository: Repository<KanbanImportedRepositoryFindingEntity>,
  ) {}

  async upsertFinding(
    input: UpsertImportedRepositoryFindingInput,
  ): Promise<KanbanImportedRepositoryFindingEntity> {
    const observedAt = input.observedAt ?? new Date();
    const upsertEntity = this.repository.create({
      project_id: input.projectId,
      source_id: input.sourceId,
      source_hash: input.sourceHash,
      probe_artifact_path: input.probeArtifactPath,
      probe_scope_id: input.probeScopeId ?? null,
      project_scope_id: input.projectScopeId ?? null,
      title: input.title,
      reason: input.reason,
      finding_kind: input.findingKind,
      recommended_work_type: input.recommendedWorkType,
      recommended_status: input.recommendedStatus,
      status: input.status ?? "pending_investigation",
      confidence_score: input.confidenceScore ?? null,
      evidence: input.evidence,
      decision: input.decision ?? null,
      work_item_id: input.workItemId ?? null,
      metadata: input.metadata ?? null,
      observed_at: observedAt,
      resolved_at: input.resolvedAt ?? null,
    });
    await this.repository.upsert(
      upsertEntity as QueryDeepPartialEntity<KanbanImportedRepositoryFindingEntity>,
      ["project_id", "source_id"],
    );

    return this.requireBySourceId(input.projectId, input.sourceId);
  }

  findByIdForProject(
    projectId: string,
    findingId: string,
  ): Promise<KanbanImportedRepositoryFindingEntity | null> {
    return this.repository.findOne({
      where: { id: findingId, project_id: projectId },
    });
  }

  findBySourceId(
    projectId: string,
    sourceId: string,
  ): Promise<KanbanImportedRepositoryFindingEntity | null> {
    return this.repository.findOne({
      where: { project_id: projectId, source_id: sourceId },
    });
  }

  listByProject(
    projectId: string,
    options: {
      readonly statuses?: ImportedRepositoryFindingStatus[];
      readonly limit?: number;
    } = {},
  ): Promise<KanbanImportedRepositoryFindingEntity[]> {
    return this.repository.find({
      where: {
        project_id: projectId,
        ...(options.statuses && options.statuses.length > 0
          ? { status: In(options.statuses) }
          : {}),
      },
      order: { updated_at: "ASC" },
      take: options.limit ?? 50,
    });
  }

  async resolveFinding(
    input: ResolveImportedRepositoryFindingInput,
  ): Promise<KanbanImportedRepositoryFindingEntity> {
    const existing = await this.findByIdForProject(
      input.projectId,
      input.findingId,
    );
    if (!existing) {
      throw new NotFoundException(
        `Imported repository finding ${input.findingId} not found`,
      );
    }

    const resolvedAt = input.resolvedAt ?? new Date();
    const updateEntity: QueryDeepPartialEntity<KanbanImportedRepositoryFindingEntity> =
      {
        status: input.status,
        decision:
          input.decision as QueryDeepPartialEntity<ImportedRepositoryFindingDecision>,
        work_item_id: input.workItemId ?? existing.work_item_id,
        metadata: (input.metadata ??
          existing.metadata) as QueryDeepPartialEntity<Record<
          string,
          unknown
        > | null>,
        resolved_at: resolvedAt,
      };
    await this.repository.update(existing.id, updateEntity);

    return this.requireById(input.projectId, input.findingId);
  }

  private async requireBySourceId(
    projectId: string,
    sourceId: string,
  ): Promise<KanbanImportedRepositoryFindingEntity> {
    const finding = await this.findBySourceId(projectId, sourceId);
    if (!finding) {
      throw new NotFoundException(
        `Imported repository finding ${sourceId} not found after upsert`,
      );
    }
    return finding;
  }

  private async requireById(
    projectId: string,
    findingId: string,
  ): Promise<KanbanImportedRepositoryFindingEntity> {
    const finding = await this.findByIdForProject(projectId, findingId);
    if (!finding) {
      throw new NotFoundException(
        `Imported repository finding ${findingId} not found`,
      );
    }
    return finding;
  }
}
