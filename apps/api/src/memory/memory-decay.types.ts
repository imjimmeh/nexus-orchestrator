/**
 * Public type surface for the MemoryDecayReaperService.
 *
 * Splitting the types out of `memory-decay.reaper.ts` keeps the
 * service file focused on its implementation and lets the scheduler
 * and the follow-up processor (work item continuation) import the
 * contracts without pulling in the service's NestJS decorators and
 * side-effectful imports.
 */

import type { DecayValuePredicateMode } from './memory-decay.value-predicate.types';

/**
 * Result of a single reaper pass.
 *
 *   - `evaluated` counts the segments whose `effective_last_touch`
 *     (max(last_accessed_at, last_reinforced_at)) fell past the
 *     configured grace window — i.e. rows the reaper actually
 *     considered for decay. Exempted sources
 *     (see `MEMORY_DECAY_EXEMPT_SOURCES`) and recently-touched
 *     segments are NOT counted in `evaluated`.
 *   - `decayed` counts the segments whose `metadata_json.confidence`
 *     was actually decremented (i.e. the row survived the
 *     floor check). A row whose decayed confidence is below the
 *     floor contributes to `archived`, not `decayed`.
 *   - `archived` counts the segments whose `metadata_json.confidence`
 *     fell below the configured floor and therefore had their
 *     `archived_at` set.
 *   - `skipped` is true when the kill switch (`memory_decay_enabled`)
 *     is off. When `skipped` is true, the other counters are all
 *     zero and the reaper did not touch any row in the database.
 *   - `reason` is the human-readable reason the reaper skipped
 *     (e.g. `'disabled'`). Undefined for successful passes.
 */
export interface MemoryDecayRunSummary {
  evaluated: number;
  decayed: number;
  archived: number;
  skipped: boolean;
  reason?: string;
}

/**
 * Options for a single reaper pass.
 *
 *   - `now` overrides the wall-clock for deterministic tests. The
 *     reaper computes `effective_last_touch = max(last_accessed_at,
 *     last_reinforced_at)` and the days-past-grace window from this
 *     anchor. Defaults to `new Date()`.
 */
export interface MemoryDecayRunOptions {
  now?: Date;
}

/**
 * Resolved decay settings for a single reaper pass. Surfaced on log
 * lines so an operator can trace which values were active when the
 * reaper ran. Mirrors the `MemoryEvictionRunSummary.settings` shape
 * (consumed by the existing `MemoryMetricsService` log-line readers).
 */
export interface MemoryDecaySettings {
  enabled: boolean;
  graceDays: number;
  dailyRate: number;
  floor: number;
  /**
   * Usefulness-aware decay value predicate mode (EPIC-212 Phase-3
   * Task 2). `legacy` (default) leaves the reaper byte-identical to
   * Phase-2; `shadow` computes the value verdict + emits the
   * divergence event without mutating; `enforce` (Task 3) lets the
   * predicate drive archival. In Task 2 the apply side treats
   * `enforce` identically to `shadow`.
   */
  valuePredicateMode: DecayValuePredicateMode;
  /** Usefulness ratio at/above which the value predicate keeps a stale row. */
  usefulnessThreshold: number;
  /** Minimum votes before usefulness may drive a keep verdict. */
  usefulnessMinSamples: number;
  /**
   * Drift-anchored self-invalidation flag (EPIC-212 Phase-3 Task 4).
   * When `true`, a `drift_detected_at`-stamped row is treated as
   * decay-eligible even inside its grace window and its decay is
   * accelerated by {@link driftPenaltyMultiplier}. Default `false`
   * leaves drifted rows byte-identical to Phase-3 Task-3.
   */
  driftInvalidationEnabled: boolean;
  /** Factor a drifted row's effective `daysElapsed` is multiplied by. */
  driftPenaltyMultiplier: number;
}
