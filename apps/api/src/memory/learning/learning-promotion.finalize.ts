import { ConflictException } from '@nestjs/common';
import type { IMemorySegment } from '@nexus/core';
import type { LearningCandidate } from '../database/entities/learning-candidate.entity';
import type {
  LearningPromotionPolicyDecision,
  LearningPromotionResult,
  SegmentDestination,
} from './learning-promotion.types';
import { isPromotedCandidate } from './learning-promotion.helpers';
import type { PromotionState } from './learning-promotion.state.types';
import { transition } from './learning-promotion.state';
import type { FinalizeStepDependencies } from './learning-promotion.finalize.types';

/**
 * Step 2a: evaluate the policy. On denial, release the claim + emit the
 * `policy_denied` failure event + throw inline. On approval, return the
 * decision alongside the next state.
 */
export async function evaluatePolicyOrDeny(
  deps: FinalizeStepDependencies,
  claimedCandidate: LearningCandidate,
  startState: PromotionState,
  claimStartedAt: Date,
  minimumConfidence: number,
  requestedBy: string | undefined,
): Promise<{
  state: PromotionState;
  decision: LearningPromotionPolicyDecision;
}> {
  const decision = deps.policy.evaluate(claimedCandidate, {
    allowClaimedCandidate: true,
    minimumConfidence,
  });
  if (decision.approved) {
    return {
      state: transition(startState, 'POLICY_APPROVED'),
      decision,
    };
  }
  transition(startState, 'POLICY_DENIED');
  await deps.candidates.releasePromotionClaim(
    claimedCandidate.id,
    claimStartedAt,
  );
  await deps.emitFailed(claimedCandidate, decision, null, 'policy_denied', {
    requestedBy,
  });
  throw new ConflictException({
    message: `Learning candidate ${claimedCandidate.id} was denied promotion`,
    decision,
  });
}

/**
 * Step 2b: find or create the memory segment. On write error, release +
 * emit `write_memory` failure + rethrow. Keeps the try-block depth to one
 * indent level by branching on the pre-fetched existing segment.
 */
export async function ensureMemorySegmentOrFailWrite(
  deps: FinalizeStepDependencies,
  claimedCandidate: LearningCandidate,
  decision: LearningPromotionPolicyDecision,
  stateBeforeWrite: PromotionState,
  claimStartedAt: Date,
  options: { requestedBy?: string; destination?: SegmentDestination } = {},
): Promise<{ segment: IMemorySegment; state: PromotionState }> {
  const { requestedBy, destination } = options;
  const existing: IMemorySegment | null =
    await deps.findExistingMemorySegment(claimedCandidate);
  try {
    if (existing) {
      return {
        segment: existing,
        state: transition(stateBeforeWrite, 'MEMORY_SEGMENT_READY'),
      };
    }
    const created = await deps.createMemorySegment(claimedCandidate, decision, {
      requestedBy,
      destination,
    });
    // EPIC-212 Phase-3 Task 5: detect + supersede a contradicting memory.
    // Gated + shadow-first + fail-soft inside the contradiction service, so
    // with the flag off (default) the promotion path is byte-identical.
    await deps.contradiction?.evaluateCreatedSegment(created);
    return {
      segment: created,
      state: transition(stateBeforeWrite, 'MEMORY_SEGMENT_READY'),
    };
  } catch (error) {
    transition(stateBeforeWrite, 'MEMORY_WRITE_FAILED');
    await deps.candidates.releasePromotionClaim(
      claimedCandidate.id,
      claimStartedAt,
    );
    await deps.emitFailed(claimedCandidate, decision, null, 'write_memory', {
      requestedBy,
    });
    throw error;
  }
}

/**
 * Step 2c: mark the candidate as promoted. `null` from
 * `markPromotedIfClaimed` means a concurrent promoter won (return existing
 * promotion) or another write contention (rethrow `ConflictException`). A
 * genuine finalize failure releases the claim + emits `finalize_promotion`
 * + rethrows.
 */
export async function markPromotedAndFinalize(
  deps: FinalizeStepDependencies,
  claimedCandidate: LearningCandidate,
  memorySegment: IMemorySegment,
  decision: LearningPromotionPolicyDecision,
  stateBeforeFinalize: PromotionState,
  claimStartedAt: Date,
  requestedBy: string | undefined,
): Promise<LearningPromotionResult> {
  try {
    const promotedAt = new Date();
    const updated = await deps.candidates.markPromotedIfClaimed(
      claimedCandidate.id,
      memorySegment.id,
      promotedAt,
      claimStartedAt,
    );

    if (!updated) {
      const latest = await deps.candidates.findById(claimedCandidate.id);
      if (latest && isPromotedCandidate(latest)) {
        transition(stateBeforeFinalize, 'PROMOTION_RACE_LOST');
        return await deps.returnExistingPromotion(latest);
      }
      throw new ConflictException(
        `Learning candidate ${claimedCandidate.id} promotion finalization failed`,
      );
    }

    transition(stateBeforeFinalize, 'PROMOTION_MARKED');
    await deps.emitSucceeded(claimedCandidate, memorySegment, decision, {
      requestedBy,
    });
    await deps.emitPromoted(claimedCandidate, memorySegment, decision);

    return {
      candidate_id: claimedCandidate.id,
      memory_segment_id: memorySegment.id,
      status: 'promoted',
      policy_decision: decision,
      candidate: updated,
      memory_segment: memorySegment,
      routing_target: claimedCandidate.routing_target,
    };
  } catch (error) {
    transition(stateBeforeFinalize, 'FINALIZE_FAILED');
    await deps.candidates.releasePromotionClaim(
      claimedCandidate.id,
      claimStartedAt,
    );
    await deps.emitFailed(
      claimedCandidate,
      decision,
      memorySegment,
      'finalize_promotion',
      { requestedBy },
    );
    throw error;
  }
}
