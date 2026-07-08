/**
 * Centralised instrumentation helper for the per-backend memory
 * services in `apps/api/src/memory/`.
 *
 * The three backend services (`PostgresMemoryBackendService`,
 * `HonchoMemoryBackendService`, `HonchoFallbackMemoryBackendService`)
 * historically wrap every operation in a copy-pasted
 * `try { recordBackend*(backend, 'success'); } catch { recordBackend*(backend, 'failure'); throw; }`
 * pattern, paired with the prom-client mirror (`MetricsService`).
 *
 * That pattern drifted in three ways (see
 * `/workspace/.agents/designs/backend-instrumentation-design.md` for
 * the full drift inventory):
 *
 *   - **D1** — Postgres records read latency in `finally`; HonchoFallback
 *     records read latency only in `catch`. A successful honcho read
 *     routed through HonchoFallback loses its latency observation.
 *   - **D2** — `HONCHO_FALLBACK_ON_ERROR=false` causes the honcho
 *     read latency to be recorded twice (once by Honcho in its own
 *     catch, once by HonchoFallback in its catch). The milestone 3–5
 *     migration resolves this; the helper provides the
 *     `recordFallback(ctx, fn)` shape that lets the new code de-dup.
 *   - **D4** — Backend labels are string literals at every call site
 *     (29 sites across the three backends). A typo (`'honch'`)
 *     compiles silently and produces a new prom-client label series.
 *     The helper signature requires the `BackendLabel` union so a
 *     stray label becomes a compile error.
 *
 * This milestone only introduces the helper and its unit tests — it
 * does NOT modify any backend file. The migration to the helper
 * happens in milestones 3–5.
 */
import { Injectable } from '@nestjs/common';
import { MemoryMetricsService } from './memory-metrics.service';
import { MetricsService } from '../observability/metrics.service';
import type {
  BackendInstrumentationDeps,
  RecordFallbackContext,
  RecordReadContext,
  RecordWriteContext,
} from './backend-instrumentation.types';

/**
 * One-second-in-nanoseconds constant used to convert
 * `process.hrtime.bigint()` deltas to milliseconds. Local to the
 * file to keep the helper's public surface free of magic numbers —
 * the design doc §1 references `Date.now()`-based latency at the
 * legacy call sites, but the helper uses `process.hrtime.bigint()` to
 * match the high-resolution timer pattern preferred for
 * sub-millisecond observations.
 */
const NANOSECONDS_PER_MILLISECOND = 1_000_000n;

@Injectable()
export class BackendInstrumentation {
  private readonly deps: BackendInstrumentationDeps;

  constructor(
    memoryMetrics: MemoryMetricsService,
    metricsService: MetricsService,
  ) {
    this.deps = { memoryMetrics, metricsService };
  }

  /**
   * Wrap a write operation. Records `outcome = 'success'` on resolve,
   * `outcome = 'failure'` on throw, then re-throws the original error
   * so the caller can decide whether to fall back (Honcho / Honcho
   * mode) or surface the failure (Postgres).
   *
   * The latency observation that the design doc's uniform
   * `try / catch / finally` template suggests for writes does NOT
   * apply here — the existing prom-client mirror
   * (`nexus_memory_backend_write_total`) and the in-memory mirror
   * (`backend.write.total[backend][outcome]`) carry no histogram,
   * so adding a latency observation would change the published
   * metric shape. The `try / catch` shape mirrors the legacy
   * Postgres / Honcho write paths (P1, H1, F1 in the design doc).
   */
  async recordWrite<T>(
    ctx: RecordWriteContext,
    fn: () => Promise<T>,
  ): Promise<T> {
    try {
      const result = await fn();
      this.deps.memoryMetrics.recordBackendWrite(ctx.backend, 'success');
      this.deps.metricsService.recordMemoryBackendWrite(ctx.backend, 'success');
      return result;
    } catch (error: unknown) {
      this.deps.memoryMetrics.recordBackendWrite(ctx.backend, 'failure');
      this.deps.metricsService.recordMemoryBackendWrite(ctx.backend, 'failure');
      throw error;
    }
  }

  /**
   * Wrap a read operation. Latency is observed in `finally` so the
   * histogram always receives an observation — success OR failure.
   * This aligns the three backends on drift D1 (Postgres was the only
   * one that always recorded latency; HonchoFallback recorded it
   * only inside `catch`).
   *
   * The error is re-thrown via the natural `finally` semantics so the
   * caller decides whether to fall back (`HonchoMemoryBackendService`,
   * `HonchoFallbackMemoryBackendService`) or surface the failure
   * (`PostgresMemoryBackendService`).
   *
   * `process.hrtime.bigint()` is used (rather than `Date.now()`) for
   * the latency measurement to match the project's high-resolution
   * timer preference — see the `process.hrtime` reference at the top
   * of `memory-metrics.service.ts` and the design doc §3.2 latency
   * accumulator.
   */
  async recordRead<T>(
    ctx: RecordReadContext,
    fn: () => Promise<T>,
  ): Promise<T> {
    const start = process.hrtime.bigint();
    try {
      return await fn();
    } finally {
      const latencyMs = this.elapsedMs(start);
      this.deps.memoryMetrics.recordBackendRead(ctx.backend, latencyMs);
      this.deps.metricsService.recordMemoryBackendRead(ctx.backend, latencyMs);
    }
  }

  /**
   * Wrap the fallback path. Increments
   * `nexus_memory_backend_fallback_total{from, to, operation}` on
   * the prom-client mirror and the in-memory
   * `backend.fallback["${from}->${to}:${operation}"]` counter, then
   * returns the wrapped `fn()` result.
   *
   * If `ctx.recordPrimaryLatencyMs` is provided, the helper also
   * records the primary attempt's elapsed time via
   * `memoryMetrics.recordBackendRead` and
   * `metricsService.recordMemoryBackendRead` (drift D2: today this
   * double-records when `HONCHO_FALLBACK_ON_ERROR=false`; the
   * milestone 6 migration will resolve that by routing the primary
   * latency through `recordRead` instead).
   *
   * On `fn()` failure, the helper re-throws the original error
   * unchanged — the caller decides whether to surface the secondary
   * failure (Postgres) or swap to yet another backend (none today,
   * but the helper leaves the door open for milestone 6).
   */
  async recordFallback<T>(
    ctx: RecordFallbackContext,
    fn: () => Promise<T>,
  ): Promise<T> {
    this.deps.memoryMetrics.recordBackendFallback(
      ctx.from,
      ctx.to,
      ctx.operation,
    );
    this.deps.metricsService.recordMemoryBackendFallback(
      ctx.from,
      ctx.to,
      ctx.operation,
    );
    if (ctx.recordPrimaryLatencyMs !== undefined) {
      this.deps.memoryMetrics.recordBackendRead(
        ctx.from,
        ctx.recordPrimaryLatencyMs,
      );
      this.deps.metricsService.recordMemoryBackendRead(
        ctx.from,
        ctx.recordPrimaryLatencyMs,
      );
    }
    return await fn();
  }

  /**
   * Explicit no-op for un-instrumented passthroughs (drift D6 in
   * the design doc). Use in `updateMemorySegmentWithMetadata` /
   * `searchPromotedLessonsByScope` so the lack of instrumentation
   * is searchable and intentional rather than accidental — a reader
   * looking for "why does this method skip the helper?" finds the
   * `passthrough()` call and the cross-reference immediately.
   */
  async passthrough<T>(fn: () => Promise<T>): Promise<T> {
    return await fn();
  }

  /**
   * Convert a `process.hrtime.bigint()` reading to milliseconds.
   * `Date.now()` would also work but `process.hrtime.bigint()` is
   * monotonic and immune to wall-clock adjustments — preferred for
   * latency observation in instrumentation code.
   */
  private elapsedMs(start: bigint): number {
    const deltaNs = process.hrtime.bigint() - start;
    return Number(deltaNs / NANOSECONDS_PER_MILLISECOND);
  }
}
