/**
 * Runtime constants for the nightly `MemoryDecayReaperService`
 * (work item 3d7fb798-f54d-40ff-a803-438224474912).
 *
 * The module centralises the source allowlist, the hardcoded
 * defaults, the canonical `SystemSettingsService` keys, and the
 * runtime identifiers (queue + job names) that the reaper service
 * and its scheduler will need once the follow-up milestones wire
 * the BullMQ scheduler and the reaper pass. This milestone only
 * defines the contract — the reaper service itself is intentionally
 * deferred to milestone 2.
 *
 * The settings-driven values (enabled flag, cron expression, grace
 * days, daily rate, floor) are persisted through
 * `SystemSettingsService` using the keys exposed via
 * {@link MEMORY_DECAY_SETTING_KEYS}. The constants below are the
 * *fallback* defaults that `SystemSettingsService.get(...)` returns
 * when a key is absent.
 *
 * Splitting the constants out of the settings module avoids a
 * circular dependency: the reaper service (in `apps/api/src/memory/`)
 * can import the queue/job names, the source allowlist, and the
 * hardcoded defaults without pulling in the settings module's full
 * surface area.
 */

/**
 * Source allowlist for the `MemoryDecayReaper`. A segment whose
 * `source` is in this set is exempt from decay regardless of how
 * stale it is — the same defensive contract that the eviction
 * reaper's `memory_segment_eviction_protected_sources` provides,
 * but tuned for the self-improvement feedback loop:
 *   - `learning_candidate` — promoted lessons backed by the
 *     human-review and auto-promotion flow. Silently decaying them
 *     would erode the system's ability to learn from past runs.
 *   - `workflow_failure_postmortem` — operator-authored
 *     post-mortems attached to failed workflow runs. These are
 *     pinned-equivalent and must not be decayed out of the active
 *     set.
 *   - `strategic_intent` — long-lived intent statements that drive
 *     multi-cycle planning. The decay reaper must never touch them.
 *   - `onboarding_chat` and `user_edit` — project-charter-origin
 *     sources written during the initial charter intake and operator
 *     edits. Decaying them would destroy the foundational intent
 *     that drives multi-cycle planning.
 *
 * The set is exported separately from the reaper service so unit
 * tests can pin the contract without depending on the (otherwise
 * internal) service binding.
 */
export const MEMORY_DECAY_EXEMPT_SOURCES: ReadonlySet<string> = new Set([
  'learning_candidate',
  'workflow_failure_postmortem',
  'strategic_intent',
  'onboarding_chat',
  'user_edit',
]);

/**
 * Default cron expression for the nightly reaper tick. Runs at
 * 03:30 UTC every day, intentionally off-peak for the orchestration
 * cycles (which peak during local business hours) and offset by 30
 * minutes from the eviction reaper's `0 3 * * *` so the two nightly
 * reapers do not race for the same DB connection budget.
 */
export const MEMORY_DECAY_DEFAULT_CRON = '30 3 * * *';

/** Hardcoded fallback for the `memory_decay_enabled` setting. */
export const MEMORY_DECAY_DEFAULT_ENABLED = true;

/** Hardcoded fallback for the `memory_decay_grace_days` setting. */
export const MEMORY_DECAY_DEFAULT_GRACE_DAYS = 30;

/** Hardcoded fallback for the `memory_decay_daily_rate` setting. */
export const MEMORY_DECAY_DEFAULT_DAILY_RATE = 0.01;

/** Hardcoded fallback for the `memory_decay_floor` setting. */
export const MEMORY_DECAY_DEFAULT_FLOOR = 0.2;

/**
 * Canonical `SystemSettingsService` keys for the memory-decay
 * reaper. The `SystemSettingsService.seedDefaults()` registration
 * (see `apps/api/src/settings/system-settings.service.ts`) reads
 * from this record so the keys and the seeded defaults can never
 * drift apart. The BullMQ scheduler milestone will read these same
 * keys at startup to honour operator changes without restarting
 * the app.
 */
export const MEMORY_DECAY_SETTING_KEYS = {
  cron: 'memory_decay_cron',
  enabled: 'memory_decay_enabled',
  graceDays: 'memory_decay_grace_days',
  dailyRate: 'memory_decay_daily_rate',
  floor: 'memory_decay_floor',
} as const;

/**
 * BullMQ queue name for the nightly memory-decay reaper. A separate
 * queue from the eviction reaper's `MEMORY_EVICTION_QUEUE` keeps the
 * two reapers' BullMQ repeat-schedule state disjoint so an operator
 * can pause the decay reaper independently of the eviction reaper
 * (and vice versa). The BullMQ scheduler milestone (work item
 * continuation) will add a processor on this queue.
 */
export const MEMORY_DECAY_QUEUE = 'memory-decay';

/** BullMQ repeatable-job name for the nightly reaper tick. */
export const MEMORY_DECAY_JOB_NAME = 'memory-decay-reaper';
