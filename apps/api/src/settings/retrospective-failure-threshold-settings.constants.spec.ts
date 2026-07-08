import { describe, expect, it } from 'vitest';
import {
  RETROSPECTIVE_FAILURE_THRESHOLD_COOLDOWN_SECONDS_MAX,
  RETROSPECTIVE_FAILURE_THRESHOLD_COOLDOWN_SECONDS_MIN,
  RETROSPECTIVE_FAILURE_THRESHOLD_COUNT_MAX,
  RETROSPECTIVE_FAILURE_THRESHOLD_COUNT_MIN,
  RETROSPECTIVE_FAILURE_THRESHOLD_SETTING_DEFAULTS,
  RETROSPECTIVE_FAILURE_THRESHOLD_SETTING_KEYS,
  RETROSPECTIVE_FAILURE_THRESHOLD_WINDOW_SECONDS_MAX,
  RETROSPECTIVE_FAILURE_THRESHOLD_WINDOW_SECONDS_MIN,
  RETROSPECTIVE_FAILURE_THRESHOLD_WINDOW_STRATEGIES,
  RetrospectiveFailureThresholdBypassCooldownSchema,
  RetrospectiveFailureThresholdCooldownSecondsSchema,
  RetrospectiveFailureThresholdCountSchema,
  RetrospectiveFailureThresholdEnabledSchema,
  RetrospectiveFailureThresholdWindowSecondsSchema,
  RetrospectiveFailureThresholdWindowStrategySchema,
} from './retrospective-failure-threshold-settings.constants';

// ---------------------------------------------------------------------------
// Setting keys + defaults + bounds
// ---------------------------------------------------------------------------

describe('retrospective-failure-threshold-settings constants', () => {
  it('exposes the six well-known SystemSetting keys', () => {
    expect(RETROSPECTIVE_FAILURE_THRESHOLD_SETTING_KEYS).toEqual({
      Enabled: 'retrospective_failure_threshold_enabled',
      Count: 'retrospective_failure_threshold_count',
      WindowSeconds: 'retrospective_failure_threshold_window_seconds',
      CooldownSeconds: 'retrospective_failure_threshold_cooldown_seconds',
      BypassCooldown: 'retrospective_failure_threshold_bypass_cooldown',
      WindowStrategy: 'retrospective_failure_threshold_window_strategy',
    });
  });

  it('keeps the schema defaults in sync with the SETTING_KEYS record', () => {
    // Every key referenced by the implementing service must have a
    // matching default. Guards against accidental key drift.
    expect(RETROSPECTIVE_FAILURE_THRESHOLD_SETTING_DEFAULTS).toEqual({
      [RETROSPECTIVE_FAILURE_THRESHOLD_SETTING_KEYS.Enabled]: true,
      [RETROSPECTIVE_FAILURE_THRESHOLD_SETTING_KEYS.Count]: 3,
      [RETROSPECTIVE_FAILURE_THRESHOLD_SETTING_KEYS.WindowSeconds]: 600,
      [RETROSPECTIVE_FAILURE_THRESHOLD_SETTING_KEYS.CooldownSeconds]: 900,
      [RETROSPECTIVE_FAILURE_THRESHOLD_SETTING_KEYS.BypassCooldown]: false,
      [RETROSPECTIVE_FAILURE_THRESHOLD_SETTING_KEYS.WindowStrategy]: 'sliding',
    });
  });

  it('keeps the numeric bounds coherent with the default values', () => {
    // Count
    expect(RETROSPECTIVE_FAILURE_THRESHOLD_COUNT_MIN).toBe(1);
    expect(RETROSPECTIVE_FAILURE_THRESHOLD_COUNT_MAX).toBe(100);
    expect(
      RETROSPECTIVE_FAILURE_THRESHOLD_SETTING_DEFAULTS[
        RETROSPECTIVE_FAILURE_THRESHOLD_SETTING_KEYS.Count
      ],
    ).toBeGreaterThanOrEqual(RETROSPECTIVE_FAILURE_THRESHOLD_COUNT_MIN);
    expect(
      RETROSPECTIVE_FAILURE_THRESHOLD_SETTING_DEFAULTS[
        RETROSPECTIVE_FAILURE_THRESHOLD_SETTING_KEYS.Count
      ],
    ).toBeLessThanOrEqual(RETROSPECTIVE_FAILURE_THRESHOLD_COUNT_MAX);

    // WindowSeconds
    expect(RETROSPECTIVE_FAILURE_THRESHOLD_WINDOW_SECONDS_MIN).toBe(60);
    expect(RETROSPECTIVE_FAILURE_THRESHOLD_WINDOW_SECONDS_MAX).toBe(86400);
    expect(
      RETROSPECTIVE_FAILURE_THRESHOLD_SETTING_DEFAULTS[
        RETROSPECTIVE_FAILURE_THRESHOLD_SETTING_KEYS.WindowSeconds
      ],
    ).toBeGreaterThanOrEqual(
      RETROSPECTIVE_FAILURE_THRESHOLD_WINDOW_SECONDS_MIN,
    );
    expect(
      RETROSPECTIVE_FAILURE_THRESHOLD_SETTING_DEFAULTS[
        RETROSPECTIVE_FAILURE_THRESHOLD_SETTING_KEYS.WindowSeconds
      ],
    ).toBeLessThanOrEqual(RETROSPECTIVE_FAILURE_THRESHOLD_WINDOW_SECONDS_MAX);

    // CooldownSeconds
    expect(RETROSPECTIVE_FAILURE_THRESHOLD_COOLDOWN_SECONDS_MIN).toBe(0);
    expect(RETROSPECTIVE_FAILURE_THRESHOLD_COOLDOWN_SECONDS_MAX).toBe(86400);
    expect(
      RETROSPECTIVE_FAILURE_THRESHOLD_SETTING_DEFAULTS[
        RETROSPECTIVE_FAILURE_THRESHOLD_SETTING_KEYS.CooldownSeconds
      ],
    ).toBeGreaterThanOrEqual(
      RETROSPECTIVE_FAILURE_THRESHOLD_COOLDOWN_SECONDS_MIN,
    );
    expect(
      RETROSPECTIVE_FAILURE_THRESHOLD_SETTING_DEFAULTS[
        RETROSPECTIVE_FAILURE_THRESHOLD_SETTING_KEYS.CooldownSeconds
      ],
    ).toBeLessThanOrEqual(RETROSPECTIVE_FAILURE_THRESHOLD_COOLDOWN_SECONDS_MAX);
  });

  it('exposes both sliding and fixed window strategies', () => {
    expect(RETROSPECTIVE_FAILURE_THRESHOLD_WINDOW_STRATEGIES).toEqual([
      'sliding',
      'fixed',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Per-key Zod schema coverage
// ---------------------------------------------------------------------------

describe('RetrospectiveFailureThresholdCountSchema', () => {
  it('accepts the default value and the boundary values', () => {
    expect(RetrospectiveFailureThresholdCountSchema.safeParse(3).success).toBe(
      true,
    );
    expect(
      RetrospectiveFailureThresholdCountSchema.safeParse(
        RETROSPECTIVE_FAILURE_THRESHOLD_COUNT_MIN,
      ).success,
    ).toBe(true);
    expect(
      RetrospectiveFailureThresholdCountSchema.safeParse(
        RETROSPECTIVE_FAILURE_THRESHOLD_COUNT_MAX,
      ).success,
    ).toBe(true);
  });

  it('rejects out-of-range and wrong-type values', () => {
    // Boundary violations
    expect(RetrospectiveFailureThresholdCountSchema.safeParse(0).success).toBe(
      false,
    );
    expect(
      RetrospectiveFailureThresholdCountSchema.safeParse(
        RETROSPECTIVE_FAILURE_THRESHOLD_COUNT_MAX + 1,
      ).success,
    ).toBe(false);
    // Fractional values — the schema enforces `.int()`
    expect(
      RetrospectiveFailureThresholdCountSchema.safeParse(1.5).success,
    ).toBe(false);
    // Wrong type — strings are not coerced
    expect(
      RetrospectiveFailureThresholdCountSchema.safeParse('three').success,
    ).toBe(false);
    // Null / undefined
    expect(
      RetrospectiveFailureThresholdCountSchema.safeParse(null).success,
    ).toBe(false);
    expect(
      RetrospectiveFailureThresholdCountSchema.safeParse(undefined).success,
    ).toBe(false);
  });
});

describe('RetrospectiveFailureThresholdWindowSecondsSchema', () => {
  it('accepts the default value and the boundary values', () => {
    expect(
      RetrospectiveFailureThresholdWindowSecondsSchema.safeParse(600).success,
    ).toBe(true);
    expect(
      RetrospectiveFailureThresholdWindowSecondsSchema.safeParse(
        RETROSPECTIVE_FAILURE_THRESHOLD_WINDOW_SECONDS_MIN,
      ).success,
    ).toBe(true);
    expect(
      RetrospectiveFailureThresholdWindowSecondsSchema.safeParse(
        RETROSPECTIVE_FAILURE_THRESHOLD_WINDOW_SECONDS_MAX,
      ).success,
    ).toBe(true);
  });

  it('rejects out-of-range, fractional, and wrong-type values', () => {
    // Boundary violations
    expect(
      RetrospectiveFailureThresholdWindowSecondsSchema.safeParse(
        RETROSPECTIVE_FAILURE_THRESHOLD_WINDOW_SECONDS_MIN - 1,
      ).success,
    ).toBe(false);
    expect(
      RetrospectiveFailureThresholdWindowSecondsSchema.safeParse(
        RETROSPECTIVE_FAILURE_THRESHOLD_WINDOW_SECONDS_MAX + 1,
      ).success,
    ).toBe(false);
    // Fractional
    expect(
      RetrospectiveFailureThresholdWindowSecondsSchema.safeParse(600.5).success,
    ).toBe(false);
    // Wrong type — strings are not coerced
    expect(
      RetrospectiveFailureThresholdWindowSecondsSchema.safeParse('600').success,
    ).toBe(false);
    // Null / undefined
    expect(
      RetrospectiveFailureThresholdWindowSecondsSchema.safeParse(null).success,
    ).toBe(false);
    expect(
      RetrospectiveFailureThresholdWindowSecondsSchema.safeParse(undefined)
        .success,
    ).toBe(false);
  });
});

describe('RetrospectiveFailureThresholdCooldownSecondsSchema', () => {
  it('accepts the default value, the lower bound (0 = disabled), and the upper bound', () => {
    expect(
      RetrospectiveFailureThresholdCooldownSecondsSchema.safeParse(900).success,
    ).toBe(true);
    expect(
      RetrospectiveFailureThresholdCooldownSecondsSchema.safeParse(
        RETROSPECTIVE_FAILURE_THRESHOLD_COOLDOWN_SECONDS_MIN,
      ).success,
    ).toBe(true);
    expect(
      RetrospectiveFailureThresholdCooldownSecondsSchema.safeParse(
        RETROSPECTIVE_FAILURE_THRESHOLD_COOLDOWN_SECONDS_MAX,
      ).success,
    ).toBe(true);
  });

  it('rejects out-of-range, fractional, and wrong-type values', () => {
    // Boundary violations — negative values are out of range (min is 0)
    expect(
      RetrospectiveFailureThresholdCooldownSecondsSchema.safeParse(-1).success,
    ).toBe(false);
    expect(
      RetrospectiveFailureThresholdCooldownSecondsSchema.safeParse(
        RETROSPECTIVE_FAILURE_THRESHOLD_COOLDOWN_SECONDS_MAX + 1,
      ).success,
    ).toBe(false);
    // Fractional
    expect(
      RetrospectiveFailureThresholdCooldownSecondsSchema.safeParse(900.5)
        .success,
    ).toBe(false);
    // Wrong type — strings are not coerced
    expect(
      RetrospectiveFailureThresholdCooldownSecondsSchema.safeParse('900')
        .success,
    ).toBe(false);
    // Null / undefined
    expect(
      RetrospectiveFailureThresholdCooldownSecondsSchema.safeParse(null)
        .success,
    ).toBe(false);
    expect(
      RetrospectiveFailureThresholdCooldownSecondsSchema.safeParse(undefined)
        .success,
    ).toBe(false);
  });
});

describe('RetrospectiveFailureThresholdEnabledSchema', () => {
  it('accepts true and false (the only valid booleans)', () => {
    expect(
      RetrospectiveFailureThresholdEnabledSchema.safeParse(true).success,
    ).toBe(true);
    expect(
      RetrospectiveFailureThresholdEnabledSchema.safeParse(false).success,
    ).toBe(true);
  });

  it('rejects non-boolean values', () => {
    expect(
      RetrospectiveFailureThresholdEnabledSchema.safeParse('true').success,
    ).toBe(false);
    expect(
      RetrospectiveFailureThresholdEnabledSchema.safeParse('false').success,
    ).toBe(false);
    expect(
      RetrospectiveFailureThresholdEnabledSchema.safeParse(0).success,
    ).toBe(false);
    expect(
      RetrospectiveFailureThresholdEnabledSchema.safeParse(1).success,
    ).toBe(false);
    expect(
      RetrospectiveFailureThresholdEnabledSchema.safeParse(null).success,
    ).toBe(false);
    expect(
      RetrospectiveFailureThresholdEnabledSchema.safeParse(undefined).success,
    ).toBe(false);
  });
});

describe('RetrospectiveFailureThresholdBypassCooldownSchema', () => {
  it('accepts true and false (the only valid booleans)', () => {
    expect(
      RetrospectiveFailureThresholdBypassCooldownSchema.safeParse(true).success,
    ).toBe(true);
    expect(
      RetrospectiveFailureThresholdBypassCooldownSchema.safeParse(false)
        .success,
    ).toBe(true);
  });

  it('rejects non-boolean values', () => {
    expect(
      RetrospectiveFailureThresholdBypassCooldownSchema.safeParse('true')
        .success,
    ).toBe(false);
    expect(
      RetrospectiveFailureThresholdBypassCooldownSchema.safeParse('false')
        .success,
    ).toBe(false);
    expect(
      RetrospectiveFailureThresholdBypassCooldownSchema.safeParse(0).success,
    ).toBe(false);
    expect(
      RetrospectiveFailureThresholdBypassCooldownSchema.safeParse(1).success,
    ).toBe(false);
    expect(
      RetrospectiveFailureThresholdBypassCooldownSchema.safeParse(null).success,
    ).toBe(false);
    expect(
      RetrospectiveFailureThresholdBypassCooldownSchema.safeParse(undefined)
        .success,
    ).toBe(false);
  });
});

describe('RetrospectiveFailureThresholdWindowStrategySchema', () => {
  it('accepts both enum members', () => {
    expect(
      RetrospectiveFailureThresholdWindowStrategySchema.safeParse('sliding')
        .success,
    ).toBe(true);
    expect(
      RetrospectiveFailureThresholdWindowStrategySchema.safeParse('fixed')
        .success,
    ).toBe(true);
  });

  it('rejects unknown, case-mismatched, empty, and null values', () => {
    expect(
      RetrospectiveFailureThresholdWindowStrategySchema.safeParse('rolling')
        .success,
    ).toBe(false);
    // Enum is case-sensitive — uppercase 'SLIDING' must be rejected
    expect(
      RetrospectiveFailureThresholdWindowStrategySchema.safeParse('SLIDING')
        .success,
    ).toBe(false);
    expect(
      RetrospectiveFailureThresholdWindowStrategySchema.safeParse('').success,
    ).toBe(false);
    expect(
      RetrospectiveFailureThresholdWindowStrategySchema.safeParse(null).success,
    ).toBe(false);
    expect(
      RetrospectiveFailureThresholdWindowStrategySchema.safeParse(undefined)
        .success,
    ).toBe(false);
    expect(
      RetrospectiveFailureThresholdWindowStrategySchema.safeParse(0).success,
    ).toBe(false);
  });
});
