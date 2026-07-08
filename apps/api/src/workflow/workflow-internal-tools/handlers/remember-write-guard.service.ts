import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { InternalToolExecutionContext, RememberBody } from '@nexus/core';
import { LearningCandidateRepository } from '../../../memory/database/repositories/learning-candidate.repository';
import { SystemSettingsService } from '../../../settings/system-settings.service';
import { CANDIDATE_SIMILARITY } from '../../../memory/signals/candidate-similarity.interface';
import type {
  ICandidateSimilarity,
  CandidateSimilarityScope,
} from '../../../memory/signals/candidate-similarity.interface';
import {
  CANDIDATE_SIMILARITY_THRESHOLD_SETTING,
  CANDIDATE_SIMILARITY_THRESHOLD_DEFAULT,
} from '../../../memory/signals/candidate-similarity.config';
import type { WriteGuardResult } from './remember-write-guard.service.types';

export type { WriteGuardResult };

const MEMORY_CAPTURE_MAX_PER_JOB_SETTING = 'memory_capture_max_per_job';
const MEMORY_CAPTURE_MAX_PER_JOB_DEFAULT = 8;
const PENDING_STATUS = 'pending';
const OWNER_TYPE = 'learning_candidate';
const NEAR_DUP_SCOPE_CANDIDATE_LIMIT = 200;
const NEAR_DUP_K = 1;

const GLOBAL_SCOPE_TYPE: RememberBody['scope'] = 'global';

interface ScopeParams {
  content: string;
  /** The ALREADY-RESOLVED scope this write targets — see `resolveRememberScope`. */
  scopeType: RememberBody['scope'];
  /** The resolved entity id for `scopeType` (`null` for `global`). */
  scopeId: string | null;
}

/**
 * Enforces two pre-insert guards on the `remember` (agent_capture) write path:
 *
 * 1. Per-job budget: if the run+job already has >= `memory_capture_max_per_job`
 *    agent_capture rows, return `budget_exhausted` without inserting.
 *
 * 2. Near-duplicate collapse: if an existing pending candidate in the same
 *    RESOLVED scope (scope_type + scope_id — e.g. a specific agent profile,
 *    workflow, or project, never mixed across scope types) has a RAW cosine
 *    similarity >= `candidate_similarity_threshold` via
 *    `ICandidateSimilarity.findRawSimilarNeighbors`, reinforce it (bump
 *    last_seen_at + recurrence_count) instead of inserting. Using the raw path
 *    (not the RRF-fused `findNearest`) is what lets the 0.85 threshold fire.
 *    Similarity errors are fail-soft: on error the guard falls through to
 *    the normal insert path.
 */
@Injectable()
export class RememberWriteGuardService {
  private readonly logger = new Logger(RememberWriteGuardService.name);

  constructor(
    private readonly candidates: LearningCandidateRepository,
    private readonly settings: SystemSettingsService,
    @Optional()
    @Inject(CANDIDATE_SIMILARITY)
    private readonly similarity: ICandidateSimilarity | null,
  ) {}

  async checkBudgetAndNearDup(
    context: InternalToolExecutionContext,
    params: ScopeParams,
  ): Promise<WriteGuardResult> {
    const budgetResult = await this.checkBudget(context);
    if (budgetResult.action === 'budget_exhausted') {
      return budgetResult;
    }

    return this.checkNearDup(params);
  }

  private async checkBudget(
    context: InternalToolExecutionContext,
  ): Promise<WriteGuardResult> {
    const runId = context.workflowRunId;
    const jobId = context.jobId;
    if (!runId || !jobId) {
      return { action: 'proceed' };
    }

    const budget = await this.settings.get<number>(
      MEMORY_CAPTURE_MAX_PER_JOB_SETTING,
      MEMORY_CAPTURE_MAX_PER_JOB_DEFAULT,
    );
    const captured = await this.candidates.countAgentCaptureByJob(runId, jobId);
    if (captured >= budget) {
      return { action: 'budget_exhausted' };
    }

    return { action: 'proceed' };
  }

  private async checkNearDup(params: ScopeParams): Promise<WriteGuardResult> {
    if (!this.similarity) {
      return { action: 'proceed' };
    }

    if (params.scopeType === GLOBAL_SCOPE_TYPE || params.scopeId === null) {
      // Global scope: no bounded candidate set to search against
      return { action: 'proceed' };
    }

    try {
      const scope = await this.buildSimilarityScope(
        params.scopeType,
        params.scopeId,
      );
      if (!scope) {
        return { action: 'proceed' };
      }

      const threshold = await this.settings.get<number>(
        CANDIDATE_SIMILARITY_THRESHOLD_SETTING,
        CANDIDATE_SIMILARITY_THRESHOLD_DEFAULT,
      );

      const neighbours = await this.similarity.findRawSimilarNeighbors(
        params.content,
        NEAR_DUP_K,
        scope,
      );

      const topNeighbour = neighbours[0];
      if (!topNeighbour || topNeighbour.score < threshold) {
        return { action: 'proceed' };
      }

      return await this.reinforceCandidate(topNeighbour.ownerId);
    } catch (error) {
      this.logger.warn(
        `Near-dup check failed (fail-soft, proceeding to insert): ${(error as Error).message}`,
      );
      return { action: 'proceed' };
    }
  }

  private async buildSimilarityScope(
    scopeType: RememberBody['scope'],
    scopeId: string,
  ): Promise<CandidateSimilarityScope | null> {
    const { data } = await this.candidates.list({
      statuses: [PENDING_STATUS],
      scopeType,
      scopeId,
      limit: NEAR_DUP_SCOPE_CANDIDATE_LIMIT,
      page: 1,
    });

    if (data.length === 0) {
      // No pending candidates in scope — nothing to near-dup against.
      return null;
    }

    return {
      ownerType: OWNER_TYPE,
      ownerIds: data.map((c) => c.id),
    };
  }

  private async reinforceCandidate(
    candidateId: string,
  ): Promise<WriteGuardResult> {
    const existing = await this.candidates.findById(candidateId);
    if (!existing) {
      return { action: 'proceed' };
    }

    await this.candidates.updateById(candidateId, {
      last_seen_at: new Date(),
      recurrence_count: existing.recurrence_count + 1,
    });

    return { action: 'reinforced', candidateId };
  }
}
