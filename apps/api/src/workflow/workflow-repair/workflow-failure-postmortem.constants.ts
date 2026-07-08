/**
 * Runtime constants for the workflow-failure postmortem writeback
 * (work item 5743ac93-456d-41b3-ae5b-0ca2554318da).
 *
 * The postmortem pipeline lets the `WorkflowFailurePostmortemListener`
 * (milestone 2) record a structured per-run "postmortem" as a memory
 * segment whenever a `WORKFLOW_RUN_FAILED_EVENT` fires, so future
 * agents tackling similar tasks can recall the prior failure mode
 * via the existing `query_memory` tool. This milestone (1) defines
 * the contract — source string, settings keys, defaults, event name,
 * and outcome labels — so the listener and the follow-up
 * `LearningService` integration (milestone 3) can wire against a
 * stable surface.
 *
 * Settings-driven values (kill switch, writeback delay, occurrence
 * threshold, occurrence window) are persisted through
 * `SystemSettingsService` using the keys exposed via
 * {@link WORKFLOW_POSTMORTEM_SETTING_KEYS}. The constants below are
 * the *fallback* defaults that `SystemSettingsService.get(...)`
 * returns when a key is absent. `SYSTEM_SETTING_DEFAULTS` registers
 * them under their string-literal keys (not via the
 * `WORKFLOW_POSTMORTEM_SETTING_KEYS` import) to avoid the
 * `system-settings` ↔ `workflow-repair` circular-import risk that the
 * memory-decay reaper module also navigated.
 *
 * Splitting the constants out of the listener / settings module
 * mirrors the precedent set by `memory-decay.constants.ts` so the
 * same operator-tunable surface is discoverable in one place.
 */

/**
 * `metadata_json.source` value that the postmortem listener writes
 * onto every memory segment it creates. The repository's threshold
 * aggregation (`countPostmortemsByFailureClass`) and the existing
 * `query_memory` tool both filter on this exact string, so it is
 * the canonical postmortem identifier. Also included verbatim in
 * the rendered `content` text so a content-keyword search of
 * `query_memory` can find the postmortem even if the metadata
 * filter is misconfigured.
 */
export const WORKFLOW_POSTMORTEM_SOURCE = 'workflow_failure_postmortem';

/**
 * Canonical `SystemSettingsService` keys for the postmortem
 * writeback. `SystemSettingsService.seedDefaults()` registers the
 * matching defaults (see `system-settings.service.ts`) and the
 * listener reads them on every event. The keys are kept as
 * string-literal constants (not enums) so the JSON-stored setting
 * value is human-readable in the `system_settings` table.
 */
export const WORKFLOW_POSTMORTEM_SETTING_KEYS = {
  enabled: 'workflow_postmortem_writeback_enabled',
  delaySeconds: 'workflow_postmortem_writeback_delay_seconds',
  occurrenceThreshold: 'workflow_postmortem_occurrence_threshold',
  occurrenceWindowDays: 'workflow_postmortem_occurrence_window_days',
} as const;

/** Hardcoded fallback for `workflow_postmortem_writeback_enabled`. */
export const WORKFLOW_POSTMORTEM_DEFAULT_ENABLED = true;

/**
 * Hardcoded fallback for `workflow_postmortem_writeback_delay_seconds`.
 * 60s gives the repair policy enough time to apply its dispatch
 * step (which can mutate the failure evidence via the
 * `sysadmin_repair` agent path) before the postmortem captures
 * the failure snapshot. Operators can shorten this to zero on
 * environments where the repair step is intentionally disabled
 * (e.g. a local dev stack), or lengthen it on production stacks
 * where the repair dispatch is observed to take longer.
 */
export const WORKFLOW_POSTMORTEM_DEFAULT_DELAY_SECONDS = 60;

/**
 * Hardcoded fallback for `workflow_postmortem_occurrence_threshold`.
 * After this many postmortems share the same `failure_class` for
 * the same project within the occurrence window, the follow-up
 * `LearningService` integration (milestone 3) auto-proposes a
 * `learning_candidate` for human review / auto-promotion.
 */
export const WORKFLOW_POSTMORTEM_DEFAULT_OCCURRENCE_THRESHOLD = 3;

/**
 * Hardcoded fallback for
 * `workflow_postmortem_occurrence_window_days`. The window is
 * anchored on `metadata_json.occurred_at` (NOT `created_at`) so an
 * operator-driven backfill that re-uses an older `occurred_at`
 * timestamp still falls out of the window correctly.
 */
export const WORKFLOW_POSTMORTEM_DEFAULT_OCCURRENCE_WINDOW_DAYS = 30;

/**
 * `memory_type` slot the postmortem listener uses when it inserts
 * the new memory segment. `MemorySegment.memory_type` is constrained
 * to `'preference' | 'fact' | 'history'`, and a postmortem is a
 * record of a past event (a failure on a specific `workflow_run_id`
 * at a specific `occurred_at`), so `'history'` is the most
 * semantically correct slot. Using `'history'` also keeps
 * `query_memory` results that combine `'preference'` / `'fact'`
 * filters from accidentally surfacing postmortems in the same list.
 */
export const WORKFLOW_POSTMORTEM_MEMORY_TYPE = 'history' as const;

/**
 * Outcome label for the `WorkflowFailurePostmortemListener`'s
 * writeback. Mirrors the three branches the listener can take:
 *   - `success` — a memory segment was created and persisted.
 *   - `skipped` — the kill switch is off, the run was already
 *     postmortem'd, or a non-failed run was filtered out before
 *     the write.
 *   - `failed`  — an unrecoverable error blocked the writeback
 *     (e.g. the project scope could not be resolved, the
 *     classification service threw, or the memory backend
 *     rejected the segment).
 *
 * The labels are also the values the listener emits on
 * `WORKFLOW_POSTMORTEM_RECORDED_EVENT` and the labels the
 * `nexus_workflow_postmortem_recorded_total` counter increments.
 */
export const WORKFLOW_POSTMORTEM_OUTCOMES = [
  'success',
  'skipped',
  'failed',
] as const;

/**
 * Event name published via the EventLedger whenever the listener
 * finishes processing a `WORKFLOW_RUN_FAILED_EVENT`. The schema
 * (`WorkflowPostmortemRecordedEvent`) is declared in
 * `workflow-failure-postmortem.types.ts` so the listener, the
 * follow-up REST controller (milestone 2), and downstream
 * consumers (downstream dashboards, observability surfaces) can all
 * depend on the same payload shape.
 *
 * The event name is mirrored on
 * `AUTONOMY_EVENT_NAMES.workflowPostmortemRecorded` (see
 * `autonomy-observability.types.ts`) so the autonomy summary
 * surface can route the event into the right category.
 */
export const WORKFLOW_POSTMORTEM_RECORDED_EVENT =
  'memory.workflow.postmortem_recorded.v1';
