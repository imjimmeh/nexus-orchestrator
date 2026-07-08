import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { SystemSettingsService } from '../settings/system-settings.service';
import { MEMORY_SEGMENT_EVICTION_CRON } from '../settings/learning-settings.constants';
import { MemoryEvictionReaperService } from './memory-eviction.reaper';
import {
  DEFAULT_MEMORY_EVICTION_CRON,
  MEMORY_EVICTION_CRON_JOB,
  MEMORY_EVICTION_QUEUE,
} from './memory-eviction.constants';
import type { MemoryEvictionRunSummary } from './memory-eviction.types';

/**
 * BullMQ processor for the memory-eviction queue.
 *
 * The queue is dedicated to the daily usage-based memory segment
 * reaper (work item bef49c3a-0c0f-4c85-b134-29d839c72bad). The
 * processor owns the *work*; the schedule is owned by
 * {@link MemoryCronScheduler} which is registered on the same
 * queue at application bootstrap.
 *
 * Job name dispatch:
 *   The processor only handles the {@link MEMORY_EVICTION_CRON_JOB}
 *   job name. Any other name that lands in the queue is logged at
 *   `debug` and ignored — the reaper is the single consumer and
 *   there is no shared multi-job contract on this queue today.
 *
 * Retry policy:
 *   The reaper's per-row delete is best-effort (errors are caught
 *   and counted into the run summary); a hard failure that escapes
 *   `runOnce()` (e.g. a settings-service outage) is re-thrown so
 *   BullMQ can retry per the queue's default policy. The summary
 *   is the job result; a successful `null` return for an unknown
 *   job name is intentional and not a failure.
 */
@Injectable()
@Processor(MEMORY_EVICTION_QUEUE)
export class MemoryEvictionProcessor extends WorkerHost {
  private readonly logger = new Logger(MemoryEvictionProcessor.name);

  constructor(
    private readonly reaper: MemoryEvictionReaperService,
    private readonly settings: SystemSettingsService,
  ) {
    super();
  }

  /**
   * Dispatch the job by name. Only
   * {@link MEMORY_EVICTION_CRON_JOB} is handled; everything else
   * is logged and returned as a no-op so an accidental
   * `queue.add('something-else', ...)` from an admin tool does not
   * crash the worker.
   */
  async process(
    job: Job<Record<string, unknown>, unknown>,
  ): Promise<MemoryEvictionRunSummary | null> {
    if (job.name !== MEMORY_EVICTION_CRON_JOB) {
      this.logger.debug(
        `Ignoring unknown memory-eviction queue task: ${job.name}`,
      );
      return null;
    }
    return this.handleCronTick();
  }

  /**
   * Run a single reaper pass and return the summary so BullMQ
   * records it as the job result.
   *
   * The handler resolves the *current* cron expression from
   * {@link SystemSettingsService} and emits it on the run log
   * line. The value is not consulted for the actual tick (the
   * schedule is owned by the scheduler service); it is logged
   * purely for observability — operators tweaking
   * `memory_segment_eviction_cron` between ticks can confirm
   * what value the worker observed when the run started.
   */
  private async handleCronTick(): Promise<MemoryEvictionRunSummary> {
    const cronExpression = await this.readCronExpression();

    this.logger.log(
      `MemoryEvictionCron tick received (cron='${cronExpression}')`,
    );

    try {
      const summary = await this.reaper.runOnce();
      this.logger.debug(
        `MemoryEvictionCron tick summary: scanned=${summary.scanned.toString()}, evicted=${summary.evicted.toString()}, skipped=${summary.skipped.toString()}, errors=${summary.errors.toString()}, cron='${cronExpression}'`,
      );
      return summary;
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        `MemoryEvictionCron tick failed: ${err.message}`,
        err.stack,
      );
      throw error;
    }
  }

  /**
   * Read the live `memory_segment_eviction_cron` setting. A
   * failure to resolve the setting is non-fatal — the handler
   * logs a warning and falls back to the hardcoded default so a
   * transient settings-service outage does not skip the tick.
   */
  private async readCronExpression(): Promise<string> {
    try {
      const raw = await this.settings.get<unknown>(
        MEMORY_SEGMENT_EVICTION_CRON,
        DEFAULT_MEMORY_EVICTION_CRON,
      );
      return normaliseCronExpression(raw, DEFAULT_MEMORY_EVICTION_CRON);
    } catch (error) {
      const err = error as Error;
      this.logger.warn(
        `Failed to resolve ${MEMORY_SEGMENT_EVICTION_CRON} from SystemSettingsService; falling back to default '${DEFAULT_MEMORY_EVICTION_CRON}': ${err.message}`,
      );
      return DEFAULT_MEMORY_EVICTION_CRON;
    }
  }
}

/**
 * Coerce a stored `memory_segment_eviction_cron` value into a
 * non-empty string. The setting is stored as a JSON string; the
 * fallback is the hardcoded default. A non-string, empty-string,
 * or whitespace-only value is treated as "missing" and the
 * hardcoded default is returned.
 *
 * Exported for unit-test reuse so the coercion rule can be pinned
 * without spinning up the full NestJS module.
 */
export function normaliseCronExpression(
  value: unknown,
  fallback: string,
): string {
  if (typeof value !== 'string') {
    return fallback;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return fallback;
  }
  return trimmed;
}
