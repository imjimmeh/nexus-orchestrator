export const LEARNING_PROMOTION_MIN_CONFIDENCE_SETTING =
  'learning_promotion_min_confidence' as const;

/**
 * System-setting keys for the usage-based memory segment eviction reaper.
 *
 * These are the `SystemSettingsService` keys whose values control the
 * daily eviction pass (max idle days, minimum access count, and the
 * protected-source allowlist). The work item documents the reaper as
 * a memory-system concern but the surface area lives in the
 * learning/settings layer because (a) the protected sources
 * (`learning_candidate`) overlap with the learning pipeline and
 * (b) the reaper service will be wired in a follow-up milestone
 * alongside the learning writeback service.
 *
 * The runtime constants (defaults, event name, queue name, cron
 * schedule) live in `apps/api/src/memory/memory-eviction.constants.ts`
 * so the reaper can be assembled without a circular dependency on
 * the settings module.
 */
export const MEMORY_SEGMENT_EVICTION_MAX_IDLE_DAYS =
  'memory_segment_eviction_max_idle_days' as const;

export const MEMORY_SEGMENT_EVICTION_MIN_ACCESS_COUNT =
  'memory_segment_eviction_min_access_count' as const;

export const MEMORY_SEGMENT_EVICTION_PROTECTED_SOURCES =
  'memory_segment_eviction_protected_sources' as const;

/**
 * Cron expression (UTC) that drives the daily
 * {@link MemoryEvictionReaperService} tick. The BullMQ scheduler
 * milestone owns the registration; this constant is the typed key
 * that the scheduler reads from `SystemSettingsService` to honour
 * operator changes without restarting the app. The hardcoded
 * fallback (`0 3 * * *` — daily 03:00 UTC) lives in
 * `apps/api/src/memory/memory-eviction.constants.ts` as
 * `DEFAULT_MEMORY_EVICTION_CRON`.
 */
export const MEMORY_SEGMENT_EVICTION_CRON =
  'memory_segment_eviction_cron' as const;
