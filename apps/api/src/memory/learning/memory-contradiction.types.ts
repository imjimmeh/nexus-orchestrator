/**
 * Public type surface for the `MemoryContradictionService` (EPIC-212 Phase-3
 * Task 5).
 *
 * Splitting the contracts out of the service / pure-logic files keeps each
 * focused and satisfies the `no-restricted-syntax` rule that forbids exported
 * interfaces / type-aliases / enums outside a dedicated `*.types.ts` file.
 */

/**
 * The opposing-stance verdict produced by the pure `detectOpposingStance`
 * heuristic.
 *
 *   - `oppose` — same topic, contradictory claim (negation / antonym /
 *     `always`↔`never` / numeric-value mismatch). Drives a `supersede`.
 *   - `refine` — same topic, the new lesson extends / refines the existing
 *     one (no contradiction). Drives a `version` bump.
 *   - `same`   — semantically the same claim. NOT a contradiction — this is a
 *     dedup the existing reinforce path already owns; drives a `none`.
 *   - `ambiguous` — overlapping but unclear. Surfaces an operator diff event;
 *     never silently mutates either row.
 */
export type OpposingStance = 'oppose' | 'refine' | 'same' | 'ambiguous';

/**
 * The kind of contradiction outcome the service decided on.
 *
 *   - `none`       — no near contradicting neighbour, or a same-stance dedup.
 *   - `supersede`  — the new memory replaces a contradicting older one.
 *   - `version`    — the new memory is a newer version of an existing one.
 *   - `ambiguous`  — a near opposing-ish hit that needs a human diff.
 */
export type ContradictionKind = 'none' | 'supersede' | 'version' | 'ambiguous';

/**
 * Apply mode for the contradiction service.
 *
 *   - `shadow`  — emit the `memory.contradiction.detected.v1` event but NEVER
 *     mutate the DB (observe the would-do set before flipping `enforce`).
 *   - `enforce` — apply the supersede / version mutations (still archive-only;
 *     the loser is preserved, never hard-deleted).
 */
export type ContradictionMode = 'shadow' | 'enforce';

/**
 * The decision the service returns to the caller. Mutations (and the apply
 * mode) are an internal concern surfaced on the emitted event, not here — the
 * return contract is intentionally minimal so the promotion hook can stay
 * fail-soft and side-effect-free.
 */
export interface ContradictionDecision {
  kind: ContradictionKind;
  /** The contradicting / refined existing segment, when one was found. */
  existingSegmentId?: string;
  /** Machine-readable rationale for the decision. */
  reason: string;
  /** The nearest-neighbour similarity score that drove the decision (0 when none). */
  similarity: number;
}

/**
 * Caller-supplied description of the freshly-created memory segment to evaluate
 * for contradictions. Decoupled from the `MemorySegment` entity so the service
 * is testable without a full ORM row.
 */
export interface ContradictionEvaluationInput {
  segmentId: string;
  content: string;
  scopeType: string;
  scopeId: string;
  version: number;
}

/**
 * Operator-tuned thresholds the pure `decideContradiction` compares against.
 */
export interface ContradictionThresholds {
  similarityThreshold: number;
}

/**
 * Inputs to the pure `decideContradiction` mapping. `nearest` is the top
 * scope-filtered neighbour (or `null` when none exists); `stance` is the
 * heuristic verdict against that neighbour's content (or `null` when there is
 * no neighbour to compare against).
 */
export interface ContradictionDecisionInput {
  nearest: { ownerId: string; score: number } | null;
  stance: OpposingStance | null;
  thresholds: ContradictionThresholds;
}
