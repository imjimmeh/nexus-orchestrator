import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { MemoryDecayReaperService } from './memory-decay.reaper';
import {
  MEMORY_DECAY_JOB_NAME,
  MEMORY_DECAY_QUEUE,
} from './memory-decay.constants';
import type { MemoryDecayRunSummary } from './memory-decay.types';

/**
 * BullMQ processor for the memory-decay queue.
 *
 * The queue is dedicated to the nightly confidence-decay reaper
 * (work item WI-2026-052, continuation of 3d7fb798). The
 * processor owns the *work*; the schedule is owned by
 * {@link MemoryCronScheduler} which is registered on the same
 * queue at application bootstrap.
 *
 * Job name dispatch:
 *   The processor only handles the {@link MEMORY_DECAY_JOB_NAME}
 *   job name. Any other name that lands in the queue is logged at
 *   `debug` and ignored — the reaper is the single consumer and
 *   there is no shared multi-job contract on this queue today.
 *
 * Retry policy:
 *   The reaper's per-row evaluation is best-effort (errors are
 *   caught and counted into the run summary). A hard failure
 *   that escapes `runDecayPass()` (e.g. a transient DB outage on
 *   the candidate query or a settings-service outage) is
 *   re-thrown so BullMQ can retry per the queue's default
 *   policy. The summary is the job result; a successful `null`
 *   return for an unknown job name is intentional and not a
 *   failure.
 */
@Injectable()
@Processor(MEMORY_DECAY_QUEUE)
export class MemoryDecayProcessor extends WorkerHost {
  private readonly logger = new Logger(MemoryDecayProcessor.name);

  constructor(private readonly reaper: MemoryDecayReaperService) {
    super();
  }

  /**
   * Dispatch the job by name. Only {@link MEMORY_DECAY_JOB_NAME}
   * is handled; everything else is logged and returned as a no-op
   * so an accidental `queue.add('something-else', ...)` from an
   * admin tool does not crash the worker.
   */
  async process(
    job: Job<unknown, MemoryDecayRunSummary>,
  ): Promise<MemoryDecayRunSummary | null> {
    if (job.name !== MEMORY_DECAY_JOB_NAME) {
      this.logger.debug(
        `Ignoring unknown memory-decay queue task: ${job.name}`,
      );
      return null;
    }
    return this.handleCronTick();
  }

  /**
   * Run a single reaper pass and return the summary so BullMQ
   * records it as the job result.
   *
   * The reaper already logs the per-pass summary on its own
   * logger (including the resolved grace/rate/floor settings)
   * and updates the `memoryDecayLastRun` snapshot on every
   * pass — including kill-switch short-circuits — so the
   * snapshot always reflects "the reaper was awake". This
   * handler logs a tick-level wrapper so an operator scanning
   * the worker logs can correlate a BullMQ tick with the
   * reaper's internal per-pass log lines.
   */
  private async handleCronTick(): Promise<MemoryDecayRunSummary> {
    this.logger.log('MemoryDecayCron tick received');

    try {
      const summary = await this.reaper.runDecayPass();
      this.logger.debug(
        `MemoryDecayCron tick summary: evaluated=${summary.evaluated.toString()}, decayed=${summary.decayed.toString()}, archived=${summary.archived.toString()}, skipped=${summary.skipped.toString()}`,
      );
      return summary;
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        `MemoryDecayCron tick failed: ${err.message}`,
        err.stack,
      );
      throw error;
    }
  }
}
