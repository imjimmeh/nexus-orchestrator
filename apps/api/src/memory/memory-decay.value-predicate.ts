/**
 * Pure usefulness-aware decay value predicate (EPIC-212 Phase-3
 * Task 2). Mirrors the `applyDecay` separation in
 * `memory-decay.reaper.ts`: all decision logic is pure and
 * I/O-free so it can be exhaustively unit-tested and reused by the
 * Phase-3 Task-3 eviction parity without touching a database.
 *
 * The predicate NEVER removes protection — it only ADDS keep
 * reasons on top of the legacy confidence-floor behaviour. A row
 * the predicate does not keep falls through to today's decay math
 * unchanged. The `MEMORY_DECAY_EXEMPT_SOURCES` allowlist remains a
 * hard floor enforced upstream in the reaper; the predicate is the
 * value-aware layer above it.
 *
 * EPIC-212 Phase-3 Task 3 promotes this predicate to the SHARED
 * memory-retention predicate consulted by BOTH the decay reaper
 * (`decay_value_predicate_mode=enforce`) and the eviction reaper
 * (`eviction_value_predicate_enabled=true`). The canonical entry
 * point is {@link decideMemoryRetentionKeep}.
 */

import type { MemorySegment } from './database/entities/memory-segment.entity';
import type {
  DecayKeepInput,
  DecayKeepThresholds,
  DecayKeepVerdict,
  DecayShadowCandidate,
  DecayShadowComparison,
  DecayValuePredicateMode,
  SegmentUsefulness,
} from './memory-decay.value-predicate.types';

export type {
  DecayKeepInput,
  DecayKeepThresholds,
  DecayKeepVerdict,
  DecayShadowCandidate,
  DecayShadowComparison,
  DecayValuePredicateMode,
  SegmentUsefulness,
} from './memory-decay.value-predicate.types';

/** Reason codes surfaced on a {@link DecayKeepVerdict}. */
export const DECAY_KEEP_REASONS = {
  pinned: 'pinned',
  injectedAndHelped: 'injected_and_helped',
  useful: 'useful',
  noVotes: 'no_votes',
  insufficientSamples: 'insufficient_samples',
  lowUsefulness: 'low_usefulness',
} as const;

/**
 * Decide whether the value predicate keeps a decay candidate.
 *
 * Keep when:
 *   1. `pinned` — an absolute operator override.
 *   2. `injectedAndHelped` — the segment demonstrably changed
 *      behaviour / contributed to a convergence success.
 *   3. `usefulness >= usefulnessThreshold` AND
 *      `sampleSize >= minSamples` — enough votes, high enough ratio.
 *
 * Otherwise the predicate does NOT keep the row (it falls back to
 * the legacy confidence-decay path):
 *   - a never-voted row (`usefulness === null`, `sampleSize === 0`)
 *     returns `keep:false` with reason `no_votes` — it is never
 *     archived BY the value predicate, but is left to the legacy
 *     confidence math exactly as today.
 *   - a row with votes but `sampleSize < minSamples` returns
 *     `insufficient_samples`.
 *   - a row with enough votes but `usefulness < usefulnessThreshold`
 *     returns `low_usefulness`.
 *
 * The function is total and never throws; out-of-band numeric
 * inputs are compared as-is (the caller coerces thresholds).
 */
export function decideMemoryRetentionKeep(
  input: DecayKeepInput,
  thresholds: DecayKeepThresholds,
): DecayKeepVerdict {
  if (input.pinned) {
    return { keep: true, reason: DECAY_KEEP_REASONS.pinned };
  }
  if (input.injectedAndHelped) {
    return { keep: true, reason: DECAY_KEEP_REASONS.injectedAndHelped };
  }
  if (input.usefulness === null || input.sampleSize === 0) {
    return { keep: false, reason: DECAY_KEEP_REASONS.noVotes };
  }
  if (input.sampleSize < thresholds.minSamples) {
    return { keep: false, reason: DECAY_KEEP_REASONS.insufficientSamples };
  }
  if (input.usefulness >= thresholds.usefulnessThreshold) {
    return { keep: true, reason: DECAY_KEEP_REASONS.useful };
  }
  return { keep: false, reason: DECAY_KEEP_REASONS.lowUsefulness };
}

/**
 * Resolve the shared memory-retention verdict for a candidate row
 * from the batch usefulness map. Pure — builds the
 * {@link DecayKeepInput} (defaulting a never-voted row to
 * `{ usefulness: null, sampleSize: 0 }`) and delegates to
 * {@link decideMemoryRetentionKeep}.
 *
 * This is the single seam BOTH lifecycle reapers call: the decay
 * reaper consults it for the `enforce` short-circuit and the shadow
 * comparison; the eviction reaper consults it before deleting an
 * idle low-access row. Computing the verdict once per candidate
 * keeps the two reapers DRY.
 *
 * `injectedAndHelped` is `false` for now: the behaviour-change
 * signal is a Phase-3 Task-6 carry-forward. A never-voted row yields
 * a `no_votes` keep:false verdict, so the value predicate never
 * protects it — it falls back to today's behaviour exactly as before.
 */
export function evaluateRetentionFromMap(
  candidate: Pick<MemorySegment, 'id' | 'pinned' | 'source'>,
  usefulnessById: Map<string, SegmentUsefulness>,
  thresholds: DecayKeepThresholds,
): DecayKeepVerdict {
  const vote: SegmentUsefulness = usefulnessById.get(candidate.id) ?? {
    usefulness: null,
    sampleSize: 0,
  };
  return decideMemoryRetentionKeep(
    {
      pinned: candidate.pinned,
      usefulness: vote.usefulness,
      sampleSize: vote.sampleSize,
      injectedAndHelped: false,
      source: candidate.source,
    },
    thresholds,
  );
}

/**
 * Build a single {@link DecayShadowCandidate} from a candidate row,
 * the legacy archive decision (did the confidence-floor path archive
 * this row?), and the precomputed retention verdict. Pure — combines
 * the two so the shadow comparison can report the divergence.
 *
 * The `legacyArchive` flag MUST reflect what the legacy
 * confidence-floor path would do, NOT the post-enforce applied
 * result — in `enforce` mode the reaper preserves a kept row whose
 * legacy classification was `archived`, and the shadow comparison
 * still reports that legacy/value divergence honestly.
 */
export function buildShadowCandidate(
  candidate: Pick<MemorySegment, 'id'>,
  legacyArchive: boolean,
  verdict: DecayKeepVerdict,
): DecayShadowCandidate {
  return {
    id: candidate.id,
    legacyArchive,
    valueKeep: verdict.keep,
    reason: verdict.reason,
  };
}

/**
 * Roll a set of per-candidate shadow decisions into the
 * `memory.decay.shadow.v1` comparison payload.
 *
 * The value-aware archive set is, by construction, a SUBSET of the
 * legacy archive set: the predicate only adds keep protection on
 * top of the confidence floor, so a row is archived under the new
 * predicate only when legacy already archived it AND the predicate
 * does not keep it (`legacyArchive && !valueKeep`).
 *
 * The divergence the shadow window is watching for is
 * `keptByValueArchivedByLegacy` — rows legacy archived that the
 * value predicate would preserve (the documented "never archive
 * useful-but-unread" risk). The mirror set
 * `archivedByValueKeptByLegacy` is empty by construction in this
 * add-only design and is surfaced so the consumer can assert the
 * invariant explicitly.
 */
export function computeDecayShadowComparison(
  mode: DecayValuePredicateMode,
  candidates: readonly DecayShadowCandidate[],
): DecayShadowComparison {
  const keptByValueArchivedByLegacy: string[] = [];
  const archivedByValueKeptByLegacy: string[] = [];
  let legacyArchiveCount = 0;
  let valuePredicateArchiveCount = 0;

  for (const candidate of candidates) {
    const valueArchive = candidate.legacyArchive && !candidate.valueKeep;
    if (candidate.legacyArchive) {
      legacyArchiveCount += 1;
    }
    if (valueArchive) {
      valuePredicateArchiveCount += 1;
    }
    if (candidate.legacyArchive && candidate.valueKeep) {
      keptByValueArchivedByLegacy.push(candidate.id);
    }
    if (valueArchive && !candidate.legacyArchive) {
      archivedByValueKeptByLegacy.push(candidate.id);
    }
  }

  return {
    mode,
    evaluated: candidates.length,
    legacyArchiveCount,
    valuePredicateArchiveCount,
    keptByValueArchivedByLegacy,
    archivedByValueKeptByLegacy,
  };
}
