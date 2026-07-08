/**
 * `SYSTEM_SETTING_DEFAULTS` fragment for the global RBAC enforcement
 * mode fallback (work item 52666e94-e403-4d00-97ab-95a3cc8af256,
 * milestone 3).
 *
 * The `rbac_enforcement_mode.__global__` key is the catch-all fallback
 * for every resource that does not declare a more specific
 * `rbac_enforcement_mode.<resource>` key. The RBAC guard reads the key
 * on every authorization check via `SystemSettingsService.get()` so
 * operator changes take effect on the next request without restarting
 * the API.
 *
 * Extracted out of `system-settings.defaults.ts` so that file stays
 * under the project's `max-lines` lint cap while the operator-tunable
 * knob surface continues to grow across milestones. The spread keeps
 * the seeded defaults byte-identical to the pre-refactor registry.
 */
export const RBAC_ENFORCEMENT_MODE_SYSTEM_SETTING_DEFAULTS: Record<
  string,
  { value: unknown; description: string }
> = {
  'rbac_enforcement_mode.__global__': {
    value: 'audit',
    description:
      "Global RBAC enforcement mode fallback: 'audit' (allow + log denials), 'warn' (allow + warn-log), or 'enforce' (deny). Per-resource keys 'rbac_enforcement_mode.<resource>' override this.",
  },
};
