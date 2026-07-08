/**
 * Operator-tunable budget knobs for the retrospective drain (EPIC-212 Phase-2
 * Task 3).
 *
 * Every knob lives here as the canonical default and is seeded into
 * `SYSTEM_SETTING_DEFAULTS` (via {@link RETROSPECTIVE_DRAIN_SYSTEM_SETTING_DEFAULTS})
 * so a fresh database returns a sane value. The drain re-reads each key on every
 * tick (via `SystemSettingsService.get`) so an operator can re-tune cost without
 * restarting the app.
 *
 * The three budget caps are HARD limits:
 *   - `budgetPerWindow`  — max rows analyzed per windowed drain tick.
 *   - `bypassBudget`     — max immediate (`bypass`) analyses per window.
 *   - `interestFloor`    — below this gate score a row is `skipped` WITHOUT any
 *                          analyzer call (never spend an LLM on noise).
 *
 * The drain cron lives in `retrospective-drain.constants.ts`; its seed entry is
 * registered here alongside the budgets so all four Phase-2 drain settings land
 * in one fragment.
 */

import {
  RETROSPECTIVE_DRAIN_CRON_SETTING,
  RETROSPECTIVE_DRAIN_DEFAULT_CRON,
} from './retrospective-drain.constants';

export const RETROSPECTIVE_DRAIN_SETTING_KEYS = {
  budgetPerWindow: 'retrospective_drain_budget_per_window',
  bypassBudget: 'retrospective_bypass_budget',
  interestFloor: 'retrospective_interest_floor',
} as const;

export const RETROSPECTIVE_DRAIN_SETTING_DEFAULTS = {
  budgetPerWindow: 5,
  bypassBudget: 3,
  interestFloor: 0.4,
} as const;

/**
 * `SYSTEM_SETTING_DEFAULTS` fragment — spread into the global registry so each
 * drain knob (and the cron) is seeded with its canonical default and a UI
 * description.
 */
export const RETROSPECTIVE_DRAIN_SYSTEM_SETTING_DEFAULTS: Record<
  string,
  { value: unknown; description: string }
> = {
  [RETROSPECTIVE_DRAIN_SETTING_KEYS.budgetPerWindow]: {
    value: RETROSPECTIVE_DRAIN_SETTING_DEFAULTS.budgetPerWindow,
    description:
      'Maximum number of queued retrospective rows analyzed per windowed drain tick (hard cost cap). Highest-priority, highest-interest rows are claimed first; the remainder wait for the next tick.',
  },
  [RETROSPECTIVE_DRAIN_SETTING_KEYS.bypassBudget]: {
    value: RETROSPECTIVE_DRAIN_SETTING_DEFAULTS.bypassBudget,
    description:
      'Separate hard cap on immediate (bypass-priority) retrospective analyses per drain window. Once exhausted, further immediate-analysis requests are deferred to the windowed drain so a burst of high-signal failures cannot blow the budget.',
  },
  [RETROSPECTIVE_DRAIN_SETTING_KEYS.interestFloor]: {
    value: RETROSPECTIVE_DRAIN_SETTING_DEFAULTS.interestFloor,
    description:
      'Minimum gate interest score (0–1) a row must meet to be handed to the analyzer. Rows below this floor are marked `skipped` WITHOUT any LLM call — the noise filter that keeps the analyst cost-bounded.',
  },
  [RETROSPECTIVE_DRAIN_CRON_SETTING]: {
    value: RETROSPECTIVE_DRAIN_DEFAULT_CRON,
    description:
      'Cron expression (UTC) that drives the retrospective drain tick. The BullMQ scheduler reads this on startup and re-registers the repeatable job when an operator updates the setting. Default `0 * * * *` runs hourly at minute 0. Standard 5-field cron syntax is required.',
  },
};
