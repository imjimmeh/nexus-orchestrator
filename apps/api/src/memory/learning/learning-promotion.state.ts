/**
 * Pure promotion-flow state machine. Extracted from
 * {@link LearningPromotionService.promoteCandidate} (Phase-3 refactor) so the
 * service can drive its flow with `transition(state, event)` instead of
 * nesting try/catch across each branch.
 *
 * Invariants:
 *   - Every (state, event) pair in {@link TRANSITIONS} is a real branch that
 *     existed in the legacy `promoteCandidate`. No invented edges.
 *   - `transition` is referentially transparent: same input → same output.
 *   - Terminal states ({@link isPromotionTerminalState}) have NO outgoing
 *     edges; calling `transition()` from one is a programming error and
 *     throws {@link InvalidPromotionTransitionError}.
 *   - Error states (`CANDIDATE_MISSING`, `CLAIM_LOST`, `POLICY_DENIED`,
 *     `PROMOTION_FAILED`) are reached by `transition()` so the service can
 *     record the failure stage + emit telemetry BEFORE the caller throws.
 */
import {
  InvalidPromotionTransitionError,
  PromotionEvent,
  PromotionState,
} from './learning-promotion.state.types';

/**
 * Explicit transition table — one entry per legal edge. Keep alphabetical
 * inside each starting state for greppability. Any pair NOT in this map is
 * an invalid transition.
 */
const TRANSITIONS: Readonly<
  Record<
    PromotionState,
    Readonly<Partial<Record<PromotionEvent, PromotionState>>>
  >
> = Object.freeze({
  [PromotionState.IDLE]: Object.freeze({
    CANDIDATE_FOUND: PromotionState.CANDIDATE_LOADED,
    CANDIDATE_NOT_FOUND: PromotionState.CANDIDATE_MISSING,
  }),
  [PromotionState.CANDIDATE_LOADED]: Object.freeze({
    ALREADY_PROMOTED: PromotionState.RETURNED_EXISTING_PROMOTION,
    PENDING_PROMOTION: PromotionState.CLAIMING_PROMOTION,
  }),
  [PromotionState.CLAIMING_PROMOTION]: Object.freeze({
    CLAIM_ACQUIRED: PromotionState.CLAIM_ACQUIRED,
    CLAIM_LOST: PromotionState.CLAIM_LOST,
  }),
  [PromotionState.CLAIM_ACQUIRED]: Object.freeze({
    GOVERNANCE_DROP: PromotionState.DROPPED_BY_GOVERNANCE,
    GOVERNANCE_SKILL_ROUTE: PromotionState.ROUTED_TO_SKILL_PROPOSAL,
    GOVERNANCE_REQUIRES_PROPOSAL: PromotionState.REQUIRES_PROPOSAL,
    GOVERNANCE_AUTO_PROMOTE: PromotionState.EVALUATING_POLICY,
  }),
  [PromotionState.EVALUATING_POLICY]: Object.freeze({
    POLICY_APPROVED: PromotionState.WRITING_MEMORY_SEGMENT,
    POLICY_DENIED: PromotionState.POLICY_DENIED,
  }),
  [PromotionState.WRITING_MEMORY_SEGMENT]: Object.freeze({
    MEMORY_SEGMENT_READY: PromotionState.FINALIZING_PROMOTION,
    MEMORY_WRITE_FAILED: PromotionState.PROMOTION_FAILED,
  }),
  [PromotionState.FINALIZING_PROMOTION]: Object.freeze({
    PROMOTION_MARKED: PromotionState.PROMOTED,
    PROMOTION_RACE_LOST: PromotionState.PROMOTION_RACE_LOST,
    FINALIZE_FAILED: PromotionState.PROMOTION_FAILED,
  }),
  // Terminal states — no outgoing edges. They are listed here only so the
  // table is complete and exhaustive over `PromotionState`; the inner object
  // is intentionally empty.
  [PromotionState.CANDIDATE_MISSING]: Object.freeze({}),
  [PromotionState.RETURNED_EXISTING_PROMOTION]: Object.freeze({}),
  [PromotionState.CLAIM_LOST]: Object.freeze({}),
  [PromotionState.DROPPED_BY_GOVERNANCE]: Object.freeze({}),
  [PromotionState.ROUTED_TO_SKILL_PROPOSAL]: Object.freeze({}),
  [PromotionState.REQUIRES_PROPOSAL]: Object.freeze({}),
  [PromotionState.POLICY_DENIED]: Object.freeze({}),
  [PromotionState.PROMOTED]: Object.freeze({}),
  [PromotionState.PROMOTION_RACE_LOST]: Object.freeze({}),
  [PromotionState.PROMOTION_FAILED]: Object.freeze({}),
});

/** True when no further events are valid from `state`. */
export function isPromotionTerminalState(state: PromotionState): boolean {
  const transitions = TRANSITIONS[state];
  return Object.keys(transitions).length === 0;
}

/**
 * Pure: return the next {@link PromotionState} given a (state, event) pair,
 * or throw {@link InvalidPromotionTransitionError} on a programming error.
 *
 * The service passes every branch decision through this function so the
 * flow is auditable from a single place (and unit-testable in isolation,
 * independent of the database / event ledger).
 */
export function transition(
  state: PromotionState,
  event: PromotionEvent,
): PromotionState {
  const stateTransitions = TRANSITIONS[state];
  const next = stateTransitions[event];
  if (next === undefined) {
    throw new InvalidPromotionTransitionError(state, event);
  }
  return next;
}

/** Test seam: the current transition table. Not exported on the public surface. */
export const __TRANSITIONS_FOR_TESTING__ = TRANSITIONS;
