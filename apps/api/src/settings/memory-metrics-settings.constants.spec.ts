import { describe, expect, it } from 'vitest';
import {
  MEMORY_METRICS_GAUGE_USE_REFRESH_SETTING,
  MEMORY_METRICS_REFRESH_INTERVAL_SECONDS_DEFAULT,
  MEMORY_METRICS_REFRESH_INTERVAL_SECONDS_MAX,
  MEMORY_METRICS_REFRESH_INTERVAL_SECONDS_MIN,
  MEMORY_METRICS_REFRESH_INTERVAL_SECONDS_SETTING,
  coerceMemoryMetricsGaugeUseRefresh,
  coerceMemoryMetricsRefreshIntervalSeconds,
} from './memory-metrics-settings.constants';

describe('memory-metrics-settings constants', () => {
  it('uses well-known setting keys', () => {
    expect(MEMORY_METRICS_REFRESH_INTERVAL_SECONDS_SETTING).toBe(
      'memory_metrics_refresh_interval_seconds',
    );
    expect(MEMORY_METRICS_GAUGE_USE_REFRESH_SETTING).toBe(
      'memory_metrics_gauge_use_refresh',
    );
  });

  it('keeps a coherent default and bounds for the interval', () => {
    expect(MEMORY_METRICS_REFRESH_INTERVAL_SECONDS_DEFAULT).toBe(60);
    expect(MEMORY_METRICS_REFRESH_INTERVAL_SECONDS_MIN).toBeLessThan(
      MEMORY_METRICS_REFRESH_INTERVAL_SECONDS_DEFAULT,
    );
    expect(MEMORY_METRICS_REFRESH_INTERVAL_SECONDS_DEFAULT).toBeLessThan(
      MEMORY_METRICS_REFRESH_INTERVAL_SECONDS_MAX,
    );
  });
});

describe('coerceMemoryMetricsRefreshIntervalSeconds', () => {
  it('returns the value when it is a finite number in range', () => {
    expect(coerceMemoryMetricsRefreshIntervalSeconds(30)).toBe(30);
    expect(coerceMemoryMetricsRefreshIntervalSeconds(3600)).toBe(3600);
    expect(coerceMemoryMetricsRefreshIntervalSeconds(5)).toBe(5);
  });

  it('falls back to the hardcoded default for missing/non-numeric/out-of-range values', () => {
    expect(coerceMemoryMetricsRefreshIntervalSeconds(undefined)).toBe(60);
    expect(coerceMemoryMetricsRefreshIntervalSeconds('60')).toBe(60);
    expect(coerceMemoryMetricsRefreshIntervalSeconds(NaN)).toBe(60);
    expect(coerceMemoryMetricsRefreshIntervalSeconds(0)).toBe(60);
    expect(coerceMemoryMetricsRefreshIntervalSeconds(4)).toBe(60);
    expect(coerceMemoryMetricsRefreshIntervalSeconds(3601)).toBe(60);
    expect(coerceMemoryMetricsRefreshIntervalSeconds(-1)).toBe(60);
  });

  it('uses the explicit fallback when supplied', () => {
    expect(coerceMemoryMetricsRefreshIntervalSeconds(0, 10)).toBe(10);
    expect(coerceMemoryMetricsRefreshIntervalSeconds('oops', 20)).toBe(20);
  });
});

describe('coerceMemoryMetricsGaugeUseRefresh', () => {
  it('accepts native booleans', () => {
    expect(coerceMemoryMetricsGaugeUseRefresh(true)).toBe(true);
    expect(coerceMemoryMetricsGaugeUseRefresh(false)).toBe(false);
  });

  it('accepts 0/1 numbers', () => {
    expect(coerceMemoryMetricsGaugeUseRefresh(0)).toBe(false);
    expect(coerceMemoryMetricsGaugeUseRefresh(1)).toBe(true);
    expect(coerceMemoryMetricsGaugeUseRefresh(2)).toBe(true);
  });

  it('accepts case-insensitive true/false strings', () => {
    expect(coerceMemoryMetricsGaugeUseRefresh('true')).toBe(true);
    expect(coerceMemoryMetricsGaugeUseRefresh('TRUE')).toBe(true);
    expect(coerceMemoryMetricsGaugeUseRefresh('False')).toBe(false);
    expect(coerceMemoryMetricsGaugeUseRefresh('0')).toBe(false);
    expect(coerceMemoryMetricsGaugeUseRefresh('1')).toBe(true);
  });

  it('falls back to the default for unknown inputs', () => {
    expect(coerceMemoryMetricsGaugeUseRefresh('maybe')).toBe(true);
    expect(coerceMemoryMetricsGaugeUseRefresh(null)).toBe(true);
    expect(coerceMemoryMetricsGaugeUseRefresh(undefined)).toBe(true);
    expect(coerceMemoryMetricsGaugeUseRefresh({})).toBe(true);
    expect(coerceMemoryMetricsGaugeUseRefresh('maybe', false)).toBe(false);
  });
});
