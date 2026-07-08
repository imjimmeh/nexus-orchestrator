import * as prometheus from 'prom-client';

/**
 * Workflow-execution instruments.
 *
 * Registers the workflow execution-duration histogram, the
 * execution total counter, and the active-workflows gauge
 * against the global `prom-client` registry. Originally
 * defined in `apps/api/src/observability/metrics.service.ts`
 * as `MetricsService.registerWorkflowInstruments()`; this
 * file is a faithful verbatim extraction of that body so the
 * metric names, label names, and bucket configuration remain
 * byte-identical to the previous in-class definition.
 *
 * Note: the `nexus_workflows_active` metric name uses the
 * plural form (matching the original `MetricsService`
 * declaration). Do not rename without a coordinated metric
 * rename — Prometheus scrapers and existing dashboards key
 * off the plural form.
 */
export function registerWorkflowInstruments(): {
  executionDuration: prometheus.Histogram;
  executionsTotal: prometheus.Counter;
  active: prometheus.Gauge;
} {
  const executionDuration = new prometheus.Histogram({
    name: 'nexus_workflow_execution_duration_seconds',
    help: 'Workflow execution duration in seconds',
    labelNames: ['workflow_id', 'status'],
    buckets: [1, 5, 10, 30, 60, 300, 600, 1800],
  });

  const executionsTotal = new prometheus.Counter({
    name: 'nexus_workflow_executions_total',
    help: 'Total number of workflow executions',
    labelNames: ['workflow_id', 'status'],
  });

  const active = new prometheus.Gauge({
    name: 'nexus_workflows_active',
    help: 'Number of currently active workflows',
    labelNames: ['workflow_id'],
  });

  return { executionDuration, executionsTotal, active };
}
