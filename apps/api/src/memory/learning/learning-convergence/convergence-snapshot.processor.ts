import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { ConvergenceRecorderService } from './convergence-recorder.service';
import type {
  ConvergenceRecorderTickError,
  ConvergenceRecorderTickResult,
} from './convergence-recorder.service';
import {
  MEMORY_CONVERGENCE_JOB_NAME,
  MEMORY_CONVERGENCE_SNAPSHOT_QUEUE,
} from './convergence.constants';

/**
 * BullMQ processor for the daily convergence recorder queue
 * (work item 946a3c8b-5814-4e76-a804-b557e589600b,
 * milestone 3).
 *
 * The queue is dedicated to the daily recorder pass — the
 * processor owns the *work*; the schedule is owned by
 * {@link MemoryCronScheduler} which is registered on the same
 * queue at application bootstrap. Mirrors the
 * `MemoryDecayProcessor` / `MemoryDriftProcessor` /
 * `MemoryEvictionProcessor` shape so the four reapers /
 * recorder share the same BullMQ dispatch contract.
 *
 * Job name dispatch:
 *   The processor only handles the
 *   {@link MEMORY_CONVERGENCE_JOB_NAME} job name. Any other
 *   name that lands in the queue is logged at `debug` and
 *   returned as `null` so an accidental
 *   `queue.add('something-else', ...)` from an admin tool
 *   does not crash the worker. An operator-triggered manual
 *   run enqueues a one-shot job with the same
 *   `MEMORY_CONVERGENCE_JOB_NAME` and gets exactly the same
 *   `process(job)` dispatch path (AC-4 — manual trigger
 *   dedicated).
 *
 * Retry policy:
 *   The recorder's per-pass orchestration is wrapped in a
 *   try/catch that returns a typed
 *   {@link ConvergenceRecorderTickError} instead of throwing
 *   on persistence failures. The processor forwards the
 *   typed result to BullMQ as the job result, so a failed
 *   recorder pass shows up as a recorded (failed) result in
 *   BullMQ's job history. A hard failure that escapes the
 *   recorder (e.g. a missing dependency injection, an
 *   unhandled constructor throw) is re-thrown so BullMQ can
 *   retry per the queue's default policy (see
 *   `removeOnFail: 200` in {@link MemoryCronScheduler}).
 *
 * Job data contract:
 *   The repeatable cron tick enqueues an empty payload
 *   (`queue.add(jobName, {}, ...)` — see
 *   {@link MemoryCronScheduler.register}). The processor
 *   never reads `job.data`; the recorder reads everything
 *   it needs (rolling window, min-samples) from
 *   `SystemSettingsService` on every pass so operator
 *   tuning takes effect without a re-deploy.
 */
@Injectable()
@Processor(MEMORY_CONVERGENCE_SNAPSHOT_QUEUE)
export class ConvergenceSnapshotProcessor extends WorkerHost {
  private readonly logger = new Logger(ConvergenceSnapshotProcessor.name);

  constructor(private readonly recorder: ConvergenceRecorderService) {
    super();
  }

  /**
   * Dispatch the job by name. Only
   * {@link MEMORY_CONVERGENCE_JOB_NAME} is handled; anything
   * else is logged and returned as `null` so an
   * accidentally-registered sibling queue does not crash
   * the worker.
   *
   * The recorder's `tick()` returns a discriminated union
   * (`ConvergenceRecorderTickResult` on success,
   * `ConvergenceRecorderTickError` on a swallowed
   * persistence failure). The processor forwards the
   * result verbatim — BullMQ records it as the job result
   * so a failed pass shows up in the BullMQ history with
   * `outcome: 'failed'` for post-mortem inspection.
   */
  async process(
    job: Job<unknown>,
  ): Promise<
    ConvergenceRecorderTickResult | ConvergenceRecorderTickError | null
  > {
    if (job.name !== MEMORY_CONVERGENCE_JOB_NAME) {
      this.logger.debug(
        `Ignoring unknown convergence-snapshot queue task: ${job.name}`,
      );
      return null;
    }
    return this.handleCronTick();
  }

  /**
   * Run a single recorder pass and return the typed result
   * so BullMQ records it as the job result.
   *
   * The recorder already logs the per-pass summary on its
   * own logger (including the persisted snapshot row's
   * `computed_at` and the policy upsert outcome) and
   * updates the metrics (score gauge + recalibration
   * counter + best-effort audit event) on every pass. This
   * handler logs a tick-level wrapper so an operator
   * scanning the worker logs can correlate a BullMQ tick
   * with the recorder's internal per-pass log lines.
   *
   * The recorder's `tick()` does NOT throw on persistence
   * failures — it returns a typed `ConvergenceRecorderTickError`
   * after emitting the best-effort failure event. The
   * processor forwards the typed result verbatim. A hard
   * failure that escapes `tick()` (e.g. an unhandled
   * exception in the recorder's constructor or DI graph)
   * is re-thrown so BullMQ can retry per the queue's
   * default policy.
   */
  private async handleCronTick(): Promise<
    ConvergenceRecorderTickResult | ConvergenceRecorderTickError
  > {
    this.logger.log('ConvergenceRecorderCron tick received');

    try {
      const result = await this.recorder.tick();
      if (result instanceof Error) {
        // Typed recorder failure (persistence swallow). The
        // recorder already logged the cause and emitted the
        // best-effort failure event — forward the typed
        // result so BullMQ records the failure in its job
        // history.
        this.logger.warn(
          `ConvergenceRecorderCron tick returned typed failure: ${result.message}`,
        );
      } else {
        this.logger.debug(
          `ConvergenceRecorderCron tick summary: outcome=${result.outcome}, window=${result.window}, snapshot_id=${result.snapshot.computed_at.toISOString()}`,
        );
      }
      return result;
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        `ConvergenceRecorderCron tick failed: ${err.message}`,
        err.stack,
      );
      throw error;
    }
  }
}
