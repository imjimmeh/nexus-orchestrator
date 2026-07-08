/**
 * System-setting keys and bounds for the per-backend `active_segments`
 * gauge refresh service.
 *
 * The refresh service is the authoritative source of the gauge while
 * `memory_metrics_gauge_use_refresh` is `true`; the legacy bump-on-write
 * path in `MemoryManagerService` is the fallback when the kill switch
 * is off. The constants below are intentionally narrow and isolated so
 * callers reference the exact key without typos — mirroring the
 * convention in `distillation-threshold.constants.ts`,
 * `learning-settings.constants.ts`, and `repair-delegation-settings.constants.ts`.
 */

/** Refresh interval in seconds for the active_segments gauge. */
export const MEMORY_METRICS_REFRESH_INTERVAL_SECONDS_SETTING =
  'memory_metrics_refresh_interval_seconds' as const;

/** Default refresh interval (60 seconds). */
export const MEMORY_METRICS_REFRESH_INTERVAL_SECONDS_DEFAULT = 60;

/** Minimum allowed refresh interval (5 seconds — bounded to avoid hammering the DB). */
export const MEMORY_METRICS_REFRESH_INTERVAL_SECONDS_MIN = 5;

/** Maximum allowed refresh interval (3600 seconds = 1 hour). */
export const MEMORY_METRICS_REFRESH_INTERVAL_SECONDS_MAX = 3600;

/** Kill switch that toggles the refresh path on/off. */
export const MEMORY_METRICS_GAUGE_USE_REFRESH_SETTING =
  'memory_metrics_gauge_use_refresh' as const;

/**
 * Coerce an arbitrary value (read from SystemSettingsService or a
 * configuration payload) into a valid refresh interval in seconds.
 *
 * Returns the value when it is a finite integer in
 * [MIN, MAX]; otherwise returns `fallback` (or the hardcoded default
 * when no fallback is supplied). Non-throwing by design — matches the
 * `coerceEnforcementMode` / `coerceMemoryDistillationThreshold` /
 * `sanitizeLimit` style in this codebase.
 */
export function coerceMemoryMetricsRefreshIntervalSeconds(
  value: unknown,
  fallback?: number,
): number {
  const safeFallback =
    typeof fallback === 'number' && Number.isFinite(fallback)
      ? fallback
      : MEMORY_METRICS_REFRESH_INTERVAL_SECONDS_DEFAULT;

  if (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= MEMORY_METRICS_REFRESH_INTERVAL_SECONDS_MIN &&
    value <= MEMORY_METRICS_REFRESH_INTERVAL_SECONDS_MAX
  ) {
    return value;
  }

  return safeFallback;
}

/**
 * Coerce an arbitrary value into a boolean kill-switch flag.
 *
 * Accepts native booleans, the literal strings `'true'` / `'false'`
 * (case-insensitive), and `1` / `0`. Any other value returns
 * `fallback` (defaulting to `true`).
 */
export function coerceMemoryMetricsGaugeUseRefresh(
  value: unknown,
  fallback = true,
): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (value === 1) {
      return true;
    }
    if (value === 0) {
      return false;
    }
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') {
      return true;
    }
    if (normalized === 'false' || normalized === '0') {
      return false;
    }
  }
  return fallback;
}
