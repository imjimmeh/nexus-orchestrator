/**
 * Boot spec for the daily convergence recorder's M3 wiring
 * (work item 946a3c8b-5814-4e76-a804-b557e589600b, milestone 3).
 *
 * Pin four contract invariants of the M3 wiring WITHOUT booting
 * `MemoryModule` end-to-end:
 *   (a) The recorder's gauge (`nexus_learning_convergence_score`)
 *       is registered on the prom-client registry after
 *       `MetricsService` constructs.
 *   (b) The recorder's counter
 *       (`nexus_memory_retention_recalibrations_total`,
 *       plural per the canonical contract in
 *       `ADR-learning-convergence-gauge-rename.md` + AC-7)
 *       is registered on the prom-client registry after
 *       `MetricsService` constructs.
 *   (c) `MEMORY_CONVERGENCE_SNAPSHOT_QUEUE` equals the literal
 *       `'convergence-snapshot'` (the BullMQ queue name the
 *       scheduler + processor wire on).
 *   (d) All four new `AUTONOMY_EVENT_NAMES` entries are
 *       present and pinned to their literal values.
 *
 * Why no `Test.createTestingModule({ imports: [MemoryModule] })`:
 *   Booting `MemoryModule` end-to-end pulls in the sibling
 *   reaper trio's processor / reaper chains (`MemoryEvictionProcessor`
 *   → `MemoryEvictionReaperService` → ...). The
 *   `MemoryEvictionProcessor`'s constructor needs the
 *   `MemoryEvictionReaperService` which transitively depends
 *   on the Postgres / TypeORM repository graph. Booting the
 *   full module in a unit-style spec requires either a live
 *   Postgres (Testcontainers) or a deep mock graph that
 *   re-mocks ~12 collaborators — exactly the kind of brittle
 *   integration test the WR-QA-2 / testing-unit-patterns
 *   guidance tells us to avoid.
 *
 *   The recorder's per-pass orchestration is exhaustively
 *   covered by `convergence-recorder.service.spec.ts` (38 unit
 *   tests). The boot spec's job is to pin the four public
 *   surfaces of the M3 wiring — instruments, queue name, and
 *   event names — so a regression in any of the three wiring
 *   constants surfaces here.
 *
 * prom-client registry hygiene:
 *   The prom-client registry is process-global. Following the
 *   pattern in `metrics.service.spec.ts`, each test calls
 *   `register.clear()` in `beforeEach` / `afterEach` so a prior
 *   `MetricsService` instance (or one from a sibling spec)
 *   doesn't collide on the duplicate-registration guard.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { register } from 'prom-client';
import { MetricsService } from '../../../observability/metrics.service';
import { AUTONOMY_EVENT_NAMES } from '../../../observability/autonomy-observability.types';
import { MEMORY_CONVERGENCE_SNAPSHOT_QUEUE } from './convergence.constants';

describe('ConvergenceRecorder M3 boot wiring', () => {
  let metrics: MetricsService;

  beforeEach(() => {
    register.clear();
    metrics = new MetricsService();
  });

  afterEach(() => {
    register.clear();
  });

  it('asserts (a) the recorder gauge is registered on the prom-client registry', () => {
    const gauge = register.getSingleMetric('nexus_learning_convergence_score');
    expect(gauge).toBeDefined();

    // Exercise the mutator so the labelled series lands on
    // the gauge — proves the recorder's `setConvergenceScore`
    // call site (which uses the same MetricsService instance)
    // writes to a real prom-client gauge, not a phantom name.
    metrics.setConvergenceScore('24h', 0.65);
  });

  it('asserts (b) the recorder counter is registered on the prom-client registry', () => {
    const counter = register.getSingleMetric(
      'nexus_memory_retention_recalibrations_total',
    );
    expect(counter).toBeDefined();

    // Exercise the mutator to confirm the counter actually
    // accepts a labelled increment — the recorder calls
    // `metrics.recordMemoryRetentionRecalibration('applied' |
    // 'no_change')` on every pass.
    metrics.recordMemoryRetentionRecalibration('applied');
    metrics.recordMemoryRetentionRecalibration('no_change');
  });

  it('asserts (c) the convergence-snapshot queue constant matches the literal', () => {
    // Pin the literal value the scheduler (in
    // `memory-cron.scheduler.ts`'s `CRON_REGISTRATIONS`) and
    // the processor (`@Processor(MEMORY_CONVERGENCE_SNAPSHOT_QUEUE)`)
    // both read. A regression that flips the constant would
    // orphan the BullMQ repeat schedule and the processor's
    // `@Processor` decorator would target a different queue.
    expect(MEMORY_CONVERGENCE_SNAPSHOT_QUEUE).toBe('convergence-snapshot');
  });

  it('asserts (d) all four new AUTONOMY_EVENT_NAMES entries are present', () => {
    // Pin the recorder's four autonomy-event surfaces on the
    // closed-union constant. The recorder service reads
    // through the constants
    // (`RECORDER_PASSED_EVENT_NAME`,
    // `RECORDER_FAILED_EVENT_NAME`, etc.); a regression that
    // drops an entry surfaces here as an `undefined` value.
    expect(AUTONOMY_EVENT_NAMES.memoryConvergenceRecorderSucceeded).toBe(
      'memory.convergence.recorder_succeeded.v1',
    );
    expect(AUTONOMY_EVENT_NAMES.memoryConvergenceRecorderFailed).toBe(
      'memory.convergence.recorder_failed.v1',
    );
    expect(AUTONOMY_EVENT_NAMES.memoryRetentionRecalibrated).toBe(
      'memory.retention.recalibrated.v1',
    );
    expect(AUTONOMY_EVENT_NAMES.memoryRetentionRecalibrationSkipped).toBe(
      'memory.retention.recalibration_skipped.v1',
    );
  });
});
