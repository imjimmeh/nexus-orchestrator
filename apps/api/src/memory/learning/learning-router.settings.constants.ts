/**
 * Operator-tunable knobs for `LearningRouterService` (EPIC-212 Phase-2 Task 8).
 *
 * Only the cross-scope `global` threshold is a system setting; the skill-match
 * floor reuses the Phase-1 `CANDIDATE_SIMILARITY_THRESHOLD_DEFAULT` so the
 * router and clusterer agree on what "near-duplicate" means (single source of
 * truth). The router re-reads the setting on every pass so an operator can
 * re-tune without a restart.
 */

export const LEARNING_ROUTER_SETTING_KEYS = {
  globalMinScopes: 'learning_router_global_min_scopes',
} as const;

export const LEARNING_ROUTER_SETTING_DEFAULTS = {
  globalMinScopes: 3,
} as const;

/**
 * `SYSTEM_SETTING_DEFAULTS` fragment — spread into the global registry so the
 * cross-scope threshold seeds with its canonical default and a UI description.
 */
export const LEARNING_ROUTER_SYSTEM_SETTING_DEFAULTS: Record<
  string,
  { value: unknown; description: string }
> = {
  [LEARNING_ROUTER_SETTING_KEYS.globalMinScopes]: {
    value: LEARNING_ROUTER_SETTING_DEFAULTS.globalMinScopes,
    description:
      'Distinct-scope count a lesson must recur across before the learning router routes it to `global` scope. Below this it stays `project` (or, at exactly one below, is treated as a low-confidence tie). Cross-scope truth is the only path to global; nothing global ever auto-promotes (Task 9 governance).',
  },
};
