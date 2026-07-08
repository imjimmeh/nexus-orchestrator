/**
 * System-setting keys, defaults, and non-throwing coercers for the
 * `MemoryContradictionService` (EPIC-212 Phase-3 Task 5).
 *
 * Three operator-tunable knobs:
 *   - `memory_contradiction_enabled` (boolean, default `false`) — the master
 *     switch. While off, the service is a no-op: the promotion path is
 *     byte-identical to the pre-Phase-3 behaviour (no vector search, no event,
 *     no mutation).
 *   - `memory_contradiction_mode` (`shadow` | `enforce`, default `shadow`) —
 *     `shadow` emits the `memory.contradiction.detected.v1` event but never
 *     mutates; `enforce` applies the supersede / version links (archive-only —
 *     the loser is preserved for audit, never hard-deleted).
 *   - `memory_contradiction_similarity_threshold` (0–1, default `0.85`) — the
 *     vector-near threshold at/above which a neighbour is a contradiction
 *     candidate. Defaults to the dedup `candidate_similarity_threshold`.
 *
 * Mirrors the fragment convention in `memory-decay-value.settings.constants.ts`
 * and `governance.settings.constants.ts`: `as const` keys, hardcoded defaults,
 * non-throwing `coerceX` helpers, and a `SYSTEM_SETTING_DEFAULTS` fragment
 * spread into the global registry.
 */

import type { ContradictionMode } from '../memory/learning/memory-contradiction.types';

export const MEMORY_CONTRADICTION_ENABLED_SETTING =
  'memory_contradiction_enabled' as const;

export const MEMORY_CONTRADICTION_MODE_SETTING =
  'memory_contradiction_mode' as const;

export const MEMORY_CONTRADICTION_SIMILARITY_THRESHOLD_SETTING =
  'memory_contradiction_similarity_threshold' as const;

/** Allowed `memory_contradiction_mode` values, in escalation order. */
export const MEMORY_CONTRADICTION_MODES: readonly ContradictionMode[] = [
  'shadow',
  'enforce',
];

/** Default master switch — off (byte-identical promotion path). */
export const MEMORY_CONTRADICTION_ENABLED_DEFAULT = false;

/** Default mode — emit-only, never mutate. */
export const MEMORY_CONTRADICTION_MODE_DEFAULT: ContradictionMode = 'shadow';

/** Hardcoded default similarity threshold (matches the dedup threshold). */
export const MEMORY_CONTRADICTION_SIMILARITY_THRESHOLD_DEFAULT = 0.85;

/**
 * Coerce the `memory_contradiction_enabled` setting into a boolean. Accepts a
 * real boolean, the string forms `"true"`/`"false"`/`"1"`/`"0"`/`"yes"`/`"no"`,
 * and the numbers `0`/`1`. Any other value falls back to the default so a UI
 * typo can never silently enable the contradiction machinery. Non-throwing.
 */
export function coerceMemoryContradictionEnabled(
  value: unknown,
  fallback: boolean = MEMORY_CONTRADICTION_ENABLED_DEFAULT,
): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    if (trimmed === 'true' || trimmed === '1' || trimmed === 'yes') {
      return true;
    }
    if (trimmed === 'false' || trimmed === '0' || trimmed === 'no') {
      return false;
    }
    return fallback;
  }
  if (typeof value === 'number') {
    if (value === 1) {
      return true;
    }
    if (value === 0) {
      return false;
    }
  }
  return fallback;
}

/**
 * Coerce the `memory_contradiction_mode` setting into a valid
 * {@link ContradictionMode}. Case-insensitive trimmed string match; any other
 * value falls back to the supplied fallback (or the hardcoded `shadow`
 * default). Non-throwing so a UI typo can never enable enforce-mode mutation.
 */
export function coerceMemoryContradictionMode(
  value: unknown,
  fallback: ContradictionMode = MEMORY_CONTRADICTION_MODE_DEFAULT,
): ContradictionMode {
  if (typeof value === 'string') {
    const normalised = value.trim().toLowerCase();
    const match = MEMORY_CONTRADICTION_MODES.find(
      (mode) => mode === normalised,
    );
    if (match !== undefined) {
      return match;
    }
  }
  return fallback;
}

/**
 * Coerce the `memory_contradiction_similarity_threshold` setting into a number
 * in `[0, 1]`. Out-of-range / non-numeric values fall back to the default so an
 * operator typo cannot make every near-neighbour a contradiction (threshold 0)
 * or none (threshold > 1).
 */
export function coerceMemoryContradictionSimilarityThreshold(
  value: unknown,
  fallback: number = MEMORY_CONTRADICTION_SIMILARITY_THRESHOLD_DEFAULT,
): number {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim().length > 0
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 1) {
    return fallback;
  }
  return numeric;
}

/**
 * `SYSTEM_SETTING_DEFAULTS` fragment — spread into the global registry so the
 * contradiction knobs seed on a fresh DB with their canonical defaults and
 * operator-facing descriptions.
 */
export const MEMORY_CONTRADICTION_SYSTEM_SETTING_DEFAULTS: Record<
  string,
  { value: unknown; description: string }
> = {
  [MEMORY_CONTRADICTION_ENABLED_SETTING]: {
    value: MEMORY_CONTRADICTION_ENABLED_DEFAULT,
    description:
      'Master switch (default false) for the MemoryContradictionService (EPIC-212 Phase-3). While off, an auto-promotion never runs the contradiction vector search and the promotion path is byte-identical to Phase-2. When on, a newly-promoted memory that contradicts an existing in-scope memory supersedes it (enforce mode) or surfaces a memory.contradiction.detected.v1 event (shadow mode).',
  },
  [MEMORY_CONTRADICTION_MODE_SETTING]: {
    value: MEMORY_CONTRADICTION_MODE_DEFAULT,
    description:
      'Apply mode for the MemoryContradictionService. `shadow` (default) emits the memory.contradiction.detected.v1 event but never mutates the DB, so an operator can compare the would-supersede set against reality before flipping `enforce`. `enforce` links the supersede/version pair and archives the superseded loser (archive-only — never hard-deleted, recoverable).',
  },
  [MEMORY_CONTRADICTION_SIMILARITY_THRESHOLD_SETTING]: {
    value: MEMORY_CONTRADICTION_SIMILARITY_THRESHOLD_DEFAULT,
    description:
      'Vector-near similarity threshold (0–1, default 0.85) at/above which an existing in-scope memory segment is a contradiction candidate for a newly-promoted memory. Mirrors the dedup candidate_similarity_threshold: a near neighbour with an OPPOSING stance is a contradiction (supersede), a refined stance is a new version, and a same stance is a dedup (no contradiction).',
  },
};
