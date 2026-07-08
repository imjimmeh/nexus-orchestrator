/**
 * Cross-app contract surface for the failure-threshold retrospective
 * trigger's six operator-tunable `SystemSetting` keys.
 *
 * The keys + defaults in this module are the single source of truth
 * shared between:
 *
 *   - `apps/api/src/settings/system-settings.defaults.ts` — registers
 *     the seeded defaults on boot so `SystemSettingsService.seedDefaults()`
 *     returns a sane value on a fresh database.
 *   - `apps/api/src/settings/retrospective-failure-threshold-settings.constants.ts`
 *     — the API-side surface that adds Zod validation schemas (an
 *     API-side concern: the API is the only app that validates settings
 *     at the boundary). The API module re-exports the symbols from this
 *     file so the legacy import paths keep working without a duplicate
 *     source of truth.
 *   - The implementing failure-threshold service in the downstream
 *     consumer app — reads the keys via a narrow `ISystemSettingsReader`
 *     interface (`get<T>(key, defaultValue)`) on every
 *     `checkFailureThreshold()` call so operator changes take effect on
 *     the next observation without a restart.
 *
 * Living in `@nexus/core` (rather than the alternative consumer-contracts
 * shared package) keeps both the API and the consumer side on a shared
 * domain-neutral surface: the keys are feature-name-neutral and the
 * boundary rule does not flag any of the feature identifiers used here.
 * Domain ownership terms remain in the implementing service only.
 *
 * Work item: 2ec2799b-b003-4f5d-bca4-d56d3ef601dd (WI-2026-063)
 * Closes OPEN_QUESTIONS K2 + K4 + K5.
 */

/**
 * Canonical `SystemSettingsService` keys for the failure-threshold
 * retrospective trigger. Frozen with `as const` so the keys, the
 * matching defaults record, and the inferred
 * {@link RetrospectiveFailureThresholdSettingKey} union all derive
 * from the same source. The implementing service reads these same
 * keys at every `checkFailureThreshold()` call so operator changes
 * take effect on the next threshold check without restarting the app.
 *
 *   - `Enabled` — kill switch. When `false` the implementing service
 *     returns immediately from `checkFailureThreshold()` with no
 *     side effects, preserving the legacy disabled path.
 *   - `Count` — consecutive-failure count within the observation
 *     window that fires the trigger. Replaces the legacy
 *     `FAILURE_THRESHOLD_COUNT` env var (which remains as a
 *     deployment-time default).
 *   - `WindowSeconds` — observation-window length in seconds. With
 *     `WindowStrategy=sliding` only failures within the last
 *     `WindowSeconds` count; with `WindowStrategy=fixed` the window
 *     rolls on calendar-minute boundaries.
 *   - `CooldownSeconds` — cooldown between consecutive
 *     failure-threshold triggers. `0` disables the cooldown so the
 *     trigger fires on every threshold crossing. Honored unless
 *     `BypassCooldown=true`.
 *   - `BypassCooldown` — explicit cooldown-bypass flag (closes
 *     `OPEN_QUESTIONS K2`). When `true` the implementing service
 *     skips the cooldown short-circuit and fires the retrospective
 *     regardless of `CooldownSeconds`.
 *   - `WindowStrategy` — `'sliding'` (default) or `'fixed'`. Does
 *     NOT change the deterministic revision-marker format emitted
 *     by the implementing service — only which failures count
 *     toward the threshold (closes `OPEN_QUESTIONS K5`).
 */
export const RETROSPECTIVE_FAILURE_THRESHOLD_SETTING_KEYS = {
  Enabled: "retrospective_failure_threshold_enabled",
  Count: "retrospective_failure_threshold_count",
  WindowSeconds: "retrospective_failure_threshold_window_seconds",
  CooldownSeconds: "retrospective_failure_threshold_cooldown_seconds",
  BypassCooldown: "retrospective_failure_threshold_bypass_cooldown",
  WindowStrategy: "retrospective_failure_threshold_window_strategy",
} as const;

/**
 * Hardcoded defaults for the failure-threshold trigger. Used as the
 * seed values by `SystemSettingsService.seedDefaults()` (registered
 * from `apps/api/src/settings/system-settings.defaults.ts`) and as
 * the `defaultValue` fallback in the implementing service when a key
 * is absent from the database.
 *
 *   - `Enabled` = `true` — feature on by default; mirrors the legacy
 *     hardcoded behaviour.
 *   - `Count` = `3` — three consecutive failures within the window
 *     trigger the retrospective. Mirrors the legacy
 *     `DEFAULT_FAILURE_THRESHOLD_COUNT = 3`.
 *   - `WindowSeconds` = `600` — 10 minutes, the natural companion to
 *     the 15-minute cycle-completion cooldown.
 *   - `CooldownSeconds` = `900` — 15 minutes, matches the legacy
 *     cycle-completion cooldown so the two triggers stay naturally
 *     staggered.
 *   - `BypassCooldown` = `false` — by default the failure-threshold
 *     trigger respects the cooldown; operators flip to `true` to
 *     force execution (closes K2).
 *   - `WindowStrategy` = `'sliding'` — sliding window counts only
 *     failures within the last `WindowSeconds`; `'fixed'` counts
 *     failures within the current calendar minute and resets on
 *     window roll.
 */
export const RETROSPECTIVE_FAILURE_THRESHOLD_SETTING_DEFAULTS = {
  [RETROSPECTIVE_FAILURE_THRESHOLD_SETTING_KEYS.Enabled]: true,
  [RETROSPECTIVE_FAILURE_THRESHOLD_SETTING_KEYS.Count]: 3,
  [RETROSPECTIVE_FAILURE_THRESHOLD_SETTING_KEYS.WindowSeconds]: 600,
  [RETROSPECTIVE_FAILURE_THRESHOLD_SETTING_KEYS.CooldownSeconds]: 900,
  [RETROSPECTIVE_FAILURE_THRESHOLD_SETTING_KEYS.BypassCooldown]: false,
  [RETROSPECTIVE_FAILURE_THRESHOLD_SETTING_KEYS.WindowStrategy]: "sliding",
} as const;
