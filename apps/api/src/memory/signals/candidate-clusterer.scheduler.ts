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
  CANDIDATE_CLUSTERING_QUEUE,
  CANDIDATE_CLUSTERING_JOB_NAME,
  CANDIDATE_CLUSTERING_DEFAULT_CRON,
  CANDIDATE_CLUSTERING_CRON_SETTING,
  CANDIDATE_CLUSTERING_REPEAT_JOB_ID,
  CANDIDATE_CLUSTERING_REMOVE_ON_COMPLETE,
  CANDIDATE_CLUSTERING_REMOVE_ON_FAIL,
} from './candidate-clusterer.constants';

/**
 * Registers the BullMQ repeatable job that drives the nightly
 * `CandidateClustererService` pass.
 *
 * The pass runs at {@link CANDIDATE_CLUSTERING_DEFAULT_CRON} (01:00 UTC)
 * — 60 minutes before the memory-learning sweep at 02:00 UTC — so
 * near-duplicate pending candidates are collapsed before the sweep
 * scores and promotes them.
 *
 * Why `OnApplicationBootstrap` and not `OnModuleInit`:
 *   `OnApplicationBootstrap` runs after every module's `onModuleInit`
 *   has finished, which is the safe phase for cross-module wiring —
 *   the queue and the `SystemSettingsService` are guaranteed to be
 *   ready. Using `OnModuleInit` risks a race where the queue registration
 *   fires before BullMQ has initialised the connection.
 *
 * Failure policy:
 *   A one-shot failure to register the schedule (e.g. a transient Redis
 *   blip or an invalid operator-supplied cron expression) is logged and
 *   swallowed. The next process restart retries the registration.
 *   Crashing the app here would block unrelated features from booting
 *   for a non-critical nightly pass.
 */
@Injectable()
export class CandidateClustererScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(CandidateClustererScheduler.name);

  /**
   * Flipped to `true` once a successful BullMQ registration is observed
   * in this process. Used by `wasRegistered()` so health checks can surface
   * "the scheduler never registered" without inspecting BullMQ internals.
   */
  private registered = false;

  constructor(
    @InjectQueue(CANDIDATE_CLUSTERING_QUEUE)
    private readonly queue: Queue,
    private readonly settings: SystemSettingsService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.scheduleClusteringJob();
  }

  /**
   * Resolve the cron expression from {@link SystemSettingsService} and
   * register a repeatable job on the candidate-clustering queue.
   *
   * The `jobId` is stable so a subsequent call replaces the previous
   * schedule (BullMQ keys repeat schedules by id) — this is the desired
   * behaviour when an operator updates `candidate_clustering_cron` and
   * the next bootstrap re-reads the new value.
   *
   * Public (vs. `onApplicationBootstrap`) so tests can call it directly
   * to verify the BullMQ argument shape without booting the full app.
   */
  async scheduleClusteringJob(): Promise<void> {
    let cronExpression: string;

    try {
      const raw = await this.settings.get<unknown>(
        CANDIDATE_CLUSTERING_CRON_SETTING,
        CANDIDATE_CLUSTERING_DEFAULT_CRON,
      );
      cronExpression = normaliseCronExpression(
        raw,
        CANDIDATE_CLUSTERING_DEFAULT_CRON,
      );
    } catch (error) {
      const err = error as Error;
      this.logger.warn(
        `Failed to resolve ${CANDIDATE_CLUSTERING_CRON_SETTING} from SystemSettingsService; ` +
          `falling back to default '${CANDIDATE_CLUSTERING_DEFAULT_CRON}': ${err.message}`,
      );
      cronExpression = CANDIDATE_CLUSTERING_DEFAULT_CRON;
    }

    try {
      await this.queue.add(
        CANDIDATE_CLUSTERING_JOB_NAME,
        {},
        {
          jobId: CANDIDATE_CLUSTERING_REPEAT_JOB_ID,
          repeat: { pattern: cronExpression },
          removeOnComplete: CANDIDATE_CLUSTERING_REMOVE_ON_COMPLETE,
          removeOnFail: CANDIDATE_CLUSTERING_REMOVE_ON_FAIL,
        },
      );

      this.registered = true;
      this.logger.log(
        `CandidateClustererScheduler registered repeatable job '${CANDIDATE_CLUSTERING_JOB_NAME}' ` +
          `(jobId='${CANDIDATE_CLUSTERING_REPEAT_JOB_ID}', pattern='${cronExpression}', ` +
          `removeOnComplete=${CANDIDATE_CLUSTERING_REMOVE_ON_COMPLETE.toString()}, ` +
          `removeOnFail=${CANDIDATE_CLUSTERING_REMOVE_ON_FAIL.toString()})`,
      );
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        `CandidateClustererScheduler failed to register repeatable job ` +
          `'${CANDIDATE_CLUSTERING_JOB_NAME}' with pattern '${cronExpression}': ${err.message}`,
        err.stack,
      );
      // Swallow — the next process restart retries registration. A failed
      // registration must NOT crash the app; the clustering pass is non-critical.
    }
  }

  /**
   * Returns `true` if a successful `queue.add(…)` was observed in this
   * process. Exposed for tests and observability callers that need to know
   * whether the schedule is live without inspecting BullMQ internals.
   */
  wasRegistered(): boolean {
    return this.registered;
  }
}

/**
 * Re-export the repeat-job id for unit tests that want to assert on the
 * exact BullMQ argument shape without depending on the (otherwise
 * internal) `CANDIDATE_CLUSTERING_REPEAT_JOB_ID` binding in this module.
 */
export { CANDIDATE_CLUSTERING_REPEAT_JOB_ID };
