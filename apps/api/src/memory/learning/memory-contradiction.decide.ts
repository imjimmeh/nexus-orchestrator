import type {
  ContradictionDecision,
  ContradictionDecisionInput,
} from './memory-contradiction.types';

/**
 * Pure decision mapping for the `MemoryContradictionService` (EPIC-212 Phase-3
 * Task 5). Maps a (nearest-neighbour, opposing-stance) pair onto the terminal
 * `ContradictionDecision`. All I/O (vector search, stance heuristic, DB writes,
 * event emit) stays in the service; this function is referentially transparent
 * so the full matrix is unit-testable.
 *
 *   - no neighbour, or below the similarity threshold ⇒ `none` (no candidate).
 *   - `oppose`    ⇒ `supersede`  (the new memory replaces the contradicting one).
 *   - `refine`    ⇒ `version`    (the new memory is a newer version).
 *   - `same`      ⇒ `none`       (a dedup the reinforce path owns, not a contradiction).
 *   - `ambiguous` ⇒ `ambiguous`  (surface an operator diff; never silently mutate).
 */
export function decideContradiction(
  input: ContradictionDecisionInput,
): ContradictionDecision {
  const { nearest, stance, thresholds } = input;

  if (nearest === null || nearest.score < thresholds.similarityThreshold) {
    return {
      kind: 'none',
      reason: 'no_near_candidate',
      similarity: nearest?.score ?? 0,
    };
  }

  const base = {
    existingSegmentId: nearest.ownerId,
    similarity: nearest.score,
  };

  switch (stance) {
    case 'oppose':
      return { kind: 'supersede', reason: 'opposing_stance', ...base };
    case 'refine':
      return { kind: 'version', reason: 'refined_stance', ...base };
    case 'ambiguous':
      return { kind: 'ambiguous', reason: 'ambiguous_stance', ...base };
    case 'same':
    case null:
    default:
      return { kind: 'none', reason: 'same_stance_dedup', ...base };
  }
}
