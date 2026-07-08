/**
 * Runtime constants for the budget-capped retrospective drain (EPIC-212
 * Phase-2 Task 3).
 *
 * The drain is the cost governor of the analyst pipeline: a BullMQ repeatable
 * job claims the top-N highest-interest `queued` rows per window and hands each
 * to the (Task 6) analysis orchestrator, while `bypass` rows are analyzed
 * immediately outside the window. The queue, job name, and repeat-job id follow
 * the same conventions as the candidate-clusterer, memory-eviction,
 * memory-decay, and memory-drift queues: one dedicated queue per pass, a stable
 * `jobId` so a subsequent `queue.add` replaces the existing schedule, and
 * generous history-retention for post-mortem inspection.
 */

/** BullMQ queue name for the retrospective drain pass. */
export const RETROSPECTIVE_DRAIN_QUEUE = 'retrospective-drain';

/** BullMQ repeatable-job name for the drain tick. */
export const RETROSPECTIVE_DRAIN_JOB_NAME = 'retrospective-drain.run';

/**
 * Default cron expression for the drain pass. Runs hourly at minute 0 — often
 * enough to keep latency low for high-signal runs without flooding the
 * light-tier analyst (the per-window budget bounds spend regardless).
 */
export const RETROSPECTIVE_DRAIN_DEFAULT_CRON = '0 * * * *';

/**
 * `SystemSettingsService` key for the drain cron expression. Operators can
 * override the schedule via this key without a restart.
 */
export const RETROSPECTIVE_DRAIN_CRON_SETTING = 'retrospective_drain_cron';

/**
 * Stable BullMQ repeat-job id. A subsequent `queue.add` call with the same id
 * replaces the existing schedule — the desired behaviour when an operator
 * updates `retrospective_drain_cron` and the next bootstrap re-reads the value.
 */
export const RETROSPECTIVE_DRAIN_REPEAT_JOB_ID = 'retrospective-drain-cron';

/** Keep the last 100 completed runs for post-mortem inspection. */
export const RETROSPECTIVE_DRAIN_REMOVE_ON_COMPLETE = 100;

/** Keep the last 200 failed runs for post-mortem inspection. */
export const RETROSPECTIVE_DRAIN_REMOVE_ON_FAIL = 200;
