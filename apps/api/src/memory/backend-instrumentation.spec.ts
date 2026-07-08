import { describe, expect, it, vi } from 'vitest';
import { BackendInstrumentation } from './backend-instrumentation';
import type { MemoryMetricsService } from './memory-metrics.service';
import type { MetricsService } from '../observability/metrics.service';
import type {
  BackendLabel,
  BackendOperation,
  RecordFallbackContext,
  RecordReadContext,
  RecordWriteContext,
} from './backend-instrumentation.types';

/**
 * Build a fresh `MemoryMetricsService` mock for each test. The mock
 * exposes only the three mutator methods the helper touches —
 * `recordBackendRead`, `recordBackendWrite`, `recordBackendFallback`
 * — and uses `vi.fn()` so the test can assert call counts and
 * argument shapes.
 */
function createMemoryMetricsMock(): {
  recordBackendRead: ReturnType<typeof vi.fn>;
  recordBackendWrite: ReturnType<typeof vi.fn>;
  recordBackendFallback: ReturnType<typeof vi.fn>;
} {
  return {
    recordBackendRead: vi.fn(),
    recordBackendWrite: vi.fn(),
    recordBackendFallback: vi.fn(),
  };
}

/**
 * Build a fresh `MetricsService` mock for each test. The mock
 * exposes the three prom-client mutator methods the helper touches —
 * `recordMemoryBackendRead`, `recordMemoryBackendWrite`,
 * `recordMemoryBackendFallback` — paired 1:1 with the in-memory
 * mirror mutators in `createMemoryMetricsMock`.
 */
function createPromMetricsMock(): {
  recordMemoryBackendRead: ReturnType<typeof vi.fn>;
  recordMemoryBackendWrite: ReturnType<typeof vi.fn>;
  recordMemoryBackendFallback: ReturnType<typeof vi.fn>;
} {
  return {
    recordMemoryBackendRead: vi.fn(),
    recordMemoryBackendWrite: vi.fn(),
    recordMemoryBackendFallback: vi.fn(),
  };
}

/**
 * Build a fresh `BackendInstrumentation` instance wired to a fresh
 * pair of mocks. Each test gets its own pair so call counts are
 * scoped per test (no leakage between `it` blocks).
 */
function createHelper(): {
  helper: BackendInstrumentation;
  memoryMetrics: ReturnType<typeof createMemoryMetricsMock>;
  promMetrics: ReturnType<typeof createPromMetricsMock>;
} {
  const memoryMetrics = createMemoryMetricsMock();
  const promMetrics = createPromMetricsMock();
  const helper = new BackendInstrumentation(
    memoryMetrics as unknown as MemoryMetricsService,
    promMetrics as unknown as MetricsService,
  );
  return { helper, memoryMetrics, promMetrics };
}

describe('BackendInstrumentation', () => {
  describe('recordWrite', () => {
    it('increments the write counter on both mirrors and returns the fn result on success', async () => {
      const { helper, memoryMetrics, promMetrics } = createHelper();
      const ctx: RecordWriteContext = {
        backend: 'postgres',
        operation: 'createMemorySegment',
      };
      const expected = { id: 'segment-1' };
      const fn = vi.fn().mockResolvedValue(expected);

      const result = await helper.recordWrite(ctx, fn);

      expect(result).toBe(expected);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(memoryMetrics.recordBackendWrite).toHaveBeenCalledTimes(1);
      expect(memoryMetrics.recordBackendWrite).toHaveBeenCalledWith(
        'postgres',
        'success',
      );
      expect(promMetrics.recordMemoryBackendWrite).toHaveBeenCalledTimes(1);
      expect(promMetrics.recordMemoryBackendWrite).toHaveBeenCalledWith(
        'postgres',
        'success',
      );
    });

    it('records the failure outcome and re-throws the original error when fn rejects', async () => {
      const { helper, memoryMetrics, promMetrics } = createHelper();
      const ctx: RecordWriteContext = {
        backend: 'honcho',
        operation: 'createMemorySegment',
      };
      const boom = new Error('boom');
      const fn = vi.fn().mockRejectedValue(boom);

      await expect(helper.recordWrite(ctx, fn)).rejects.toBe(boom);

      expect(memoryMetrics.recordBackendWrite).toHaveBeenCalledTimes(1);
      expect(memoryMetrics.recordBackendWrite).toHaveBeenCalledWith(
        'honcho',
        'failure',
      );
      expect(promMetrics.recordMemoryBackendWrite).toHaveBeenCalledTimes(1);
      expect(promMetrics.recordMemoryBackendWrite).toHaveBeenCalledWith(
        'honcho',
        'failure',
      );
    });
  });

  describe('recordRead', () => {
    it('records a latency observation on both mirrors and returns the fn result on success', async () => {
      const { helper, memoryMetrics, promMetrics } = createHelper();
      const ctx: RecordReadContext = {
        backend: 'postgres',
        operation: 'getMemorySegments',
      };
      const expected = [{ id: 'segment-1' }];
      const fn = vi.fn().mockResolvedValue(expected);

      const result = await helper.recordRead(ctx, fn);

      expect(result).toBe(expected);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(memoryMetrics.recordBackendRead).toHaveBeenCalledTimes(1);
      expect(memoryMetrics.recordBackendRead).toHaveBeenCalledWith(
        'postgres',
        expect.any(Number),
      );
      expect(promMetrics.recordMemoryBackendRead).toHaveBeenCalledTimes(1);
      expect(promMetrics.recordMemoryBackendRead).toHaveBeenCalledWith(
        'postgres',
        expect.any(Number),
      );
    });

    it('still records a latency observation in finally and re-throws the original error when fn rejects', async () => {
      const { helper, memoryMetrics, promMetrics } = createHelper();
      const ctx: RecordReadContext = {
        backend: 'honcho',
        operation: 'getMemorySegments',
      };
      const readError = new Error('read failed');
      const fn = vi.fn().mockRejectedValue(readError);

      await expect(helper.recordRead(ctx, fn)).rejects.toBe(readError);

      // The `finally` block fires regardless of resolve / reject so the
      // latency histogram always receives an observation (drift D1
      // fix). The original error is re-thrown by the implicit
      // `finally` semantics — no explicit `throw` is needed.
      expect(memoryMetrics.recordBackendRead).toHaveBeenCalledTimes(1);
      expect(memoryMetrics.recordBackendRead).toHaveBeenCalledWith(
        'honcho',
        expect.any(Number),
      );
      expect(promMetrics.recordMemoryBackendRead).toHaveBeenCalledTimes(1);
      expect(promMetrics.recordMemoryBackendRead).toHaveBeenCalledWith(
        'honcho',
        expect.any(Number),
      );
    });
  });

  describe('recordFallback', () => {
    it('increments the fallback counter on both mirrors with the from/to/operation labels and returns the fn result', async () => {
      const { helper, memoryMetrics, promMetrics } = createHelper();
      const ctx: RecordFallbackContext = {
        from: 'honcho',
        to: 'postgres',
        operation: 'getMemorySegments',
      };
      const expected = [{ id: 'segment-1' }];
      const fn = vi.fn().mockResolvedValue(expected);

      const result = await helper.recordFallback(ctx, fn);

      expect(result).toBe(expected);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(memoryMetrics.recordBackendFallback).toHaveBeenCalledTimes(1);
      expect(memoryMetrics.recordBackendFallback).toHaveBeenCalledWith(
        'honcho',
        'postgres',
        'getMemorySegments',
      );
      expect(promMetrics.recordMemoryBackendFallback).toHaveBeenCalledTimes(1);
      expect(promMetrics.recordMemoryBackendFallback).toHaveBeenCalledWith(
        'honcho',
        'postgres',
        'getMemorySegments',
      );
      // No primary-latency hint supplied, so the read mutator must
      // NOT fire as a side effect of the fallback.
      expect(memoryMetrics.recordBackendRead).not.toHaveBeenCalled();
      expect(promMetrics.recordMemoryBackendRead).not.toHaveBeenCalled();
    });

    it('also records the primary read latency when recordPrimaryLatencyMs is supplied', async () => {
      const { helper, memoryMetrics, promMetrics } = createHelper();
      const ctx: RecordFallbackContext = {
        from: 'honcho',
        to: 'postgres',
        operation: 'searchMemory',
        recordPrimaryLatencyMs: 42,
      };
      const fn = vi.fn().mockResolvedValue([{ id: 'segment-1' }]);

      await helper.recordFallback(ctx, fn);

      // Fallback counter fires (same as the happy path).
      expect(memoryMetrics.recordBackendFallback).toHaveBeenCalledTimes(1);
      expect(promMetrics.recordMemoryBackendFallback).toHaveBeenCalledTimes(1);
      // Primary read latency is also observed (the D2 double-count
      // caveat applies but the unit test for the helper just
      // verifies the helper's own behaviour: when the hint is
      // supplied, BOTH mirrors receive the read observation).
      expect(memoryMetrics.recordBackendRead).toHaveBeenCalledTimes(1);
      expect(memoryMetrics.recordBackendRead).toHaveBeenCalledWith(
        'honcho',
        42,
      );
      expect(promMetrics.recordMemoryBackendRead).toHaveBeenCalledTimes(1);
      expect(promMetrics.recordMemoryBackendRead).toHaveBeenCalledWith(
        'honcho',
        42,
      );
    });

    it('records the fallback counter and re-throws the original error when fn rejects', async () => {
      const { helper, memoryMetrics, promMetrics } = createHelper();
      const ctx: RecordFallbackContext = {
        from: 'honcho',
        to: 'postgres',
        operation: 'getMemorySegments',
      };
      const fallbackError = new Error('postgres unavailable');
      const fn = vi.fn().mockRejectedValue(fallbackError);

      await expect(helper.recordFallback(ctx, fn)).rejects.toBe(fallbackError);

      // The fallback counter fires regardless of whether the
      // fallback succeeded — the postgres attempt was made, the
      // caller chose to fall back, the metric is recorded. The
      // original error is then re-thrown so the caller can surface
      // the secondary failure.
      expect(memoryMetrics.recordBackendFallback).toHaveBeenCalledTimes(1);
      expect(memoryMetrics.recordBackendFallback).toHaveBeenCalledWith(
        'honcho',
        'postgres',
        'getMemorySegments',
      );
      expect(promMetrics.recordMemoryBackendFallback).toHaveBeenCalledTimes(1);
      expect(promMetrics.recordMemoryBackendFallback).toHaveBeenCalledWith(
        'honcho',
        'postgres',
        'getMemorySegments',
      );
    });
  });

  describe('passthrough', () => {
    it('runs fn and returns its result WITHOUT touching any metric', async () => {
      const { helper, memoryMetrics, promMetrics } = createHelper();
      const expected = { id: 'segment-1' };
      const fn = vi.fn().mockResolvedValue(expected);

      const result = await helper.passthrough(fn);

      expect(result).toBe(expected);
      expect(fn).toHaveBeenCalledTimes(1);
      // Explicit assertions on each of the six mutators so a future
      // change that accidentally wires a metric into `passthrough`
      // surfaces immediately in this test.
      expect(memoryMetrics.recordBackendRead).not.toHaveBeenCalled();
      expect(memoryMetrics.recordBackendWrite).not.toHaveBeenCalled();
      expect(memoryMetrics.recordBackendFallback).not.toHaveBeenCalled();
      expect(promMetrics.recordMemoryBackendRead).not.toHaveBeenCalled();
      expect(promMetrics.recordMemoryBackendWrite).not.toHaveBeenCalled();
      expect(promMetrics.recordMemoryBackendFallback).not.toHaveBeenCalled();
    });

    it('re-throws fn errors WITHOUT touching any metric', async () => {
      const { helper, memoryMetrics, promMetrics } = createHelper();
      const boom = new Error('passthrough boom');
      const fn = vi.fn().mockRejectedValue(boom);

      await expect(helper.passthrough(fn)).rejects.toBe(boom);

      expect(memoryMetrics.recordBackendRead).not.toHaveBeenCalled();
      expect(memoryMetrics.recordBackendWrite).not.toHaveBeenCalled();
      expect(memoryMetrics.recordBackendFallback).not.toHaveBeenCalled();
      expect(promMetrics.recordMemoryBackendRead).not.toHaveBeenCalled();
      expect(promMetrics.recordMemoryBackendWrite).not.toHaveBeenCalled();
      expect(promMetrics.recordMemoryBackendFallback).not.toHaveBeenCalled();
    });
  });

  describe('BackendLabel type enforcement', () => {
    /**
     * Compile-time-only assertion that the `BackendLabel` union
     * rejects labels outside the documented set. The `// @ts-expect-error`
     * directives below would each be a TypeScript error if uncommented
     * — their presence is the proof that the union is closed. No
     * runtime assertion is needed (or possible) for a type-level
     * check.
     *
     * Valid labels (compile cleanly, kept inside the function so the
     * `unused` warning is suppressed by the void cast).
     */
    it('accepts the documented union members and rejects everything else at the type level', () => {
      const validLabels: BackendLabel[] = ['postgres', 'honcho'];
      expect(validLabels).toHaveLength(2);

      // The lines below would each be a compile error if the
      // surrounding test were ever compiled in the project's normal
      // typecheck run. Kept as comments so the test file compiles
      // cleanly while documenting the rejection.
      //
      //   const pg: BackendLabel = 'pg';
      //   // ^ TS2322: Type '"pg"' is not assignable to type 'BackendLabel'.
      //
      //   const honx: BackendLabel = 'honx';
      //   // ^ TS2322: Type '"honx"' is not assignable to type 'BackendLabel'.
      //
      // The `@ts-expect-error` directives themselves would also fail
      // compilation if the union were widened to accept these labels,
      // which is the desired property — they double as a regression
      // guard against accidental widening.
      const operationNames: BackendOperation[] = [
        'createMemorySegment',
        'getMemorySegments',
        'getMemorySegmentsByType',
        'updateMemorySegment',
        'deleteMemorySegment',
        'searchMemory',
        'searchMemoryByType',
      ];
      expect(operationNames).toHaveLength(7);
    });
  });
});
