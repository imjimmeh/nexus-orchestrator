import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { RetrospectiveDrainService } from './retrospective-drain.service';
import type { DrainSummary } from './retrospective-drain.types';
import {
  RETROSPECTIVE_DRAIN_QUEUE,
  RETROSPECTIVE_DRAIN_JOB_NAME,
} from './retrospective-drain.constants';

/**
 * BullMQ processor for the retrospective-drain queue.
 *
 * The queue is dedicated to the budget-capped drain pass; this processor owns
 * the *work* (one `drainWindow()` tick) while the schedule is owned by
 * {@link RetrospectiveDrainScheduler}.
 *
 * Job-name dispatch: only {@link RETROSPECTIVE_DRAIN_JOB_NAME} is handled; any
 * other name is logged at `debug` and returned as `null` (the drain is the
 * single consumer of this queue).
 *
 * Retry policy: the drain's per-row work is fail-soft (one bad row is caught
 * and counted, not thrown). A hard failure that escapes `drainWindow()` (e.g. a
 * transient DB outage on the claim query) is re-thrown so BullMQ can apply the
 * queue's default retry/backoff. It is NOT swallowed.
 */
@Injectable()
@Processor(RETROSPECTIVE_DRAIN_QUEUE)
export class RetrospectiveDrainProcessor extends WorkerHost {
  private readonly logger = new Logger(RetrospectiveDrainProcessor.name);

  constructor(private readonly drain: RetrospectiveDrainService) {
    super();
  }

  async process(job: Job<unknown, DrainSummary>): Promise<DrainSummary | null> {
    if (job.name !== RETROSPECTIVE_DRAIN_JOB_NAME) {
      this.logger.debug(
        `Ignoring unknown retrospective-drain queue task: ${job.name}`,
      );
      return null;
    }
    return this.handleCronTick();
  }

  private async handleCronTick(): Promise<DrainSummary> {
    this.logger.log('RetrospectiveDrainProcessor cron tick received');
    try {
      return await this.drain.drainWindow();
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        `RetrospectiveDrainProcessor tick failed: ${err.message}`,
        err.stack,
      );
      throw error;
    }
  }
}
