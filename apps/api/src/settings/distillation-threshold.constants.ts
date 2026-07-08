/**
 * System-setting keys and bounds for the memory distillation trigger threshold.
 *
 * Centralised as `as const` string literals so callers can reference the
 * exact key without typos. Mirrors the existing convention in
 * `learning-settings.constants.ts`, `repair-delegation-settings.constants.ts`,
 * and the prefix/`__global__` pattern from
 * `auth/authorization/enforcement-mode.ts`.
 */

/** Per-resource prefix; resource-level keys are `${KEY_PREFIX}.${resourceId}`. */
export const MEMORY_DISTILLATION_THRESHOLD_KEY_PREFIX =
  'memoryDistillationThreshold' as const;

/** Global override key; mirrors the `rbac_enforcement_mode.__global__` shape. */
export const MEMORY_DISTILLATION_THRESHOLD_GLOBAL_KEY =
  'memoryDistillationThreshold.__global__' as const;

/**
 * Build the per-resource SystemSettingsService key for the given resource id.
 *
 * The caller is responsible for providing a non-empty, validated resource id;
 * the function does not sanitise its input because SystemSettingsService
 * itself treats the key as opaque.
 */
export function memoryDistillationThresholdKey(resourceId: string): string {
  return `${MEMORY_DISTILLATION_THRESHOLD_KEY_PREFIX}.${resourceId}`;
}

/** Hardcoded default threshold used when no override is configured. */
export const MEMORY_DISTILLATION_THRESHOLD_DEFAULT = 0.8;

/** Minimum allowed threshold (10% of the model's context window). */
export const MEMORY_DISTILLATION_THRESHOLD_MIN = 0.1;

/** Maximum allowed threshold (95% of the model's context window). */
export const MEMORY_DISTILLATION_THRESHOLD_MAX = 0.95;

/**
 * Coerce an arbitrary value (e.g. read from SystemSettingsService or a
 * configuration payload) into a valid distillation threshold.
 *
 * Returns the value when it is a finite number in
 * [MEMORY_DISTILLATION_THRESHOLD_MIN, MEMORY_DISTILLATION_THRESHOLD_MAX];
 * otherwise returns `fallback` (or the hardcoded default when no fallback
 * is supplied).
 *
 * The function is non-throwing by design — SystemSettingsService can store
 * any JSON-serialisable value, and the legacy `coerceEnforcementMode` /
 * `sanitizeLimit` helpers in this codebase also fall back silently with a
 * warn-log. Callers that want to surface the coercion can do so by
 * comparing the return value to the input.
 */
export function coerceMemoryDistillationThreshold(
  value: unknown,
  fallback?: number,
): number {
  const safeFallback =
    typeof fallback === 'number' && Number.isFinite(fallback)
      ? fallback
      : MEMORY_DISTILLATION_THRESHOLD_DEFAULT;

  if (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= MEMORY_DISTILLATION_THRESHOLD_MIN &&
    value <= MEMORY_DISTILLATION_THRESHOLD_MAX
  ) {
    return value;
  }

  return safeFallback;
}
