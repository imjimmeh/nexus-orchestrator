/**
 * State-machine types for the {@link LearningPromotionService.promoteCandidate}
 * flow. Extracted so the public service stays focused on I/O composition and
 * the discrete flow stages are testable in isolation (Phase-3 refactor).
 *
 * The state names mirror the steps the legacy `promoteCandidate` already
 * executed in order; the events mirror its branch decisions. No state, no
 * event is invented — every legal pair corresponds to a real
 * `await …` call or branch in the original method. Terminal states are the
 * ones from which the caller must return or throw — calling `transition()`
 * from one of them is itself a programming error and throws
 * {@link InvalidPromotionTransitionError}.
 */

/** Distinct stages the promotion flow moves through. */
export enum PromotionState {
  /** Entry to `promoteCandidate`; `findById` has not yet been called. */
  IDLE = 'idle',
  /** `findById` returned a row; branch to either return-or-claim. */
  CANDIDATE_LOADED = 'candidate_loaded',
  /** `findById` returned `null`; caller throws `NotFoundException`. */
  CANDIDATE_MISSING = 'candidate_missing',
  /** Candidate was already promoted; return the existing result. */
  RETURNED_EXISTING_PROMOTION = 'returned_existing_promotion',
  /** `claimPendingPromotion` has been called; awaiting result. */
  CLAIMING_PROMOTION = 'claiming_promotion',
  /** Claim acquired; ready for route-aware governance dispatch. */
  CLAIM_ACQUIRED = 'claim_acquired',
  /** Claim conflict (concurrent promotion); caller throws `ConflictException`. */
  CLAIM_LOST = 'claim_lost',
  /** Route-aware governance verdict resolved to `drop`. */
  DROPPED_BY_GOVERNANCE = 'dropped_by_governance',
  /** Route-aware governance verdict resolved to a skill proposal. */
  ROUTED_TO_SKILL_PROPOSAL = 'routed_to_skill_proposal',
  /** Route-aware governance verdict resolved to "requires proposal". */
  REQUIRES_PROPOSAL = 'requires_proposal',
  /** Policy decision is being evaluated against a claimed candidate. */
  EVALUATING_POLICY = 'evaluating_policy',
  /** `policy.evaluate` returned a non-approved decision; caller throws. */
  POLICY_DENIED = 'policy_denied',
  /** Finding or creating the memory segment for an auto-promotion. */
  WRITING_MEMORY_SEGMENT = 'writing_memory_segment',
  /** Memory segment is ready; finalizing the candidate promotion. */
  FINALIZING_PROMOTION = 'finalizing_promotion',
  /** Terminal: candidate was marked promoted successfully. */
  PROMOTED = 'promoted',
  /**
   * Terminal: a concurrent promoter won the race; we found an existing
   * promotion and return it.
   */
  PROMOTION_RACE_LOST = 'promotion_race_lost',
  /**
   * Terminal: memory write OR finalization failed; cleanup ran and the
   * original error was re-thrown.
   */
  PROMOTION_FAILED = 'promotion_failed',
}

/** Discrete transition triggers derived from real `promoteCandidate` branches. */
export type PromotionEvent =
  | 'CANDIDATE_FOUND'
  | 'CANDIDATE_NOT_FOUND'
  | 'ALREADY_PROMOTED'
  | 'PENDING_PROMOTION'
  | 'CLAIM_ACQUIRED'
  | 'CLAIM_LOST'
  | 'GOVERNANCE_DROP'
  | 'GOVERNANCE_SKILL_ROUTE'
  | 'GOVERNANCE_REQUIRES_PROPOSAL'
  | 'GOVERNANCE_AUTO_PROMOTE'
  | 'POLICY_APPROVED'
  | 'POLICY_DENIED'
  | 'MEMORY_SEGMENT_READY'
  | 'MEMORY_WRITE_FAILED'
  | 'PROMOTION_MARKED'
  | 'PROMOTION_RACE_LOST'
  | 'FINALIZE_FAILED';

/**
 * Thrown by {@link transition} when a (state, event) pair has no legal edge.
 * Caller error — the promotion flow must never produce one of these at
 * runtime. Caught here so the underlying service can surface it during tests
 * instead of silently advancing into a corrupt terminal.
 */
export class InvalidPromotionTransitionError extends Error {
  readonly state: PromotionState;
  readonly event: PromotionEvent;

  constructor(state: PromotionState, event: PromotionEvent) {
    super(
      `Invalid promotion transition: state=${state} does not accept event=${event}`,
    );
    this.name = 'InvalidPromotionTransitionError';
    this.state = state;
    this.event = event;
  }
}
