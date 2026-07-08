import * as prometheus from 'prom-client';

/**
 * Container-lifecycle instruments.
 *
 * Registers the container provisioning-duration histogram, the
 * active-containers gauge, and the container-failures counter
 * against the global `prom-client` registry. Originally defined
 * in `apps/api/src/observability/metrics.service.ts` as
 * `MetricsService.registerContainerInstruments()`; this file is
 * a faithful verbatim extraction of that body so the metric
 * names, label names, and bucket configuration remain
 * byte-identical to the previous in-class definition.
 *
 * Note: the `nexus_containers_active` metric name uses the
 * plural form (matching the original `MetricsService`
 * declaration). Do not rename without a coordinated metric
 * rename — Prometheus scrapers and existing dashboards key
 * off the plural form.
 */
export function registerContainerInstruments(): {
  provisioningDuration: prometheus.Histogram;
  active: prometheus.Gauge;
  failuresTotal: prometheus.Counter;
} {
  const provisioningDuration = new prometheus.Histogram({
    name: 'nexus_container_provisioning_duration_seconds',
    help: 'Container provisioning duration in seconds',
    labelNames: ['tier'],
    buckets: [1, 2, 5, 10, 20, 30, 60],
  });

  const active = new prometheus.Gauge({
    name: 'nexus_containers_active',
    help: 'Number of currently active containers',
    labelNames: ['tier'],
  });

  const failuresTotal = new prometheus.Counter({
    name: 'nexus_container_failures_total',
    help: 'Total number of container failures',
    labelNames: ['tier', 'reason'],
  });

  return { provisioningDuration, active, failuresTotal };
}
