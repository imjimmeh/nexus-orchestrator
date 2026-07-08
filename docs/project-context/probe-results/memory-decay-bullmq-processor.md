---
project_scope_id: 458935f0-213e-4bbe-89d1-8883e0efa9ad
probe_scope_id: memory-decay-bullmq-processor
outcome: success
inferred_status: implemented
confidence_score: 0.95
evidence_refs:
  - apps/api/src/memory/memory-decay.processor.ts
  - apps/api/src/memory/memory-decay.processor.spec.ts
  - apps/api/src/memory/memory-decay.processor.integration.spec.ts
  - apps/api/src/memory/memory-decay.constants.ts (MEMORY_DECAY_QUEUE, MEMORY_DECAY_JOB_NAME)
  - apps/api/src/memory/memory-decay.types.ts (MemoryDecayRunSummary)
  - apps/api/src/memory/memory.module.ts (provider + BullModule.registerQueue wiring)
  - apps/api/src/memory/memory-cron.scheduler.ts (owns the schedule; enqueues the same jobName)
  - apps/api/src/memory/memory-decay.reaper.ts (runDecayPass target)
  - apps/api/src/memory/memory-eviction.processor.ts (sibling reference pattern)
  - apps/api/src/memory/distillation.consumer.ts (parallel @Processor WorkerHost shape)
  - docs/project-context/probe-results/memory-decay-reaper.md (R105 open question that this work item resolves)
source_paths:
  - apps/api/src/memory/memory-decay.processor.ts
  - apps/api/src/memory/memory-decay.processor.spec.ts
  - apps/api/src/memory/memory-decay.processor.integration.spec.ts
updated_at: 2026-07-02T00:00:00.000Z
---

# Probe Result: Memory Decay BullMQ Processor (R105 followup)

## Narrative Summary

The R105 followup gap (work item `1cb060cc-3d71-4d92-b894-9d5c430c2af4` / WI-2026-052, "continuation of 3d7fb798") is fully closed. A `MemoryDecayProcessor` BullMQ consumer is now registered on the `memory-decay` queue and wired into `MemoryModule` alongside `MemoryDecayReaperService`, completing the runtime cron-tick path that the prior `memory-decay-reaper` probe flagged as missing. The processor is a thin dispatch shim: it filters by `job.name` against `MEMORY_DECAY_JOB_NAME` (`'memory-decay-reaper'`), delegates a single reaper call to `MemoryDecayReaperService.runDecayPass()` (no arguments — the reaper resolves its own `now` via the `options.now` default), and rethrows on failure so BullMQ's default retry/backoff policy applies. Unknown job names are logged at `debug` and returned as `null` so an accidental `queue.add('something-else', ...)` from an admin tool cannot crash the worker.

The processor is a `WorkerHost` subclass decorated with `@Injectable()` and `@Processor(MEMORY_DECAY_QUEUE)` (queue name `'memory-decay'`, from `memory-decay.constants.ts`). The schedule is owned by `MemoryCronScheduler` (the same scaffold that drives the eviction and drift reapers), which enqueues `MEMORY_DECAY_JOB_NAME` onto the queue at `onApplicationBootstrap` via the `queue.add(jobName, {}, { jobId, repeat: { pattern } })` path. Together the two pieces close the loop: scheduler enqueues → BullMQ dispatches → `MemoryDecayProcessor.process(job)` → `reaper.runDecayPass()` → `MemoryDecayRunSummary` returned to BullMQ as the job result.

**Confidence: 0.95** — production code, unit coverage, and integration coverage are all present and consistent; the only minor uncertainty is that the integration test does not stand up a live `new Worker(...)` (it calls `processor.process(job)` directly), but this is the project's documented pattern for BullMQ processor tests (see the `distillation-threshold.bullmq-integration.spec.ts` analog called out in the integration spec's leading comment).

## Capability Updates

- **Memory-decay BullMQ consumer (R105 resolution)**: `apps/api/src/memory/memory-decay.processor.ts` defines `MemoryDecayProcessor` (a `@Processor(MEMORY_DECAY_QUEUE) WorkerHost`) that completes the runtime cron-tick path the prior `memory-decay-reaper` probe flagged as missing. The processor is registered as a provider in `MemoryModule` and the `memory-decay` queue is registered via `BullModule.registerQueue({ name: MEMORY_DECAY_QUEUE })` in the module's `imports`. Together with `MemoryCronScheduler.register(...)` (which enqueues `MEMORY_DECAY_JOB_NAME` on the same queue), the cron-tick path is fully wired: scheduler enqueues → BullMQ dispatches → `processor.process(job)` → `reaper.runDecayPass()`.
- **Job-name dispatch contract**: the processor reads `job.name` and ignores any name other than `MEMORY_DECAY_JOB_NAME`. The unknown-name branch logs at `debug` and returns `null`; the known-name branch delegates to the reaper. This is the same defensive "single consumer, ignore noise" pattern as the sibling `MemoryEvictionProcessor` (which is annotated with the same docblock contract). The unit spec pins both branches; the integration spec pins both branches through real NestJS DI.
- **Retry/backoff delegation**: the `handleCronTick()` method wraps `reaper.runDecayPass()` in a try/catch that logs the failure and rethrows. Per the docblock on the class, the reaper's per-row evaluation is best-effort (a single bad row is caught and counted into the run summary); a hard failure that escapes `runDecayPass()` propagates to BullMQ so the queue's default retry policy can apply. The unit spec pins the rethrow with an explicit `rejects.toThrow('reaper db outage')` assertion.
- **Tick-level observability**: `handleCronTick()` logs `MemoryDecayCron tick received` on entry and a debug-level summary line (`evaluated=…`, `decayed=…`, `archived=…`, `skipped=…`) on success so an operator scanning worker logs can correlate a BullMQ tick with the reaper's own internal per-pass log lines. This is intentionally lighter than the sibling `MemoryEvictionProcessor`, which additionally resolves and logs the cron expression from `SystemSettingsService` — the decay processor treats the cron expression as scheduler-owned state and does not duplicate it on the worker side.
- **No `job.data` threading**: both the production code and the specs document the explicit decision that `runDecayPass()` is invoked with no arguments. The reaper resolves its own `now` from `options.now` defaulting to `new Date()`. If a future revision needs to thread `now` (or any other context) from `job.data` into the reaper, both test files flag the exact assertion (`expect(reaper.runDecayPass).toHaveBeenCalledWith()`) that will need to be updated to the new contract.
- **Test coverage (unit)**: `memory-decay.processor.spec.ts` covers three cases — (1) unknown job name returns `null` and does NOT call the reaper; (2) `MEMORY_DECAY_JOB_NAME` invokes `reaper.runDecayPass()` with no args and returns the summary; (3) reaper rejection propagates through the processor (no swallowing). The unit spec uses the same typed-mock-factory style as the sibling `memory-decay.reaper.spec.ts` and explicitly justifies the "no NestJS TestingModule" choice in its leading docblock.
- **Test coverage (integration)**: `memory-decay.processor.integration.spec.ts` boots a real `Test.createTestingModule({...})` with `BullModule.registerQueue({ name: MEMORY_DECAY_QUEUE })` in `imports`, the real `MemoryDecayProcessor` in `providers`, and a `{ provide: MemoryDecayReaperService, useValue: fakeReaper }` override. The test then resolves the processor and calls `processor.process(makeJobMock(MEMORY_DECAY_JOB_NAME))` directly. Two scenarios are covered end-to-end through the DI graph: the known-name path asserts the fake was consulted once with no args and the summary is returned verbatim; the unknown-name path asserts the fake is never consulted and the result is `null`. The leading docblock explicitly aligns this approach with the project's "smoke-integration" convention (citing `distillation-threshold.bullmq-integration.spec.ts` and the reaper integration specs).

## Health Findings

- **R105 gap closed cleanly**: the prior `memory-decay-reaper` probe's "Open Questions" section called out the missing BullMQ consumer for the `memory-decay` queue. The current probe confirms that gap is resolved by `MemoryDecayProcessor` (the resolution is also annotated on the prior probe's open-question entry, citing WI-2026-052 / `1cb060cc-3d71-4d92-b894-9d5c430c2af4`).
- **Module wiring is consistent with the eviction processor**: `MemoryModule.imports` registers the `memory-decay` queue via `BullModule.registerQueue({ name: MEMORY_DECAY_QUEUE })`; `MemoryModule.providers` includes `MemoryDecayProcessor` directly (not behind a `useFactory` or `useClass`). The same import line also registers `MEMORY_EVICTION_QUEUE` and `MEMORY_DRIFT_QUEUE`, so the three reapers are wired through one scaffold (`MemoryCronScheduler`) and three parallel processors. No boundary drift is observed.
- **Test style matches project conventions**: the unit spec uses the same typed-mock-factory (`createMockReaper`) shape as the reaper specs; the integration spec uses the same `Test.createTestingModule` + `BullModule.registerQueue` + `{ provide, useValue }` override shape as `distillation-threshold.bullmq-integration.spec.ts`. Both specs use `vi.fn()` for fake implementations and clean up via `moduleRef.close()` between tests.
- **No lint suppression in the assigned files**: a grep across the three files finds no `eslint-disable` / `@ts-ignore` / `@ts-nocheck` comments — consistent with the strict-lint policy in `AGENTS.md`.
- **Defensive belt-and-suspenders**: the unit spec's third case pins the rethrow path with an explicit assertion (`rejects.toThrow('reaper db outage')`), so a future refactor that accidentally swallows the reaper's error will fail CI. The integration spec's second case pins the unknown-name path through real DI, so a refactor that promotes the reaper call above the job-name guard will fail CI.
- **No churn signals**: the three files are dated 2026-06-22 (or 2026-06-26 for the reaper target) and are not flagged in the prior probe as having active churn.

## Open Questions

- **Live `new Worker(...)` exercise**: both tests cover the processor by calling `processor.process(job)` directly. The integration spec's leading docblock explicitly justifies this as the project's "smoke-integration" convention (no Redis, no Docker, no live `Worker`). The same convention is used by the `distillation-threshold.bullmq-integration.spec.ts` analog. The risk surface — that a regression in NestJS BullMQ's `WorkerHost` integration (e.g., a future `@nestjs/bullmq` upgrade that changes the `process(job)` call shape) might not be caught by these tests — is small but real. There is no e2e exercise of the `memory-decay` queue end-to-end through a live worker, so the only runtime evidence that the worker actually dispatches `MEMORY_DECAY_JOB_NAME` to `MemoryDecayProcessor` is the production wiring in `MemoryModule` and `MemoryCronScheduler`. This matches the eviction reaper's posture, so it is consistent rather than anomalous, but is worth flagging if a black-box worker test is desired in a future milestone.
- **No `useFactory`/`useClass` indirection on the processor**: `MemoryDecayProcessor` is registered as a plain provider (constructor-injected `MemoryDecayReaperService`), in contrast to `BackendInstrumentation` in the same module which is wrapped in a `useFactory` for SWC-decorator-metadata reasons. The plain shape works here because the processor is a simple `@Injectable()` with one collaborator and no circular-dep risk. No action needed, but a future addition (e.g., injecting `SystemSettingsService` to mirror the eviction processor's cron-expression logging) would not require any rewiring beyond adding the constructor parameter.
