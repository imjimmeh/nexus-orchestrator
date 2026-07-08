import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { SystemSettingsService } from '../../settings/system-settings.service';
import { normaliseCronExpression } from '../../memory/memory-eviction.processor';
import {
  RETROSPECTIVE_DRAIN_QUEUE,
  RETROSPECTIVE_DRAIN_JOB_NAME,
  RETROSPECTIVE_DRAIN_DEFAULT_CRON,
  RETROSPECTIVE_DRAIN_CRON_SETTING,
  RETROSPECTIVE_DRAIN_REPEAT_JOB_ID,
  RETROSPECTIVE_DRAIN_REMOVE_ON_COMPLETE,
  RETROSPECTIVE_DRAIN_REMOVE_ON_FAIL,
} from './retrospective-drain.constants';

/**
 * Registers the BullMQ repeatable job that drives the budget-capped
 * retrospective drain (EPIC-212 Phase-2 Task 3).
 *
 * Mirrors `CandidateClustererScheduler`:
 *   - `OnApplicationBootstrap` runs after every module's `onModuleInit`, the
 *     safe phase for cross-module wiring (queue + `SystemSettingsService`
 *     guaranteed ready).
 *   - The cron is read from `SystemSettingsService` and normalised via the
 *     shared `normaliseCronExpression` (no hand-rolled cron parsing).
 *   - The `jobId` is stable so a subsequent registration replaces the prior
 *     schedule when an operator re-tunes `retrospective_drain_cron`.
 *
 * Failure policy: a registration failure (transient Redis blip, invalid
 * operator cron) is logged and SWALLOWED — the next restart retries. Crashing
 * the app for a non-critical cost-governing pass is unacceptable.
 */
@Injectable()
export class RetrospectiveDrainScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(RetrospectiveDrainScheduler.name);

  /** Flipped `true` once a successful BullMQ registration is observed. */
  private registered = false;

  constructor(
    @InjectQueue(RETROSPECTIVE_DRAIN_QUEUE)
    private readonly queue: Queue,
    private readonly settings: SystemSettingsService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.scheduleDrainJob();
  }

  /**
   * Resolve the cron from {@link SystemSettingsService} and register a
   * repeatable job on the drain queue. Public so tests can assert the BullMQ
   * argument shape without booting the full app.
   */
  async scheduleDrainJob(): Promise<void> {
    let cronExpression: string;

    try {
      const raw = await this.settings.get<unknown>(
        RETROSPECTIVE_DRAIN_CRON_SETTING,
        RETROSPECTIVE_DRAIN_DEFAULT_CRON,
      );
      cronExpression = normaliseCronExpression(
        raw,
        RETROSPECTIVE_DRAIN_DEFAULT_CRON,
      );
    } catch (error) {
      const err = error as Error;
      this.logger.warn(
        `Failed to resolve ${RETROSPECTIVE_DRAIN_CRON_SETTING} from SystemSettingsService; ` +
          `falling back to default '${RETROSPECTIVE_DRAIN_DEFAULT_CRON}': ${err.message}`,
      );
      cronExpression = RETROSPECTIVE_DRAIN_DEFAULT_CRON;
    }

    try {
      await this.queue.add(
        RETROSPECTIVE_DRAIN_JOB_NAME,
        {},
        {
          jobId: RETROSPECTIVE_DRAIN_REPEAT_JOB_ID,
          repeat: { pattern: cronExpression },
          removeOnComplete: RETROSPECTIVE_DRAIN_REMOVE_ON_COMPLETE,
          removeOnFail: RETROSPECTIVE_DRAIN_REMOVE_ON_FAIL,
        },
      );

      this.registered = true;
      this.logger.log(
        `RetrospectiveDrainScheduler registered repeatable job '${RETROSPECTIVE_DRAIN_JOB_NAME}' ` +
          `(jobId='${RETROSPECTIVE_DRAIN_REPEAT_JOB_ID}', pattern='${cronExpression}', ` +
          `removeOnComplete=${RETROSPECTIVE_DRAIN_REMOVE_ON_COMPLETE.toString()}, ` +
          `removeOnFail=${RETROSPECTIVE_DRAIN_REMOVE_ON_FAIL.toString()})`,
      );
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        `RetrospectiveDrainScheduler failed to register repeatable job ` +
          `'${RETROSPECTIVE_DRAIN_JOB_NAME}' with pattern '${cronExpression}': ${err.message}`,
        err.stack,
      );
      // Swallow — the next process restart retries. A failed registration must
      // NOT crash the app; the drain is a non-critical cost-governing pass.
    }
  }

  /**
   * Returns `true` if a successful `queue.add(…)` was observed in this process.
   * Exposed for tests / observability without inspecting BullMQ internals.
   */
  wasRegistered(): boolean {
    return this.registered;
  }
}

/**
 * Re-export the repeat-job id for unit tests that assert the exact BullMQ
 * argument shape without depending on the (otherwise internal) constant import.
 */
export { RETROSPECTIVE_DRAIN_REPEAT_JOB_ID };
