/**
 * System-setting keys and bounds for the learning-loop convergence
 * ratio gauge (work item
 * 88d7654e-ca93-4ffa-8ba5-7065db9506db, milestone 3).
 *
 * The convergence ratio is the "did the lesson actually help?"
 * signal that closes the self-improvement feedback loop:
 *
 *   ratio = success_outcome_count / total_outcome_count
 *
 * computed over a rolling window of `learning_convergence_window_days`
 * days. The ratio is exposed both as a per-scope gauge on the
 * `nexus_learning_loop_convergence_ratio{scope}` prom-client
 * instrument (this milestone) and as a structured block on the
 * per-process `GET /api/memory/metrics` JSON snapshot (this
 * milestone). The setting is read fresh at every snapshot
 * computation so operators can tune the rolling window without
 * restarting the API.
 *
 * Centralised as `as const` string literals so callers can reference
 * the exact key without typos. Mirrors the existing convention in
 * `learning-settings.constants.ts`, `distillation-threshold.constants.ts`,
 * `memory-metrics-settings.constants.ts`, and
 * `repair-delegation-settings.constants.ts`.
 */

/** Rolling window (in days) used to compute the convergence ratio. */
export const LEARNING_CONVERGENCE_WINDOW_DAYS_SETTING =
  'learning_convergence_window_days' as const;

/** Hardcoded default window — 7 days. */
export const LEARNING_CONVERGENCE_WINDOW_DAYS_DEFAULT = 7;

/** Minimum allowed window — 1 day. */
export const LEARNING_CONVERGENCE_WINDOW_DAYS_MIN = 1;

/** Maximum allowed window — 90 days. */
export const LEARNING_CONVERGENCE_WINDOW_DAYS_MAX = 90;

/**
 * Coerce an arbitrary value (read from SystemSettingsService or a
 * configuration payload) into a valid convergence-window length in
 * days.
 *
 * Returns the value when it is a finite integer in
 * [LEARNING_CONVERGENCE_WINDOW_DAYS_MIN,
 * LEARNING_CONVERGENCE_WINDOW_DAYS_MAX]; otherwise returns `fallback`
 * (or the hardcoded default when no fallback is supplied).
 * Non-throwing by design — matches the `coerceMemoryDistillationThreshold`
 * / `coerceMemoryMetricsRefreshIntervalSeconds` / `coerceEnabled` style
 * in this codebase.
 */
export function coerceLearningConvergenceWindowDays(
  value: unknown,
  fallback?: number,
): number {
  const safeFallback =
    typeof fallback === 'number' && Number.isFinite(fallback)
      ? fallback
      : LEARNING_CONVERGENCE_WINDOW_DAYS_DEFAULT;

  if (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= LEARNING_CONVERGENCE_WINDOW_DAYS_MIN &&
    value <= LEARNING_CONVERGENCE_WINDOW_DAYS_MAX
  ) {
    return value;
  }

  return safeFallback;
}
