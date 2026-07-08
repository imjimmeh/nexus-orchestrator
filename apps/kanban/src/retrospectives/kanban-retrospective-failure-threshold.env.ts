/**
 * Env-var fallback helpers for the failure-threshold retrospective
 * trigger. These are deployment-time defaults that take effect when
 * the matching operator-tunable `SystemSetting` row is missing or
 * when `SystemSettingsService` is not available (e.g. legacy unit
 * tests that do not wire the optional dependency).
 *
 * The precedence chain documented in the work item (M1/M2) is:
 *
 *   1. `SystemSettingsService.get<T>(key, ...)` (operator-tuned via
 *      the system-settings REST surface).
 *   2. Process env var (deployment-time default).
 *   3. Hardcoded schema default in
 *      `apps/api/src/settings/retrospective-failure-threshold-settings.constants.ts`.
 *
 * The legacy `FAILURE_THRESHOLD_COUNT` env var is preserved as the
 * deployment-time default for `Count` per AC-3 of work item
 * 2ec2799b-b003-4f5d-bca4-d56d3ef601dd so existing deployments do
 * not break.
 *
 * Work item: 2ec2799b-b003-4f5d-bca4-d56d3ef601dd (WI-2026-063)
 * Closes OPEN_QUESTIONS K2 + K4 + K5.
 */

const DEFAULT_FAILURE_THRESHOLD_COUNT = 3;
const DEFAULT_RETROSPECTIVE_FAILURE_THRESHOLD_ENABLED = true;
const DEFAULT_RETROSPECTIVE_FAILURE_THRESHOLD_WINDOW_SECONDS = 600;
const DEFAULT_RETROSPECTIVE_FAILURE_THRESHOLD_COOLDOWN_SECONDS = 900;
const DEFAULT_RETROSPECTIVE_FAILURE_THRESHOLD_BYPASS_COOLDOWN = false;
const DEFAULT_RETROSPECTIVE_FAILURE_THRESHOLD_WINDOW_STRATEGY: "sliding" | "fixed" =
  "sliding";

/**
 * Read the legacy `FAILURE_THRESHOLD_COUNT` env var, falling back to
 * the hardcoded default of 3 when unset / non-numeric / non-positive.
 * Mirrors the pattern in
 * `KanbanRetrospectiveFailureThresholdService.readFailureThresholdCount`
 * so the legacy code path is preserved unchanged.
 */
export function readFailureThresholdCountEnv(): number {
  const value = Number(process.env.FAILURE_THRESHOLD_COUNT);
  return Number.isFinite(value) && value > 0
    ? Math.round(value)
    : DEFAULT_FAILURE_THRESHOLD_COUNT;
}

/** Read `RETROSPECTIVE_FAILURE_THRESHOLD_ENABLED` env var (default true). */
export function readEnabledEnv(): boolean {
  const raw = process.env.RETROSPECTIVE_FAILURE_THRESHOLD_ENABLED;
  if (raw === undefined) {
    return DEFAULT_RETROSPECTIVE_FAILURE_THRESHOLD_ENABLED;
  }
  return raw === "true" || raw === "1";
}

/**
 * Read `RETROSPECTIVE_FAILURE_THRESHOLD_WINDOW_SECONDS` env var
 * (default 600 = 10 minutes). Falls back to the default for
 * non-numeric / non-positive values.
 */
export function readWindowSecondsEnv(): number {
  const value = Number(process.env.RETROSPECTIVE_FAILURE_THRESHOLD_WINDOW_SECONDS);
  return Number.isFinite(value) && value > 0
    ? Math.round(value)
    : DEFAULT_RETROSPECTIVE_FAILURE_THRESHOLD_WINDOW_SECONDS;
}

/**
 * Read `RETROSPECTIVE_FAILURE_THRESHOLD_COOLDOWN_SECONDS` env var
 * (default 900 = 15 minutes). Zero is a valid value (cooldown
 * disabled); falls back to the default for non-numeric / negative
 * values.
 */
export function readCooldownSecondsEnv(): number {
  const value = Number(process.env.RETROSPECTIVE_FAILURE_THRESHOLD_COOLDOWN_SECONDS);
  return Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : DEFAULT_RETROSPECTIVE_FAILURE_THRESHOLD_COOLDOWN_SECONDS;
}

/** Read `RETROSPECTIVE_FAILURE_THRESHOLD_BYPASS_COOLDOWN` env var (default false). */
export function readBypassCooldownEnv(): boolean {
  const raw = process.env.RETROSPECTIVE_FAILURE_THRESHOLD_BYPASS_COOLDOWN;
  if (raw === undefined) {
    return DEFAULT_RETROSPECTIVE_FAILURE_THRESHOLD_BYPASS_COOLDOWN;
  }
  return raw === "true" || raw === "1";
}

/**
 * Read `RETROSPECTIVE_FAILURE_THRESHOLD_WINDOW_STRATEGY` env var
 * (default `'sliding'`). Falls back to the default for any value
 * other than `'sliding'` or `'fixed'`.
 */
export function readWindowStrategyEnv(): "sliding" | "fixed" {
  const raw = process.env.RETROSPECTIVE_FAILURE_THRESHOLD_WINDOW_STRATEGY;
  if (raw === "sliding" || raw === "fixed") {
    return raw;
  }
  return DEFAULT_RETROSPECTIVE_FAILURE_THRESHOLD_WINDOW_STRATEGY;
}
