/**
 * System-setting keys, defaults, and non-throwing coercers for the
 * weekly bounded weight-tuner (EPIC-212 Phase-3 Task 9).
 *
 * Four operator-tunable knobs:
 *   - `feedback_weight_tuner_enabled` (default `false`) — master switch.
 *     When `false` the weekly pass is a no-op BEFORE any DB query (zero
 *     overhead); the hand-set Phase-1 `candidate_scoring_*` weights are
 *     never touched.
 *   - `feedback_weight_tuner_max_delta` (> 0, default `0.1`) — per-run clamp
 *     on each scoring-weight change. No single weight moves more than this
 *     bound per run, so a noisy retrain can never swing a weight wildly.
 *   - `feedback_weight_tuner_min_samples` (>= 1, default `50`) — minimum
 *     labelled samples before a retune is applied. Below the floor the pass
 *     writes a `reason='insufficient_samples'` history row and applies
 *     nothing.
 *   - `feedback_weight_tuner_cron` (default `0 4 * * 0`) — weekly schedule
 *     (Sunday 04:00 UTC). Read by the scheduler, not coerced here (the
 *     scheduler normalises it via `normaliseCronExpression`).
 *
 * Mirrors the fragment convention in
 * `memory-probation.settings.constants.ts` (`as const` keys, hardcoded
 * defaults, non-throwing `coerceX` helpers, and a `SYSTEM_SETTING_DEFAULTS`
 * fragment spread into the global registry so the knobs seed on a fresh DB).
 */

export const FEEDBACK_WEIGHT_TUNER_ENABLED_SETTING =
  'feedback_weight_tuner_enabled' as const;

export const FEEDBACK_WEIGHT_TUNER_MAX_DELTA_SETTING =
  'feedback_weight_tuner_max_delta' as const;

export const FEEDBACK_WEIGHT_TUNER_MIN_SAMPLES_SETTING =
  'feedback_weight_tuner_min_samples' as const;

export const FEEDBACK_WEIGHT_TUNER_CRON_SETTING =
  'feedback_weight_tuner_cron' as const;

/** Default for `feedback_weight_tuner_enabled` — off (Phase-1 weights untouched). */
export const FEEDBACK_WEIGHT_TUNER_ENABLED_DEFAULT = false;

/** Default per-run clamp on each scoring-weight change. */
export const FEEDBACK_WEIGHT_TUNER_MAX_DELTA_DEFAULT = 0.1;

/** Default minimum labelled samples before a retune is applied. */
export const FEEDBACK_WEIGHT_TUNER_MIN_SAMPLES_DEFAULT = 50;

/** Default weekly cron — Sunday 04:00 UTC. */
export const FEEDBACK_WEIGHT_TUNER_DEFAULT_CRON = '0 4 * * 0';

/**
 * Coerce the `feedback_weight_tuner_enabled` setting into a boolean. Accepts
 * a real boolean, the string forms `"true"`/`"false"`/`"1"`/`"0"`/`"yes"`/
 * `"no"`, and the numbers `0`/`1`. Any other value falls back to the default
 * so a UI typo can never silently enable the tuner. Non-throwing by design.
 */
export function coerceFeedbackWeightTunerEnabled(
  value: unknown,
  fallback: boolean = FEEDBACK_WEIGHT_TUNER_ENABLED_DEFAULT,
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
 * Coerce the `feedback_weight_tuner_max_delta` setting into a strictly
 * positive, finite number. A non-positive or non-numeric value would either
 * freeze the tuner (delta = 0) or remove the safety clamp entirely, so such
 * values fall back to the default.
 */
export function coerceFeedbackWeightTunerMaxDelta(
  value: unknown,
  fallback: number = FEEDBACK_WEIGHT_TUNER_MAX_DELTA_DEFAULT,
): number {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim().length > 0
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback;
  }
  return numeric;
}

/**
 * Coerce the `feedback_weight_tuner_min_samples` setting into a positive
 * integer (>= 1). A floor below 1 would let a single labelled sample drive a
 * full retune, so values below 1 (and non-numeric values) fall back to the
 * default.
 */
export function coerceFeedbackWeightTunerMinSamples(
  value: unknown,
  fallback: number = FEEDBACK_WEIGHT_TUNER_MIN_SAMPLES_DEFAULT,
): number {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim().length > 0
        ? Number.parseInt(value, 10)
        : Number.NaN;

  if (!Number.isFinite(numeric) || numeric < 1) {
    return fallback;
  }
  return Math.floor(numeric);
}

/**
 * `SYSTEM_SETTING_DEFAULTS` fragment — spread into the global registry so the
 * weekly bounded weight-tuner knobs (EPIC-212 Phase-3 Task 9) seed on a fresh
 * DB with their canonical defaults and operator-facing descriptions. The tuner
 * is inert by default: while `feedback_weight_tuner_enabled` is false the
 * weekly pass is a no-op before any DB query and the hand-set Phase-1
 * `candidate_scoring_*` weights are never touched.
 */
export const FEEDBACK_WEIGHT_TUNER_SYSTEM_SETTING_DEFAULTS: Record<
  string,
  { value: unknown; description: string }
> = {
  [FEEDBACK_WEIGHT_TUNER_ENABLED_SETTING]: {
    value: FEEDBACK_WEIGHT_TUNER_ENABLED_DEFAULT,
    description:
      'Master switch (default false) for the weekly bounded feedback weight-tuner (EPIC-212 Phase-3). While off the weekly pass is a no-op BEFORE any DB query and the hand-set Phase-1 candidate_scoring_* weights are left untouched. When on, the tuner retrains the candidate-scoring weights weekly via a bounded, versioned, reversible L2-regularised logistic regression over promoted+usefulness labels — every change is clamped, recorded in signal_weight_history, and reversible.',
  },
  [FEEDBACK_WEIGHT_TUNER_MAX_DELTA_SETTING]: {
    value: FEEDBACK_WEIGHT_TUNER_MAX_DELTA_DEFAULT,
    description:
      'Per-run clamp (> 0, default 0.1) on each candidate_scoring_* weight change applied by the weekly weight-tuner. No single weight moves more than this bound per run, so a noisy retrain can never swing a weight wildly. Bounding keeps the loop stable while it self-tunes.',
  },
  [FEEDBACK_WEIGHT_TUNER_MIN_SAMPLES_SETTING]: {
    value: FEEDBACK_WEIGHT_TUNER_MIN_SAMPLES_DEFAULT,
    description:
      'Minimum number of labelled samples (>= 1, default 50) required before the weekly weight-tuner applies a retune. Below this floor the pass writes a signal_weight_history row with reason=insufficient_samples and applies nothing, so a sparse-data window never mutates the scoring weights.',
  },
  [FEEDBACK_WEIGHT_TUNER_CRON_SETTING]: {
    value: FEEDBACK_WEIGHT_TUNER_DEFAULT_CRON,
    description:
      'Cron expression (UTC) that drives the weekly feedback weight-tuner pass. Default `0 4 * * 0` runs at 04:00 UTC every Sunday, off-peak for the orchestration cycles. The BullMQ scheduler reads this value on startup and re-registers the repeatable job when an operator updates the setting. Standard 5-field cron syntax is required.',
  },
};
