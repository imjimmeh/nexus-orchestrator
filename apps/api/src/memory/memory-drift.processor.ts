import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { MemoryDriftDetectionService } from './memory-drift-detection.service';
import {
  MEMORY_DRIFT_JOB_NAME,
  MEMORY_DRIFT_QUEUE,
} from './memory-drift.constants';
import type { MemoryDriftRunSummary } from './memory-drift.types';

/**
 * BullMQ processor for the memory-drift queue (work item
 * 0cead042-e823-4e26-9386-02042252ffb0).
 *
 * The queue is dedicated to the nightly source-file reality
 * check driven by `MemoryDriftDetectionService`. The processor
 * owns the *work*; the schedule is owned by
 * {@link MemoryCronScheduler} which is registered on the same
 * queue at application bootstrap.
 *
 * Job name dispatch:
 *   The processor only handles the
 *   {@link MEMORY_DRIFT_JOB_NAME} job name. Any other name
 *   that lands in the queue is logged at `debug` and ignored —
 *   the detector is the single consumer and there is no shared
 *   multi-job contract on this queue today.
 *
 * Retry policy:
 *   The detector's per-row evaluation is best-effort (errors
 *   are caught and counted into the run summary). A hard
 *   failure that escapes `runDriftPass()` (e.g. a transient DB
 *   outage on the candidate query) is re-thrown so BullMQ can
 *   retry per the queue's default policy. The summary is the
 *   job result so a manual retry can inspect what the previous
 *   pass produced before failing.
 */
@Injectable()
@Processor(MEMORY_DRIFT_QUEUE)
export class MemoryDriftProcessor extends WorkerHost {
  private readonly logger = new Logger(MemoryDriftProcessor.name);

  constructor(private readonly detector: MemoryDriftDetectionService) {
    super();
  }

  /**
   * Dispatch the job by name. Only
   * {@link MEMORY_DRIFT_JOB_NAME} is handled; everything else
   * is logged and returned as a no-op so an accidental
   * `queue.add('something-else', ...)` from an admin tool does
   * not crash the worker.
   */
  async process(
    _job: Job<Record<string, unknown>, unknown>,
  ): Promise<{ summary: MemoryDriftRunSummary } | null> {
    if (_job.name !== MEMORY_DRIFT_JOB_NAME) {
      this.logger.debug(
        `Ignoring unknown memory-drift queue task: ${_job.name}`,
      );
      return null;
    }
    return this.handleCronTick();
  }

  /**
   * Run a single detector pass and return the summary so
   * BullMQ records it as the job result.
   *
   * The detector already logs the per-pass summary on its own
   * logger; this handler logs a tick-level wrapper so an
   * operator scanning the worker logs can correlate a BullMQ
   * tick with the detector's internal per-pass log lines.
   */
  private async handleCronTick(): Promise<{ summary: MemoryDriftRunSummary }> {
    this.logger.log('MemoryDriftCron tick received');

    try {
      const summary = await this.detector.runDriftPass();
      this.logger.debug(
        `MemoryDriftCron tick summary: candidateCount=${summary.candidateCount.toString()}, checkedCount=${summary.checkedCount.toString()}, driftDetectedCount=${summary.driftDetectedCount.toString()}, errors=${summary.errors.length.toString()}, skipped=${summary.skipped.toString()}`,
      );
      return { summary };
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        `MemoryDriftCron tick failed: ${err.message}`,
        err.stack,
      );
      throw error;
    }
  }
}
