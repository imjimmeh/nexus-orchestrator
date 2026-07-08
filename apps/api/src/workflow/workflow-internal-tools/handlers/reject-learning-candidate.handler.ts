import { Injectable, NotFoundException } from '@nestjs/common';
import { LearningCandidateRepository } from '../../../memory/database/repositories/learning-candidate.repository';
import { requireNonEmptyString } from '../../workflow-runtime/workflow-runtime-tools.helpers';

/**
 * Extracted handler for the `reject_learning_candidate` runtime
 * capability (refactoring work item: split `MemoryToolsHandler` per
 * public method). Behaviour is identical to the previous aggregate's
 * `rejectCandidate` implementation — same `candidate_id` validation,
 * same `updateById` patch with `status: 'rejected'` (and a
 * `diagnostics_json.rejection_reason` when a `reason` is supplied),
 * same `NotFoundException` when `updateById` reports the candidate is
 * missing, same `{ candidate_id: updated.id, status: updated.status }`
 * response shape — so the existing
 * `leaves non-queryMemory handler paths (rejectCandidate) unaffected`
 * regression sentinel in `query-memory.handler.spec.ts` continues to
 * exercise the reject path unchanged.
 *
 * AC-9 (no new dependencies): the constructor surface is intentionally
 * narrow — this handler only needs the single repository that owns
 * the actual update path (`LearningCandidateRepository`). All other
 * dependencies the aggregate carries stay on the aggregate, which
 * keeps the wiring graph here honest and the handler trivially
 * mockable.
 */
@Injectable()
export class RejectLearningCandidateHandler {
  constructor(private readonly candidates: LearningCandidateRepository) {}

  async rejectCandidate(params: {
    candidate_id: string;
    reason?: string;
  }): Promise<Record<string, unknown>> {
    const candidateId = requireNonEmptyString(
      params.candidate_id,
      'candidate_id',
    );
    const updated = await this.candidates.updateById(candidateId, {
      status: 'rejected',
      diagnostics_json: params.reason
        ? { rejection_reason: params.reason }
        : undefined,
    });
    if (!updated) {
      throw new NotFoundException(
        `Learning candidate ${candidateId} not found`,
      );
    }
    return {
      candidate_id: updated.id,
      status: updated.status,
    };
  }
}
