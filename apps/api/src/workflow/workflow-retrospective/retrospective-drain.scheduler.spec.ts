/**
 * Unit tests for `RetrospectiveDrainScheduler` (EPIC-212 Phase-2 Task 3).
 *
 * Asserts the BullMQ `queue.add` argument shape and the fail-soft registration
 * contract (a registration throw is swallowed; the app still boots). Typed
 * mocks only — no real BullMQ / Redis.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Queue } from 'bullmq';
import { RetrospectiveDrainScheduler } from './retrospective-drain.scheduler';
import type { SystemSettingsService } from '../../settings/system-settings.service';
import {
  RETROSPECTIVE_DRAIN_JOB_NAME,
  RETROSPECTIVE_DRAIN_DEFAULT_CRON,
  RETROSPECTIVE_DRAIN_REPEAT_JOB_ID,
  RETROSPECTIVE_DRAIN_REMOVE_ON_COMPLETE,
  RETROSPECTIVE_DRAIN_REMOVE_ON_FAIL,
} from './retrospective-drain.constants';

interface MockQueue {
  add: ReturnType<typeof vi.fn>;
}

interface MockSettings {
  get: ReturnType<typeof vi.fn>;
}

function createMockQueue(overrides: Partial<MockQueue> = {}): MockQueue {
  return { add: vi.fn().mockResolvedValue(undefined), ...overrides };
}

function createMockSettings(value: unknown): MockSettings {
  return { get: vi.fn().mockResolvedValue(value) };
}

function build(
  queue: MockQueue,
  settings: MockSettings,
): RetrospectiveDrainScheduler {
  return new RetrospectiveDrainScheduler(
    queue as unknown as Queue,
    settings as unknown as SystemSettingsService,
  );
}

describe('RetrospectiveDrainScheduler', () => {
  let queue: MockQueue;

  beforeEach(() => {
    queue = createMockQueue();
  });

  it('registers the repeatable drain job with the configured cron and retention', async () => {
    const settings = createMockSettings(RETROSPECTIVE_DRAIN_DEFAULT_CRON);
    const scheduler = build(queue, settings);

    await scheduler.scheduleDrainJob();

    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith(
      RETROSPECTIVE_DRAIN_JOB_NAME,
      {},
      {
        jobId: RETROSPECTIVE_DRAIN_REPEAT_JOB_ID,
        repeat: { pattern: RETROSPECTIVE_DRAIN_DEFAULT_CRON },
        removeOnComplete: RETROSPECTIVE_DRAIN_REMOVE_ON_COMPLETE,
        removeOnFail: RETROSPECTIVE_DRAIN_REMOVE_ON_FAIL,
      },
    );
    expect(scheduler.wasRegistered()).toBe(true);
  });

  it('falls back to the default cron when the stored value is not a usable string', async () => {
    // `normaliseCronExpression` treats a non-string / empty value as "missing"
    // and returns the fallback (it does not validate cron field syntax).
    const settings = createMockSettings(null);
    const scheduler = build(queue, settings);

    await scheduler.scheduleDrainJob();

    const pattern = queue.add.mock.calls[0][2].repeat.pattern;
    expect(pattern).toBe(RETROSPECTIVE_DRAIN_DEFAULT_CRON);
  });

  it('swallows a registration failure so the app still boots', async () => {
    queue = createMockQueue({
      add: vi.fn().mockRejectedValue(new Error('redis down')),
    });
    const settings = createMockSettings(RETROSPECTIVE_DRAIN_DEFAULT_CRON);
    const scheduler = build(queue, settings);

    await expect(scheduler.scheduleDrainJob()).resolves.toBeUndefined();
    expect(scheduler.wasRegistered()).toBe(false);
  });

  it('does not throw from onApplicationBootstrap when registration fails', async () => {
    queue = createMockQueue({
      add: vi.fn().mockRejectedValue(new Error('redis down')),
    });
    const settings = createMockSettings(RETROSPECTIVE_DRAIN_DEFAULT_CRON);
    const scheduler = build(queue, settings);

    await expect(scheduler.onApplicationBootstrap()).resolves.toBeUndefined();
  });
});
