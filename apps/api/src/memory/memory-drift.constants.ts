/**
 * Runtime constants for the `MemoryDriftDetectionService`
 * (work item 0cead042-e823-4e26-9386-02042252ffb0).
 *
 * The drift-detection pass is the third leg of the AI-memory
 * "Automatically updated" clause:
 *
 *   - `MemoryEvictionReaper` (work item
 *     bef49c3a-0c0f-4c85-b134-29d839c72bad) handles "removed when
 *     not used" based on access patterns.
 *   - `MemoryDecayReaper` (work item
 *     3d7fb798-f54d-40ff-a803-438224474912) handles time-based
 *     confidence decay.
 *   - `MemoryDriftDetectionService` (this milestone) handles the
 *     "reality check": for each `memory_segment` whose
 *     `source_metadata` references a repo path, a schema column,
 *     or an API endpoint, the service parses the reference and runs
 *     a cheap check (`file_exists` for path refs, `schema_lookup`
 *     for `table.column` refs, `regex_match` for API endpoint
 *     refs). When drift is detected the row's
 *     `drift_detected_at` is stamped, a configurable confidence
 *     penalty is applied (default -0.2), and a
 *     `memory.segment.drift_detected.v1` domain event is emitted.
 *
 * The module centralises the exempt-source allowlist, the
 * hardcoded defaults, the canonical `SystemSettingsService` keys,
 * and the runtime identifiers (event / queue / job names) that
 * the detector service and its scheduler will need once the
 * follow-up BullMQ milestones wire the scheduler and the
 * prom-client metric. This milestone defines the contract — the
 * detector service itself is also implemented here, but module
 * registration, scheduler wiring, and the metric are deferred to
 * milestone 3.
 *
 * The settings-driven values (kill switch, cron expression,
 * confidence penalty, optional recheck window) are persisted
 * through `SystemSettingsService` using the keys exposed via
 * {@link MEMORY_DRIFT_SETTING_KEYS}. The constants below are the
 * *fallback* defaults that `SystemSettingsService.get(...)` returns
 * when a key is absent.
 *
 * Splitting the constants out of the settings module avoids a
 * circular dependency: the detector service (in
 * `apps/api/src/memory/`) can import the event name, queue name,
 * source allowlist, and the hardcoded defaults without pulling in
 * the settings module's full surface area.
 *
 * @see apps/api/src/memory/memory-drift.types.ts — public types
 * @see apps/api/src/memory/memory-drift-detection.service.ts — service
 * @see apps/api/src/memory/memory-drift-reference.parser.ts — parser
 * @see apps/api/src/memory/memory-drift-checkers.ts — checker helpers
 */

/**
 * Source allowlist for the drift detector. A segment whose
 * `source` is in this set is exempt from drift detection
 * regardless of how stale its `source_metadata` reference is.
 *
 *   - `learning_candidate` — promoted lessons backed by the
 *     human-review and auto-promotion flow. They are validated
 *     by promotion gates, not by code-level reality checks.
 *   - `workflow_failure_postmortem` — operator-authored
 *     post-mortems attached to failed workflow runs. The
 *     detector must never "drift" a human narrative.
 *   - `strategic_intent` — long-lived intent statements that drive
 *     multi-cycle planning. The detector must never touch them.
 *   - `workflow_success_postmortem` — operator-authored
 *     post-mortems attached to successful workflow runs (the
 *     symmetric counterpart of `workflow_failure_postmortem`).
 *
 * The set is exported separately from the detector service so
 * unit tests can pin the contract without depending on the
 * (otherwise internal) service binding. The frozen tuple mirrors
 * the eviction reaper's `DEFAULT_PROTECTED_SOURCES` and the
 * decay reaper's `MEMORY_DECAY_EXEMPT_SOURCES` — both projects
 * pin their allowlist to a `readonly` frozen value so the
 * detector can never silently widen the contract.
 */
export const MEMORY_DRIFT_EXEMPT_SOURCES: readonly string[] = Object.freeze([
  'learning_candidate',
  'workflow_failure_postmortem',
  'strategic_intent',
  'workflow_success_postmortem',
]);

/**
 * Default cron expression for the nightly drift-detection tick.
 * Runs at 04:00 UTC every day, intentionally offset 60 minutes
 * from the decay reaper's `30 3 * * *` and 60 minutes from the
 * eviction reaper's `0 3 * * *` so the three nightly passes do
 * not race for the same DB connection budget.
 */
export const MEMORY_DRIFT_DEFAULT_CRON = '0 4 * * *';

/** Hardcoded fallback for the `memory_drift_enabled` setting. */
export const MEMORY_DRIFT_DEFAULT_ENABLED = true;

/**
 * Hardcoded fallback for the `memory_drift_confidence_penalty`
 * setting. The value is the magnitude of the confidence *penalty*
 * (i.e. the value subtracted from the segment's confidence when
 * drift is detected). 0.2 mirrors the decay reaper's
 * `MEMORY_DECAY_DEFAULT_FLOOR` — a single drift hit is equivalent
 * to the floor of the decay reaper.
 */
export const MEMORY_DRIFT_DEFAULT_CONFIDENCE_PENALTY = 0.2;

/**
 * Observability event emitted once per segment the drift detector
 * flags as drifted. Carries the segment id, the reference kind
 * and reference string the detector matched, the original
 * confidence, the new (penalised) confidence, and the reason
 * string the checker returned so downstream consumers (audit
 * log, metrics, learning writeback) can reason about what was
 * drifted and why.
 */
export const MEMORY_DRIFT_EVENT_NAME = 'memory.segment.drift_detected.v1';

/**
 * BullMQ queue name for the nightly drift detector. A separate
 * queue from the eviction reaper's `MEMORY_EVICTION_QUEUE` and
 * the decay reaper's `MEMORY_DECAY_QUEUE` keeps the three
 * reapers' BullMQ repeat-schedule state disjoint so an operator
 * can pause the drift detector independently of the others (and
 * vice versa). The BullMQ scheduler milestone (work item
 * continuation) will add a processor on this queue.
 */
export const MEMORY_DRIFT_QUEUE = 'memory-drift-detection';

/** BullMQ repeatable-job name for the nightly drift-detection tick. */
export const MEMORY_DRIFT_JOB_NAME = 'memory-drift-detection.run';

/**
 * Canonical `SystemSettingsService` keys for the drift detector.
 * The `SystemSettingsService.seedDefaults()` registration (see
 * `apps/api/src/settings/system-settings.service.ts`) reads from
 * this record so the keys and the seeded defaults can never
 * drift apart. The BullMQ scheduler milestone will read these
 * same keys at startup to honour operator changes without
 * restarting the app.
 */
export const MEMORY_DRIFT_SETTING_KEYS = {
  cron: 'memory_drift_cron',
  enabled: 'memory_drift_enabled',
  confidencePenalty: 'memory_drift_confidence_penalty',
  recheckAfterMs: 'memory_drift_recheck_after_ms',
} as const;
