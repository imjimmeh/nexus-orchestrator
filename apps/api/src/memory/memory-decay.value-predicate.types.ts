/**
 * Public type surface for the usefulness-aware decay value predicate
 * (EPIC-212 Phase-3 Task 2).
 *
 * Splitting the contracts out of `memory-decay.value-predicate.ts`
 * keeps the pure-logic file focused and lets the reaper import the
 * shapes without pulling in any I/O. The exported interfaces /
 * unions live here so the `no-restricted-syntax` rule that forbids
 * exported interfaces in non-`*.types.ts` files is satisfied.
 */

/**
 * Operating mode for the decay value predicate.
 *
 *   - `legacy`  — the predicate is inert. The reaper applies the
 *     exempt-by-source + confidence-floor behaviour unchanged. No
 *     usefulness batch is computed, no shadow event is emitted.
 *   - `shadow`  — the reaper applies the OLD (legacy) behaviour to
 *     the DB byte-identically, but ALSO computes the value verdict
 *     per candidate and emits a `memory.decay.shadow.v1` event
 *     comparing the would-archive set under the new predicate
 *     against the legacy archive set. Zero behaviour change.
 *   - `enforce` — reserved for Phase-3 Task 3 (the predicate's
 *     `keep` verdict short-circuits archival). In THIS task the
 *     apply side treats `enforce` identically to `shadow` (compute
 *     + emit, never mutate differently).
 */
export type DecayValuePredicateMode = 'legacy' | 'shadow' | 'enforce';

/**
 * Per-candidate inputs to {@link decideMemoryRetentionKeep}.
 *
 *   - `pinned` — operator pin flag; an absolute keep short-circuit.
 *   - `usefulness` — the rolling-window usefulness ratio from
 *     `MemorySegmentFeedbackService`. `null` means "no votes yet"
 *     (distinct from `0`, which means "every vote so far was
 *     not-useful").
 *   - `sampleSize` — total vote count in the window (`0` when
 *     `usefulness` is `null`).
 *   - `injectedAndHelped` — whether the segment appears as a
 *     behaviour-change / convergence success. Carry-forward: Task 6
 *     wires the real signal; Task 2 always passes `false`.
 *   - `source` — the segment's coarse origin classification. The
 *     `MEMORY_DECAY_EXEMPT_SOURCES` allowlist is enforced upstream
 *     in the reaper (and the repository query), so the predicate
 *     never needs to re-check it; the field is carried for the
 *     Task-3 eviction-parity reuse and audit logging.
 */
export interface DecayKeepInput {
  pinned: boolean;
  usefulness: number | null;
  sampleSize: number;
  injectedAndHelped: boolean;
  source: string | null;
}

/**
 * Operator-tuned thresholds the value predicate compares against.
 *
 *   - `usefulnessThreshold` — usefulness ratio at/above which a
 *     stale row is kept by the value predicate.
 *   - `minSamples` — minimum votes before usefulness may drive a
 *     keep verdict.
 */
export interface DecayKeepThresholds {
  usefulnessThreshold: number;
  minSamples: number;
}

/**
 * Result of a single {@link decideMemoryRetentionKeep} evaluation.
 *
 *   - `keep` — when `true` the value predicate protects the row
 *     (in `enforce` mode this would short-circuit archival; in
 *     `shadow` mode it only feeds the divergence report).
 *   - `reason` — machine-readable rationale (`pinned`,
 *     `injected_and_helped`, `useful`, `no_votes`,
 *     `insufficient_samples`, `low_usefulness`).
 */
export interface DecayKeepVerdict {
  keep: boolean;
  reason: string;
}

/**
 * Per-segment usefulness verdict returned by the batch
 * `MemorySegmentFeedbackService.computeUsefulnessForSegments` call.
 * `usefulness === null` means "no votes yet" (distinct from `0`).
 */
export interface SegmentUsefulness {
  usefulness: number | null;
  sampleSize: number;
}

/**
 * One candidate's contribution to the shadow comparison. Combines
 * the legacy archive decision (did the existing confidence-floor
 * path archive this row?) with the value predicate's verdict.
 */
export interface DecayShadowCandidate {
  id: string;
  legacyArchive: boolean;
  valueKeep: boolean;
  reason: string;
}

/**
 * The shadow comparison emitted as the `memory.decay.shadow.v1`
 * payload. Documents the divergence between the legacy archive set
 * and the value-predicate-aware archive set WITHOUT mutating the DB.
 *
 *   - `legacyArchiveCount` — rows the legacy path archived.
 *   - `valuePredicateArchiveCount` — rows the value-aware predicate
 *     would archive (a subset of the legacy set: the predicate only
 *     ADDS protection, never archives beyond the confidence floor).
 *   - `keptByValueArchivedByLegacy` — the divergence that matters:
 *     rows the legacy path archived that the value predicate would
 *     KEEP (e.g. useful-but-stale lessons).
 *   - `archivedByValueKeptByLegacy` — rows the value predicate would
 *     archive that legacy kept. Structurally empty in the add-only
 *     shadow design; carried for forward-compat and as an explicit
 *     invariant the consumer can assert on.
 */
export interface DecayShadowComparison {
  mode: DecayValuePredicateMode;
  evaluated: number;
  legacyArchiveCount: number;
  valuePredicateArchiveCount: number;
  keptByValueArchivedByLegacy: string[];
  archivedByValueKeptByLegacy: string[];
}
