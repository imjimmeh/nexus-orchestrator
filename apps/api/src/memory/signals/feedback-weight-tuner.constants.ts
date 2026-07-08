/**
 * Runtime constants for the weekly `FeedbackWeightTunerService` pass
 * (EPIC-212 Phase-3 Task 9).
 *
 * Mirrors the candidate-clusterer queue conventions: one dedicated queue per
 * pass, a stable `jobId` so a subsequent `queue.add` replaces the existing
 * schedule, and generous history retention for post-mortem inspection. The
 * pass itself is gated by `feedback_weight_tuner_enabled` (default off) inside
 * the service, so the schedule is always registered but the work no-ops until
 * an operator flips the flag.
 */

/** BullMQ queue name for the weekly weight-tuner pass. */
export const FEEDBACK_WEIGHT_TUNER_QUEUE = 'feedback-weight-tuner';

/** BullMQ repeatable-job name for the weekly tuner tick. */
export const FEEDBACK_WEIGHT_TUNER_JOB_NAME = 'feedback-weight-tuner.run';

/** Default cron expression — Sunday 04:00 UTC. */
export const FEEDBACK_WEIGHT_TUNER_DEFAULT_CRON = '0 4 * * 0';

/** `SystemSettingsService` key for the tuner cron expression. */
export const FEEDBACK_WEIGHT_TUNER_CRON_SETTING = 'feedback_weight_tuner_cron';

/**
 * Stable BullMQ repeat-job id. A subsequent `queue.add` with the same id
 * replaces the existing schedule, which is the desired behaviour when an
 * operator updates `feedback_weight_tuner_cron` and the next bootstrap
 * re-reads the value.
 */
export const FEEDBACK_WEIGHT_TUNER_REPEAT_JOB_ID = 'feedback-weight-tuner-cron';

/** Keep the last 100 completed runs for post-mortem inspection. */
export const FEEDBACK_WEIGHT_TUNER_REMOVE_ON_COMPLETE = 100;

/** Keep the last 200 failed runs for post-mortem inspection. */
export const FEEDBACK_WEIGHT_TUNER_REMOVE_ON_FAIL = 200;
