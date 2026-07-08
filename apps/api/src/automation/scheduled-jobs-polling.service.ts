import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { SystemSettingsService } from '../settings/system-settings.service';
import {
  DEFAULT_SCHEDULED_JOBS_POLL_INTERVAL_SECONDS,
  SCHEDULED_JOBS_ENABLED_KEY,
  SCHEDULED_JOBS_POLL_INTERVAL_SECONDS_KEY,
  SCHEDULED_JOBS_POLL_REPEAT_JOB_ID,
  SCHEDULED_JOBS_POLL_TICK_JOB,
  SCHEDULED_JOBS_QUEUE,
} from './scheduled-jobs.constants';

const MIN_POLL_INTERVAL_SECONDS = 5;

@Injectable()
export class ScheduledJobsPollingService implements OnModuleInit {
  private readonly logger = new Logger(ScheduledJobsPollingService.name);

  constructor(
    @InjectQueue(SCHEDULED_JOBS_QUEUE)
    private readonly scheduledJobsQueue: Queue,
    private readonly settings: SystemSettingsService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.configurePollingSchedule();
  }

  async configurePollingSchedule(): Promise<void> {
    const [enabledRaw, pollIntervalRaw] = await Promise.all([
      this.settings.get<boolean>(SCHEDULED_JOBS_ENABLED_KEY, true),
      this.settings.get<number>(
        SCHEDULED_JOBS_POLL_INTERVAL_SECONDS_KEY,
        DEFAULT_SCHEDULED_JOBS_POLL_INTERVAL_SECONDS,
      ),
    ]);

    if (!enabledRaw) {
      this.logger.log('Scheduled jobs polling is disabled by system setting');
      return;
    }

    const intervalSeconds =
      Number.isFinite(pollIntervalRaw) &&
      pollIntervalRaw >= MIN_POLL_INTERVAL_SECONDS
        ? Math.floor(pollIntervalRaw)
        : DEFAULT_SCHEDULED_JOBS_POLL_INTERVAL_SECONDS;

    await this.scheduledJobsQueue.add(
      SCHEDULED_JOBS_POLL_TICK_JOB,
      {},
      {
        jobId: SCHEDULED_JOBS_POLL_REPEAT_JOB_ID,
        repeat: {
          every: intervalSeconds * 1000,
        },
      },
    );

    this.logger.log(
      `Scheduled jobs polling configured for every ${intervalSeconds.toString()} seconds`,
    );
  }
}
