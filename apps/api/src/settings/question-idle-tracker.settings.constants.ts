/**
 * `SYSTEM_SETTING_DEFAULTS` fragment for the question-idle-tracker
 * knobs (work item 52666e94-e403-4d00-97ab-95a3cc8af256, milestone 2).
 *
 * String-literal keys are used here so the fragment can be imported by
 * `system-settings.defaults.ts` without dragging in the container /
 * question-idle-tracker code path. The idle tracker re-reads these
 * keys on every transition so operator changes take effect on the
 * next observation tick without restarting the API.
 *
 * Extracted out of `system-settings.defaults.ts` so that file stays
 * under the project's `max-lines` lint cap while the operator-tunable
 * knob surface continues to grow across milestones. The spread keeps
 * the seeded defaults byte-identical to the pre-refactor registry.
 */
export const QUESTION_IDLE_TRACKER_SYSTEM_SETTING_DEFAULTS: Record<
  string,
  { value: unknown; description: string }
> = {
  question_idle_stop_seconds: {
    value: 300,
    description:
      'Seconds to wait before dehydrating a container waiting for user input (default: 300 = 5 min)',
  },
  question_idle_remove_seconds: {
    value: 3600,
    description:
      'Seconds to wait before removing a stopped container waiting for user input (default: 3600 = 1 hour)',
  },
};
