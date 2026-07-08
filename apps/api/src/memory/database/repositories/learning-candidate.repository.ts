import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, IsNull, LessThan, Repository } from 'typeorm';
import { LearningCandidate } from '../entities/learning-candidate.entity';
import {
  applyPagination,
  applySearch,
  applySort,
} from '../../../common/utils/query-helpers';
import { BulkActionError } from '../../../common/errors/bulk-action.error';

interface ListLearningCandidatesParams {
  statuses?: string[];
  candidateTypes?: string[];
  scopeType?: string;
  scopeId?: string;
  excludeMerged?: boolean;
  search?: string;
  minScore?: number;
  createdFrom?: Date;
  createdTo?: Date;
  page: number;
  limit: number;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
}

const MERGED_STATUS = 'merged';

const PROMOTION_IN_PROGRESS_STATUS = 'promotion_in_progress';

const CANDIDATE_ALLOWED_SORTS = [
  'score',
  'created_at',
  'updated_at',
  'first_seen_at',
  'last_seen_at',
  'promoted_at',
];

const CANDIDATE_SEARCHABLE_COLUMNS = ['title', 'summary'];

@Injectable()
export class LearningCandidateRepository {
  constructor(
    @InjectRepository(LearningCandidate)
    private readonly repository: Repository<LearningCandidate>,
  ) {}

  async create(data: Partial<LearningCandidate>): Promise<LearningCandidate> {
    const entity = this.repository.create(data);
    return this.repository.save(entity);
  }

  async findById(id: string): Promise<LearningCandidate | null> {
    return this.repository.findOne({ where: { id } });
  }

  async findByFingerprint(
    fingerprint: string,
  ): Promise<LearningCandidate | null> {
    return this.repository.findOne({ where: { fingerprint } });
  }

  async rejectById(
    id: string,
    data: { rejectedBy: string | null; reason: string },
  ): Promise<LearningCandidate | null> {
    const result = await this.repository.update(
      { id, status: 'pending' },
      {
        status: 'rejected',
        rejected_by: data.rejectedBy,
        rejected_at: new Date(),
        rejection_reason: data.reason,
      },
    );

    if (!result.affected) {
      return null;
    }

    return this.findById(id);
  }

  async archiveById(
    id: string,
    data: { archivedBy: string | null; reason: string | null },
  ): Promise<LearningCandidate | null> {
    const result = await this.repository.update(
      { id, status: 'pending' },
      {
        status: 'archived',
        archived_by: data.archivedBy,
        archived_at: new Date(),
        archive_reason: data.reason,
      },
    );

    if (!result.affected) {
      return null;
    }

    return this.findById(id);
  }

  async bulkReject(
    ids: string[],
    data: { rejectedBy: string | null; reason: string },
  ): Promise<LearningCandidate[]> {
    return this.repository.manager.transaction(async (manager) => {
      await this.verifyPendingBatch(manager, ids);

      await manager.update(
        LearningCandidate,
        { id: In(ids) },
        {
          status: 'rejected',
          rejected_by: data.rejectedBy,
          rejected_at: new Date(),
          rejection_reason: data.reason,
        },
      );

      return manager.find(LearningCandidate, { where: { id: In(ids) } });
    });
  }

  async bulkArchive(
    ids: string[],
    data: { archivedBy: string | null; reason: string | null },
  ): Promise<LearningCandidate[]> {
    return this.repository.manager.transaction(async (manager) => {
      await this.verifyPendingBatch(manager, ids);

      await manager.update(
        LearningCandidate,
        { id: In(ids) },
        {
          status: 'archived',
          archived_by: data.archivedBy,
          archived_at: new Date(),
          archive_reason: data.reason,
        },
      );

      return manager.find(LearningCandidate, { where: { id: In(ids) } });
    });
  }

  /**
   * Load the target rows inside the transaction and verify every id exists
   * and is `pending` before any write happens — throws {@link BulkActionError}
   * (which rolls back the transaction) identifying the offending ids otherwise.
   */
  private async verifyPendingBatch(
    manager: { find: EntityManager['find'] },
    ids: string[],
  ): Promise<LearningCandidate[]> {
    const found = await manager.find(LearningCandidate, {
      where: { id: In(ids) },
    });
    const foundIds = new Set(found.map((candidate) => candidate.id));
    const missingIds = ids.filter((id) => !foundIds.has(id));
    if (missingIds.length > 0) {
      throw new BulkActionError('not_found', missingIds);
    }

    const invalidIds = found
      .filter((candidate) => candidate.status !== 'pending')
      .map((candidate) => candidate.id);
    if (invalidIds.length > 0) {
      throw new BulkActionError('invalid_status', invalidIds);
    }

    return found;
  }

  async list(
    params: ListLearningCandidatesParams,
  ): Promise<{ data: LearningCandidate[]; total: number }> {
    const qb = this.repository.createQueryBuilder('candidate');

    applySearch(qb, params.search, CANDIDATE_SEARCHABLE_COLUMNS, 'candidate');

    if (params.statuses && params.statuses.length > 0) {
      qb.andWhere('candidate.status IN (:...statuses)', {
        statuses: params.statuses,
      });
    }

    if (params.excludeMerged) {
      // Opt-in: hide clustering duplicates; they are counted separately
      qb.andWhere('candidate.status != :merged', { merged: MERGED_STATUS });
    }

    if (params.candidateTypes && params.candidateTypes.length > 0) {
      qb.andWhere('candidate.candidate_type IN (:...candidateTypes)', {
        candidateTypes: params.candidateTypes,
      });
    }

    if (params.scopeType) {
      qb.andWhere('candidate.scope_type = :scopeType', {
        scopeType: params.scopeType,
      });
    }

    if (params.scopeId) {
      qb.andWhere('candidate.scope_id = :scopeId', { scopeId: params.scopeId });
    }

    if (params.minScore !== undefined) {
      qb.andWhere('candidate.score >= :minScore', {
        minScore: params.minScore,
      });
    }

    if (params.createdFrom) {
      qb.andWhere('candidate.created_at >= :createdFrom', {
        createdFrom: params.createdFrom,
      });
    }

    if (params.createdTo) {
      qb.andWhere('candidate.created_at <= :createdTo', {
        createdTo: params.createdTo,
      });
    }

    const total = await qb.getCount();

    applySort(
      qb,
      params.sortBy,
      params.sortDir,
      CANDIDATE_ALLOWED_SORTS,
      'score',
      'desc',
      'candidate',
    );

    if (!params.sortBy) {
      qb.addOrderBy('candidate.updated_at', 'DESC');
    }

    applyPagination(qb, params.page, params.limit);

    const data = await qb.getMany();
    return { data, total };
  }

  async countMerged(): Promise<number> {
    return this.repository.count({ where: { status: MERGED_STATUS } });
  }

  async findByIds(
    ids: string[],
  ): Promise<Array<{ id: string; rawContent: string }>> {
    if (ids.length === 0) {
      return [];
    }
    const candidates = await this.repository.find({ where: { id: In(ids) } });
    return candidates.map((c) => ({ id: c.id, rawContent: c.summary }));
  }

  async countByStatuses(statuses: string[]): Promise<number> {
    if (statuses.length === 0) {
      return 0;
    }

    return this.repository.count({
      where: {
        status: In(statuses),
      },
    });
  }

  /**
   * Count agent_capture candidates created in a specific workflow run and job.
   * Used by the per-job write-budget guard on the `remember` tool.
   * Queries the JSONB provenance fields stored in signals_json.
   */
  async countAgentCaptureByJob(
    workflowRunId: string,
    jobId: string,
  ): Promise<number> {
    return this.repository
      .createQueryBuilder('candidate')
      .where('candidate.candidate_type = :type', { type: 'agent_capture' })
      .andWhere(
        "candidate.signals_json -> 'provenance' ->> 'workflowRunId' = :runId",
        { runId: workflowRunId },
      )
      .andWhere("candidate.signals_json -> 'provenance' ->> 'jobId' = :jobId", {
        jobId,
      })
      .getCount();
  }

  /**
   * Load `pending` candidates that have not yet been routed
   * (`routing_target IS NULL`). Used by the nightly clusterer pass to populate
   * `routing_target` deterministically before the sweep consumes the queue.
   * `merged` clustering duplicates are excluded by the status filter, so each
   * surviving canonical candidate is routed exactly once (idempotent).
   */
  async findPendingForRouting(limit: number): Promise<LearningCandidate[]> {
    return this.repository.find({
      where: { status: 'pending', routing_target: IsNull() },
      order: { score: 'DESC', updated_at: 'DESC' },
      take: limit,
    });
  }

  /**
   * Persist the deterministic routing decision onto a candidate. Idempotent —
   * re-routing simply overwrites the prior target.
   */
  async setRoutingTarget(id: string, target: string): Promise<void> {
    await this.repository.update({ id }, { routing_target: target });
  }

  async updateById(
    id: string,
    data: Partial<LearningCandidate>,
  ): Promise<LearningCandidate | null> {
    await this.repository.update(
      { id },
      data as Parameters<typeof this.repository.update>[1],
    );

    return this.findById(id);
  }

  async claimPendingPromotion(
    id: string,
    options: { staleBefore?: Date; claimedAt?: Date } = {},
  ): Promise<LearningCandidate | null> {
    const claimedAt = options.claimedAt ?? new Date();
    const pendingResult = await this.repository.update(
      {
        id,
        status: 'pending',
        promoted_memory_segment_id: IsNull(),
        promoted_at: IsNull(),
      },
      { status: PROMOTION_IN_PROGRESS_STATUS, updated_at: claimedAt },
    );

    if (pendingResult.affected) {
      return this.findById(id);
    }

    if (!options.staleBefore) {
      return null;
    }

    const staleResult = await this.repository.update(
      {
        id,
        status: PROMOTION_IN_PROGRESS_STATUS,
        promoted_memory_segment_id: IsNull(),
        promoted_at: IsNull(),
        updated_at: LessThan(options.staleBefore),
      },
      { status: PROMOTION_IN_PROGRESS_STATUS, updated_at: claimedAt },
    );

    if (!staleResult.affected) {
      return null;
    }

    return this.findById(id);
  }

  /**
   * Transition a claimed candidate (status `promotion_in_progress`) to a
   * terminal governance status (`dropped` | `routed_to_proposal`). Consumes the
   * promotion claim atomically, the same way {@link markPromotedIfClaimed}
   * does, so a concurrent finalizer cannot also act on the row. Returns the
   * updated row, or `null` when the claim was already lost.
   */
  async markStatusIfClaimed(
    id: string,
    status: string,
    claimedAt?: Date,
  ): Promise<LearningCandidate | null> {
    const result = await this.repository.update(
      {
        id,
        status: PROMOTION_IN_PROGRESS_STATUS,
        promoted_memory_segment_id: IsNull(),
        promoted_at: IsNull(),
        ...(claimedAt ? { updated_at: claimedAt } : {}),
      },
      { status },
    );

    if (!result.affected) {
      return null;
    }

    return this.findById(id);
  }

  async releasePromotionClaim(id: string, claimedAt?: Date): Promise<void> {
    await this.repository.update(
      {
        id,
        status: PROMOTION_IN_PROGRESS_STATUS,
        promoted_memory_segment_id: IsNull(),
        promoted_at: IsNull(),
        ...(claimedAt ? { updated_at: claimedAt } : {}),
      },
      { status: 'pending' },
    );
  }

  async markPromotedIfClaimed(
    id: string,
    memorySegmentId: string,
    promotedAt: Date,
    claimedAt?: Date,
  ): Promise<LearningCandidate | null> {
    const result = await this.repository.update(
      {
        id,
        status: PROMOTION_IN_PROGRESS_STATUS,
        ...(claimedAt ? { updated_at: claimedAt } : {}),
      },
      {
        status: 'promoted',
        promoted_memory_segment_id: memorySegmentId,
        promoted_at: promotedAt,
      },
    );

    if (!result.affected) {
      return null;
    }

    return this.findById(id);
  }
}
