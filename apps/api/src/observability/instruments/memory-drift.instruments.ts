import * as prometheus from 'prom-client';

/**
 * Memory-drift-detection instrument (work item
 * 0cead042-e823-4e26-9386-02042252ffb0).
 *
 * Registers the `nexus_memory_drift_detected_total` counter
 * against the global `prom-client` registry. The counter is
 * incremented from three call sites inside the detector
 * service:
 *   - `outcome = 'detected'` — the row's checker returned
 *     `{ drifted: true }`, the row was stamped with
 *     `drift_detected_at`, the confidence penalty was
 *     applied, and the `memory.segment.drift_detected.v1`
 *     event was emitted.
 *   - `outcome = 'exempt'` — the row's `source` matched the
 *     `MEMORY_DRIFT_EXEMPT_SOURCES` allowlist and the
 *     detector short-circuited without invoking a checker.
 *   - `outcome = 'unavailable'` — the row's checker was
 *     unreachable (e.g. schema index build failed or code
 *     corpus enumeration failed) and the detector recorded
 *     `reason = 'checker_unavailable'` for the row.
 *
 * The `source` label is the parser's `referenceKind`
 * (`file` | `schema` | `api`) so the operator can slice the
 * metric by drift surface area. Cardinality is bounded by
 * the documented set of reference kinds (a closed enum,
 * NOT free-form metadata). `normaliseDriftMetricLabel`
 * below is the defensive coercer that callers use to keep
 * the cardinality contract enforced.
 *
 * Originally defined in
 * `apps/api/src/observability/metrics.service.ts` as
 * `MetricsService.registerMemoryDriftMetric()`; this file
 * is a faithful verbatim extraction of that body so the
 * metric name, label names, and help string remain
 * byte-identical to the previous in-class definition.
 */
export function registerMemoryDriftMetric(): prometheus.Counter {
  return new prometheus.Counter({
    name: 'nexus_memory_drift_detected_total',
    help: 'Total memory segments flagged as drifted by the source-file reality check, labelled by source kind and outcome (detected | exempt | unavailable | error).',
    labelNames: ['source', 'outcome'],
  });
}

/**
 * Coerce an incoming `source` label for the drift-detection
 * counter (work item 0cead042-e823-4e26-9386-02042252ffb0)
 * into a safe, bounded-cardinality value.
 *
 * The documented label union is the parser's closed enum
 * (`file` | `schema` | `api`). Anything else (`unknown`,
 * `null`, `undefined`, non-string, etc.) is normalised to
 * the sentinel `'unknown'` so the Prometheus scrape cannot
 * fail on a malformed input and the counter's cardinality
 * stays bounded by the documented set.
 *
 * Originally a module-level `function` at the bottom of
 * `apps/api/src/observability/metrics.service.ts`. Extracted
 * verbatim so the coercion rules remain byte-identical.
 */
export function normaliseDriftMetricLabel(source: unknown): string {
  if (typeof source !== 'string') {
    return 'unknown';
  }
  if (source === 'file' || source === 'schema' || source === 'api') {
    return source;
  }
  return 'unknown';
}
