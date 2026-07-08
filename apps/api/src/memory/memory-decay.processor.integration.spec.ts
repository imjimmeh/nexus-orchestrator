/**
 * Integration test for the MemoryDecayProcessor.
 *
 * Work item: 1cb060cc-3d71-4d92-b894-9d5c430c2af4 (WI-2026-052,
 * continuation of 3d7fb798-f54d-40ff-a803-438224474912).
 *
 * Approach (smoke integration):
 *   This test boots a real NestJS `TestingModule` around the
 *   production {@link MemoryDecayProcessor} with a fake
 *   {@link MemoryDecayReaperService} that records every call and
 *   returns a known {@link MemoryDecayRunSummary}. It then invokes
 *   the processor's `process(job)` method directly on the
 *   resolved instance — exactly the call shape BullMQ's `Worker`
 *   would make when a job is dispatched to a `@Processor(...)`-
 *   decorated `WorkerHost` subclass.
 *
 * Why not a live BullMQ worker / `new Worker(...)`:
 *   The project does not have a real in-memory BullMQ pattern.
 *   `memory-decay.reaper.integration.spec.ts` and
 *   `memory-eviction.reaper.integration.spec.ts` exercise the
 *   reapers through hand-rolled in-memory repository fakes (no
 *   live Postgres). `distillation-threshold.bullmq-integration.spec.ts`
 *   — the closest analog for a BullMQ processor — wires a real
 *   `DistillationConsumer` with a fake downstream service tree and
 *   calls `.process(fakeJob)` directly without standing up a real
 *   `Worker`. The same convention is used here:
 *
 *     - The `BullModule.registerQueue({ name: MEMORY_DECAY_QUEUE })`
 *       import is registered on the testing module's `imports`
 *       (so the DI container has the queue metadata registered),
 *       but the queue token is never injected — the
 *       `useFactory` that would build a real `bullmq.Queue` (and
 *       try to connect to Redis) is never invoked.
 *     - The real `MemoryDecayProcessor` is wired in `providers`
 *       with a `{ provide: MemoryDecayReaperService, useValue:
 *       fakeReaper }` override — no `useValue` override on the
 *       processor itself.
 *     - The test resolves the processor and calls
 *       `processor.process(makeJobMock(MEMORY_DECAY_JOB_NAME))`
 *       directly. The processor only consumes `job.name`, so a
 *       minimal `{ name: string }` literal is sufficient.
 *
 *   This keeps the test hermetic (no Redis, no Docker, no
 *   network), exercises the real NestJS DI graph
 *   (`@Injectable()` + constructor injection) the production
 *   `MemoryModule` uses, and pins the processor's dispatch
 *   contract end-to-end through the same code path BullMQ
 *   would invoke.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { BullModule } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { MemoryDecayProcessor } from './memory-decay.processor';
import { MemoryDecayReaperService } from './memory-decay.reaper';
import type { MemoryDecayRunSummary } from './memory-decay.types';
import {
  MEMORY_DECAY_JOB_NAME,
  MEMORY_DECAY_QUEUE,
} from './memory-decay.constants';

// ---------------------------------------------------------------------------
// Fake reaper
// ---------------------------------------------------------------------------

interface FakeReaper {
  runDecayPass: ReturnType<typeof vi.fn>;
}

/**
 * Build a fake reaper that records every `runDecayPass()` call and
 * returns the supplied summary. The fake is intentionally minimal —
 * the processor's dispatch logic only calls one method on the
 * reaper, so a single-mock surface is sufficient.
 */
function createFakeReaper(summary: MemoryDecayRunSummary): FakeReaper {
  return {
    runDecayPass: vi.fn().mockResolvedValue(summary),
  };
}

/**
 * Build a minimal `Job`-shaped object literal. The processor only
 * reads `job.name` so a single-property cast is enough to satisfy
 * the BullMQ `Job<unknown, MemoryDecayRunSummary>` signature.
 */
function makeJobMock(name: string): Job<unknown, MemoryDecayRunSummary> {
  return { name } as Job<unknown, MemoryDecayRunSummary>;
}

// ---------------------------------------------------------------------------
// Test module wiring
// ---------------------------------------------------------------------------

/**
 * Boot a NestJS `TestingModule` with the real `MemoryDecayProcessor`
 * and a fake reaper. The queue is registered via
 * `BullModule.registerQueue({ name: MEMORY_DECAY_QUEUE })` to keep
 * the module's DI graph in sync with the production
 * {@link MemoryModule}, even though the test never injects the
 * queue token (see the leading comment for the rationale).
 */
async function buildTestingModule(
  fakeReaper: FakeReaper,
): Promise<TestingModule> {
  return Test.createTestingModule({
    imports: [BullModule.registerQueue({ name: MEMORY_DECAY_QUEUE })],
    providers: [
      MemoryDecayProcessor,
      { provide: MemoryDecayReaperService, useValue: fakeReaper },
    ],
  }).compile();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MemoryDecayProcessor (integration)', () => {
  let moduleRef: TestingModule | undefined;
  let processor: MemoryDecayProcessor;
  let fakeReaper: FakeReaper;

  /**
   * The summary the fake reaper returns on every call. Pinned so
   * the integration test can assert the processor returns it
   * verbatim — a regression that wraps or transforms the summary
   * surfaces here.
   */
  const expectedSummary: MemoryDecayRunSummary = {
    evaluated: 7,
    decayed: 4,
    archived: 3,
    skipped: false,
  };

  beforeEach(async () => {
    fakeReaper = createFakeReaper(expectedSummary);
    moduleRef = await buildTestingModule(fakeReaper);
    processor = moduleRef.get(MemoryDecayProcessor);
  });

  afterEach(async () => {
    // The fake reaper is the only collaborator on the processor
    // instance; there are no live Queue / Worker handles to close
    // because the smoke-integration approach never injects them.
    // We still call `moduleRef.close()` so the DI container
    // tears down cleanly between specs (no onApplicationShutdown
    // hooks are wired here, but the contract is honoured).
    await moduleRef?.close();
    moduleRef = undefined;
  });

  it('invokes the fake reaper exactly once for a MEMORY_DECAY_JOB_NAME job and returns its summary', async () => {
    // The smoke integration: this is the call BullMQ's `Worker`
    // would make when a `memory-decay-reaper` job is dispatched
    // to the processor.
    const result = await processor.process(makeJobMock(MEMORY_DECAY_JOB_NAME));

    // The fake was consulted exactly once — the dispatch shim
    // delegates to a single reaper call per tick.
    expect(fakeReaper.runDecayPass).toHaveBeenCalledTimes(1);
    // The processor does NOT thread job data into the reaper
    // today — `runDecayPass()` is invoked with no arguments.
    // If a future revision starts reading `now` from
    // `job.data`, this assertion will need to be updated to
    // the new contract.
    expect(fakeReaper.runDecayPass).toHaveBeenCalledWith();
    // The processor returns the summary verbatim so BullMQ
    // records it as the job result.
    expect(result).toEqual(expectedSummary);
  });

  it('does NOT call the fake reaper when the job name is unknown', async () => {
    // Belt-and-suspenders: the dispatch shim ignores any name
    // other than MEMORY_DECAY_JOB_NAME so an accidental
    // `queue.add('something-else', ...)` from an admin tool does
    // not crash the worker. Asserting this through the real
    // NestJS module wiring catches a regression where a future
    // refactor accidentally promotes the reaper call above the
    // job-name guard.
    const result = await processor.process(makeJobMock('not-a-decay-job'));

    expect(fakeReaper.runDecayPass).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });
});
