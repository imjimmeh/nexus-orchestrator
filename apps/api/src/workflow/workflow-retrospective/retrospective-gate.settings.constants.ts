/**
 * Operator-tunable weights and thresholds for the deterministic
 * `RetrospectiveGateService` (EPIC-212 Phase-2 Task 2).
 *
 * Every knob lives here as the canonical default and is seeded into
 * `SYSTEM_SETTING_DEFAULTS` so a fresh database returns a sane value. The gate
 * re-reads each key on every scoring pass (via `SystemSettingsService.get`) so
 * an operator can re-tune the interest model without restarting the app.
 *
 * Scoring model (all signals deterministic, zero LLM calls):
 *   - Recovered-struggle-on-success  → `struggleScore`        (high lane)
 *   - Anchored failure (real error)  → `anchoredFailureScore` (high lane)
 *   - Strong anchored failure        → `bypassScore`          (bypass lane)
 *   - Recognized non-ambiguous class → `recognizedFailureScore` (high lane)
 *   - Bare `ambiguous_failure`       → `ambiguousFloor`       (low lane — the
 *                                       pathology inversion: the old catch-all
 *                                       "highest-confidence" class now FLOORS)
 *   - Clean / trivial success        → `cleanSuccessScore`    (low lane)
 *
 * The four `*Threshold` knobs map a 0–1 score onto the priority lane.
 */

export const RETROSPECTIVE_GATE_SETTING_KEYS = {
  struggleScore: 'retrospective_gate_struggle_score',
  anchoredFailureScore: 'retrospective_gate_anchored_failure_score',
  recognizedFailureScore: 'retrospective_gate_recognized_failure_score',
  bypassScore: 'retrospective_gate_bypass_score',
  ambiguousFloor: 'retrospective_gate_ambiguous_floor',
  cleanSuccessScore: 'retrospective_gate_clean_success_score',
  bypassThreshold: 'retrospective_gate_bypass_threshold',
  highThreshold: 'retrospective_gate_high_threshold',
  normalThreshold: 'retrospective_gate_normal_threshold',
  bypassDistinctErrorCodes: 'retrospective_gate_bypass_distinct_error_codes',
  repeatedFailureThreshold: 'retrospective_gate_repeated_failure_threshold',
  minDurationSeconds: 'retrospective_gate_min_duration_seconds',
  maxDurationSeconds: 'retrospective_gate_max_duration_seconds',
} as const;

export const RETROSPECTIVE_GATE_SETTING_DEFAULTS = {
  struggleScore: 0.85,
  anchoredFailureScore: 0.75,
  recognizedFailureScore: 0.7,
  bypassScore: 0.92,
  ambiguousFloor: 0.1,
  cleanSuccessScore: 0.2,
  bypassThreshold: 0.9,
  highThreshold: 0.7,
  normalThreshold: 0.4,
  bypassDistinctErrorCodes: 2,
  repeatedFailureThreshold: 2,
  minDurationSeconds: 30,
  maxDurationSeconds: 7200,
} as const;

/**
 * `SYSTEM_SETTING_DEFAULTS` fragment — spread into the global registry so each
 * gate knob is seeded with its canonical default and a UI description.
 */
export const RETROSPECTIVE_GATE_SYSTEM_SETTING_DEFAULTS: Record<
  string,
  { value: unknown; description: string }
> = {
  [RETROSPECTIVE_GATE_SETTING_KEYS.struggleScore]: {
    value: RETROSPECTIVE_GATE_SETTING_DEFAULTS.struggleScore,
    description:
      'Interest score (0–1) the retrospective gate assigns to a completed run that recovered from a tool struggle. Highest-value signal — a working recovery procedure worth mining into a skill.',
  },
  [RETROSPECTIVE_GATE_SETTING_KEYS.anchoredFailureScore]: {
    value: RETROSPECTIVE_GATE_SETTING_DEFAULTS.anchoredFailureScore,
    description:
      'Interest score (0–1) for a failed run whose tool-execution ledger carries at least one real error_code (an anchored, diagnosable failure).',
  },
  [RETROSPECTIVE_GATE_SETTING_KEYS.recognizedFailureScore]: {
    value: RETROSPECTIVE_GATE_SETTING_DEFAULTS.recognizedFailureScore,
    description:
      'Interest score (0–1) for a failed run whose recorded classification is a recognized non-ambiguous class (e.g. dependency_missing) even without a tool error_code.',
  },
  [RETROSPECTIVE_GATE_SETTING_KEYS.bypassScore]: {
    value: RETROSPECTIVE_GATE_SETTING_DEFAULTS.bypassScore,
    description:
      'Interest score (0–1) for a strong anchored failure (multiple distinct error codes or a repeated failed command). At/above the bypass threshold this marks the run for immediate analysis.',
  },
  [RETROSPECTIVE_GATE_SETTING_KEYS.ambiguousFloor]: {
    value: RETROSPECTIVE_GATE_SETTING_DEFAULTS.ambiguousFloor,
    description:
      'Floor interest score (0–1) for a bare ambiguous_failure with no anchored error code. Inverts the historic pathology where the catch-all ambiguous_failure class was treated as highest-confidence.',
  },
  [RETROSPECTIVE_GATE_SETTING_KEYS.cleanSuccessScore]: {
    value: RETROSPECTIVE_GATE_SETTING_DEFAULTS.cleanSuccessScore,
    description:
      'Interest score (0–1) for a clean or trivial successful run with no struggle signal. Low by design — uneventful successes are rarely worth an LLM.',
  },
  [RETROSPECTIVE_GATE_SETTING_KEYS.bypassThreshold]: {
    value: RETROSPECTIVE_GATE_SETTING_DEFAULTS.bypassThreshold,
    description:
      'Score (0–1) at/above which the gate assigns the bypass priority lane (immediate analysis outside the drain window).',
  },
  [RETROSPECTIVE_GATE_SETTING_KEYS.highThreshold]: {
    value: RETROSPECTIVE_GATE_SETTING_DEFAULTS.highThreshold,
    description:
      'Score (0–1) at/above which the gate assigns the high priority lane.',
  },
  [RETROSPECTIVE_GATE_SETTING_KEYS.normalThreshold]: {
    value: RETROSPECTIVE_GATE_SETTING_DEFAULTS.normalThreshold,
    description:
      'Score (0–1) at/above which the gate assigns the normal priority lane; below it the run is low priority.',
  },
  [RETROSPECTIVE_GATE_SETTING_KEYS.bypassDistinctErrorCodes]: {
    value: RETROSPECTIVE_GATE_SETTING_DEFAULTS.bypassDistinctErrorCodes,
    description:
      "Number of distinct error codes among a failed run's tool failures that escalates an anchored failure to the bypass lane.",
  },
  [RETROSPECTIVE_GATE_SETTING_KEYS.repeatedFailureThreshold]: {
    value: RETROSPECTIVE_GATE_SETTING_DEFAULTS.repeatedFailureThreshold,
    description:
      'Number of identical failed tool calls (same payload) that escalates an anchored failure to the bypass lane.',
  },
  [RETROSPECTIVE_GATE_SETTING_KEYS.minDurationSeconds]: {
    value: RETROSPECTIVE_GATE_SETTING_DEFAULTS.minDurationSeconds,
    description:
      'Lower duration bound (seconds) mirroring the success listener. A successful run whose tool-activity span is shorter is treated as trivial.',
  },
  [RETROSPECTIVE_GATE_SETTING_KEYS.maxDurationSeconds]: {
    value: RETROSPECTIVE_GATE_SETTING_DEFAULTS.maxDurationSeconds,
    description:
      'Upper duration bound (seconds) mirroring the success listener. A successful run whose tool-activity span is longer is treated as a duration outlier.',
  },
};
