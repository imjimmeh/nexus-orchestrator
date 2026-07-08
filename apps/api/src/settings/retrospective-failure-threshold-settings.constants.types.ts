import type { z } from 'zod';
import {
  RETROSPECTIVE_FAILURE_THRESHOLD_SETTING_KEYS,
  RetrospectiveFailureThresholdBypassCooldownSchema,
  RetrospectiveFailureThresholdCooldownSecondsSchema,
  RetrospectiveFailureThresholdCountSchema,
  RetrospectiveFailureThresholdEnabledSchema,
  RetrospectiveFailureThresholdWindowSecondsSchema,
  RetrospectiveFailureThresholdWindowStrategySchema,
} from './retrospective-failure-threshold-settings.constants';

/**
 * Inferred TypeScript types for each of the six
 * `retrospective_failure_threshold_*` Zod schemas. The inferred
 * types live in a dedicated `*.types.ts` companion so the API
 * lint policy (`no-restricted-syntax` for exported type
 * aliases) is satisfied without weakening the file split.
 *
 * The implementing service (M2) and the milestone-3 test suite
 * import the types from this file to type
 * `SystemSettingsService.get<T>(key, defaultValue)` calls and
 * to type the coercion helpers they will add.
 */

/**
 * Union of the six canonical
 * `retrospective_failure_threshold_*` setting keys, derived from
 * {@link RETROSPECTIVE_FAILURE_THRESHOLD_SETTING_KEYS} so the
 * type and the runtime registry can never drift apart. Used by
 * the implementing service (M2) to constrain the `key` argument
 * on typed `SystemSettingsService.get<T>(key, defaultValue)` call
 * sites, and by the milestone-3 test suite to enumerate the
 * keys exhaustively without copy-paste drift.
 */
export type RetrospectiveFailureThresholdSettingKey =
  (typeof RETROSPECTIVE_FAILURE_THRESHOLD_SETTING_KEYS)[keyof typeof RETROSPECTIVE_FAILURE_THRESHOLD_SETTING_KEYS];

/** Type of `retrospective_failure_threshold_enabled`. */
export type RetrospectiveFailureThresholdEnabledType = z.infer<
  typeof RetrospectiveFailureThresholdEnabledSchema
>;

/** Type of `retrospective_failure_threshold_count`. */
export type RetrospectiveFailureThresholdCountType = z.infer<
  typeof RetrospectiveFailureThresholdCountSchema
>;

/** Type of `retrospective_failure_threshold_window_seconds`. */
export type RetrospectiveFailureThresholdWindowSecondsType = z.infer<
  typeof RetrospectiveFailureThresholdWindowSecondsSchema
>;

/** Type of `retrospective_failure_threshold_cooldown_seconds`. */
export type RetrospectiveFailureThresholdCooldownSecondsType = z.infer<
  typeof RetrospectiveFailureThresholdCooldownSecondsSchema
>;

/** Type of `retrospective_failure_threshold_bypass_cooldown`. */
export type RetrospectiveFailureThresholdBypassCooldownType = z.infer<
  typeof RetrospectiveFailureThresholdBypassCooldownSchema
>;

/** Type of `retrospective_failure_threshold_window_strategy`. */
export type RetrospectiveFailureThresholdWindowStrategyType = z.infer<
  typeof RetrospectiveFailureThresholdWindowStrategySchema
>;
