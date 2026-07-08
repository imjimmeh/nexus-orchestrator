import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { SystemSettingsService } from '../settings/system-settings.service';
import { ScheduledJobsService } from './scheduled-jobs.service';
import {
  DEFAULT_SCHEDULED_JOBS_POLL_BATCH_SIZE,
  SCHEDULED_JOBS_ENABLED_KEY,
  SCHEDULED_JOBS_POLL_BATCH_SIZE_KEY,
  SCHEDULED_JOBS_POLL_TICK_JOB,
  SCHEDULED_JOBS_QUEUE,
} from './scheduled-jobs.constants';
import type { PollDueSchedulesResult } from './scheduled-jobs.types';

@Injectable()
@Processor(SCHEDULED_JOBS_QUEUE)
export class ScheduledJobsConsumer extends WorkerHost {
  private readonly logger = new Logger(ScheduledJobsConsumer.name);

  constructor(
    private readonly settings: SystemSettingsService,
    private readonly scheduledJobsService: ScheduledJobsService,
  ) {
    super();
  }

  async process(
    job: Job<Record<string, unknown>, unknown>,
  ): Promise<PollDueSchedulesResult | null> {
    if (job.name !== SCHEDULED_JOBS_POLL_TICK_JOB) {
      this.logger.debug(
        `Ignoring unknown scheduled jobs queue task: ${job.name}`,
      );
      return null;
    }

    const [enabledRaw, batchSizeRaw] = await Promise.all([
      this.settings.get<boolean>(SCHEDULED_JOBS_ENABLED_KEY, true),
      this.settings.get<number>(
        SCHEDULED_JOBS_POLL_BATCH_SIZE_KEY,
        DEFAULT_SCHEDULED_JOBS_POLL_BATCH_SIZE,
      ),
    ]);

    if (!enabledRaw) {
      return {
        scanned: 0,
        started: 0,
        skipped: 0,
      };
    }

    const batchSize =
      Number.isFinite(batchSizeRaw) && batchSizeRaw > 0
        ? Math.floor(batchSizeRaw)
        : DEFAULT_SCHEDULED_JOBS_POLL_BATCH_SIZE;

    return this.scheduledJobsService.processDueSchedules({
      now: new Date(),
      batchSize,
    });
  }
}
