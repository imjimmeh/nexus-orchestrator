/**
 * Runtime constants for the nightly `CandidateClustererService` pass.
 *
 * The clustering pass runs at 01:00 UTC — 60 minutes before the
 * memory-learning sweep at 02:00 UTC — so near-duplicate pending
 * candidates are collapsed into canonical rows (and their
 * `recurrence_count` is updated) before the sweep scores and
 * promotes them.
 *
 * The BullMQ queue, job name, and repeat-job id follow the same
 * conventions as the memory-eviction, memory-decay, and memory-drift
 * queues: one dedicated queue per pass, a stable `jobId` so a
 * subsequent `queue.add` replaces the existing schedule, and
 * generous history-retention for post-mortem inspection.
 */

/** BullMQ queue name for the nightly candidate-clustering pass. */
export const CANDIDATE_CLUSTERING_QUEUE = 'candidate-clustering';

/** BullMQ repeatable-job name for the nightly clustering tick. */
export const CANDIDATE_CLUSTERING_JOB_NAME = 'candidate-clustering.run';

/**
 * Default cron expression for the nightly clustering pass.
 * Runs at 01:00 UTC every day, 60 minutes before the memory-learning
 * sweep.
 */
export const CANDIDATE_CLUSTERING_DEFAULT_CRON = '0 1 * * *';

/**
 * `SystemSettingsService` key for the clustering cron expression.
 * Operators can override the schedule via this key without a restart.
 */
export const CANDIDATE_CLUSTERING_CRON_SETTING = 'candidate_clustering_cron';

/**
 * Stable BullMQ repeat-job id. A subsequent `queue.add` call with the
 * same id replaces the existing schedule, which is the desired
 * behaviour when an operator updates `candidate_clustering_cron` and
 * the next bootstrap re-reads the value.
 */
export const CANDIDATE_CLUSTERING_REPEAT_JOB_ID = 'candidate-clustering-cron';

/** Keep the last 100 completed runs for post-mortem inspection. */
export const CANDIDATE_CLUSTERING_REMOVE_ON_COMPLETE = 100;

/** Keep the last 200 failed runs for post-mortem inspection. */
export const CANDIDATE_CLUSTERING_REMOVE_ON_FAIL = 200;
