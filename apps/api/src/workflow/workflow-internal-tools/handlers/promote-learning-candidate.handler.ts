import { Injectable, NotFoundException } from '@nestjs/common';
import { LearningCandidateRepository } from '../../../memory/database/repositories/learning-candidate.repository';
import { LearningPromotionService } from '../../../memory/learning/learning-promotion.service';
import { requireNonEmptyString } from '../../workflow-runtime/workflow-runtime-tools.helpers';

/**
 * Extracted handler for the `promote_learning_candidate` runtime
 * capability (refactoring work item: split `MemoryToolsHandler` per
 * public method). Behaviour is identical to the previous aggregate's
 * `promoteCandidate` implementation — same `candidate_id` validation,
 * same `NotFoundException` when the candidate is missing, same
 * already-promoted early-return (only when `promoted_memory_segment_id`
 * is a non-empty string), same `pending_approval` short-circuit when
 * neither `human_approved_at` nor `operator_scope` is set, same
 * `LearningPromotionService.promoteCandidate` delegation with
 * `requestedBy: 'workflow_sweep'` — so the existing
 * `returns pending_approval and does not call promoteCandidate when
 * neither human_approved_at nor operator_scope is set`,
 * `proceeds to full promotion when human_approved_at is a valid Date`,
 * and `proceeds to full promotion when operator_scope is supplied even
 * with human_approved_at null` describes in
 * `query-memory.handler.spec.ts` continue to exercise the promotion
 * gate unchanged.
 *
 * AC-9 (no new dependencies): the constructor surface is intentionally
 * narrow — this handler only needs the repository that owns the
 * candidate lookup (`LearningCandidateRepository`) and the service
 * that owns the actual promotion flow (`LearningPromotionService`).
 * No other dependencies the aggregate carries are pulled in here.
 */
@Injectable()
export class PromoteLearningCandidateHandler {
  constructor(
    private readonly candidates: LearningCandidateRepository,
    private readonly promotion: LearningPromotionService,
  ) {}

  async promoteCandidate(params: {
    candidate_id: string;
    operator_scope?: string;
  }): Promise<Record<string, unknown>> {
    const candidateId = requireNonEmptyString(
      params.candidate_id,
      'candidate_id',
    );
    const operatorScope =
      typeof params.operator_scope === 'string' &&
      params.operator_scope.trim().length > 0
        ? params.operator_scope.trim()
        : undefined;

    const candidate = await this.candidates.findById(candidateId);
    if (!candidate) {
      throw new NotFoundException(
        `Learning candidate ${candidateId} not found`,
      );
    }

    if (
      candidate.status === 'promoted' &&
      candidate.promoted_memory_segment_id != null &&
      candidate.promoted_memory_segment_id.trim().length > 0
    ) {
      return {
        candidate_id: candidate.id,
        memory_segment_id: candidate.promoted_memory_segment_id,
        status: candidate.status,
      };
    }

    const isHumanApproved = candidate.human_approved_at instanceof Date;
    if (!isHumanApproved && !operatorScope) {
      return {
        candidate_id: candidateId,
        status: 'pending_approval',
        reason: 'Human approval required for unattended sweep promotion',
      };
    }

    const result = await this.promotion.promoteCandidate(candidateId, {
      requestedBy: 'workflow_sweep',
    });
    return {
      candidate_id: result.candidate_id,
      memory_segment_id: result.memory_segment_id,
      status: result.status,
    };
  }
}
