/**
 * `SYSTEM_SETTING_DEFAULTS` fragment for the workflow-auto-retry
 * knobs (work item 52666e94-e403-4d00-97ab-95a3cc8af256, milestone 1).
 *
 * String-literal keys are used here so the fragment can be imported by
 * `system-settings.defaults.ts` without dragging in the workflow
 * retry-policy module. The implementing module reads each key by its
 * string-literal name via `SystemSettingsService.get()` on every
 * dispatch tick, so operator changes take effect on the next queue
 * attempt without restarting the API.
 *
 * Extracted out of `system-settings.defaults.ts` so that file stays
 * under the project's `max-lines` lint cap while the operator-tunable
 * knob surface continues to grow across milestones. The spread keeps
 * the seeded defaults byte-identical to the pre-refactor registry.
 */
export const WORKFLOW_AUTO_RETRY_SYSTEM_SETTING_DEFAULTS: Record<
  string,
  { value: unknown; description: string }
> = {
  workflow_auto_retry_enabled: {
    value: false,
    description:
      'Enable automatic workflow job retries after terminal job failure',
  },
  workflow_auto_retry_max_attempts: {
    value: 2,
    description:
      'Maximum number of auto-retry attempts after a job fails all queue attempts',
  },
  workflow_auto_retry_initial_delay_ms: {
    value: 60000,
    description:
      'Initial delay in milliseconds before the first automatic workflow retry',
  },
  workflow_auto_retry_max_delay_ms: {
    value: 300000,
    description:
      'Maximum delay in milliseconds applied to exponential workflow retry backoff',
  },
  workflow_auto_retry_backoff_multiplier: {
    value: 2,
    description:
      'Exponential multiplier applied between automatic workflow retry attempts',
  },
  workflow_auto_retry_jitter_ratio: {
    value: 0.2,
    description:
      'Random jitter ratio applied to automatic workflow retry backoff delay',
  },
  workflow_auto_retry_max_in_flight: {
    value: 5,
    description:
      'Maximum number of delayed, waiting, or active workflow auto-retry jobs allowed at once before new retries are suppressed',
  },
};
