/**
 * System-setting keys and bounds for the rolling window that
 * drives the per-segment `usefulness_ratio` aggregation in the
 * memory-quality feedback loop (work item
 * 66ea23d1-59f2-451b-a090-a292fad8f21b).
 *
 * The `memory_feedback_window_days` setting defines the
 * look-back horizon (in days) used by the follow-up
 * `MemorySegmentFeedbackService` (Milestone 2) when computing
 * `usefulness_ratio = count(useful_votes) / count(total_votes)`
 * over the explicit agent feedback recorded in the
 * `memory_segment_feedback` table. Operators tune the window
 * to trade off freshness (shorter window) against statistical
 * robustness (longer window).
 *
 * Centralised as `as const` string literals so callers can
 * reference the exact key without typos. Mirrors the existing
 * convention in `learning-convergence-settings.constants.ts`,
 * `memory-metrics-settings.constants.ts`,
 * `distillation-threshold.constants.ts`, and
 * `learning-settings.constants.ts`.
 */

/**
 * Rolling window (in days) used to compute per-segment
 * usefulness_ratio from explicit agent feedback.
 *
 * Mirrors the description registered in
 * `SYSTEM_SETTING_DEFAULTS` so the operator-facing system
 * settings controller surfaces the same wording on GET/PUT.
 */
export const MEMORY_FEEDBACK_WINDOW_DAYS_SETTING =
  'memory_feedback_window_days' as const;

/** Hardcoded default window — 30 days. */
export const MEMORY_FEEDBACK_WINDOW_DAYS_DEFAULT = 30;

/** Minimum allowed window — 1 day. */
export const MEMORY_FEEDBACK_WINDOW_DAYS_MIN = 1;

/** Maximum allowed window — 365 days. */
export const MEMORY_FEEDBACK_WINDOW_DAYS_MAX = 365;

/**
 * Coerce an arbitrary value (read from SystemSettingsService or a
 * configuration payload) into a valid feedback-window length in
 * days.
 *
 * Returns the value when it is a finite integer in
 * [MEMORY_FEEDBACK_WINDOW_DAYS_MIN,
 * MEMORY_FEEDBACK_WINDOW_DAYS_MAX]; otherwise returns
 * `fallback` (or the hardcoded default when no fallback is
 * supplied). Non-throwing by design — matches the
 * `coerceLearningConvergenceWindowDays` /
 * `coerceMemoryMetricsRefreshIntervalSeconds` /
 * `coerceMemoryDistillationThreshold` style in this codebase.
 */
export function coerceMemoryFeedbackWindowDays(
  value: unknown,
  fallback?: number,
): number {
  const safeFallback =
    typeof fallback === 'number' && Number.isFinite(fallback)
      ? fallback
      : MEMORY_FEEDBACK_WINDOW_DAYS_DEFAULT;

  if (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= MEMORY_FEEDBACK_WINDOW_DAYS_MIN &&
    value <= MEMORY_FEEDBACK_WINDOW_DAYS_MAX &&
    Number.isInteger(value)
  ) {
    return value;
  }

  return safeFallback;
}
