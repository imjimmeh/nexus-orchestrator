/**
 * Operator-tunable knobs for `PromotionGovernancePolicyService` (EPIC-212
 * Phase-2 Task 9).
 *
 * Two thresholds are system settings (re-read on every evaluation so an
 * operator can re-tune without a restart); the base auto-promotion floor is a
 * fixed constant that mirrors `LearningPromotionPolicyService`'s 0.5 floor so
 * the governance matrix and the existing promotion policy agree (defence in
 * depth — both must pass).
 */

export const GOVERNANCE_SETTING_KEYS = {
  agentPreferenceMinConfidence: 'governance_agent_preference_min_confidence',
  probationDays: 'governance_probation_days',
} as const;

/**
 * Base auto-promotion floor. Kept in sync with
 * `LearningPromotionPolicyService`'s `DEFAULT_MINIMUM_CONFIDENCE`; a `project`
 * fact auto-promotes only at/above this value. Not a system setting because it
 * is the same load-bearing floor the existing promotion policy enforces.
 */
export const GOVERNANCE_PROMOTION_CONFIDENCE_FLOOR = 0.5;

export const GOVERNANCE_SETTING_DEFAULTS = {
  agentPreferenceMinConfidence: 0.8,
  probationDays: 14,
} as const;

/**
 * `SYSTEM_SETTING_DEFAULTS` fragment — spread into the global registry so the
 * governance thresholds seed on a fresh DB with their canonical defaults and a
 * UI description.
 */
export const GOVERNANCE_SYSTEM_SETTING_DEFAULTS: Record<
  string,
  { value: unknown; description: string }
> = {
  [GOVERNANCE_SETTING_KEYS.agentPreferenceMinConfidence]: {
    value: GOVERNANCE_SETTING_DEFAULTS.agentPreferenceMinConfidence,
    description:
      'Stricter confidence floor a behavioural `agent_preference` learning must clear before it auto-promotes (provisional). Below this it requires a human/proposal path. `global` never auto-promotes at any confidence; skill routes are always a proposal.',
  },
  [GOVERNANCE_SETTING_KEYS.probationDays]: {
    value: GOVERNANCE_SETTING_DEFAULTS.probationDays,
    description:
      'Probation window (days) stamped as `probationUntil` on every auto-promoted `provisional` memory segment. Phase 3 adds the probation evaluator that confirms or reverts the segment when the window elapses.',
  },
};
