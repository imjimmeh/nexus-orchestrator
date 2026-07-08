/**
 * Inferred TypeScript types for the failure-threshold retrospective
 * trigger's `SystemSetting` keys. The types live in a dedicated
 * `*.types.ts` companion so the project's `no-restricted-syntax` lint
 * policy (exported type aliases must live in `*.types.ts` files) is
 * satisfied without weakening the file split.
 *
 * Work item: 2ec2799b-b003-4f5d-bca4-d56d3ef601dd (WI-2026-063).
 */

import type { RETROSPECTIVE_FAILURE_THRESHOLD_SETTING_KEYS } from "./failure-threshold-settings.constants";

/**
 * Union of the six canonical
 * `retrospective_failure_threshold_*` setting keys, derived from
 * {@link RETROSPECTIVE_FAILURE_THRESHOLD_SETTING_KEYS} so the type
 * and the runtime registry can never drift apart. Used by the
 * implementing service to constrain the `key` argument on typed
 * `SystemSettingsService.get<T>(key, defaultValue)` call sites and
 * by the per-key type aliases below to keep the inference chain
 * intact.
 */
export type RetrospectiveFailureThresholdSettingKey =
  (typeof RETROSPECTIVE_FAILURE_THRESHOLD_SETTING_KEYS)[keyof typeof RETROSPECTIVE_FAILURE_THRESHOLD_SETTING_KEYS];

/** Type of the `retrospective_failure_threshold_enabled` setting. */
export type RetrospectiveFailureThresholdEnabledType = boolean;

/** Type of the `retrospective_failure_threshold_count` setting. */
export type RetrospectiveFailureThresholdCountType = number;

/** Type of the `retrospective_failure_threshold_window_seconds` setting. */
export type RetrospectiveFailureThresholdWindowSecondsType = number;

/** Type of the `retrospective_failure_threshold_cooldown_seconds` setting. */
export type RetrospectiveFailureThresholdCooldownSecondsType = number;

/** Type of the `retrospective_failure_threshold_bypass_cooldown` setting. */
export type RetrospectiveFailureThresholdBypassCooldownType = boolean;

/** Type of the `retrospective_failure_threshold_window_strategy` setting. */
export type RetrospectiveFailureThresholdWindowStrategyType =
  | "sliding"
  | "fixed";
