/**
 * System-setting keys, defaults, and Zod validation schemas for the
 * failure-threshold retrospective trigger
 * (work item `2ec2799b-b003-4f5d-bca4-d56d3ef601dd`,
 * short title "Add failure-threshold trigger settings schema
 * entries for count, window, and cooldown (closes OPEN_QUESTIONS
 * K2 + K4 + K5)").
 *
 * The failure-threshold trigger (the dedicated service that owns
 * the cyclic retrospective-decision path on the downstream
 * domain side) previously hardcoded its `FAILURE_THRESHOLD_COUNT`
 * env var
 * (with no window concept, no explicit cooldown-bypass flag, and
 * a non-deterministic `trigger_revision_marker`). This milestone
 * (M1) promotes those hardcoded knobs to first-class
 * `SystemSetting` entries with Zod validation so operators can
 * tune them through the system-settings controller without
 * restarts; the implementing service-side changes (M2) read the
 * keys from `SystemSettingsService` on every
 * `checkFailureThreshold()` call. The three new keys + the
 * cooldown-bypass flag together close `OPEN_QUESTIONS.md` K2,
 * K4, and K5:
 *
 *  - K4 — the settings surface now lists a `count`, a `window`,
 *    a `cooldown`, a `strategy`, and a kill switch (six entries
 *    total: Enabled / Count / WindowSeconds / CooldownSeconds /
 *    BypassCooldown / WindowStrategy).
 *  - K2 — the explicit `BypassCooldown` flag decouples the
 *    failure-threshold trigger from the cycle-completion
 *    15-minute cooldown; operators no longer need a
 *    `manual_override` flag to force execution.
 *  - K5 — the `WindowStrategy` knob (sliding vs fixed) pairs
 *    with the deterministic
 *    `failure-threshold:{scopeId}:{windowStartEpoch}` revision
 *    marker emitted by the implementing service (M2); retried
 *    emissions within the same window dedupe via that key.
 *
 * The pattern mirrors the sibling settings files
 * (`distillation-threshold.constants.ts`,
 * `learning-convergence-settings.constants.ts`,
 * `memory-feedback-window-days.constants.ts`,
 * `repair-delegation-settings.constants.ts`,
 * `telegram-settings.constants.ts`,
 * `apps/api/src/memory/memory-decay.constants.ts`) —
 * `SETTING_KEYS` and `SETTING_DEFAULTS` are `as const` objects,
 * every numeric setting has an explicit `.int().min(...).max(...)`
 * Zod bound matching the work item, and the inferred TypeScript
 * types live in the dedicated
 * `retrospective-failure-threshold-settings.constants.types.ts`
 * companion so the API lint policy
 * (`no-restricted-syntax` for exported type aliases) is
 * satisfied. The seeded defaults are registered in
 * `apps/api/src/settings/system-settings.defaults.ts` so the
 * keys and the seeded defaults can never drift apart.
 *
 * Boundary note: the file lives in `apps/api/src/settings/` so
 * the SystemSettingsService can read/write the keys, but every
 * symbol is feature-name-neutral — no domain ownership terms
 * appear here — so the core/API boundary lint rule stays clean.
 * The implementing service (M2) reads the keys from
 * `SystemSettingsService` on each call site and supplies its own
 * scope-id semantics via neutral `scopeId` parameters.
 */

import { z } from 'zod';
import {
  RETROSPECTIVE_FAILURE_THRESHOLD_SETTING_DEFAULTS as CORE_FAILURE_THRESHOLD_SETTING_DEFAULTS,
  RETROSPECTIVE_FAILURE_THRESHOLD_SETTING_KEYS as CORE_FAILURE_THRESHOLD_SETTING_KEYS,
} from '@nexus/core';

/**
 * Canonical `SystemSettingsService` keys for the failure-threshold
 * retrospective trigger. Re-exported from
 * `@nexus/core/retrospectives/failure-threshold-settings.constants`
 * so the keys, the seeded defaults, and the inferred TypeScript
 * union all share a single source of truth across the API + the
 * implementing service. The
 * `SystemSettingsService.seedDefaults()` registration (see
 * `apps/api/src/settings/system-settings.defaults.ts`) reads
 * from the
 * {@link RETROSPECTIVE_FAILURE_THRESHOLD_SETTING_DEFAULTS} record
 * so the keys and the seeded defaults can never drift apart. The
 * implementing service (M2) reads these same keys at every
 * `checkFailureThreshold()` call so operator changes take effect
 * on the next threshold check without restarting the app.
 *
 * The `Count` key replaces the legacy `FAILURE_THRESHOLD_COUNT`
 * env var (which remains as a deployment-time default — see
 * AC-3); `WindowSeconds` / `CooldownSeconds` /
 * `WindowStrategy` / `BypassCooldown` are net-new operator
 * knobs closing K2 + K4 + K5; `Enabled` is the kill switch that
 * preserves the legacy "feature disabled" path.
 */
export const RETROSPECTIVE_FAILURE_THRESHOLD_SETTING_KEYS =
  CORE_FAILURE_THRESHOLD_SETTING_KEYS;

/**
 * Hardcoded defaults for the failure-threshold trigger. Used as
 * the seed values by `SystemSettingsService.seedDefaults()` and
 * as the `defaultValue` fallback in the implementing service when
 * a key is absent from the DB. Re-exported from `@nexus/core` so
 * the API module stays a thin shim over the shared contract and
 * the keys + defaults can never drift apart.
 *
 *   - `Enabled` = `true` — feature on by default; mirrors the
 *     legacy hardcoded behaviour in the downstream retrospective
 *     failure-threshold service.
 *   - `Count` = `3` — three consecutive failures within the
 *     window trigger the retrospective. Mirrors the legacy
 *     `DEFAULT_FAILURE_THRESHOLD_COUNT = 3` constant.
 *   - `WindowSeconds` = `600` — 10 minutes, the natural
 *     companion to the 15-minute cycle-completion cooldown.
 *   - `CooldownSeconds` = `900` — 15 minutes, matches the
 *     legacy cycle-completion cooldown so the two triggers stay
 *     naturally staggered.
 *   - `BypassCooldown` = `false` — by default the
 *     failure-threshold trigger respects the cooldown; operators
 *     flip to `true` to force execution (closes K2).
 *   - `WindowStrategy` = `'sliding'` — sliding window counts only
 *     failures within the last `WindowSeconds`; `'fixed'` counts
 *     failures within the current calendar minute and resets on
 *     window roll.
 */
export const RETROSPECTIVE_FAILURE_THRESHOLD_SETTING_DEFAULTS =
  CORE_FAILURE_THRESHOLD_SETTING_DEFAULTS;

/** Minimum allowed value for `retrospective_failure_threshold_count`. */
export const RETROSPECTIVE_FAILURE_THRESHOLD_COUNT_MIN = 1;

/** Maximum allowed value for `retrospective_failure_threshold_count`. */
export const RETROSPECTIVE_FAILURE_THRESHOLD_COUNT_MAX = 100;

/**
 * Minimum allowed value for
 * `retrospective_failure_threshold_window_seconds` — 1 minute.
 * Lower bound keeps the sliding window from collapsing into a
 * single tick.
 */
export const RETROSPECTIVE_FAILURE_THRESHOLD_WINDOW_SECONDS_MIN = 60;

/**
 * Maximum allowed value for
 * `retrospective_failure_threshold_window_seconds` — 1 day.
 * Upper bound caps the fixed-strategy window so an operator typo
 * cannot accidentally pin the entire history.
 */
export const RETROSPECTIVE_FAILURE_THRESHOLD_WINDOW_SECONDS_MAX = 86400;

/**
 * Minimum allowed value for
 * `retrospective_failure_threshold_cooldown_seconds` — 0 disables
 * the cooldown entirely (the trigger fires on every threshold
 * crossing). Matches the `min(0)` bound documented in the work
 * item AC-1.
 */
export const RETROSPECTIVE_FAILURE_THRESHOLD_COOLDOWN_SECONDS_MIN = 0;

/**
 * Maximum allowed value for
 * `retrospective_failure_threshold_cooldown_seconds` — 1 day.
 * Same upper bound as `WindowSeconds` for symmetry; the
 * implementing service treats values larger than
 * `WindowSeconds` as the operator-intended "longer than the
 * observation window" cooldown.
 */
export const RETROSPECTIVE_FAILURE_THRESHOLD_COOLDOWN_SECONDS_MAX = 86400;

/**
 * `SYSTEM_SETTING_DEFAULTS` fragment for the failure-threshold
 * retrospective trigger (work item
 * `2ec2799b-b003-4f5d-bca4-d56d3ef601dd` / WI-2026-063,
 * registry work item
 * 52666e94-e403-4d00-97ab-95a3cc8af256 milestone 4).
 *
 * The six `value` / `description` entries live next to the keys
 * and the typed defaults so the registry can never drift away
 * from the shared cross-app contract re-exported from
 * `@nexus/core/retrospectives/failure-threshold-settings.constants`.
 * Values are written as the underlying primitives (not as
 * `SETTING_DEFAULTS[KEY]` lookups) because the entry now lives
 * in the fragment directly — the verbose indirection that used
 * to wrap each inline block in
 * `apps/api/src/settings/system-settings.defaults.ts` collapses
 * here.
 *
 * The Zod schemas further down enforce the same numeric bounds
 * the descriptions reference (count `1–100`, window
 * `60–86_400`, cooldown `0–86_400`, strategy enum) so a UI typo
 * that lands inside the seeded registry is rejected before it
 * reaches the implementing service.
 *
 * Placement: declared AFTER the numeric bounds so the
 * description template literals can reference them. The
 * fragments pattern in this directory (e.g.
 * `agent-mesh.settings.constants.ts`) places bounds inline with
 * each entry — here we follow the existing module's pattern
 * (bounds + Zod schemas declared first) because they are also
 * re-exported as standalone symbols for the implementing
 * service.
 */
export const RETROSPECTIVE_FAILURE_THRESHOLD_SYSTEM_SETTING_DEFAULTS: Record<
  string,
  { value: unknown; description: string }
> = {
  [RETROSPECTIVE_FAILURE_THRESHOLD_SETTING_KEYS.Enabled]: {
    value: true,
    description:
      'Kill switch for the failure-threshold retrospective trigger (work item 2ec2799b-b003-4f5d-bca4-d56d3ef601dd, OPEN_QUESTIONS K4). When false the implementing service returns immediately from checkFailureThreshold() with no side effects, preserving the legacy disabled path.',
  },
  [RETROSPECTIVE_FAILURE_THRESHOLD_SETTING_KEYS.Count]: {
    value: 3,
    description: `Number of consecutive failures within the observation window that fire the retrospective trigger (range ${RETROSPECTIVE_FAILURE_THRESHOLD_COUNT_MIN}-${RETROSPECTIVE_FAILURE_THRESHOLD_COUNT_MAX}, default 3). Replaces the legacy FAILURE_THRESHOLD_COUNT env var (which remains as a deployment-time default — see AC-3). Re-read on every threshold check so operator changes take effect on the next observation without a restart.`,
  },
  [RETROSPECTIVE_FAILURE_THRESHOLD_SETTING_KEYS.WindowSeconds]: {
    value: 600,
    description: `Observation-window length in seconds for the failure-threshold trigger (range ${RETROSPECTIVE_FAILURE_THRESHOLD_WINDOW_SECONDS_MIN}-${RETROSPECTIVE_FAILURE_THRESHOLD_WINDOW_SECONDS_MAX}, default 600 = 10 minutes). With WindowStrategy=sliding only failures within the last WindowSeconds count; with WindowStrategy=fixed the window rolls on calendar-minute boundaries. Closes OPEN_QUESTIONS K4 (window concept) and K5 (deterministic revision marker paired with the WindowStrategy knob).`,
  },
  [RETROSPECTIVE_FAILURE_THRESHOLD_SETTING_KEYS.CooldownSeconds]: {
    value: 900,
    description: `Cooldown in seconds between consecutive failure-threshold triggers (range ${RETROSPECTIVE_FAILURE_THRESHOLD_COOLDOWN_SECONDS_MIN}-${RETROSPECTIVE_FAILURE_THRESHOLD_COOLDOWN_SECONDS_MAX}, default 900 = 15 minutes, matching the legacy cycle-completion cooldown). 0 disables the cooldown so the trigger fires on every threshold crossing. Honored unless BypassCooldown=true. Closes OPEN_QUESTIONS K2 by giving operators a separate, dedicated bypass flag.`,
  },
  [RETROSPECTIVE_FAILURE_THRESHOLD_SETTING_KEYS.BypassCooldown]: {
    value: false,
    description:
      'Explicit cooldown-bypass flag for the failure-threshold trigger (work item 2ec2799b-b003-4f5d-bca4-d56d3ef601dd, OPEN_QUESTIONS K2). When true the implementing service skips the cooldown_active short-circuit and fires the retrospective regardless of CooldownSeconds. Defaults to false so operators must opt in to bypass.',
  },
  [RETROSPECTIVE_FAILURE_THRESHOLD_SETTING_KEYS.WindowStrategy]: {
    value: 'sliding',
    description:
      'Window strategy for the failure-threshold trigger (work item 2ec2799b-b003-4f5d-bca4-d56d3ef601dd, OPEN_QUESTIONS K5). Allowed values: `sliding` (count only failures within the last WindowSeconds — default) or `fixed` (count failures within the current calendar minute and reset on window roll). The deterministic revision-marker format `failure-threshold:{scopeId}:{windowStartEpoch}` is identical for both strategies; only the set of failures that count toward the threshold changes.',
  },
};

/**
 * Allowed values for the `WindowStrategy` setting, exported as a
 * frozen tuple so the Zod schema and the inferred type both
 * derive from the same source. `'sliding'` counts only failures
 * within the last `WindowSeconds`; `'fixed'` counts failures
 * within the current calendar minute (1-minute granularity) and
 * resets on window roll. The deterministic revision-marker
 * format emitted by the implementing service (M2) is
 * `failure-threshold:{scopeId}:{windowStartEpoch}` for both
 * strategies — the value of this knob only changes which events
 * count toward the threshold, not the marker shape.
 */
export const RETROSPECTIVE_FAILURE_THRESHOLD_WINDOW_STRATEGIES = [
  'sliding',
  'fixed',
] as const;

/**
 * Zod schema for `retrospective_failure_threshold_enabled`. The
 * kill switch — when `false` the implementing service (M2)
 * returns immediately from `checkFailureThreshold()` with no
 * side effects, preserving the legacy disabled path.
 */
export const RetrospectiveFailureThresholdEnabledSchema = z.boolean();

/**
 * Zod schema for `retrospective_failure_threshold_count`. The
 * numeric threshold — `int` because a fractional failure count
 * has no meaning, `min(1)` because a threshold of 0 fires on
 * every observation, `max(100)` to keep the operator-facing
 * range sane. Replaces the legacy `FAILURE_THRESHOLD_COUNT`
 * env var.
 */
export const RetrospectiveFailureThresholdCountSchema = z
  .number()
  .int()
  .min(RETROSPECTIVE_FAILURE_THRESHOLD_COUNT_MIN)
  .max(RETROSPECTIVE_FAILURE_THRESHOLD_COUNT_MAX);

/**
 * Zod schema for `retrospective_failure_threshold_window_seconds`.
 * The observation-window length in seconds. `min(60)` is the
 * 1-minute floor (a sub-minute window is too noisy for any
 * meaningful "did the lesson actually help?" signal);
 * `max(86400)` is the 1-day ceiling.
 */
export const RetrospectiveFailureThresholdWindowSecondsSchema = z
  .number()
  .int()
  .min(RETROSPECTIVE_FAILURE_THRESHOLD_WINDOW_SECONDS_MIN)
  .max(RETROSPECTIVE_FAILURE_THRESHOLD_WINDOW_SECONDS_MAX);

/**
 * Zod schema for `retrospective_failure_threshold_cooldown_seconds`.
 * The cooldown in seconds between consecutive
 * failure-threshold triggers. `min(0)` disables the cooldown
 * entirely (trigger fires on every threshold crossing);
 * `max(86400)` matches the `WindowSeconds` upper bound.
 */
export const RetrospectiveFailureThresholdCooldownSecondsSchema = z
  .number()
  .int()
  .min(RETROSPECTIVE_FAILURE_THRESHOLD_COOLDOWN_SECONDS_MIN)
  .max(RETROSPECTIVE_FAILURE_THRESHOLD_COOLDOWN_SECONDS_MAX);

/**
 * Zod schema for `retrospective_failure_threshold_bypass_cooldown`.
 * When `true`, the implementing service (M2) skips the
 * `cooldown_active` short-circuit and fires the retrospective
 * regardless of the cooldown. This is the explicit knob that
 * closes OPEN_QUESTIONS K2 — operators no longer need a
 * separate `manual_override` flag to force execution.
 */
export const RetrospectiveFailureThresholdBypassCooldownSchema = z.boolean();

/**
 * Zod schema for `retrospective_failure_threshold_window_strategy`.
 * Enum constrained to `'sliding'` or `'fixed'`; both values are
 * exported via
 * {@link RETROSPECTIVE_FAILURE_THRESHOLD_WINDOW_STRATEGIES} so the
 * inferred type stays in sync with the source of truth. The
 * strategy does NOT change the deterministic revision-marker
 * format emitted by the implementing service — only which
 * failures count toward the threshold.
 */
export const RetrospectiveFailureThresholdWindowStrategySchema = z.enum(
  RETROSPECTIVE_FAILURE_THRESHOLD_WINDOW_STRATEGIES,
);
