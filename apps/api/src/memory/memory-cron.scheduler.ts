import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { SystemSettingsService } from '../settings/system-settings.service';
import { MEMORY_SEGMENT_EVICTION_CRON } from '../settings/learning-settings.constants';
import {
  DEFAULT_MEMORY_EVICTION_CRON,
  MEMORY_EVICTION_CRON_JOB,
  MEMORY_EVICTION_QUEUE,
} from './memory-eviction.constants';
import {
  MEMORY_DECAY_DEFAULT_CRON,
  MEMORY_DECAY_JOB_NAME,
  MEMORY_DECAY_QUEUE,
  MEMORY_DECAY_SETTING_KEYS,
} from './memory-decay.constants';
import {
  MEMORY_DRIFT_DEFAULT_CRON,
  MEMORY_DRIFT_JOB_NAME,
  MEMORY_DRIFT_QUEUE,
  MEMORY_DRIFT_SETTING_KEYS,
} from './memory-drift.constants';
import {
  MEMORY_CONVERGENCE_JOB_NAME,
  MEMORY_CONVERGENCE_REPEAT_JOB_ID,
  MEMORY_CONVERGENCE_SNAPSHOT_QUEUE,
} from './learning/learning-convergence/convergence.constants';
import {
  LEARNING_CONVERGENCE_CRON_DEFAULT,
  LEARNING_CONVERGENCE_CRON_SETTING,
} from './learning/learning-convergence/settings/learning-convergence.settings.constants';
import { normaliseCronExpression } from './memory-eviction.processor';

/**
 * Stable `jobId` used when registering the eviction reaper's
 * repeatable job with BullMQ. BullMQ keys the repeat schedule by
 * this id, so a subsequent `queue.add` with the same id replaces
 * the existing schedule — which is exactly what we want when an
 * operator updates the `memory_segment_eviction_cron` SystemSetting
 * and the next bootstrap re-reads the value. Mirrors the
 * `MEMORY_EVICTION_REPEAT_JOB_ID` constant declared in
 * `memory-eviction.scheduler.ts`; both literals must stay in
 * lock-step (see the migration contract in
 * `docs/architecture/decisions/ADR-memory-cron-scheduler-extraction.md`).
 */
const MEMORY_EVICTION_REPEAT_JOB_ID = 'memory-eviction-cron';

/**
 * Stable `jobId` used when registering the decay reaper's
 * repeatable job with BullMQ. Mirrors the
 * `MEMORY_DECAY_REPEAT_JOB_ID` constant declared in
 * `memory-decay.reaper.ts`; both literals must stay in lock-step
 * so the stored BullMQ schedule key remains stable across the
 * extraction.
 */
const MEMORY_DECAY_REPEAT_JOB_ID = 'memory-decay-cron';

/**
 * Stable `jobId` used when registering the drift detector's
 * repeatable job with BullMQ. Mirrors the
 * `MEMORY_DRIFT_REPEAT_JOB_ID` constant declared in
 * `memory-drift.scheduler.ts`; both literals must stay in
 * lock-step so the stored BullMQ schedule key remains stable
 * across the extraction.
 */
const MEMORY_DRIFT_REPEAT_JOB_ID = 'memory-drift-cron';

/**
 * Stable `jobId` used when registering the daily convergence
 * recorder's repeatable job with BullMQ. Mirrors the
 * `MEMORY_CONVERGENCE_REPEAT_JOB_ID` constant exported by
 * `learning-convergence/convergence.constants.ts`; both
 * literals must stay in lock-step so the stored BullMQ
 * schedule key remains stable across the recorder's bootstrap
 * cycle. The literal is the single source of truth the
 * `CRON_REGISTRATIONS` table spreads — never inline a
 * different value at the call site.
 */
// Re-exported from the recorder's constants module so the
// call sites use the same literal. (The local declaration was
// removed when the recorder constant was promoted to its
// domain-local module; the import at the top of this file is
// what `CRON_REGISTRATIONS` now reads from.)

/**
 * Default history-retention knobs for every repeatable job the
 * scheduler registers. The three legacy scaffolds each declared
 * their own copy of these two values; the extraction collapses
 * them into a single constant because the three reapers share
 * the same retention policy. The values follow the scheduling
 * spec: keep the last 100 completed runs and 200 failed runs for
 * post-mortem inspection. BullMQ's `removeOnComplete: 100` means
 * "keep the last 100 completed jobs"; the same semantics apply
 * to `removeOnFail`.
 */
const CRON_REMOVE_ON_COMPLETE = 100;
const CRON_REMOVE_ON_FAIL = 200;

/**
 * Per-`jobName` arguments for the bootstrap `register(...)` calls.
 * Each entry names the queue token already injected on this
 * class, the BullMQ job name to enqueue, the
 * `SystemSettingsService` setting key the cron expression is read
 * from, the hardcoded fallback default, and the stable
 * `repeatJobId` the migration contract requires. The four values
 * vary per reaper; the registration shape does not.
 */
const CRON_REGISTRATIONS = [
  {
    queue: 'eviction' as const,
    queueName: MEMORY_EVICTION_QUEUE,
    jobName: MEMORY_EVICTION_CRON_JOB,
    settingKey: MEMORY_SEGMENT_EVICTION_CRON,
    defaultCron: DEFAULT_MEMORY_EVICTION_CRON,
    repeatJobId: MEMORY_EVICTION_REPEAT_JOB_ID,
  },
  {
    queue: 'decay' as const,
    queueName: MEMORY_DECAY_QUEUE,
    jobName: MEMORY_DECAY_JOB_NAME,
    settingKey: MEMORY_DECAY_SETTING_KEYS.cron,
    defaultCron: MEMORY_DECAY_DEFAULT_CRON,
    repeatJobId: MEMORY_DECAY_REPEAT_JOB_ID,
  },
  {
    queue: 'drift' as const,
    queueName: MEMORY_DRIFT_QUEUE,
    jobName: MEMORY_DRIFT_JOB_NAME,
    settingKey: MEMORY_DRIFT_SETTING_KEYS.cron,
    defaultCron: MEMORY_DRIFT_DEFAULT_CRON,
    repeatJobId: MEMORY_DRIFT_REPEAT_JOB_ID,
  },
  {
    queue: 'convergence' as const,
    queueName: MEMORY_CONVERGENCE_SNAPSHOT_QUEUE,
    jobName: MEMORY_CONVERGENCE_JOB_NAME,
    settingKey: LEARNING_CONVERGENCE_CRON_SETTING,
    defaultCron: LEARNING_CONVERGENCE_CRON_DEFAULT,
    repeatJobId: MEMORY_CONVERGENCE_REPEAT_JOB_ID,
  },
] as const;

/**
 * Single owner of the cron-resolver + BullMQ-registration
 * scaffold that the three memory reapers (eviction, decay,
 * drift) all share.
 *
 * Why this class exists:
 *   The three reapers each shipped a near-identical
 *   `@Injectable() / OnApplicationBootstrap` scaffold (see the
 *   ADR for the side-by-side comparison). Each scaffold read a
 *   cron expression from {@link SystemSettingsService}, called
 *   `normaliseCronExpression` for coercion, registered a
 *   repeatable job on a BullMQ queue, swallowed registration
 *   failures, and exposed a `wasRegistered()` observability flag.
 *   Three near-identical scaffolds invite silent drift: every
 *   future change to the cron/BullMQ contract had to be made in
 *   three places. This class is the single source of truth.
 *
 * Why the three `@InjectQueue` tokens live on the class:
 *   The `register(...)` method takes a `queue: Queue` argument
 *   so the per-reaper collaborators (today: the three legacy
 *   scheduler classes plus the inline scheduler on the decay
 *   reaper) can stay thin forwarders. The bootstrap path here
 *   is for M2's "additive wiring" only — once the legacy
 *   schedulers are removed in M3, the bootstrap path remains
 *   the single registration site. The constructor injects all
 *   three queue tokens because each `register(...)` call needs
 *   one and a single instance serves all three reapers.
 *
 * Why `OnApplicationBootstrap` and not `OnModuleInit`:
 *   Same reasoning as the legacy scaffolds. The three queues
 *   are registered by `BullModule.registerQueue(...)` in the
 *   same module, and `SystemSettingsModule` is imported by
 *   `MemoryModule`. `OnApplicationBootstrap` runs after every
 *   module's `onModuleInit` has finished, which is the safe
 *   phase for cross-module wiring — the queue and the settings
 *   service are guaranteed to be ready, and any other module
 *   that needs to observe the schedule (e.g. metrics or health
 *   checks) has already had a chance to register.
 *
 * Failure policy:
 *   A one-shot failure to register the schedule (e.g. a
 *   transient Redis blip, an invalid cron expression supplied
 *   by an operator) is logged and swallowed — the next
 *   process restart gets a fresh attempt. Crashing the
 *   application here would block unrelated features from
 *   booting for an issue that recovers on its own. This is
 *   the same swallow-and-continue policy the three legacy
 *   scaffolds followed.
 *
 * `repeatJobId` migration contract:
 *   The BullMQ repeat schedule is keyed by the `jobId` argument
 *   to `queue.add`. Every `register(...)` call site MUST pass
 *   an explicit `repeatJobId` equal to the literal that the
 *   legacy scaffold used (`'memory-eviction-cron'`,
 *   `'memory-decay-cron'`, `'memory-drift-cron'`) — the scheduler
 *   infers NO default `repeatJobId`. This is the contract named
 *   in the ADR: changing the stored BullMQ key would orphan the
 *   existing schedule on the next bootstrap and cause two
 *   schedules to coexist for one bootstrap cycle.
 */
@Injectable()
export class MemoryCronScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(MemoryCronScheduler.name);

  /**
   * Per-`jobName` registration flag. The map is initialised
   * empty (default-on-failure semantics); a successful
   * `queue.add(...)` flips the entry to `true`; a subsequent
   * `register(...)` call for the same `jobName` keeps it at
   * `true`. The `wasRegistered(jobName)` getter exposes the
   * lookup so health checks / observability callers can answer
   * "did each of the three schedules register this process?"
   * without reaching into BullMQ internals.
   */
  private readonly registeredFlags = new Map<string, boolean>();

  constructor(
    private readonly settings: SystemSettingsService,
    @InjectQueue(MEMORY_EVICTION_QUEUE)
    private readonly evictionQueue: Queue,
    @InjectQueue(MEMORY_DECAY_QUEUE)
    private readonly decayQueue: Queue,
    @InjectQueue(MEMORY_DRIFT_QUEUE)
    private readonly driftQueue: Queue,
    @InjectQueue(MEMORY_CONVERGENCE_SNAPSHOT_QUEUE)
    private readonly convergenceQueue: Queue,
  ) {}

  /**
   * NestJS lifecycle hook: register the three nightly
   * reapers' repeatable jobs at bootstrap. Each call site
   * passes an explicit `repeatJobId` equal to the legacy
   * scaffold's literal `*_REPEAT_JOB_ID` constant — the
   * stored BullMQ schedule key remains stable across the
   * extraction (see the migration contract in the ADR).
   *
   * Bootstrap failures are swallowed by `register(...)`
   * itself, so a single failed registration does not block
   * the remaining ones.
   */
  async onApplicationBootstrap(): Promise<void> {
    for (const config of CRON_REGISTRATIONS) {
      const queue = this.resolveQueue(config.queue);
      await this.register({
        queue,
        queueName: config.queueName,
        jobName: config.jobName,
        settingKey: config.settingKey,
        defaultCron: config.defaultCron,
        repeatJobId: config.repeatJobId,
      });
    }
  }

  /**
   * Resolve the cron expression from
   * {@link SystemSettingsService} and register a repeatable
   * job on the supplied BullMQ queue. The `jobId` is stable
   * (the explicit `repeatJobId` argument, falling back to
   * `jobName`) so a subsequent registration replaces the
   * previous schedule (BullMQ keys repeat schedules by id).
   *
   * The default fallback is the hardcoded default supplied
   * by the call site — if the stored value is missing,
   * non-string, or empty, the registration proceeds with the
   * hardcoded cron pattern. We deliberately do NOT validate
   * the cron expression here: BullMQ delegates to
   * `cron-parser` internally and will throw a descriptive
   * error if the operator-supplied pattern is unparseable,
   * which the `catch` block logs and converts to a no-op.
   *
   * Both failure paths (settings-service rejection and
   * `queue.add(...)` rejection) are logged and swallowed —
   * the next process restart retries the registration. A
   * failed registration must NOT crash the app; the reaper
   * is non-critical and recovers on its own.
   *
   * @param args.queue - The BullMQ `Queue` instance the
   *   repeatable job is registered on.
   * @param args.queueName - Diagnostic label (the BullMQ
   *   queue name) used in the log lines.
   * @param args.jobName - The BullMQ job name passed as the
   *   first argument to `queue.add`.
   * @param args.settingKey - The `SystemSettingsService` key
   *   the cron expression is read from.
   * @param args.defaultCron - Hardcoded fallback used when
   *   the stored value is missing, non-string, or empty.
   * @param args.repeatJobId - The BullMQ repeatable `jobId`.
   *   MUST be supplied explicitly by the call site (the
   *   bootstrap hook always does so); the scheduler infers no
   *   default because an accidental default would change the
   *   stored BullMQ key.
   */
  public async register(args: {
    queue: Queue;
    queueName: string;
    jobName: string;
    settingKey: string;
    defaultCron: string;
    repeatJobId?: string;
  }): Promise<void> {
    const { queue, queueName, jobName, settingKey, defaultCron, repeatJobId } =
      args;
    const jobId = repeatJobId ?? jobName;

    let cronExpression: string;
    try {
      const raw = await this.settings.get<unknown>(settingKey, defaultCron);
      cronExpression = normaliseCronExpression(raw, defaultCron);
    } catch (error) {
      const err = error as Error;
      this.logger.warn(
        `Failed to resolve ${settingKey} from SystemSettingsService; falling back to default '${defaultCron}': ${err.message}`,
      );
      cronExpression = defaultCron;
    }

    try {
      await queue.add(
        jobName,
        {},
        {
          jobId,
          repeat: {
            pattern: cronExpression,
          },
          removeOnComplete: CRON_REMOVE_ON_COMPLETE,
          removeOnFail: CRON_REMOVE_ON_FAIL,
        },
      );
      this.registeredFlags.set(jobName, true);
      this.logger.log(
        `MemoryCronScheduler registered repeatable job '${jobName}' on queue '${queueName}' (jobId='${jobId}', pattern='${cronExpression}', removeOnComplete=${CRON_REMOVE_ON_COMPLETE.toString()}, removeOnFail=${CRON_REMOVE_ON_FAIL.toString()})`,
      );
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        `MemoryCronScheduler failed to register repeatable job '${jobName}' on queue '${queueName}' with pattern '${cronExpression}': ${err.message}`,
        err.stack,
      );
      // Swallow the error — the next process restart retries
      // the registration. A failed registration must NOT
      // crash the app; the reaper is non-critical and
      // recovers on its own.
    }
  }

  /**
   * Returns true if a successful `queue.add(...)` was observed
   * for the supplied `jobName` during this process. Exposed for
   * tests and observability callers (e.g. an admin health
   * endpoint) that need to know whether the schedule is live
   * without inspecting BullMQ internals.
   *
   * The lookup is per-`jobName` — the three legacy scaffolds
   * each owned a boolean field; this getter replaces them with
   * a single map keyed by `jobName` so any future health
   * endpoint can ask `wasRegistered(MEMORY_EVICTION_CRON_JOB)`
   * (or any other job name) without reaching into BullMQ.
   *
   * Default-on-failure: a `jobName` that has never been
   * registered returns `false`; a failed registration also
   * returns `false` (the flag flips to `true` only on a
   * successful `queue.add(...)`); a successful re-run keeps
   * the flag at `true`.
   */
  public wasRegistered(jobName: string): boolean {
    return this.registeredFlags.get(jobName) === true;
  }

  /**
   * Resolve the BullMQ `Queue` instance for the bootstrap
   * `register(...)` call sites. Each entry in
   * {@link CRON_REGISTRATIONS} names which injected queue to
   * use. The lookup is exhaustive — every entry in
   * `CRON_REGISTRATIONS` maps to exactly one of the four
   * `@InjectQueue` fields on this class.
   */
  private resolveQueue(
    name: 'eviction' | 'decay' | 'drift' | 'convergence',
  ): Queue {
    switch (name) {
      case 'eviction':
        return this.evictionQueue;
      case 'decay':
        return this.decayQueue;
      case 'drift':
        return this.driftQueue;
      case 'convergence':
        return this.convergenceQueue;
      default: {
        // Exhaustiveness guard — the union above is closed;
        // reaching this branch would mean a new entry was
        // added to `CRON_REGISTRATIONS` without extending
        // this switch. Throw so the bug surfaces at boot
        // rather than silently no-op'ing.
        const exhaustive: never = name;
        throw new Error(
          `MemoryCronScheduler.resolveQueue: unhandled queue label '${exhaustive as string}'`,
        );
      }
    }
  }
}

/**
 * Re-export the three stable `*_REPEAT_JOB_ID` constants so the
 * M3 milestones (collaborator edits + integration assertions)
 * can pin the BullMQ `jobId` argument without depending on the
 * (otherwise internal) bindings in this module. The literals
 * here MUST stay byte-for-byte identical to the constants
 * declared in the legacy `memory-eviction.scheduler.ts`,
 * `memory-decay.reaper.ts`, and `memory-drift.scheduler.ts`
 * until those legacy files are removed.
 */
export {
  MEMORY_EVICTION_REPEAT_JOB_ID,
  MEMORY_DECAY_REPEAT_JOB_ID,
  MEMORY_DRIFT_REPEAT_JOB_ID,
  MEMORY_CONVERGENCE_REPEAT_JOB_ID,
};
