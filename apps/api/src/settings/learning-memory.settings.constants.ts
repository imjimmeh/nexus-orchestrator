/**
 * `SYSTEM_SETTING_DEFAULTS` fragment for the learning/memory
 * operator-tunable knobs (work item
 * 52666e94-e403-4d00-97ab-95a3cc8af256, milestone 4).
 *
 * The fragment consolidates the repair-delegation gate, the
 * learning-promotion confidence floor, the memory-segment eviction
 * reaper knobs, the session-distillation threshold, the
 * memory-metrics refresh interval / kill switch, the
 * learning-convergence window, and the per-segment feedback
 * window. All consumers (the repair service, the promotion
 * service, the eviction reaper, the distillation service, the
 * metrics refresh service, the convergence gauge, and the
 * feedback aggregation) read their keys by string-literal name
 * via `SystemSettingsService.get()` on every relevant tick so
 * operator changes take effect without restarting the API.
 *
 * The keys are imported as `as const` symbols from sibling
 * constants files (`repair-delegation-settings.constants.ts`,
 * `learning-settings.constants.ts`, `distillation-threshold.constants.ts`,
 * `memory-metrics-settings.constants.ts`,
 * `learning-convergence-settings.constants.ts`, and
 * `memory-feedback-window-days.constants.ts`). Each of those
 * leaf modules owns its Zod schemas / numeric bounds; the
 * fragment imports the defaults and bounds so the description
 * strings can quote the same ranges the Zod schemas enforce,
 * keeping the operator-facing UI text and the validation bounds
 * in lock-step.
 *
 * Extracted out of `system-settings.defaults.ts` so that file
 * stays under the project's `max-lines` lint cap while the
 * operator-tunable knob surface continues to grow across
 * milestones. The spread keeps the seeded defaults byte-identical
 * to the pre-refactor inline registry.
 */
import {
  WORKFLOW_REPAIR_DELEGATION_ENABLED_SETTING,
  WORKFLOW_REPAIR_DELEGATION_MAX_ATTEMPTS_SETTING,
} from './repair-delegation-settings.constants';
import {
  LEARNING_PROMOTION_MIN_CONFIDENCE_SETTING,
  MEMORY_SEGMENT_EVICTION_CRON,
  MEMORY_SEGMENT_EVICTION_MAX_IDLE_DAYS,
  MEMORY_SEGMENT_EVICTION_MIN_ACCESS_COUNT,
  MEMORY_SEGMENT_EVICTION_PROTECTED_SOURCES,
} from './learning-settings.constants';
import {
  MEMORY_DISTILLATION_THRESHOLD_DEFAULT,
  MEMORY_DISTILLATION_THRESHOLD_GLOBAL_KEY,
  MEMORY_DISTILLATION_THRESHOLD_MAX,
  MEMORY_DISTILLATION_THRESHOLD_MIN,
} from './distillation-threshold.constants';
import {
  MEMORY_METRICS_GAUGE_USE_REFRESH_SETTING,
  MEMORY_METRICS_REFRESH_INTERVAL_SECONDS_DEFAULT,
  MEMORY_METRICS_REFRESH_INTERVAL_SECONDS_MAX,
  MEMORY_METRICS_REFRESH_INTERVAL_SECONDS_MIN,
  MEMORY_METRICS_REFRESH_INTERVAL_SECONDS_SETTING,
} from './memory-metrics-settings.constants';
import {
  LEARNING_CONVERGENCE_WINDOW_DAYS_DEFAULT,
  LEARNING_CONVERGENCE_WINDOW_DAYS_MAX,
  LEARNING_CONVERGENCE_WINDOW_DAYS_MIN,
  LEARNING_CONVERGENCE_WINDOW_DAYS_SETTING,
} from './learning-convergence-settings.constants';
import {
  MEMORY_FEEDBACK_WINDOW_DAYS_DEFAULT,
  MEMORY_FEEDBACK_WINDOW_DAYS_MAX,
  MEMORY_FEEDBACK_WINDOW_DAYS_MIN,
  MEMORY_FEEDBACK_WINDOW_DAYS_SETTING,
} from './memory-feedback-window-days.constants';

export const LEARNING_MEMORY_SYSTEM_SETTING_DEFAULTS: Record<
  string,
  { value: unknown; description: string }
> = {
  [WORKFLOW_REPAIR_DELEGATION_ENABLED_SETTING]: {
    value: true,
    description:
      'Enable config-gated autonomous repair delegation for policy-allowed workflow failures',
  },
  [WORKFLOW_REPAIR_DELEGATION_MAX_ATTEMPTS_SETTING]: {
    value: 1,
    description:
      'Maximum autonomous repair attempts per workflow run and repair action before repair delegation is suppressed',
  },
  [LEARNING_PROMOTION_MIN_CONFIDENCE_SETTING]: {
    value: 0.5,
    description:
      'Minimum confidence score required for learning candidate auto-promotion (0–1). Candidates below this threshold are rejected with code low_confidence.',
  },
  [MEMORY_DISTILLATION_THRESHOLD_GLOBAL_KEY]: {
    value: MEMORY_DISTILLATION_THRESHOLD_DEFAULT,
    description: `Global fallback for the session distillation trigger threshold: fraction of the model token limit (range ${MEMORY_DISTILLATION_THRESHOLD_MIN}–${MEMORY_DISTILLATION_THRESHOLD_MAX}, default ${MEMORY_DISTILLATION_THRESHOLD_DEFAULT}) that enqueues a distillation job in SessionHydrationService. Per-resource keys 'memoryDistillationThreshold.<resourceId>' override this value.`,
  },
  [MEMORY_SEGMENT_EVICTION_MAX_IDLE_DAYS]: {
    value: 90,
    description:
      'Maximum number of days a memory segment can go untouched (last_accessed_at) before becoming eligible for eviction by the daily MemoryEvictionReaper. Lower values evict more aggressively. Pinned segments and segments whose source is listed in memory_segment_eviction_protected_sources (e.g. learning_candidate) are always preserved regardless of this value.',
  },
  [MEMORY_SEGMENT_EVICTION_MIN_ACCESS_COUNT]: {
    value: 1,
    description:
      'Minimum access_count required to protect a memory segment from eviction by the daily MemoryEvictionReaper. Segments with access_count below this threshold AND last_accessed_at older than memory_segment_eviction_max_idle_days are deleted. Set to 0 to remove the access-count protection and rely solely on the idle-days cutoff.',
  },
  [MEMORY_SEGMENT_EVICTION_PROTECTED_SOURCES]: {
    value: ['learning_candidate'],
    description:
      'Allowlist of memory_segments.source values that the daily MemoryEvictionReaper must never auto-evict, regardless of how stale or under-used the row is. `learning_candidate` is included by default to preserve the self-improvement feedback loop that backs the human-review and auto-promotion flow.',
  },
  [MEMORY_SEGMENT_EVICTION_CRON]: {
    value: '0 3 * * *',
    description:
      'Cron expression (UTC) that drives the daily MemoryEvictionReaper tick. The BullMQ scheduler registration reads this value on startup and re-registers the repeatable job when an operator updates the setting. Default `0 3 * * *` runs at 03:00 UTC every day, intentionally off-peak for the orchestration cycles. Standard 5-field cron syntax is required; the scheduler rejects anything else.',
  },
  [MEMORY_METRICS_REFRESH_INTERVAL_SECONDS_SETTING]: {
    value: MEMORY_METRICS_REFRESH_INTERVAL_SECONDS_DEFAULT,
    description: `Refresh interval in seconds for the per-backend active_segments gauge (range ${MEMORY_METRICS_REFRESH_INTERVAL_SECONDS_MIN}–${MEMORY_METRICS_REFRESH_INTERVAL_SECONDS_MAX}, default ${MEMORY_METRICS_REFRESH_INTERVAL_SECONDS_DEFAULT}). When set, the value is re-read on every tick so operator changes take effect on the next interval without a restart.`,
  },
  [MEMORY_METRICS_GAUGE_USE_REFRESH_SETTING]: {
    value: true,
    description:
      'When true, the MemoryMetricsRefreshService overwrites the active_segments gauge with the result of a SELECT count(*) GROUP BY source on every tick; when false, the refresh is skipped and the legacy bump-on-write path remains the only source of the gauge (kill switch for safe rollback).',
  },
  [LEARNING_CONVERGENCE_WINDOW_DAYS_SETTING]: {
    value: LEARNING_CONVERGENCE_WINDOW_DAYS_DEFAULT,
    description: `Rolling window (in days) used to compute the learning-loop convergence ratio (work item 88d7654e-ca93-4ffa-8ba5-7065db9506db, milestone 3). The ratio is computed over outcome-counter events observed within the last N days; older events are dropped from the numerator and denominator (range ${LEARNING_CONVERGENCE_WINDOW_DAYS_MIN}-${LEARNING_CONVERGENCE_WINDOW_DAYS_MAX}, default ${LEARNING_CONVERGENCE_WINDOW_DAYS_DEFAULT}). Re-read on every snapshot/aggregation tick so operator changes take effect on the next scrape without a restart.`,
  },
  [MEMORY_FEEDBACK_WINDOW_DAYS_SETTING]: {
    value: MEMORY_FEEDBACK_WINDOW_DAYS_DEFAULT,
    description: `Rolling window (in days) used to compute per-segment usefulness_ratio from explicit agent feedback (work item 66ea23d1-59f2-451b-a090-a292fad8f21b). The ratio is computed over feedback rows observed within the last N days; older rows are dropped from the numerator and denominator (range ${MEMORY_FEEDBACK_WINDOW_DAYS_MIN}-${MEMORY_FEEDBACK_WINDOW_DAYS_MAX}, default ${MEMORY_FEEDBACK_WINDOW_DAYS_DEFAULT}). Re-read on every aggregation tick so operator changes take effect on the next refresh without a restart.`,
  },
};
