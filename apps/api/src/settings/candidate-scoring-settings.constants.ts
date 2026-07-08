/**
 * System-setting keys, defaults, and coercion helpers for the
 * `CandidateScoringService` introduced in EPIC-212 Phase 1.
 *
 * The weights are intentionally conservative hand-set priors.
 * Phase 3 will tune them against empirical promotion success data.
 *
 * All keys follow the `candidate_scoring_*` namespace so operators can
 * filter them in the settings UI.
 */

// ── Setting keys ─────────────────────────────────────────────────────────────

/** Log-recurrence weight in the logistic score formula. */
export const CANDIDATE_SCORING_W_RECURRENCE =
  'candidate_scoring_w_recurrence' as const;

/** Source-quality confidence weight in the logistic score formula. */
export const CANDIDATE_SCORING_W_SOURCE_QUALITY =
  'candidate_scoring_w_source_quality' as const;

/** Recency-decay weight in the logistic score formula. */
export const CANDIDATE_SCORING_W_RECENCY =
  'candidate_scoring_w_recency' as const;

/** Stage-diversity weight in the logistic score formula. */
export const CANDIDATE_SCORING_W_DIVERSITY =
  'candidate_scoring_w_diversity' as const;

/**
 * Logistic bias term (β). Negative so a candidate whose signals are all at
 * their neutral mid-point scores below 0.5 by default, requiring a
 * meaningful combination of signals to exceed the promotion threshold.
 */
export const CANDIDATE_SCORING_BETA = 'candidate_scoring_beta' as const;

/**
 * Decay constant (λ) for the exponential recency-decay formula:
 *   recency_decay = exp(-λ · Δdays)
 *
 * At λ = 0.05 a 7-day-old candidate retains ~70 % weight; a 30-day-old
 * candidate retains ~22 % weight.
 */
export const CANDIDATE_SCORING_LAMBDA = 'candidate_scoring_lambda' as const;

/**
 * The number of distinct stages beyond which additional diversity yields
 * no further score benefit (linear cap before normalisation).
 */
export const CANDIDATE_SCORING_DIVERSITY_CAP =
  'candidate_scoring_diversity_cap' as const;

// ── Defaults ─────────────────────────────────────────────────────────────────

export const CANDIDATE_SCORING_W_RECURRENCE_DEFAULT = 0.4;
export const CANDIDATE_SCORING_W_SOURCE_QUALITY_DEFAULT = 0.8;
export const CANDIDATE_SCORING_W_RECENCY_DEFAULT = 0.6;
export const CANDIDATE_SCORING_W_DIVERSITY_DEFAULT = 0.3;
export const CANDIDATE_SCORING_BETA_DEFAULT = -1.0;
export const CANDIDATE_SCORING_LAMBDA_DEFAULT = 0.05;
export const CANDIDATE_SCORING_DIVERSITY_CAP_DEFAULT = 5;

// ── Source-quality priors by candidate_type ───────────────────────────────────

/**
 * Per-`candidate_type` source-quality confidence priors.
 *
 * These are canonical write-time defaults; the `CandidateScoringService`
 * overwrites them on every scoring pass to keep the field consistent
 * regardless of how the row was originally created.
 *
 * | Candidate type     | Prior | Rationale                              |
 * |--------------------|-------|----------------------------------------|
 * | agent_capture      | 0.9   | Deliberate, structured agent output    |
 * | struggle           | 0.8   | Evidence-backed struggle→recovery pair |
 * | runtime_learning   | 0.5   | Mid-signal automated observation       |
 * | (any other)        | 0.5   | Unknown provenance — neutral prior     |
 * | templated/low-signal | 0.2 | Content-free; template matched         |
 *
 * The "templated/low-signal" row is NOT in this map; the classifier result
 * drives the override in `CandidateScoringService.computeSourceQuality`.
 */
export const SOURCE_QUALITY_PRIORS: Readonly<Record<string, number>> = {
  agent_capture: 0.9,
  struggle: 0.8,
  runtime_learning: 0.5,
};

/** Prior for any `candidate_type` not listed in {@link SOURCE_QUALITY_PRIORS}. */
export const SOURCE_QUALITY_DEFAULT_PRIOR = 0.5;

/**
 * Prior override when `TemplateNoiseClassifier` classifies the candidate
 * as low-signal (isLowSignal = true).
 *
 * Low-signal classification always wins, regardless of `candidate_type`.
 */
export const SOURCE_QUALITY_LOW_SIGNAL_PRIOR = 0.2;

// ── Coercion helpers ──────────────────────────────────────────────────────────

/**
 * Coerce any DB value to a finite non-negative number, returning `fallback`
 * if the value is not valid. Used to sanitise all weight/lambda/cap reads.
 */
export function coerceNonNegativeNumber(
  value: unknown,
  fallback: number,
): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value;
  }
  return fallback;
}
