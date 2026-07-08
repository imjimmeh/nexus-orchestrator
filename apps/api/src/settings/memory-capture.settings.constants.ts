/**
 * `SYSTEM_SETTING_DEFAULTS` fragment for the memory-capture knobs
 * (work item 52666e94-e403-4d00-97ab-95a3cc8af256, milestone 2).
 *
 * String-literal keys are used here so the fragment can be imported by
 * `system-settings.defaults.ts` without dragging in the memory-capture
 * code path. The `remember` tool reads these keys on every invocation
 * via `SystemSettingsService.get()` so operator changes take effect on
 * the next capture attempt without restarting the API.
 *
 * Extracted out of `system-settings.defaults.ts` so that file stays
 * under the project's `max-lines` lint cap while the operator-tunable
 * knob surface continues to grow across milestones. The spread keeps
 * the seeded defaults byte-identical to the pre-refactor registry.
 */
export const MEMORY_CAPTURE_SYSTEM_SETTING_DEFAULTS: Record<
  string,
  { value: unknown; description: string }
> = {
  memory_capture_default_confidence: {
    value: 0.6,
    description:
      'Default confidence score applied to agent-captured memories when the agent does not supply an explicit confidence value (0–1, default 0.6).',
  },
  memory_capture_max_per_job: {
    value: 8,
    description:
      'Maximum number of agent_capture learning candidates the `remember` tool may create per job. When the cap is reached, subsequent `remember` calls return {created:false, reason:"budget_exhausted"} without inserting. Default 8 prevents runaway agents from flooding the learning queue.',
  },
};
