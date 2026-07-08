import * as prometheus from 'prom-client';

/**
 * Memory-backend, distillation, and learning-promotion instruments.
 *
 * Registers the memory-backend read/write counters, read-latency
 * histogram, active-segments gauge, fallback counter, the
 * distillation completed-total counter, the distillation
 * compression-ratio histogram, and the learning-promoted counter
 * against the global `prom-client` registry. Originally defined
 * in `apps/api/src/observability/metrics.service.ts` as
 * `MetricsService.registerMemoryInstruments()`; this file is a
 * faithful verbatim extraction of that body so the metric names,
 * label names, and bucket configuration remain byte-identical to
 * the previous in-class definition.
 *
 * Note on metric names: the distillation and learning-promotion
 * metrics intentionally do NOT carry a `memory_` prefix
 * (`nexus_distillation_completed_total`,
 * `nexus_distillation_compression_ratio`,
 * `nexus_learning_promoted_total`). They are siblings of the
 * `nexus_memory_backend_*` instruments but live on the
 * distillation / learning domains respectively — that is the
 * original `MetricsService` declaration. Do not rename without a
 * coordinated metric rename — Prometheus scrapers and existing
 * dashboards key off these exact names.
 *
 * Note on `distillationCompressionRatio`: this is a `Histogram`
 * (one observation per completed distillation run), not a
 * `Gauge`. The original `MetricsService` declaration uses
 * `Histogram` so dashboards can compute p50/p95/p99 compression
 * ratios. Faithful extraction preserves that.
 */
export function registerMemoryInstruments(): {
  backendReadTotal: prometheus.Counter;
  backendWriteTotal: prometheus.Counter;
  backendReadLatencyMs: prometheus.Histogram;
  backendActiveSegments: prometheus.Gauge;
  backendFallbackTotal: prometheus.Counter;
  distillationCompletedTotal: prometheus.Counter;
  distillationCompressionRatio: prometheus.Histogram;
  learningPromotedTotal: prometheus.Counter;
} {
  const backendReadTotal = new prometheus.Counter({
    name: 'nexus_memory_backend_read_total',
    help: 'Total number of memory backend read operations',
    labelNames: ['backend'],
  });

  const backendWriteTotal = new prometheus.Counter({
    name: 'nexus_memory_backend_write_total',
    help: 'Total number of memory backend write operations',
    labelNames: ['backend', 'outcome'],
  });

  const backendReadLatencyMs = new prometheus.Histogram({
    name: 'nexus_memory_backend_read_latency_ms',
    help: 'Memory backend read latency in milliseconds',
    labelNames: ['backend'],
    buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
  });

  const backendActiveSegments = new prometheus.Gauge({
    name: 'nexus_memory_backend_active_segments',
    help: 'Current count of active memory segments per backend and source',
    labelNames: ['backend', 'source'],
  });

  const backendFallbackTotal = new prometheus.Counter({
    name: 'nexus_memory_backend_fallback_total',
    help: 'Total number of memory backend fallback events',
    labelNames: ['from', 'to', 'operation'],
  });

  const distillationCompletedTotal = new prometheus.Counter({
    name: 'nexus_distillation_completed_total',
    help: 'Total number of memory distillation runs completed',
    labelNames: ['outcome'],
  });

  const distillationCompressionRatio = new prometheus.Histogram({
    name: 'nexus_distillation_compression_ratio',
    help: 'Compression ratio of distilled memory runs (final/initial tokens)',
    buckets: [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 5],
  });

  const learningPromotedTotal = new prometheus.Counter({
    name: 'nexus_learning_promoted_total',
    help: 'Total number of learning candidates promoted to memory',
  });

  return {
    backendReadTotal,
    backendWriteTotal,
    backendReadLatencyMs,
    backendActiveSegments,
    backendFallbackTotal,
    distillationCompletedTotal,
    distillationCompressionRatio,
    learningPromotedTotal,
  };
}
