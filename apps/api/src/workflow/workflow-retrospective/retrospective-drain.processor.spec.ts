/**
 * Unit tests for `RetrospectiveDrainProcessor` (EPIC-212 Phase-2 Task 3).
 *
 * Verifies job-name dispatch and the error-propagation contract (a hard
 * `drainWindow()` failure is re-thrown for BullMQ retry, not swallowed). The
 * processor is a thin shim around `RetrospectiveDrainService`, so a typed mock
 * + `new` exercises the same path BullMQ would invoke.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job } from 'bullmq';
import { RetrospectiveDrainProcessor } from './retrospective-drain.processor';
import type { RetrospectiveDrainService } from './retrospective-drain.service';
import type { DrainSummary } from './retrospective-drain.types';
import { RETROSPECTIVE_DRAIN_JOB_NAME } from './retrospective-drain.constants';

interface MockDrainService {
  drainWindow: ReturnType<typeof vi.fn>;
}

function createMockDrain(
  overrides: Partial<MockDrainService> = {},
): MockDrainService {
  return { drainWindow: vi.fn(), ...overrides };
}

function makeJob(name: string): Job<unknown, DrainSummary> {
  return { name } as Job<unknown, DrainSummary>;
}

describe('RetrospectiveDrainProcessor', () => {
  let drain: MockDrainService;
  let processor: RetrospectiveDrainProcessor;

  beforeEach(() => {
    drain = createMockDrain();
    processor = new RetrospectiveDrainProcessor(
      drain as unknown as RetrospectiveDrainService,
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns null and does NOT drain for an unknown job name', async () => {
    const result = await processor.process(makeJob('unknown-job'));

    expect(result).toBeNull();
    expect(drain.drainWindow).not.toHaveBeenCalled();
  });

  it('delegates one drainWindow tick and returns its summary', async () => {
    const summary: DrainSummary = {
      claimed: 3,
      analyzed: 2,
      skipped: 1,
      failed: 0,
      deferred: 0,
    };
    drain.drainWindow.mockResolvedValue(summary);

    const result = await processor.process(
      makeJob(RETROSPECTIVE_DRAIN_JOB_NAME),
    );

    expect(drain.drainWindow).toHaveBeenCalledTimes(1);
    expect(result).toEqual(summary);
  });

  it('rethrows when drainWindow rejects (so BullMQ can retry)', async () => {
    drain.drainWindow.mockRejectedValue(new Error('claim db outage'));

    await expect(
      processor.process(makeJob(RETROSPECTIVE_DRAIN_JOB_NAME)),
    ).rejects.toThrow('claim db outage');
  });
});
