import * as prometheus from 'prom-client';

/**
 * HTTP API and ACP instruments.
 *
 * Registers the HTTP request-duration histogram, the HTTP
 * request-total counter, the ACP-server discovered-agents
 * gauge, the ACP-invoke duration histogram, and the ACP-invoke
 * total counter against the global `prom-client` registry.
 * Originally defined in
 * `apps/api/src/observability/metrics.service.ts` as
 * `MetricsService.registerHttpAndAcpInstruments()`; this file
 * is a faithful verbatim extraction of that body so the metric
 * names, label names, and bucket configuration remain
 * byte-identical to the previous in-class definition.
 */
export function registerHttpAndAcpInstruments(): {
  httpRequestDuration: prometheus.Histogram;
  httpRequestsTotal: prometheus.Counter;
  acpServerDiscoveredAgents: prometheus.Gauge;
  acpInvokeDuration: prometheus.Histogram;
  acpInvokeTotal: prometheus.Counter;
} {
  const httpRequestDuration = new prometheus.Histogram({
    name: 'nexus_http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'path', 'status_code'],
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
  });

  const httpRequestsTotal = new prometheus.Counter({
    name: 'nexus_http_requests_total',
    help: 'Total number of HTTP requests',
    labelNames: ['method', 'path', 'status_code'],
  });

  const acpServerDiscoveredAgents = new prometheus.Gauge({
    name: 'nexus_acp_server_discovered_agents',
    help: 'Number of discovered agents per ACP server',
    labelNames: ['server_id'],
  });

  const acpInvokeDuration = new prometheus.Histogram({
    name: 'nexus_acp_invoke_duration_seconds',
    help: 'ACP agent invoke duration in seconds',
    labelNames: ['server_id', 'agent_name', 'status'],
    buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60],
  });

  const acpInvokeTotal = new prometheus.Counter({
    name: 'nexus_acp_invoke_total',
    help: 'Total number of ACP agent invocations',
    labelNames: ['server_id', 'agent_name', 'status'],
  });

  return {
    httpRequestDuration,
    httpRequestsTotal,
    acpServerDiscoveredAgents,
    acpInvokeDuration,
    acpInvokeTotal,
  };
}
