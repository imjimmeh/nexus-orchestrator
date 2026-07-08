/**
 * Pure helper that resolves the full `MemoryDecaySettings`
 * snapshot the reaper consumes on every pass. Extracted out of
 * the private `MemoryDecayReaperService.resolveSettings()` so
 * the reaper class stays under the project's `max-lines` lint
 * cap and so the resolution contract has a dedicated,
 * unit-testable seam.
 *
 * Each `memory_decay_*` SystemSetting key is read fresh on
 * every call (no construction-time caching) so an operator can
 * tighten or loosen the values between ticks without
 * restarting the app. The drift and value-predicate knobs are
 * resolved through the same priority chain the reaper used
 * before extraction — recorder-calibrated > operator
 * SystemSetting > hardcoded default — so the rendered settings
 * are byte-identical to the pre-extraction behaviour.
 */
import { coerceInteger } from '../settings/setting-coercers';
import {
  MEMORY_DECAY_DEFAULT_DAILY_RATE,
  MEMORY_DECAY_DEFAULT_ENABLED,
  MEMORY_DECAY_DEFAULT_FLOOR,
  MEMORY_DECAY_DEFAULT_GRACE_DAYS,
  MEMORY_DECAY_SETTING_KEYS,
} from './memory-decay.constants';
import type { MemoryDecaySettings } from './memory-decay.types';
import type { MemoryDecaySettingsResolverDeps } from './memory-decay.settings.helpers.types';
import {
  coerceDailyRate,
  coerceEnabled,
  coerceFloor,
} from './memory-decay.coercion';
import {
  DECAY_VALUE_PREDICATE_MODE_DEFAULT,
  DECAY_VALUE_PREDICATE_MODE_SETTING,
  MEMORY_DECAY_USEFULNESS_MIN_SAMPLES_DEFAULT,
  MEMORY_DECAY_USEFULNESS_MIN_SAMPLES_SETTING,
  MEMORY_DECAY_USEFULNESS_THRESHOLD_DEFAULT,
  MEMORY_DECAY_USEFULNESS_THRESHOLD_SETTING,
  coerceDecayValuePredicateMode,
  coerceMemoryDecayUsefulnessMinSamples,
  coerceMemoryDecayUsefulnessThreshold,
} from '../settings/memory-decay-value.settings.constants';
import {
  MEMORY_DECAY_DRIFT_INVALIDATION_ENABLED_DEFAULT,
  MEMORY_DECAY_DRIFT_INVALIDATION_ENABLED_SETTING,
  MEMORY_DECAY_DRIFT_PENALTY_MULTIPLIER_DEFAULT,
  MEMORY_DECAY_DRIFT_PENALTY_MULTIPLIER_SETTING,
  coerceMemoryDecayDriftInvalidationEnabled,
  coerceMemoryDecayDriftPenaltyMultiplier,
} from '../settings/memory-decay-drift.settings.constants';

/**
 * Resolve the live decay settings from
 * {@link SystemSettingsService}. Reads happen fresh on every
 * call — never cached at construction — so an operator can
 * tighten or loosen the values between ticks without
 * restarting the app.
 *
 * Each setting is coerced into a sane runtime value:
 *   - `enabled`: coerced to a boolean; falls back to the
 *     hardcoded `true` default when the stored value is
 *     missing, non-boolean, or a non-truthy non-false value.
 *   - `graceDays`: coerced to a non-negative integer; falls
 *     back to the hardcoded `30` default when the stored
 *     value is missing or non-numeric.
 *   - `dailyRate`: coerced to a non-negative number; falls
 *     back to the hardcoded `0.01` default when the stored
 *     value is missing or non-numeric. A value of `0`
 *     effectively disables decay.
 *   - `floor`: coerced to a number in the `[0, 1]` range;
 *     falls back to the hardcoded `0.2` default when the
 *     stored value is missing or out of range.
 */
export async function resolveDecaySettings(
  deps: MemoryDecaySettingsResolverDeps,
): Promise<MemoryDecaySettings> {
  const { settings, settingsResolver } = deps;

  const rawEnabled = await settings.get<unknown>(
    MEMORY_DECAY_SETTING_KEYS.enabled,
    MEMORY_DECAY_DEFAULT_ENABLED,
  );
  const enabled = coerceEnabled(rawEnabled);

  const rawGraceDays = await settings.get<unknown>(
    MEMORY_DECAY_SETTING_KEYS.graceDays,
    MEMORY_DECAY_DEFAULT_GRACE_DAYS,
  );
  // coerceGraceDays: parses the grace-days override; falls back to
  // MEMORY_DECAY_DEFAULT_GRACE_DAYS. A `graceDays = 0` is allowed
  // (every row is eligible the moment it is touched); negative
  // values fall back to the default so a UI typo cannot invert
  // the reaper's behaviour.
  const graceDays = coerceInteger(
    rawGraceDays,
    MEMORY_DECAY_DEFAULT_GRACE_DAYS,
    { min: 0 },
  );

  const rawDailyRate = await settings.get<unknown>(
    MEMORY_DECAY_SETTING_KEYS.dailyRate,
    MEMORY_DECAY_DEFAULT_DAILY_RATE,
  );
  const dailyRate = coerceDailyRate(rawDailyRate);

  const rawFloor = await settings.get<unknown>(
    MEMORY_DECAY_SETTING_KEYS.floor,
    MEMORY_DECAY_DEFAULT_FLOOR,
  );
  const floor = coerceFloor(rawFloor);

  const rawMode = await settings.get<unknown>(
    DECAY_VALUE_PREDICATE_MODE_SETTING,
    DECAY_VALUE_PREDICATE_MODE_DEFAULT,
  );
  const valuePredicateMode = coerceDecayValuePredicateMode(rawMode);

  // Resolved via the dedicated settings resolver (work item
  // 946a3c8b-5814-4e76-a804-b557e589600b, milestone 4) so the
  // priority chain — recorder-calibrated > operator SystemSetting
  // > hardcoded default — lives in a single seam. The dependency
  // is `@Optional()` so a host application that does not register
  // the resolver (e.g. an app slice wiring only the reaper
  // standalone) still resolves the threshold via the original
  // inline `SystemSettingsService.get(...)` path.
  let usefulnessThreshold: number;
  if (settingsResolver) {
    usefulnessThreshold = await settingsResolver.resolveUsefulnessThreshold();
  } else {
    const rawUsefulnessThreshold = await settings.get<unknown>(
      MEMORY_DECAY_USEFULNESS_THRESHOLD_SETTING,
      MEMORY_DECAY_USEFULNESS_THRESHOLD_DEFAULT,
    );
    usefulnessThreshold = coerceMemoryDecayUsefulnessThreshold(
      rawUsefulnessThreshold,
    );
  }

  const rawUsefulnessMinSamples = await settings.get<unknown>(
    MEMORY_DECAY_USEFULNESS_MIN_SAMPLES_SETTING,
    MEMORY_DECAY_USEFULNESS_MIN_SAMPLES_DEFAULT,
  );
  const usefulnessMinSamples = coerceMemoryDecayUsefulnessMinSamples(
    rawUsefulnessMinSamples,
  );

  const rawDriftInvalidationEnabled = await settings.get<unknown>(
    MEMORY_DECAY_DRIFT_INVALIDATION_ENABLED_SETTING,
    MEMORY_DECAY_DRIFT_INVALIDATION_ENABLED_DEFAULT,
  );
  const driftInvalidationEnabled = coerceMemoryDecayDriftInvalidationEnabled(
    rawDriftInvalidationEnabled,
  );

  const rawDriftPenaltyMultiplier = await settings.get<unknown>(
    MEMORY_DECAY_DRIFT_PENALTY_MULTIPLIER_SETTING,
    MEMORY_DECAY_DRIFT_PENALTY_MULTIPLIER_DEFAULT,
  );
  const driftPenaltyMultiplier = coerceMemoryDecayDriftPenaltyMultiplier(
    rawDriftPenaltyMultiplier,
  );

  return {
    enabled,
    graceDays,
    dailyRate,
    floor,
    valuePredicateMode,
    usefulnessThreshold,
    usefulnessMinSamples,
    driftInvalidationEnabled,
    driftPenaltyMultiplier,
  };
}
