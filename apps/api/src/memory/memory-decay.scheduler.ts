/**
 * Pure helper for registering the `memory-decay` BullMQ
 * repeatable job. Extracted out of `memory-decay.reaper.ts` so
 * the `MemoryDecayReaperService` stays under the project's
 * `max-lines` lint cap and so the registration logic has a
 * dedicated, unit-testable seam.
 *
 * The `MemoryDecayReaperService.scheduleDecayJob()` public
 * method delegates to {@link registerMemoryDecayRepeatableJob}
 * — the public surface and its method signature are preserved
 * byte-identically so existing callers (NestJS bootstrap, tests)
 * do not need to change.
 */
import {
  MEMORY_DECAY_DEFAULT_CRON,
  MEMORY_DECAY_JOB_NAME,
  MEMORY_DECAY_SETTING_KEYS,
} from './memory-decay.constants';
import { normaliseCronExpression } from './memory-eviction.processor';
import type { MemoryDecaySchedulerDeps } from './memory-decay.scheduler.types';

/**
 * Stable `jobId` used when registering the repeatable job with
 * BullMQ. Mirrors the eviction reaper's
 * `MEMORY_EVICTION_REPEAT_JOB_ID` convention — BullMQ keys the
 * repeat schedule by this id, so a subsequent `queue.add` with the
 * same id replaces the existing schedule, which is what we want
 * when an operator updates `memory_decay_cron` and the next
 * bootstrap re-reads the value.
 */
export const MEMORY_DECAY_REPEAT_JOB_ID = 'memory-decay-cron';

/**
 * Resolve the cron expression from the supplied
 * {@link SystemSettingsService} and register a repeatable job on
 * the memory-decay queue. The `jobId` is stable so a subsequent
 * registration replaces the previous schedule (BullMQ keys repeat
 * schedules by id).
 *
 * The default fallback is the same default the reaper uses for
 * every other decay setting — if the stored value is missing,
 * non-string, or empty, the registration proceeds with the
 * hardcoded `'30 3 * * *'`. We deliberately do NOT validate the
 * cron expression here: BullMQ delegates to `cron-parser`
 * internally and will throw a descriptive error if the
 * operator-supplied pattern is unparseable, which the `catch`
 * block logs and converts to a no-op.
 *
 * Safe to invoke when the BullMQ queue is not registered
 * (e.g. a unit-test module wiring that omits the queue) — the
 * call is a no-op and the reaper can still be driven manually via
 * `runDecayPass()`. A failure to register (e.g. a transient Redis
 * blip or an unparseable cron expression) is logged and swallowed
 * — the next process restart retries the registration.
 */
export async function registerMemoryDecayRepeatableJob(
  deps: MemoryDecaySchedulerDeps,
): Promise<void> {
  const { queue, settings, logger } = deps;
  if (!queue) {
    logger.debug(
      `MemoryDecayReaper scheduleDecayJob called without a BullMQ queue binding; skipping registration (the reaper can still be driven via runDecayPass())`,
    );
    return;
  }

  let cronExpression: string;
  try {
    const raw = await settings.get<unknown>(
      MEMORY_DECAY_SETTING_KEYS.cron,
      MEMORY_DECAY_DEFAULT_CRON,
    );
    cronExpression = normaliseCronExpression(raw, MEMORY_DECAY_DEFAULT_CRON);
  } catch (error) {
    const err = error as Error;
    logger.warn(
      `Failed to resolve ${MEMORY_DECAY_SETTING_KEYS.cron} from SystemSettingsService; falling back to default '${MEMORY_DECAY_DEFAULT_CRON}': ${err.message}`,
    );
    cronExpression = MEMORY_DECAY_DEFAULT_CRON;
  }

  try {
    await queue.add(
      MEMORY_DECAY_JOB_NAME,
      {},
      {
        jobId: MEMORY_DECAY_REPEAT_JOB_ID,
        repeat: {
          pattern: cronExpression,
        },
        removeOnComplete: MEMORY_DECAY_REMOVE_ON_COMPLETE,
        removeOnFail: MEMORY_DECAY_REMOVE_ON_FAIL,
      },
    );
    logger.log(
      `MemoryDecayScheduler registered repeatable job '${MEMORY_DECAY_JOB_NAME}' (jobId='${MEMORY_DECAY_REPEAT_JOB_ID}', pattern='${cronExpression}', removeOnComplete=${MEMORY_DECAY_REMOVE_ON_COMPLETE.toString()}, removeOnFail=${MEMORY_DECAY_REMOVE_ON_FAIL.toString()})`,
    );
  } catch (error) {
    const err = error as Error;
    logger.error(
      `MemoryDecayScheduler failed to register repeatable job '${MEMORY_DECAY_JOB_NAME}' with pattern '${cronExpression}': ${err.message}`,
      err.stack,
    );
    // Swallow the error — the next process restart retries the
    // registration. A failed registration must NOT crash the
    // app; the reaper is non-critical and recovers on its own.
  }
}

/**
 * History-retention knobs for the repeatable job. Mirrors the
 * eviction reaper's defaults — keep the last 100 completed runs
 * and 200 failed runs for post-mortem inspection.
 */
export const MEMORY_DECAY_REMOVE_ON_COMPLETE = 100;
export const MEMORY_DECAY_REMOVE_ON_FAIL = 200;
