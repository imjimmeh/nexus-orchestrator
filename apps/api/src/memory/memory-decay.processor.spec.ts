/**
 * Unit tests for the MemoryDecayProcessor.
 *
 * Work item: 1cb060cc-3d71-4d92-b894-9d5c430c2af4 (WI-2026-052,
 * continuation of 3d7fb798-f54d-40ff-a803-438224474912).
 *
 * Scope:
 *   Verifies the processor's job-name dispatch logic without
 *   booting a NestJS module. The processor only reads `job.name`
 *   so a partial Job cast is sufficient. The reaper is mocked with
 *   a typed factory (no real DB / BullMQ wiring).
 *
 * Test cases:
 *   1. Unknown job name → returns `null` and does NOT call
 *      `reaper.runDecayPass()`.
 *   2. Known job name (`MEMORY_DECAY_JOB_NAME`) → calls
 *      `reaper.runDecayPass()` (no arguments — the processor
 *      reads its `now` from the reaper's own default) and returns
 *      the resulting `MemoryDecayRunSummary`.
 *   3. Error from `reaper.runDecayPass()` → the processor logs
 *      the failure and re-throws so BullMQ can apply its
 *      retry / backoff policy. The error is NOT swallowed.
 *
 * Why not a NestJS TestingModule:
 *   The processor is a thin dispatch shim around
 *   `MemoryDecayReaperService` — its only collaborator is the
 *   reaper itself, and the only state on the instance is the
 *   `Logger`. Constructing it with `new MemoryDecayProcessor(...)`
 *   and a typed mock exercises the same code path BullMQ would
 *   invoke, without the noise of `Test.createTestingModule`. The
 *   integration spec (`memory-decay.processor.integration.spec.ts`)
 *   covers the same wiring through a real Nest module.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job } from 'bullmq';
import { MemoryDecayProcessor } from './memory-decay.processor';
import type { MemoryDecayReaperService } from './memory-decay.reaper';
import type { MemoryDecayRunSummary } from './memory-decay.types';
import { MEMORY_DECAY_JOB_NAME } from './memory-decay.constants';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

interface MockMemoryDecayReaper {
  runDecayPass: ReturnType<typeof vi.fn>;
}

/**
 * Typed factory for the reaper mock. Mirrors the
 * `createMockReaper()` style used elsewhere in `apps/api/src/memory/`
 * (see `memory-decay.reaper.spec.ts` / `memory-eviction.reaper.spec.ts`).
 */
function createMockReaper(
  overrides: Partial<MockMemoryDecayReaper> = {},
): MockMemoryDecayReaper {
  return {
    runDecayPass: vi.fn(),
    ...overrides,
  };
}

/**
 * Build a `Job`-like object literal. The processor only reads
 * `job.name` — every other property on the BullMQ Job (id, data,
 * attemptsMade, etc.) is unused by the dispatch shim — so a partial
 * cast is sufficient.
 */
function makeJob(name: string): Job<unknown, MemoryDecayRunSummary> {
  return { name } as Job<unknown, MemoryDecayRunSummary>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MemoryDecayProcessor', () => {
  let reaper: MockMemoryDecayReaper;
  let processor: MemoryDecayProcessor;

  beforeEach(() => {
    reaper = createMockReaper();
    processor = new MemoryDecayProcessor(
      reaper as unknown as MemoryDecayReaperService,
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('process', () => {
    it('returns null and does NOT call reaper.runDecayPass() for an unknown job name', async () => {
      // Case 1: dispatch-by-name contract. The processor is the
      // single consumer of the `memory-decay` queue today, but
      // the BullMQ queue API does not prevent a future caller
      // from `queue.add('something-else', ...)` — the processor
      // must log + ignore any name other than
      // MEMORY_DECAY_JOB_NAME so an admin tool can enqueue
      // arbitrary tasks without crashing the worker.
      const result = await processor.process(makeJob('unknown-job'));

      expect(result).toBeNull();
      expect(reaper.runDecayPass).not.toHaveBeenCalled();
    });

    it('calls reaper.runDecayPass() and returns the summary for MEMORY_DECAY_JOB_NAME', async () => {
      // Case 2: happy path. The processor delegates to
      // `MemoryDecayReaperService.runDecayPass()` with no
      // arguments (the reaper resolves its own `now` via the
      // `options.now` default — the processor does not need to
      // thread `job.data` into the reaper's signature) and
      // returns the resulting summary so BullMQ records it as
      // the job result.
      const summary: MemoryDecayRunSummary = {
        evaluated: 5,
        decayed: 3,
        archived: 2,
        skipped: false,
      };
      reaper.runDecayPass.mockResolvedValue(summary);

      const result = await processor.process(makeJob(MEMORY_DECAY_JOB_NAME));

      expect(reaper.runDecayPass).toHaveBeenCalledTimes(1);
      // The processor does NOT thread job data into the reaper
      // today — `runDecayPass()` is invoked with no arguments.
      // If a future revision starts reading `now` from
      // `job.data`, this assertion will need to be updated to
      // the new contract.
      expect(reaper.runDecayPass).toHaveBeenCalledWith();
      expect(result).toEqual(summary);
    });

    it('rethrows when reaper.runDecayPass() rejects (so BullMQ can apply retry/backoff)', async () => {
      // Case 3: error path. The reaper's per-row evaluation is
      // best-effort — a single bad row is caught and counted
      // into the run summary. A hard failure that escapes
      // `runDecayPass()` (e.g. a transient DB outage on the
      // candidate query or a settings-service outage) must
      // propagate to BullMQ so the queue's default retry policy
      // can apply. The processor logs and rethrows; it MUST NOT
      // swallow the error.
      const error = new Error('reaper db outage');
      reaper.runDecayPass.mockRejectedValue(error);

      await expect(
        processor.process(makeJob(MEMORY_DECAY_JOB_NAME)),
      ).rejects.toThrow('reaper db outage');

      expect(reaper.runDecayPass).toHaveBeenCalledTimes(1);
    });
  });
});
