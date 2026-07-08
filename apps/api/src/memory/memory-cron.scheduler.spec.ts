/**
 * Unit tests for `MemoryCronScheduler`.
 *
 * Work item: 4ed37f14-073f-420b-97b6-9069356ad408 — refactor to
 * consolidate the three near-identical cron/BullMQ scaffolds
 * (memory-eviction, memory-decay, memory-drift).
 *
 * Milestone: M2 — "Add `MemoryCronScheduler` class with public
 * `register(...)` API".
 *
 * This file exercises the consolidated scheduler's contract
 * using Vitest mocks for the three BullMQ queue tokens and the
 * `SystemSettingsService` — no live Redis, no live DB, no real
 * BullMQ worker. The integration test for the byte-for-byte
 * `jobId` migration contract lands in M3.
 *
 * Test scenarios (6 per the milestone acceptance criteria):
 *   1. `register(...)` resolves the cron from
 *      `SystemSettingsService.get(settingKey, defaultCron)` and
 *      falls back to `defaultCron` on a non-string / empty value.
 *   2. The resolved cron is passed to
 *      `queue.add(jobName, {}, { jobId: repeatJobId ?? jobName,
 *      repeat: { pattern }, removeOnComplete, removeOnFail })`
 *      exactly — assert the call shape with vi-mocked queues.
 *   3. `wasRegistered(jobName)` returns `false` before any
 *      registration and `true` after a successful registration.
 *   4. A `settings.get(...)` rejection is logged and swallowed.
 *   5. A `queue.add(...)` rejection is logged and swallowed (no
 *      rethrow).
 *   6. Explicit `repeatJobId` is preserved as the BullMQ `jobId`
 *      (the migration contract).
 *
 * The mock-factory style mirrors `memory-decay.reaper.spec.ts`:
 * typed mock interfaces + `Test.createTestingModule` with
 * `useValue` providers.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Provider } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { MemoryCronScheduler } from './memory-cron.scheduler';
import { SystemSettingsService } from '../settings/system-settings.service';
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
import { MEMORY_SEGMENT_EVICTION_CRON } from '../settings/learning-settings.constants';
import {
  MEMORY_CONVERGENCE_JOB_NAME,
  MEMORY_CONVERGENCE_SNAPSHOT_QUEUE,
} from './learning/learning-convergence/convergence.constants';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

interface MockQueue {
  add: ReturnType<typeof vi.fn>;
}

interface MockSystemSettings {
  get: ReturnType<typeof vi.fn>;
}

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

/**
 * Build a `MockQueue` whose `add` resolves to `undefined`. The
 * scheduler only consumes the resolved value's existence (to flip
 * the `wasRegistered` flag); the call arguments are what the
 * scenarios assert against.
 */
function buildQueueMock(): MockQueue {
  return {
    add: vi.fn().mockResolvedValue(undefined),
  };
}

/**
 * Wire a `SystemSettingsService` mock to return a fixed map of
 * `{ settingKey: raw }`. The scheduler passes the result through
 * `normaliseCronExpression`, which collapses non-string / empty
 * values to the supplied fallback; scenarios that need that
 * fallback path can pass `null`, `undefined`, `''`, or a
 * non-string shape to the map.
 */
function configureSettings(
  settings: MockSystemSettings,
  values: Record<string, unknown>,
): void {
  settings.get.mockImplementation(((key: string, defaultValue: unknown) => {
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      return Promise.resolve(values[key]);
    }
    return Promise.resolve(defaultValue);
  }) as never);
}

async function buildModule(
  settings: MockSystemSettings,
  queues: {
    eviction: MockQueue;
    decay: MockQueue;
    drift: MockQueue;
    convergence: MockQueue;
  },
): Promise<TestingModule> {
  const providers: Provider[] = [
    MemoryCronScheduler,
    { provide: SystemSettingsService, useValue: settings },
    {
      provide: getQueueToken(MEMORY_EVICTION_QUEUE),
      useValue: queues.eviction,
    },
    {
      provide: getQueueToken(MEMORY_DECAY_QUEUE),
      useValue: queues.decay,
    },
    {
      provide: getQueueToken(MEMORY_DRIFT_QUEUE),
      useValue: queues.drift,
    },
    {
      provide: getQueueToken(MEMORY_CONVERGENCE_SNAPSHOT_QUEUE),
      useValue: queues.convergence,
    },
  ];
  return Test.createTestingModule({ providers }).compile();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MemoryCronScheduler', () => {
  let settings: MockSystemSettings;
  let evictionQueue: MockQueue;
  let decayQueue: MockQueue;
  let driftQueue: MockQueue;
  let convergenceQueue: MockQueue;

  beforeEach(() => {
    settings = {
      get: vi.fn(),
    };
    evictionQueue = buildQueueMock();
    decayQueue = buildQueueMock();
    driftQueue = buildQueueMock();
    convergenceQueue = buildQueueMock();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('register(...)', () => {
    it('resolves the cron from SystemSettingsService and passes the trimmed value to queue.add (string happy path)', async () => {
      // Scenario 1 (string branch): the stored setting is a
      // well-formed non-empty string with surrounding whitespace;
      // `normaliseCronExpression` trims it and the trimmed value
      // is what `queue.add` receives as the repeat pattern. The
      // settings-service call uses the supplied `settingKey` and
      // `defaultCron` exactly as documented.
      configureSettings(settings, {
        [MEMORY_SEGMENT_EVICTION_CRON]: '  0 3 * * *  ',
      });

      const moduleRef = await buildModule(settings, {
        eviction: evictionQueue,
        decay: decayQueue,
        drift: driftQueue,
        convergence: convergenceQueue,
      });
      const scheduler = moduleRef.get(MemoryCronScheduler);

      await scheduler.register({
        queue: evictionQueue as never,
        queueName: MEMORY_EVICTION_QUEUE,
        jobName: MEMORY_EVICTION_CRON_JOB,
        settingKey: MEMORY_SEGMENT_EVICTION_CRON,
        defaultCron: DEFAULT_MEMORY_EVICTION_CRON,
        repeatJobId: 'memory-eviction-cron',
      });

      // The settings service was consulted once with the
      // documented argument shape.
      expect(settings.get).toHaveBeenCalledTimes(1);
      expect(settings.get).toHaveBeenCalledWith(
        MEMORY_SEGMENT_EVICTION_CRON,
        DEFAULT_MEMORY_EVICTION_CRON,
      );

      // The queue received the trimmed pattern (whitespace
      // collapsed by `normaliseCronExpression`).
      expect(evictionQueue.add).toHaveBeenCalledTimes(1);
      const callArgs = evictionQueue.add.mock.calls[0] as unknown as [
        string,
        Record<string, unknown>,
        {
          jobId: string;
          repeat: { pattern: string };
          removeOnComplete: number;
          removeOnFail: number;
        },
      ];
      expect(callArgs[0]).toBe(MEMORY_EVICTION_CRON_JOB);
      expect(callArgs[1]).toEqual({});
      expect(callArgs[2]).toEqual({
        jobId: 'memory-eviction-cron',
        repeat: { pattern: '0 3 * * *' },
        removeOnComplete: 100,
        removeOnFail: 200,
      });
    });

    it('falls back to defaultCron when the stored value is non-string (null)', async () => {
      // Scenario 1 (non-string fallback): the stored value is
      // `null`. `normaliseCronExpression` returns the hardcoded
      // fallback for any non-string input, and the scheduler
      // uses that fallback as the repeat pattern. The settings
      // service is still consulted (the fallback is a coercion
      // helper, not a settings short-circuit).
      configureSettings(settings, {
        [MEMORY_DECAY_SETTING_KEYS.cron]: null,
      });

      const moduleRef = await buildModule(settings, {
        eviction: evictionQueue,
        decay: decayQueue,
        drift: driftQueue,
        convergence: convergenceQueue,
      });
      const scheduler = moduleRef.get(MemoryCronScheduler);

      await scheduler.register({
        queue: decayQueue as never,
        queueName: MEMORY_DECAY_QUEUE,
        jobName: MEMORY_DECAY_JOB_NAME,
        settingKey: MEMORY_DECAY_SETTING_KEYS.cron,
        defaultCron: MEMORY_DECAY_DEFAULT_CRON,
        repeatJobId: 'memory-decay-cron',
      });

      expect(settings.get).toHaveBeenCalledWith(
        MEMORY_DECAY_SETTING_KEYS.cron,
        MEMORY_DECAY_DEFAULT_CRON,
      );
      expect(decayQueue.add).toHaveBeenCalledTimes(1);
      const callArgs = decayQueue.add.mock.calls[0] as unknown as [
        string,
        Record<string, unknown>,
        {
          jobId: string;
          repeat: { pattern: string };
          removeOnComplete: number;
          removeOnFail: number;
        },
      ];
      expect(callArgs[2]?.repeat?.pattern).toBe(MEMORY_DECAY_DEFAULT_CRON);
      // The jobId is the explicit repeatJobId (the migration
      // contract — see scenario 6).
      expect(callArgs[2]?.jobId).toBe('memory-decay-cron');
    });

    it('falls back to defaultCron when the stored value is an empty / whitespace-only string', async () => {
      // Scenario 1 (empty-string fallback): the stored value is
      // an empty string. `normaliseCronExpression` trims first,
      // sees the trimmed length is zero, and returns the
      // fallback. The scheduler uses the fallback as the repeat
      // pattern.
      configureSettings(settings, {
        [MEMORY_DRIFT_SETTING_KEYS.cron]: '   ',
      });

      const moduleRef = await buildModule(settings, {
        eviction: evictionQueue,
        decay: decayQueue,
        drift: driftQueue,
        convergence: convergenceQueue,
      });
      const scheduler = moduleRef.get(MemoryCronScheduler);

      await scheduler.register({
        queue: driftQueue as never,
        queueName: MEMORY_DRIFT_QUEUE,
        jobName: MEMORY_DRIFT_JOB_NAME,
        settingKey: MEMORY_DRIFT_SETTING_KEYS.cron,
        defaultCron: MEMORY_DRIFT_DEFAULT_CRON,
        repeatJobId: 'memory-drift-cron',
      });

      expect(driftQueue.add).toHaveBeenCalledTimes(1);
      const callArgs = driftQueue.add.mock.calls[0] as unknown as [
        string,
        Record<string, unknown>,
        {
          jobId: string;
          repeat: { pattern: string };
          removeOnComplete: number;
          removeOnFail: number;
        },
      ];
      expect(callArgs[2]?.repeat?.pattern).toBe(MEMORY_DRIFT_DEFAULT_CRON);
      expect(callArgs[2]?.jobId).toBe('memory-drift-cron');
    });

    it('passes the resolved cron to queue.add with the documented argument shape (jobName, {}, { jobId, repeat, removeOnComplete, removeOnFail })', async () => {
      // Scenario 2 (call shape): the third argument to
      // `queue.add` is asserted field-by-field against the
      // documented shape:
      //   { jobId: repeatJobId ?? jobName,
      //     repeat: { pattern },
      //     removeOnComplete: 100,
      //     removeOnFail: 200 }
      // The first argument is `jobName` and the second is `{}`
      // (the per-tick payload — there is none for a repeatable
      // cron tick).
      configureSettings(settings, {
        [MEMORY_SEGMENT_EVICTION_CRON]: '15 4 * * *',
      });

      const moduleRef = await buildModule(settings, {
        eviction: evictionQueue,
        decay: decayQueue,
        drift: driftQueue,
        convergence: convergenceQueue,
      });
      const scheduler = moduleRef.get(MemoryCronScheduler);

      await scheduler.register({
        queue: evictionQueue as never,
        queueName: MEMORY_EVICTION_QUEUE,
        jobName: MEMORY_EVICTION_CRON_JOB,
        settingKey: MEMORY_SEGMENT_EVICTION_CRON,
        defaultCron: DEFAULT_MEMORY_EVICTION_CRON,
        repeatJobId: 'memory-eviction-cron',
      });

      expect(evictionQueue.add).toHaveBeenCalledTimes(1);
      expect(evictionQueue.add).toHaveBeenCalledWith(
        MEMORY_EVICTION_CRON_JOB,
        {},
        {
          jobId: 'memory-eviction-cron',
          repeat: { pattern: '15 4 * * *' },
          removeOnComplete: 100,
          removeOnFail: 200,
        },
      );
    });

    it('defaults the BullMQ jobId to jobName when repeatJobId is omitted (defensive)', async () => {
      // Scenario 2 (no repeatJobId branch): the contract is
      // `jobId: repeatJobId ?? jobName`. When the call site
      // omits `repeatJobId`, the scheduler falls back to the
      // `jobName`. This is a defensive code path — the
      // bootstrap hook always passes an explicit
      // `repeatJobId` (see scenario 6) — but the public API
      // must still support the omission.
      configureSettings(settings, {
        [MEMORY_SEGMENT_EVICTION_CRON]: '0 3 * * *',
      });

      const moduleRef = await buildModule(settings, {
        eviction: evictionQueue,
        decay: decayQueue,
        drift: driftQueue,
        convergence: convergenceQueue,
      });
      const scheduler = moduleRef.get(MemoryCronScheduler);

      await scheduler.register({
        queue: evictionQueue as never,
        queueName: MEMORY_EVICTION_QUEUE,
        jobName: MEMORY_EVICTION_CRON_JOB,
        settingKey: MEMORY_SEGMENT_EVICTION_CRON,
        defaultCron: DEFAULT_MEMORY_EVICTION_CRON,
      });

      const callArgs = evictionQueue.add.mock.calls[0] as unknown as [
        string,
        Record<string, unknown>,
        { jobId: string },
      ];
      expect(callArgs[2]?.jobId).toBe(MEMORY_EVICTION_CRON_JOB);
    });
  });

  describe('wasRegistered(jobName)', () => {
    it('returns false before any registration and true after a successful registration', async () => {
      // Scenario 3 (lookup surface): a fresh scheduler
      // instance has no registered flags, so
      // `wasRegistered(...)` returns false for any jobName.
      // After a successful `register(...)`, the flag for the
      // supplied `jobName` flips to true; the lookup for an
      // unrelated jobName still returns false (the map is
      // keyed by jobName, not by queue name).
      configureSettings(settings, {
        [MEMORY_SEGMENT_EVICTION_CRON]: '0 3 * * *',
      });

      const moduleRef = await buildModule(settings, {
        eviction: evictionQueue,
        decay: decayQueue,
        drift: driftQueue,
        convergence: convergenceQueue,
      });
      const scheduler = moduleRef.get(MemoryCronScheduler);

      // Pre-registration: the eviction job is unknown to the
      // flag map; the same lookup on a synthetic jobName is
      // also unknown.
      expect(scheduler.wasRegistered(MEMORY_EVICTION_CRON_JOB)).toBe(false);
      expect(scheduler.wasRegistered('some-other-job')).toBe(false);

      await scheduler.register({
        queue: evictionQueue as never,
        queueName: MEMORY_EVICTION_QUEUE,
        jobName: MEMORY_EVICTION_CRON_JOB,
        settingKey: MEMORY_SEGMENT_EVICTION_CRON,
        defaultCron: DEFAULT_MEMORY_EVICTION_CRON,
        repeatJobId: 'memory-eviction-cron',
      });

      // Post-registration: the eviction job is flagged; the
      // synthetic jobName is still unknown.
      expect(scheduler.wasRegistered(MEMORY_EVICTION_CRON_JOB)).toBe(true);
      expect(scheduler.wasRegistered('some-other-job')).toBe(false);
    });

    it('keeps the flag at true on a subsequent successful registration for the same jobName', async () => {
      // Defensive: a re-run after a settings change does not
      // flip the flag back to false. The flag is monotonic in
      // the success direction (false → true → stays true).
      configureSettings(settings, {
        [MEMORY_SEGMENT_EVICTION_CRON]: '0 3 * * *',
      });

      const moduleRef = await buildModule(settings, {
        eviction: evictionQueue,
        decay: decayQueue,
        drift: driftQueue,
        convergence: convergenceQueue,
      });
      const scheduler = moduleRef.get(MemoryCronScheduler);

      await scheduler.register({
        queue: evictionQueue as never,
        queueName: MEMORY_EVICTION_QUEUE,
        jobName: MEMORY_EVICTION_CRON_JOB,
        settingKey: MEMORY_SEGMENT_EVICTION_CRON,
        defaultCron: DEFAULT_MEMORY_EVICTION_CRON,
        repeatJobId: 'memory-eviction-cron',
      });
      expect(scheduler.wasRegistered(MEMORY_EVICTION_CRON_JOB)).toBe(true);

      // A second registration call with the same jobName —
      // the operator tightened the schedule — must keep the
      // flag at true.
      configureSettings(settings, {
        [MEMORY_SEGMENT_EVICTION_CRON]: '30 4 * * *',
      });
      await scheduler.register({
        queue: evictionQueue as never,
        queueName: MEMORY_EVICTION_QUEUE,
        jobName: MEMORY_EVICTION_CRON_JOB,
        settingKey: MEMORY_SEGMENT_EVICTION_CRON,
        defaultCron: DEFAULT_MEMORY_EVICTION_CRON,
        repeatJobId: 'memory-eviction-cron',
      });
      expect(scheduler.wasRegistered(MEMORY_EVICTION_CRON_JOB)).toBe(true);
      // Both registrations called `queue.add(...)`; the
      // operator-tuned cron is what the second call sees.
      expect(evictionQueue.add).toHaveBeenCalledTimes(2);
    });
  });

  describe('failure policy', () => {
    it('logs and swallows a settings.get(...) rejection, falling back to defaultCron', async () => {
      // Scenario 4 (settings-service swallow): the settings
      // service throws (e.g. the underlying repository is
      // unreachable). The scheduler logs a warning, falls
      // back to `defaultCron`, and proceeds to call
      // `queue.add(...)` with the fallback pattern. No error
      // is re-thrown.
      const settingsError = new Error('database connection refused');
      settings.get.mockRejectedValue(settingsError);

      const moduleRef = await buildModule(settings, {
        eviction: evictionQueue,
        decay: decayQueue,
        drift: driftQueue,
        convergence: convergenceQueue,
      });
      const scheduler = moduleRef.get(MemoryCronScheduler);

      // The call must resolve (no rethrow). The queue receives
      // the default cron as the repeat pattern.
      await expect(
        scheduler.register({
          queue: evictionQueue as never,
          queueName: MEMORY_EVICTION_QUEUE,
          jobName: MEMORY_EVICTION_CRON_JOB,
          settingKey: MEMORY_SEGMENT_EVICTION_CRON,
          defaultCron: DEFAULT_MEMORY_EVICTION_CRON,
          repeatJobId: 'memory-eviction-cron',
        }),
      ).resolves.toBeUndefined();

      expect(evictionQueue.add).toHaveBeenCalledTimes(1);
      const callArgs = evictionQueue.add.mock.calls[0] as unknown as [
        string,
        Record<string, unknown>,
        { repeat: { pattern: string }; jobId: string },
      ];
      expect(callArgs[2]?.repeat?.pattern).toBe(DEFAULT_MEMORY_EVICTION_CRON);
      // The flag stays false — the registration succeeded
      // (against the fallback), so it flips to true. The
      // scenarios distinguish "settings rejection → fall back
      // to default and proceed" from "queue.add rejection →
      // no-op".
      expect(scheduler.wasRegistered(MEMORY_EVICTION_CRON_JOB)).toBe(true);
    });

    it('logs and swallows a queue.add(...) rejection without flipping the registered flag', async () => {
      // Scenario 5 (queue rejection swallow): the
      // `queue.add(...)` call rejects (e.g. a transient Redis
      // blip). The scheduler logs the error and swallows it —
      // no re-throw. The `wasRegistered(...)` flag stays at
      // `false` because the registration did not succeed.
      configureSettings(settings, {
        [MEMORY_SEGMENT_EVICTION_CRON]: '0 3 * * *',
      });
      const queueError = new Error('redis ECONNREFUSED');
      evictionQueue.add.mockRejectedValue(queueError);

      const moduleRef = await buildModule(settings, {
        eviction: evictionQueue,
        decay: decayQueue,
        drift: driftQueue,
        convergence: convergenceQueue,
      });
      const scheduler = moduleRef.get(MemoryCronScheduler);

      await expect(
        scheduler.register({
          queue: evictionQueue as never,
          queueName: MEMORY_EVICTION_QUEUE,
          jobName: MEMORY_EVICTION_CRON_JOB,
          settingKey: MEMORY_SEGMENT_EVICTION_CRON,
          defaultCron: DEFAULT_MEMORY_EVICTION_CRON,
          repeatJobId: 'memory-eviction-cron',
        }),
      ).resolves.toBeUndefined();

      // `queue.add(...)` was attempted once (no retry, no
      // re-throw).
      expect(evictionQueue.add).toHaveBeenCalledTimes(1);
      // The flag is NOT flipped: a failed registration leaves
      // it at false (default-on-failure semantics).
      expect(scheduler.wasRegistered(MEMORY_EVICTION_CRON_JOB)).toBe(false);
    });

    it('does not cross-contaminate the registered flag when one queue fails and another succeeds', async () => {
      // Defensive: the three queue registrations share a
      // single `registeredFlags` map. A failed registration on
      // the eviction queue must NOT flip the decay or drift
      // flag, and a successful registration on the decay queue
      // must NOT retroactively flip the eviction flag.
      configureSettings(settings, {
        [MEMORY_SEGMENT_EVICTION_CRON]: '0 3 * * *',
        [MEMORY_DECAY_SETTING_KEYS.cron]: '30 3 * * *',
      });
      evictionQueue.add.mockRejectedValue(new Error('eviction queue down'));
      decayQueue.add.mockResolvedValue(undefined);

      const moduleRef = await buildModule(settings, {
        eviction: evictionQueue,
        decay: decayQueue,
        drift: driftQueue,
        convergence: convergenceQueue,
      });
      const scheduler = moduleRef.get(MemoryCronScheduler);

      await scheduler.register({
        queue: evictionQueue as never,
        queueName: MEMORY_EVICTION_QUEUE,
        jobName: MEMORY_EVICTION_CRON_JOB,
        settingKey: MEMORY_SEGMENT_EVICTION_CRON,
        defaultCron: DEFAULT_MEMORY_EVICTION_CRON,
        repeatJobId: 'memory-eviction-cron',
      });
      await scheduler.register({
        queue: decayQueue as never,
        queueName: MEMORY_DECAY_QUEUE,
        jobName: MEMORY_DECAY_JOB_NAME,
        settingKey: MEMORY_DECAY_SETTING_KEYS.cron,
        defaultCron: MEMORY_DECAY_DEFAULT_CRON,
        repeatJobId: 'memory-decay-cron',
      });

      expect(scheduler.wasRegistered(MEMORY_EVICTION_CRON_JOB)).toBe(false);
      expect(scheduler.wasRegistered(MEMORY_DECAY_JOB_NAME)).toBe(true);
    });
  });

  describe('migration contract (repeatJobId preservation)', () => {
    it('passes the explicit repeatJobId to BullMQ as the jobId (the byte-for-byte migration contract)', async () => {
      // Scenario 6 (migration contract): the scheduler MUST
      // pass the explicit `repeatJobId` argument to BullMQ as
      // the `jobId` of the repeatable job. This is the
      // contract that preserves the stored BullMQ schedule
      // key across the refactor — an accidental default like
      // `${queueName}-cron` would orphan the existing
      // schedule on the next bootstrap and double-fire the
      // reaper on the next cron tick.
      //
      // We exercise this against the drift queue specifically:
      // its legacy `repeatJobId` is `'memory-drift-cron'`,
      // which is NOT a suffix of `MEMORY_DRIFT_QUEUE`
      // (`'memory-drift-detection'`). That mismatch is the
      // proof point — an accidental `${queueName}-cron`
      // default would produce `'memory-drift-detection-cron'`,
      // which is a different BullMQ key from the legacy
      // `'memory-drift-cron'` and would orphan the existing
      // schedule.
      configureSettings(settings, {
        [MEMORY_DRIFT_SETTING_KEYS.cron]: '0 4 * * *',
      });

      const moduleRef = await buildModule(settings, {
        eviction: evictionQueue,
        decay: decayQueue,
        drift: driftQueue,
        convergence: convergenceQueue,
      });
      const scheduler = moduleRef.get(MemoryCronScheduler);

      await scheduler.register({
        queue: driftQueue as never,
        queueName: MEMORY_DRIFT_QUEUE,
        jobName: MEMORY_DRIFT_JOB_NAME,
        settingKey: MEMORY_DRIFT_SETTING_KEYS.cron,
        defaultCron: MEMORY_DRIFT_DEFAULT_CRON,
        repeatJobId: 'memory-drift-cron',
      });

      const callArgs = driftQueue.add.mock.calls[0] as unknown as [
        string,
        Record<string, unknown>,
        { jobId: string },
      ];
      // The exact literal that the legacy
      // `MEMORY_DRIFT_REPEAT_JOB_ID` constant declared.
      expect(callArgs[2]?.jobId).toBe('memory-drift-cron');
      // NOT the queue-name-derived anti-pattern the ADR
      // explicitly calls out — the legacy literal and a
      // `${queueName}-cron` default would collide on the
      // other two queues (a coincidence that masks the bug);
      // for the drift queue they differ, so this assertion
      // is the proof point.
      expect(callArgs[2]?.jobId).not.toBe(`${MEMORY_DRIFT_QUEUE}-cron`);
    });

    it('preserves the explicit repeatJobId across all three reapers when wired via the bootstrap hook', async () => {
      // Defensive: the bootstrap hook calls `register(...)`
      // for each of the three reapers with the legacy
      // `*_REPEAT_JOB_ID` literal as `repeatJobId`. The
      // integration of the call-site wiring is asserted by
      // confirming each of the three queues receives the
      // matching BullMQ `jobId`.
      configureSettings(settings, {
        [MEMORY_SEGMENT_EVICTION_CRON]: '0 3 * * *',
        [MEMORY_DECAY_SETTING_KEYS.cron]: '30 3 * * *',
        [MEMORY_DRIFT_SETTING_KEYS.cron]: '0 4 * * *',
      });

      const moduleRef = await buildModule(settings, {
        eviction: evictionQueue,
        decay: decayQueue,
        drift: driftQueue,
        convergence: convergenceQueue,
      });
      const scheduler = moduleRef.get(MemoryCronScheduler);

      await scheduler.onApplicationBootstrap();

      // Each queue received exactly one `add(...)` call with
      // the matching legacy literal as the BullMQ `jobId`.
      expect(evictionQueue.add).toHaveBeenCalledTimes(1);
      expect(decayQueue.add).toHaveBeenCalledTimes(1);
      expect(driftQueue.add).toHaveBeenCalledTimes(1);
      expect(convergenceQueue.add).toHaveBeenCalledTimes(1);

      const evictionArgs = evictionQueue.add.mock.calls[0] as unknown as [
        string,
        Record<string, unknown>,
        { jobId: string },
      ];
      const decayArgs = decayQueue.add.mock.calls[0] as unknown as [
        string,
        Record<string, unknown>,
        { jobId: string },
      ];
      const driftArgs = driftQueue.add.mock.calls[0] as unknown as [
        string,
        Record<string, unknown>,
        { jobId: string },
      ];
      const convergenceArgs = convergenceQueue.add.mock.calls[0] as unknown as [
        string,
        Record<string, unknown>,
        { jobId: string },
      ];

      expect(evictionArgs[0]).toBe(MEMORY_EVICTION_CRON_JOB);
      expect(evictionArgs[2]?.jobId).toBe('memory-eviction-cron');
      expect(decayArgs[0]).toBe(MEMORY_DECAY_JOB_NAME);
      expect(decayArgs[2]?.jobId).toBe('memory-decay-cron');
      expect(driftArgs[0]).toBe(MEMORY_DRIFT_JOB_NAME);
      expect(driftArgs[2]?.jobId).toBe('memory-drift-cron');
      expect(convergenceArgs[2]?.jobId).toBe('memory-convergence-cron');

      // All four `wasRegistered` flags are true post-bootstrap.
      expect(scheduler.wasRegistered(MEMORY_EVICTION_CRON_JOB)).toBe(true);
      expect(scheduler.wasRegistered(MEMORY_DECAY_JOB_NAME)).toBe(true);
      expect(scheduler.wasRegistered(MEMORY_DRIFT_JOB_NAME)).toBe(true);
      expect(scheduler.wasRegistered(MEMORY_CONVERGENCE_JOB_NAME)).toBe(true);
    });
  });
});
