import type { IMemorySegment } from '@nexus/core';
import type { LearningCandidate } from '../database/entities/learning-candidate.entity';
import type { MemoryType } from '../memory-backend.types';
import type {
  GovernanceDecision,
  GovernanceState,
} from './promotion-governance-policy.types';

export interface LearningPromotionPolicyOptions {
  minimumConfidence?: number;
  allowClaimedCandidate?: boolean;
}

export interface LearningPromotionPolicyDecision {
  approved: boolean;
  code:
    | 'approved'
    | 'missing_lesson'
    | 'not_pending'
    | 'already_promoted'
    | 'low_confidence';
  reason: string;
  policyName: string;
  policyVersion: string;
  minimumConfidence: number;
  confidence: number;
}

/**
 * Terminal outcome of a promotion attempt. `promoted` is today's only outcome
 * for an un-routed (`routing_target = null`) candidate; the remaining three are
 * introduced by the route-aware governance dispatch (EPIC-212 Phase-2 Task 10):
 *   - `dropped`             — governance classified the candidate as noise; no
 *                             segment, candidate marked `dropped`.
 *   - `requires_proposal`   — governance forbids auto-landing (e.g. `global`,
 *                             or an `agent_preference` below its stricter
 *                             threshold); the claim is released and the
 *                             candidate stays `pending` for a human/proposal.
 *   - `routed_to_proposal`  — a skill route created a pending `skill_create`
 *                             improvement proposal; the candidate is marked
 *                             `routed_to_proposal` (no segment).
 */
export type LearningPromotionStatus =
  | 'promoted'
  | 'dropped'
  | 'requires_proposal'
  | 'routed_to_proposal';

export interface LearningPromotionOptions {
  requestedBy?: string;
}

/**
 * Result of a promotion attempt. Only the `promoted` outcome carries a
 * `memory_segment` / `memory_segment_id` / `policy_decision`; the governance
 * branches (`dropped` / `requires_proposal` / `routed_to_proposal`) carry a
 * `governance_decision` instead and never a segment. The optional fields keep
 * the un-routed (`promoted`) path byte-compatible with the pre-Task-10 shape.
 */
export interface LearningPromotionResult {
  candidate_id: string;
  status: LearningPromotionStatus;
  candidate: LearningCandidate;
  memory_segment_id?: string;
  memory_segment?: IMemorySegment;
  policy_decision?: LearningPromotionPolicyDecision;
  governance_decision?: GovernanceDecision;
  routing_target?: string | null;
  skill_proposal_id?: string;
}

/**
 * The concrete write destination an auto-promotion resolves to from a
 * candidate's `routing_target` + the governance verdict. For an un-routed
 * candidate the destination is `undefined` and the promotion uses today's
 * defaults (project scope, `fact`, no governance state).
 */
export interface SegmentDestination {
  entityType: string;
  entityId: string;
  memoryType: MemoryType;
  governanceState: GovernanceState;
  probationUntil: Date | null;
}

/** Extra, route-derived metadata stamped alongside the base promotion metadata. */
export interface BuildMetadataExtras {
  requestedBy?: string;
  probationUntil?: Date | null;
  routingTarget?: string | null;
}

/** The `failure_stage` a `learning.promotion_failed` event is tagged with. */
export type PromotionFailureStage =
  | 'claim_promotion'
  | 'policy_denied'
  | 'write_memory'
  | 'finalize_promotion';

/** The non-promote governance outcomes a `learning.routed` event reports. */
export type GovernanceRoutedOutcome = Exclude<
  LearningPromotionStatus,
  'promoted'
>;

/**
 * The outcome of consulting the route-aware governance dispatch. A `handled`
 * dispatch produced a terminal `LearningPromotionResult` (drop / proposal /
 * pending) and the caller returns immediately; an un-handled dispatch hands an
 * optional `destination` back to the existing auto-promote machinery (the
 * un-routed path leaves it `undefined` so today's defaults apply).
 */
export type RouteDispatch =
  | { handled: true; result: LearningPromotionResult }
  | { handled: false; destination?: SegmentDestination };
