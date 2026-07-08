/**
 * `SYSTEM_SETTING_DEFAULTS` fragment for the workflow-host-mount catalog
 * knobs (work item 52666e94-e403-4d00-97ab-95a3cc8af256, milestone 1).
 *
 * String-literal keys are used here so the fragment can be imported by
 * `system-settings.defaults.ts` without dragging in the
 * `workflow-host-mount` module (which would risk a circular import back
 * through the settings service). The implementing module reads the keys
 * by their string-literal name via `SystemSettingsService.get()` on
 * every call site — see `apps/api/src/workflow/workflow-host-mount/`
 * for the consumer side.
 *
 * Extracted out of `system-settings.defaults.ts` so that file stays
 * under the project's `max-lines` lint cap while the operator-tunable
 * knob surface continues to grow across milestones. The spread keeps
 * the seeded defaults byte-identical to the pre-refactor registry.
 */
export const WORKFLOW_HOST_MOUNT_SYSTEM_SETTING_DEFAULTS: Record<
  string,
  { value: unknown; description: string }
> = {
  workflow_host_mount_catalog: {
    value: {},
    description:
      'Alias-indexed host mount catalog. Each alias entry defines api_root, default_mode, writable_allowed, and approval_required_on_rw.',
  },
  workflow_host_mount_rw_approval_required: {
    value: false,
    description:
      'Require explicit operator approval for read-write host mounts when true.',
  },
};
