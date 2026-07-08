/**
 * Type contracts for the {@link BackendInstrumentation} helper class.
 *
 * The helper centralises the copy-pasted
 * `try { recordBackend*(backend, 'success'); } catch { recordBackend*(backend, 'failure'); throw; }`
 * pattern that wraps every Postgres / Honcho / HonchoFallback backend call
 * in `apps/api/src/memory/`. See
 * `/workspace/.agents/designs/backend-instrumentation-design.md` for the
 * design rationale and drift inventory that motivated this extraction.
 *
 * The `.types.ts` filename is required by the project's lint policy
 * (`apps/api/eslint.config.mjs`) — exported interfaces and type aliases
 * must live in `*.types.ts` files so the public surface of the helper
 * stays statically analysable.
 *
 * `BackendLabel` is re-exported from `memory-metrics.types.ts` (the
 * existing source of truth) so the helper, the in-memory mirror
 * (`MemoryMetricsService`), and the prom-client mirror (`MetricsService`)
 * all share the same union — there is exactly one place in the codebase
 * where a backend label literal can be introduced.
 */
import type { MemoryMetricsService } from './memory-metrics.service';
import type { MetricsService } from '../observability/metrics.service';
import type { BackendLabel as InMemoryBackendLabel } from './memory-metrics.types';

/**
 * The closed union of backend labels that {@link BackendInstrumentation}
 * accepts. Mirrors `BackendLabel` from `memory-metrics.types.ts`; the
 * re-export keeps the helper's public surface self-contained — a caller
 * that imports from `backend-instrumentation.types.ts` does not also
 * need to import from `memory-metrics.types.ts` to type its parameters.
 */
export type BackendLabel = InMemoryBackendLabel;

/**
 * Closed enum for instrumented backend operations. The set mirrors the
 * `operation` label on `nexus_memory_backend_fallback_total` so the
 * helper refuses free-form strings at the type level.
 *
 * The 7 names come from the design doc's §1 call-site inventory:
 *
 *   - `createMemorySegment`     — `postgres.createMemorySegment` (P1)
 *                                 and `honcho.createMemorySegment`
 *                                 (H1, F1)
 *   - `getMemorySegments`       — `postgres.getMemorySegments` (P2),
 *                                 `honcho.getMemorySegments` (H2, F2)
 *   - `getMemorySegmentsByType` — `postgres.getMemorySegmentsByType`
 *                                 (P3), `honcho.getMemorySegmentsByType`
 *                                 (H3, F3)
 *   - `updateMemorySegment`     — `postgres.updateMemorySegment` (P4)
 *   - `deleteMemorySegment`     — `postgres.deleteMemorySegment` (P5)
 *   - `searchMemory`            — `postgres.searchMemory` (P6),
 *                                 `honcho.searchMemory` (H4, F4)
 *   - `searchMemoryByType`      — `postgres.searchMemoryByType` (P7),
 *                                 `honcho.searchMemoryByType` (H5, F5)
 *
 * `updateMemorySegmentWithMetadata` and `searchPromotedLessonsByScope`
 * are intentionally excluded — they are un-instrumented passthroughs
 * (drift D6 in the design doc) and use the helper's `passthrough()`
 * method instead.
 */
export type BackendOperation =
  | 'createMemorySegment'
  | 'getMemorySegments'
  | 'getMemorySegmentsByType'
  | 'updateMemorySegment'
  | 'deleteMemorySegment'
  | 'searchMemory'
  | 'searchMemoryByType';

/**
 * Parameter object for {@link BackendInstrumentation.recordWrite}.
 *
 * The `fn` callable is passed as a separate positional argument to the
 * `recordWrite` method rather than embedded in this context — keeping
 * the context as metadata only makes the call-site reads as
 * `instrumentation.recordWrite({ backend, operation }, () => ...)`,
 * which mirrors how the in-memory and prom-client mutators are
 * invoked at the legacy call sites today.
 */
export interface RecordWriteContext {
  readonly backend: BackendLabel;
  readonly operation: BackendOperation;
}

/**
 * Parameter object for {@link BackendInstrumentation.recordRead}.
 * Mirrors {@link RecordWriteContext} — see the comment there for why
 * `fn` is a separate positional argument.
 */
export interface RecordReadContext {
  readonly backend: BackendLabel;
  readonly operation: BackendOperation;
}

/**
 * Parameter object for {@link BackendInstrumentation.recordFallback}.
 *
 * `recordPrimaryLatencyMs` is optional: when supplied, the helper
 * records it via both `memoryMetrics.recordBackendRead` and
 * `metricsService.recordMemoryBackendRead` in addition to the fallback
 * counter. This matches the existing
 * `HonchoFallbackMemoryBackendService` behaviour (F2 line 91, F3 line
 * 119, F4 line 167, F5 line 196) where the primary honcho attempt's
 * latency is observed at the moment the fallback fires — see drift D2
 * in the design doc for the double-count caveat that the milestone
 * 3–5 migration will resolve.
 */
export interface RecordFallbackContext {
  readonly from: BackendLabel;
  readonly to: BackendLabel;
  readonly operation: BackendOperation;
  readonly recordPrimaryLatencyMs?: number;
}

/**
 * Constructor dependency for {@link BackendInstrumentation}.
 *
 * The two fields map to the services that the helper must touch on
 * every instrumented call:
 *
 *   - `memoryMetrics` — the in-memory `nexus_memory_backend_*` mirror
 *     that the `MemoryMetricsController` REST endpoint exposes.
 *   - `metricsService` — the prom-client mirror that the Prometheus
 *     scrape aggregates.
 */
export interface BackendInstrumentationDeps {
  readonly memoryMetrics: MemoryMetricsService;
  readonly metricsService: MetricsService;
}
