import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { SystemSettingsService } from '../../settings/system-settings.service';
import { normaliseCronExpression } from '../memory-eviction.processor';
import {
  FEEDBACK_WEIGHT_TUNER_QUEUE,
  FEEDBACK_WEIGHT_TUNER_JOB_NAME,
  FEEDBACK_WEIGHT_TUNER_DEFAULT_CRON,
  FEEDBACK_WEIGHT_TUNER_CRON_SETTING,
  FEEDBACK_WEIGHT_TUNER_REPEAT_JOB_ID,
  FEEDBACK_WEIGHT_TUNER_REMOVE_ON_COMPLETE,
  FEEDBACK_WEIGHT_TUNER_REMOVE_ON_FAIL,
} from './feedback-weight-tuner.constants';

/**
 * Registers the BullMQ repeatable job that drives the weekly
 * `FeedbackWeightTunerService` pass (EPIC-212 Phase-3 Task 9).
 *
 * The schedule is always registered (default Sunday 04:00 UTC); the work is
 * gated inside the service by `feedback_weight_tuner_enabled` (default off),
 * so a disabled tuner fires the tick but no-ops before any DB query.
 *
 * Mirrors `CandidateClustererScheduler`: `OnApplicationBootstrap` (safe
 * cross-module wiring phase), a stable `jobId` so an operator's cron change
 * replaces the schedule on the next bootstrap, and a swallowed-then-logged
 * registration failure (a non-critical weekly pass must never block boot).
 */
@Injectable()
export class FeedbackWeightTunerScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(FeedbackWeightTunerScheduler.name);

  private registered = false;

  constructor(
    @InjectQueue(FEEDBACK_WEIGHT_TUNER_QUEUE)
    private readonly queue: Queue,
    private readonly settings: SystemSettingsService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.scheduleTunerJob();
  }

  /**
   * Resolve the cron expression from {@link SystemSettingsService} and register
   * a repeatable job on the tuner queue. Public so tests can assert the BullMQ
   * argument shape without booting the full app.
   */
  async scheduleTunerJob(): Promise<void> {
    let cronExpression: string;

    try {
      const raw = await this.settings.get<unknown>(
        FEEDBACK_WEIGHT_TUNER_CRON_SETTING,
        FEEDBACK_WEIGHT_TUNER_DEFAULT_CRON,
      );
      cronExpression = normaliseCronExpression(
        raw,
        FEEDBACK_WEIGHT_TUNER_DEFAULT_CRON,
      );
    } catch (error) {
      const err = error as Error;
      this.logger.warn(
        `Failed to resolve ${FEEDBACK_WEIGHT_TUNER_CRON_SETTING} from SystemSettingsService; ` +
          `falling back to default '${FEEDBACK_WEIGHT_TUNER_DEFAULT_CRON}': ${err.message}`,
      );
      cronExpression = FEEDBACK_WEIGHT_TUNER_DEFAULT_CRON;
    }

    try {
      await this.queue.add(
        FEEDBACK_WEIGHT_TUNER_JOB_NAME,
        {},
        {
          jobId: FEEDBACK_WEIGHT_TUNER_REPEAT_JOB_ID,
          repeat: { pattern: cronExpression },
          removeOnComplete: FEEDBACK_WEIGHT_TUNER_REMOVE_ON_COMPLETE,
          removeOnFail: FEEDBACK_WEIGHT_TUNER_REMOVE_ON_FAIL,
        },
      );

      this.registered = true;
      this.logger.log(
        `FeedbackWeightTunerScheduler registered repeatable job '${FEEDBACK_WEIGHT_TUNER_JOB_NAME}' ` +
          `(jobId='${FEEDBACK_WEIGHT_TUNER_REPEAT_JOB_ID}', pattern='${cronExpression}')`,
      );
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        `FeedbackWeightTunerScheduler failed to register repeatable job ` +
          `'${FEEDBACK_WEIGHT_TUNER_JOB_NAME}' with pattern '${cronExpression}': ${err.message}`,
        err.stack,
      );
      // Swallow — the next process restart retries registration. A failed
      // registration must NOT crash the app; the tuner pass is non-critical.
    }
  }

  /** Returns `true` once a successful `queue.add(…)` was observed in this process. */
  wasRegistered(): boolean {
    return this.registered;
  }
}

export { FEEDBACK_WEIGHT_TUNER_REPEAT_JOB_ID };
