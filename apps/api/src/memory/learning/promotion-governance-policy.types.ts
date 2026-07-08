/**
 * Public contract for `PromotionGovernancePolicyService` (EPIC-212 Phase-2
 * Task 9).
 *
 * The service encodes a tiered "who may auto-promote" matrix keyed on a
 * candidate's deterministic `routingTarget` (Task 8) plus its re-derived
 * confidence (Task 7). The decision math is PURE and deterministic: the
 * probation window is computed from an injected `nowMs`, never a hidden
 * `Date.now()`, so every cell of the matrix is unit-testable to the
 * millisecond. Task 10 consumes a `GovernanceDecision` in the promotion
 * dispatch to choose the destination (auto-promote vs. proposal vs. drop) and
 * stamp `governance_state` on any auto-promoted segment.
 */
import type { RoutingTarget } from './learning-router.types';

/**
 * Lifecycle state stamped on a `memory_segments` row. `provisional` marks an
 * auto-promotion still inside its probation window (Phase-3 confirms or
 * reverts it); `confirmed` is a settled segment; `null` is a legacy row
 * written before governance existed (treated as confirmed by readers).
 */
export type GovernanceState = 'provisional' | 'confirmed' | null;

/** Input to the pure governance decision. */
export interface GovernanceEvaluationInput {
  /** The candidate's deterministic routing home (Task 8). */
  routingTarget: RoutingTarget;
  /** Re-derived (router-capped) confidence in `[0, 1]` (Task 7). */
  confidence: number;
  /**
   * Injected wall-clock in epoch-ms used to compute `probationUntil`
   * deterministically. When omitted the service falls back to the current
   * time; tests ALWAYS pass an explicit value so the computed date is exact.
   */
  nowMs?: number;
}

/**
 * The governance verdict. Exactly one of `autoPromote` / `requiresProposal` /
 * `drop` is the operative outcome; the others are `false`. An auto-promotion
 * always carries `governanceState='provisional'` and a `probationUntil`.
 */
export interface GovernanceDecision {
  /** True only when the candidate may be written as a memory segment now. */
  autoPromote: boolean;
  /** State to stamp on the new segment; `provisional` for every auto-promotion. */
  governanceState: GovernanceState;
  /** End of the probation window for an auto-promotion; `null` otherwise. */
  probationUntil?: Date | null;
  /** True when the candidate must go through a human/proposal path instead. */
  requiresProposal: boolean;
  /** True when the candidate is noise and should be dropped without a segment. */
  drop: boolean;
  /** Human-readable rationale for the verdict (safe to log; no secrets). */
  reason: string;
}

/** Resolved, operator-tunable thresholds the pure decision math consumes. */
export interface GovernanceThresholds {
  /** Defence-in-depth auto-promotion floor (mirrors the 0.5 promotion floor). */
  promotionFloor: number;
  /** Stricter floor a behavioural `agent_preference` must clear to auto-promote. */
  agentPreferenceMinConfidence: number;
  /** Probation window (days) stamped on every `provisional` auto-promotion. */
  probationDays: number;
}
