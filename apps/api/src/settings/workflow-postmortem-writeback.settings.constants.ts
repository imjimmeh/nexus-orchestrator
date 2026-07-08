/**
 * `SYSTEM_SETTING_DEFAULTS` fragment for the workflow-failure postmortem
 * writeback knobs (work item 5743ac93).
 *
 * String-literal keys are used here (NOT imports from
 * `workflow-failure-postmortem.constants.ts`) to avoid the
 * `system-settings` ↔ `workflow-repair` circular-import risk that the
 * memory-decay reaper module also navigated. The constants file remains the
 * canonical source for the listener / REST controller — the two surfaces are
 * pinned by name in their respective test suites.
 *
 * Extracted out of `system-settings.defaults.ts` so that file stays under the
 * project's `max-lines` cap; the spread keeps the seeded keys byte-identical.
 */
export const WORKFLOW_POSTMORTEM_WRITEBACK_SYSTEM_SETTING_DEFAULTS: Record<
  string,
  { value: unknown; description: string }
> = {
  workflow_postmortem_writeback_enabled: {
    value: true,
    description:
      'Kill switch for the WorkflowFailurePostmortemListener (work item 5743ac93-456d-41b3-ae5b-0ca2554318da). When false the listener logs and returns early without writing a postmortem memory segment for the failed run (the recorded_total counter still bumps the `skipped` label so the snapshot reflects "the listener was awake").',
  },
  workflow_postmortem_writeback_delay_seconds: {
    value: 60,
    description:
      'Delay in seconds between a WORKFLOW_RUN_FAILED_EVENT firing and the WorkflowFailurePostmortemListener writing the postmortem memory segment. Gives the repair policy enough time to apply its dispatch step (which can mutate the failure evidence via the sysadmin_repair agent path) before the postmortem captures the failure snapshot. Operators can shorten this to zero on environments where the repair step is intentionally disabled (e.g. local dev), or lengthen it on production stacks where the repair dispatch is observed to take longer.',
  },
  workflow_postmortem_occurrence_threshold: {
    value: 3,
    description:
      'Number of postmortem memory segments sharing the same failure_class for the same project within the occurrence window that triggers the follow-up LearningService integration to auto-propose a learning_candidate for human review / auto-promotion. The threshold is enforced on the active (archived_at IS NULL) set.',
  },
  workflow_postmortem_occurrence_window_days: {
    value: 30,
    description:
      'Number of days the WorkflowFailurePostmortemListener looks back when aggregating postmortems for the occurrence threshold. The window is anchored on metadata_json.occurred_at (NOT created_at) so an operator-driven backfill that re-uses an older occurred_at timestamp still falls out of the window correctly.',
  },
};
