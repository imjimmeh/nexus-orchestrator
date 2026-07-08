/**
 * Runtime constants for the usage-based memory segment eviction reaper.
 *
 * This module centralises the event name, queue/job names, and hardcoded
 * defaults that the reaper service will need once the BullMQ scheduler
 * and the eviction pass are wired (milestones 2/3/4). Settings-driven
 * values (max idle days, min access count, protected sources) live in
 * `apps/api/src/settings/learning-settings.constants.ts` and are
 * persisted through `SystemSettingsService`; the constants below are
 * the *fallback* defaults and the runtime identifiers that are
 * independent of operator-tunable configuration.
 *
 * Splitting the constants out of the settings module avoids a circular
 * dependency: the reaper service (in `apps/api/src/memory/`) can
 * import the queue/event names and the hardcoded defaults without
 * pulling in the settings module's full surface area.
 */

/**
 * Observability event emitted once per segment the reaper actually
 * deletes. Carries the segment id and the (now-historical) `source`
 * value so downstream consumers (audit log, metrics, learning
 * writeback) can reason about what was removed and why it was
 * eligible.
 */
export const MEMORY_SEGMENT_EVICTED_EVENT = 'memory.segment.evicted.v1';

/**
 * Default allowlist of `memory_segments.source` values that the reaper
 * must NEVER auto-evict, regardless of how stale or under-used the row
 * is. Used when the corresponding
 * `memory_segment_eviction_protected_sources` system setting is
 * absent or has been cleared back to the empty list during a
 * disaster-recovery seed; the reaper is never allowed to enter a
 * state where the protected allowlist is the empty set.
 *
 * `learning_candidate` is included by default to preserve the
 * self-improvement feedback loop — these segments back the
 * human-review and auto-promotion flow that turns agent signals into
 * durable memory, and silently deleting them would erode the
 * system's ability to learn from past runs.
 * `onboarding_chat` and `user_edit` are project-charter-origin
 * sources written during the initial charter intake and operator
 * edits; evicting them would destroy the foundational intent that
 * drives multi-cycle planning.
 */
export const DEFAULT_PROTECTED_SOURCES: readonly string[] = [
  'learning_candidate',
  'onboarding_chat',
  'user_edit',
] as const;

/** Hardcoded fallback for the `memory_segment_eviction_max_idle_days` setting. */
export const DEFAULT_MAX_IDLE_DAYS = 90;

/** Hardcoded fallback for the `memory_segment_eviction_min_access_count` setting. */
export const DEFAULT_MIN_ACCESS_COUNT = 1;

/** BullMQ queue name for the daily memory-eviction reaper. */
export const MEMORY_EVICTION_QUEUE = 'memory-eviction';

/**
 * BullMQ repeatable job name for the daily reaper tick. Operators can
 * trigger a manual run by enqueueing a one-shot job with the same
 * name from the admin trigger handler; the worker ignores any other
 * job names that land in the queue.
 */
export const MEMORY_EVICTION_CRON_JOB = 'memory-eviction-reaper';

/**
 * Default cron expression for the daily reaper tick. Runs at 03:00
 * UTC every day, which is intentionally off-peak for the orchestration
 * cycles (which peak during the local business hours of the
 * operators on the platform's primary tenant).
 */
export const DEFAULT_MEMORY_EVICTION_CRON = '0 3 * * *';
