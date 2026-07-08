/**
 * Pure (I/O-free) classification helpers for the
 * `MemoryDecayReaperService`.
 *
 * Extracting the legacy confidence-floor decision logic out of the
 * reaper keeps the service file under its `max-lines` budget and lets
 * the EPIC-212 Phase-3 Task-3 `enforce` short-circuit reason about
 * "what would legacy do?" without touching the database. Every export
 * here is a pure function — no NestJS, no repository, no settings I/O.
 */

import type { MemorySegment } from './database/entities/memory-segment.entity';
import { readConfidence } from './database/memory-segment.helpers';
import type { MemoryDecaySettings } from './memory-decay.types';
import { MEMORY_DECAY_EXEMPT_SOURCES } from './memory-decay.constants';
import type { DecayClassification } from './memory-decay.classify.types';

export type { DecayClassification } from './memory-decay.classify.types';

/** One day expressed in milliseconds — the reaper's grace/rate unit. */
export const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Classify a candidate row under the legacy confidence-floor decay
 * rules WITHOUT any I/O. The rules read top-to-bottom in source
 * order, mirroring the pre-Task-3 `evaluateCandidate` body so the
 * `legacy`/`shadow` mutation behaviour is byte-identical:
 *
 *   1. Exempt source (belt-and-suspenders over the repository
 *      filter) → `skipped`. This is the `MEMORY_DECAY_EXEMPT_SOURCES`
 *      hard floor enforced in ALL modes — `enforce` only ever ADDS
 *      keep protection on top of it.
 *   2. `effective_last_touch` null (never touched / reinforced) →
 *      `skipped`.
 *   3. Inside the grace window → `skipped`.
 *   4. No `metadata_json.confidence` to decay → `skipped`.
 *   5. Decayed confidence below the floor → `archived`; otherwise
 *      → `decayed`.
 *
 * EPIC-212 Phase-3 Task 4: when `settings.driftInvalidationEnabled` is
 * on AND the candidate carries a `drift_detected_at` stamp, the in-grace
 * skip (step 3) is bypassed and the effective `daysElapsed` is the full
 * days-since-touch multiplied by `settings.driftPenaltyMultiplier`, so
 * the drifted fact decays faster. The exempt-source hard floor (step 1)
 * and every other skip remain in force; a non-drifted row (or the flag
 * off) is classified byte-identically to the pre-Task-4 behaviour.
 */
export function classifyDecay(
  candidate: MemorySegment,
  settings: MemoryDecaySettings,
  now: Date,
): DecayClassification {
  if (
    candidate.source !== null &&
    MEMORY_DECAY_EXEMPT_SOURCES.has(candidate.source)
  ) {
    return { outcome: 'skipped' };
  }

  const effectiveLastTouch = effectiveTouch(candidate);
  if (effectiveLastTouch === null) {
    return { outcome: 'skipped' };
  }

  const daysSinceTouch = Math.floor(
    (now.getTime() - effectiveLastTouch.getTime()) / MS_PER_DAY,
  );

  const driftAccelerated =
    settings.driftInvalidationEnabled && candidate.drift_detected_at !== null;

  if (!driftAccelerated && daysSinceTouch <= settings.graceDays) {
    return { outcome: 'skipped' };
  }

  const daysElapsed = driftAccelerated
    ? Math.max(0, daysSinceTouch) * settings.driftPenaltyMultiplier
    : daysSinceTouch - settings.graceDays;
  const currentConfidence = readConfidence(candidate);
  if (currentConfidence === null) {
    return { outcome: 'skipped' };
  }

  const decayed = applyDecay(
    currentConfidence,
    settings.dailyRate,
    daysElapsed,
  );
  if (decayed < settings.floor) {
    return { outcome: 'archived', decayedConfidence: decayed };
  }
  return { outcome: 'decayed', decayedConfidence: decayed };
}

/**
 * Compute a segment's `effective_last_touch` —
 * `max(last_accessed_at, last_reinforced_at)`. The decay reaper
 * uses this composite timestamp as the "real" last-touch anchor
 * so frequently-consumed segments stay fresh and avoid spurious
 * decay. A `null` value for either column is treated as
 * "no-data" (i.e. contributes `-Infinity` to the max); if both
 * columns are `null` the result is `null` and the reaper treats
 * the row as ineligible.
 */
export function effectiveTouch(segment: MemorySegment): Date | null {
  const accessed = segment.last_accessed_at;
  const reinforced = segment.last_reinforced_at;
  if (accessed === null && reinforced === null) {
    return null;
  }
  if (accessed === null) {
    return reinforced;
  }
  if (reinforced === null) {
    return accessed;
  }
  return accessed.getTime() >= reinforced.getTime() ? accessed : reinforced;
}

/**
 * Apply the per-day subtractive decay to a confidence value. The
 * math is the spec's contract: `confidence = max(0, floor((confidence
 * - daily_rate * days_elapsed) * 100) / 100)`. Rounding to 2 decimal
 * places keeps the on-disk value stable and prevents float drift
 * (e.g. `0.5 - 0.01 = 0.4899999999999999`).
 *
 * Sanity check (from the work item):
 *   `confidence=0.5, daily_rate=0.01, days_elapsed=1`
 *   → `(0.5 - 0.01 * 1) * 100 = 49`
 *   → `floor(49) = 49`
 *   → `49 / 100 = 0.49`
 */
export function applyDecay(
  confidence: number,
  dailyRate: number,
  daysElapsed: number,
): number {
  const raw = confidence - dailyRate * daysElapsed;
  const rounded = Math.floor(raw * 100) / 100;
  if (!Number.isFinite(rounded)) {
    return 0;
  }
  return Math.max(0, rounded);
}
