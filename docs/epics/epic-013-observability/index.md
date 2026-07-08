# Epic 013: Observability, Monitoring & Alerting

## Overview

**Epic ID**: 013
**Layer**: Advanced Features
**Status**: Not Started
**Priority**: High for Production (P1)
**Estimated Timeline**: 1 week

## Context

Build production monitoring and observability infrastructure including metrics collection, distributed tracing, log aggregation, dashboards, and alerting. This epic provides visibility into system health, performance, and usage patterns, enabling proactive issue detection and resolution before they impact users.

Observability is essential for operating Nexus in production - without it, you're flying blind.

## Dependencies

**Upstream Dependencies**:
- Epic 007 (WebSocket Telemetry) - for event data
- Epic 005 (Workflow Engine) - for workflow metrics
- Epic 002 (Core Infrastructure) - for infrastructure metrics

**Downstream Dependencies**: None (this observes existing infrastructure)

## Scope

### Included in This Epic

- **Metrics Collection (Prometheus)**
  - Workflow execution metrics (duration, success rate, failure rate)
  - Container metrics (CPU, RAM, active count, provisioning time)
  - BullMQ queue metrics (queue depth, processing time, job failures)
  - API metrics (request rate, latency, error rate)
  - Database metrics (connection pool, query duration)
  - Redis metrics (connection count, command latency)

- **Distributed Tracing (OpenTelemetry)**
  - Trace workflow execution across all services
  - Trace subagent spawning (parent → child relationships)
  - Trace database and Redis calls
  - Trace API requests end-to-end
  - Span annotations with business context

- **Log Aggregation**
  - Centralized logging (ELK stack, Loki, or CloudWatch)
  - Structured JSON logs
  - Log correlation with trace IDs
  - Log level filtering (DEBUG, INFO, WARN, ERROR)
  - Log retention policy (30 days)

- **Dashboards (Grafana)**
  - Workflow execution dashboard (success rate, duration, active workflows)
  - System health dashboard (CPU, RAM, Redis, PostgreSQL, BullMQ)
  - Agent activity dashboard (active agents, tool usage, subagent spawning)
  - API performance dashboard (request rate, latency percentiles, error rate)
  - Cost tracking dashboard (LLM API usage, container runtime)

- **Alerting (Prometheus Alertmanager or PagerDuty)**
  - Alert on workflow failures (> 5 failures in 10 minutes)
  - Alert on high queue depth (> 100 jobs waiting)
  - Alert on container failures (container OOM, crashes)
  - Alert on database connection pool exhaustion
  - Alert on API error rate spike (> 10% error rate)
  - Alert on disk space low (< 10% free)

- **Health Checks**
  - Liveness probes (is the service running?)
  - Readiness probes (is the service ready to accept traffic?)
  - Dependency health checks (PostgreSQL, Redis, Docker)

### Out of Scope

- Business intelligence dashboards (separate analytics project)
- Cost optimization automation (separate FinOps epic)
- Capacity planning automation (manual for now)
- APM (Application Performance Monitoring) - use OpenTelemetry instead
- Custom alerting integrations (Slack is enough for MVP)

## Tasks

### Prometheus Metrics Setup
- [ ] Install Prometheus client library (prom-client)
- [ ] Create MetricsService
- [ ] Initialize Prometheus registry
- [ ] Expose /metrics endpoint (for Prometheus scraping)
- [ ] Set up Prometheus server (Docker Compose or K8s)
- [ ] Configure Prometheus to scrape NestJS app
- [ ] Test metrics endpoint (curl /metrics)

### Workflow Metrics
- [ ] Create workflow execution duration histogram
  - Metric: workflow_execution_duration_seconds
  - Labels: workflow_id, status (completed, failed)
  - Buckets: [1, 5, 10, 30, 60, 300, 600, 1800] seconds
- [ ] Create workflow execution counter
  - Metric: workflow_executions_total
  - Labels: workflow_id, status
- [ ] Create active workflows gauge
  - Metric: workflows_active
  - Labels: workflow_id
- [ ] Integrate with WorkflowEngineService
  - Increment counter on workflow start
  - Observe duration on workflow complete
  - Update active gauge
- [ ] Test workflow metrics (trigger workflows, check /metrics)

### Container Metrics
- [ ] Create container provisioning duration histogram
  - Metric: container_provisioning_duration_seconds
  - Labels: tier (light, heavy)
  - Buckets: [1, 2, 5, 10, 20, 30, 60] seconds
- [ ] Create active containers gauge
  - Metric: containers_active
  - Labels: tier
- [ ] Create container failure counter
  - Metric: container_failures_total
  - Labels: tier, reason (oom, crash, timeout)
- [ ] Integrate with ContainerOrchestratorService
  - Observe provisioning duration
  - Update active gauge on start/stop
  - Increment failure counter on errors
- [ ] Test container metrics

### BullMQ Metrics
- [ ] Install BullMQ Prometheus exporter or create custom metrics
- [ ] Create queue depth gauge
  - Metric: bullmq_queue_depth
  - Labels: queue_name
- [ ] Create job processing duration histogram
  - Metric: bullmq_job_duration_seconds
  - Labels: queue_name, status (completed, failed)
- [ ] Create job failure counter
  - Metric: bullmq_job_failures_total
  - Labels: queue_name, reason
- [ ] Integrate with BullMQ consumers
  - Export queue metrics
  - Observe job duration
- [ ] Test BullMQ metrics

### API Metrics
- [ ] Create API request duration histogram
  - Metric: http_request_duration_seconds
  - Labels: method (GET, POST), path, status_code
  - Buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5] seconds
- [ ] Create API request counter
  - Metric: http_requests_total
  - Labels: method, path, status_code
- [ ] Create API error rate counter
  - Metric: http_errors_total
  - Labels: method, path, error_type
- [ ] Add middleware to track all API requests
  - Measure duration
  - Increment counters
  - Handle errors
- [ ] Test API metrics (send requests, check /metrics)

### Database Metrics
- [ ] Create database connection pool gauge
  - Metric: db_connection_pool_size
  - Labels: state (active, idle)
- [ ] Create database query duration histogram
  - Metric: db_query_duration_seconds
  - Labels: operation (SELECT, INSERT, UPDATE, DELETE)
  - Buckets: [0.001, 0.01, 0.05, 0.1, 0.5, 1, 5] seconds
- [ ] Integrate with TypeORM/Prisma
  - Hook into query logging
  - Export connection pool metrics
- [ ] Test database metrics

### Redis Metrics
- [ ] Create Redis connection gauge
  - Metric: redis_connections_active
- [ ] Create Redis command duration histogram
  - Metric: redis_command_duration_seconds
  - Labels: command (GET, SET, XADD, etc.)
- [ ] Integrate with ioredis
  - Hook into command monitoring
  - Export metrics
- [ ] Test Redis metrics

### OpenTelemetry Tracing Setup
- [ ] Install OpenTelemetry SDK (@opentelemetry/sdk-node)
- [ ] Configure OpenTelemetry
  - Service name: "nexus-core-engine"
  - Exporter: Jaeger or OTLP (OpenTelemetry Protocol)
  - Trace sampling: 100% for MVP (sample in production)
- [ ] Set up Jaeger backend (Docker Compose or K8s)
- [ ] Test basic tracing (create span, export to Jaeger)

### Distributed Tracing Integration
- [ ] Add auto-instrumentation for HTTP requests
  - Use @opentelemetry/instrumentation-http
  - Trace all incoming API requests
- [ ] Add auto-instrumentation for database queries
  - Use @opentelemetry/instrumentation-pg or prisma plugin
- [ ] Add auto-instrumentation for Redis commands
  - Use @opentelemetry/instrumentation-ioredis
- [ ] Add custom spans for key operations
  - Workflow execution (start → complete)
  - Container provisioning
  - Session dehydration/rehydration
  - Subagent spawning
- [ ] Add span attributes
  - workflow_id, workflow_run_id
  - container_id, tier
  - agent_profile, task_prompt
- [ ] Propagate trace context across services
  - WebSocket gateway → agents
  - Parent agent → child agent (subagents)
- [ ] Test distributed tracing (view traces in Jaeger UI)

### Log Aggregation Setup
- [ ] Choose logging backend (ELK, Loki, or CloudWatch)
- [ ] Configure structured JSON logging (Winston or Pino)
  - Format: {"level":"info","message":"...","timestamp":"...","context":{}}
  - Include trace_id in all logs (for correlation)
  - Include service_name, environment
- [ ] Set up log shipper (Fluentd, Promtail, or CloudWatch agent)
- [ ] Configure log retention (30 days)
- [ ] Test log aggregation (send logs, view in UI)

### Grafana Dashboards
- [ ] Set up Grafana (Docker Compose or K8s)
- [ ] Configure Prometheus as data source
- [ ] Create Workflow Execution Dashboard
  - Panel: Workflow success rate (%) over time
  - Panel: Workflow duration (p50, p95, p99) over time
  - Panel: Active workflows (gauge)
  - Panel: Top 10 workflows by execution count
  - Panel: Workflow failures (table with workflow_id, timestamp, error)
- [ ] Create System Health Dashboard
  - Panel: CPU usage (%)
  - Panel: RAM usage (%)
  - Panel: PostgreSQL connection pool (active, idle)
  - Panel: Redis connection count
  - Panel: BullMQ queue depth
  - Panel: Disk space (%)
- [ ] Create Agent Activity Dashboard
  - Panel: Active containers (gauge)
  - Panel: Container provisioning duration (p50, p95)
  - Panel: Tool usage (top 10 tools by execution count)
  - Panel: Subagent spawning rate
- [ ] Create API Performance Dashboard
  - Panel: Request rate (requests/second)
  - Panel: Request latency (p50, p95, p99)
  - Panel: Error rate (%)
  - Panel: Top 10 slowest endpoints
- [ ] Create Cost Tracking Dashboard
  - Panel: LLM API usage (total tokens, cost estimate)
  - Panel: Container runtime (total hours, cost estimate)
  - Panel: Database storage (GB, cost estimate)
- [ ] Export dashboards as JSON (version control)
- [ ] Test dashboards (verify all panels load data)

### Alerting Setup
- [ ] Set up Prometheus Alertmanager (Docker Compose or K8s)
- [ ] Configure alert rules (alerting.yml)
  - High workflow failure rate (> 5 failures in 10 min)
  - High queue depth (> 100 jobs)
  - Container OOM (out of memory)
  - Database connection pool exhausted (< 2 connections available)
  - High API error rate (> 10% in 5 min)
  - Disk space low (< 10% free)
  - Redis connection failure
- [ ] Configure alerting channels
  - Slack webhook integration
  - Email (SMTP)
  - PagerDuty (optional)
- [ ] Test alerts (trigger conditions, verify notifications)

### Health Checks
- [ ] Enhance /health endpoint (from Epic 002)
  - Check PostgreSQL connectivity (run SELECT 1)
  - Check Redis connectivity (run PING)
  - Check Docker daemon connectivity
  - Return detailed health status:
    - status: "healthy" | "degraded" | "unhealthy"
    - checks: { postgres: "ok", redis: "ok", docker: "ok" }
    - uptime: seconds
- [ ] Add liveness probe endpoint (/health/live)
  - Returns 200 if service is running
  - Lightweight check (no dependency checks)
- [ ] Add readiness probe endpoint (/health/ready)
  - Returns 200 if service is ready to accept traffic
  - Check all dependencies (DB, Redis, Docker)
- [ ] Test health check endpoints

### Cost Tracking
- [ ] Create LLM usage tracking
  - Track total tokens (prompt + completion)
  - Estimate cost based on model pricing
  - Store in CostTracking table (date, model, tokens, cost_usd)
- [ ] Create container runtime tracking
  - Track total container hours (by tier)
  - Estimate cost based on compute pricing
  - Store in CostTracking table
- [ ] Create storage tracking
  - Track total storage used (DB, Redis)
  - Estimate cost
- [ ] Create cost summary endpoint (GET /api/costs)
  - Return total cost by category (LLM, compute, storage)
  - Support date range filtering
- [ ] Test cost tracking

### Testing & Documentation
- [ ] Write unit tests for MetricsService
- [ ] Write integration tests for metrics export
- [ ] Write integration tests for tracing
- [ ] Write runbook for common alerts
  - High workflow failure rate → check logs, recent deploys
  - High queue depth → scale workers, check for stuck jobs
  - Container OOM → increase resource limits, check for memory leaks
  - Database connection exhaustion → increase pool size, check for leaks
- [ ] Document dashboard usage
- [ ] Document alert response procedures
- [ ] Create observability architecture diagram

## Key Deliverables

1. **Prometheus Metrics**
   - Workflow, container, BullMQ, API, database, Redis metrics
   - /metrics endpoint for scraping

2. **OpenTelemetry Tracing**
   - Distributed traces across all services
   - Trace context propagation
   - Jaeger backend for visualization

3. **Log Aggregation**
   - Structured JSON logs
   - Centralized logging backend
   - Log correlation with traces

4. **Grafana Dashboards**
   - 5 comprehensive dashboards
   - Workflow, system health, agent activity, API, cost tracking

5. **Alerting**
   - Prometheus Alertmanager
   - 6 critical alert rules
   - Slack/email notifications

6. **Health Checks**
   - Enhanced /health endpoint
   - Liveness and readiness probes

7. **Documentation**
   - Alert runbook
   - Dashboard usage guide
   - Observability architecture

## Acceptance Criteria

- [ ] Prometheus scrapes /metrics endpoint successfully
- [ ] Workflow execution duration is tracked (histogram)
- [ ] Workflow success rate is tracked (counter)
- [ ] Container provisioning duration is tracked
- [ ] BullMQ queue depth is tracked (gauge)
- [ ] API request duration is tracked (histogram)
- [ ] Database query duration is tracked
- [ ] Redis command latency is tracked
- [ ] OpenTelemetry exports traces to Jaeger
- [ ] Distributed traces span workflow execution end-to-end
- [ ] Trace context propagates to subagents
- [ ] Logs are structured JSON with trace_id
- [ ] Logs are aggregated in centralized backend
- [ ] Grafana Workflow Execution Dashboard shows live data
- [ ] Grafana System Health Dashboard shows all metrics
- [ ] Grafana Agent Activity Dashboard shows container count
- [ ] Grafana API Performance Dashboard shows request latency
- [ ] Grafana Cost Tracking Dashboard shows LLM and compute costs
- [ ] Alert fires on high workflow failure rate (tested with mock failures)
- [ ] Alert fires on high queue depth (tested with 101 jobs)
- [ ] Alert fires on container OOM (tested with memory-intensive container)
- [ ] Alert fires on database connection exhaustion (tested with connection leak)
- [ ] Slack notification received on alert (tested with mock alert)
- [ ] /health endpoint returns PostgreSQL, Redis, Docker status
- [ ] /health/live returns 200 (liveness probe)
- [ ] /health/ready returns 200 when all dependencies healthy
- [ ] /health/ready returns 503 when dependencies unhealthy
- [ ] Cost tracking records LLM token usage
- [ ] Cost tracking records container runtime hours
- [ ] Integration tests verify metrics accuracy

## Technical Notes

### Technology Stack
- **Metrics**: Prometheus + prom-client
- **Tracing**: OpenTelemetry + Jaeger
- **Logging**: Winston/Pino + ELK/Loki/CloudWatch
- **Dashboards**: Grafana
- **Alerting**: Prometheus Alertmanager

### Prometheus Metrics Examples
```typescript
// Histogram
const workflowDuration = new prometheus.Histogram({
  name: 'workflow_execution_duration_seconds',
  help: 'Workflow execution duration in seconds',
  labelNames: ['workflow_id', 'status'],
  buckets: [1, 5, 10, 30, 60, 300, 600, 1800],
});

// Counter
const workflowCounter = new prometheus.Counter({
  name: 'workflow_executions_total',
  help: 'Total number of workflow executions',
  labelNames: ['workflow_id', 'status'],
});

// Gauge
const activeWorkflows = new prometheus.Gauge({
  name: 'workflows_active',
  help: 'Number of currently active workflows',
  labelNames: ['workflow_id'],
});
```

### OpenTelemetry Tracing Example
```typescript
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('nexus-core-engine');

async function executeWorkflow(workflowId: string) {
  const span = tracer.startSpan('execute_workflow');
  span.setAttribute('workflow_id', workflowId);

  try {
    // Execute workflow
    await workflowEngine.execute(workflowId);
    span.setStatus({ code: SpanStatusCode.OK });
  } catch (error) {
    span.recordException(error);
    span.setStatus({ code: SpanStatusCode.ERROR });
  } finally {
    span.end();
  }
}
```

### Structured Logging Example
```json
{
  "level": "info",
  "message": "Workflow execution completed",
  "timestamp": "2026-03-22T10:30:00Z",
  "trace_id": "abc123",
  "context": {
    "workflow_id": "wf_123",
    "workflow_run_id": "wfrun_456",
    "duration_ms": 5432,
    "status": "completed"
  }
}
```

### Alert Rule Example (alerting.yml)
```yaml
groups:
  - name: nexus_alerts
    rules:
      - alert: HighWorkflowFailureRate
        expr: rate(workflow_executions_total{status="failed"}[10m]) > 5
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "High workflow failure rate detected"
          description: "More than 5 workflow failures per 10 minutes"

      - alert: HighQueueDepth
        expr: bullmq_queue_depth > 100
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High BullMQ queue depth"
          description: "Queue depth exceeds 100 jobs"
```

### Cost Estimation
- **LLM API**: $0.002/1K tokens (GPT-4o-mini)
- **Container Compute**: $0.10/hour (Heavy tier)
- **Database Storage**: $0.10/GB/month
- **Total Monthly Estimate**: Track and display in dashboard

### Testing Strategy
- **Unit Tests**: MetricsService methods
- **Integration Tests**: Metrics export, tracing, logging
- **Load Tests**: Generate metrics under load (1000 workflows)
- **Alert Tests**: Trigger alerts, verify notifications

## Risks & Mitigation

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Metrics overhead impacts performance | Medium | Low | Use lightweight metrics, sampling |
| Tracing overhead slows requests | Medium | Medium | Sample traces in production (10%) |
| Alert fatigue (too many alerts) | Medium | High | Tune alert thresholds, use severity levels |
| Log volume exceeds retention budget | Medium | Medium | Log level filtering, retention policy |
| Dashboard query performance | Low | Low | Optimize Prometheus queries, caching |

## Parallel Development

**Can Run in Parallel**: YES (observes existing infrastructure)
**Can Run Alongside**: All other epics

## Related ADRs

- Create ADR-036: Observability stack choice (Prometheus + Grafana vs. Datadog)
- Create ADR-037: Tracing sampling strategy (100% vs. 10%)
- Create ADR-038: Log retention policy (30 days)

## Notes

- Observability is critical for production - don't skip this epic
- Start with simple metrics, add more over time
- Tune alert thresholds based on actual production traffic
- Dashboards should be actionable (not just pretty graphs)
- Cost tracking helps with FinOps and budget planning
- Document alert runbooks thoroughly (future on-call engineers will thank you)
- Consider adding user-facing status page (future enhancement)
- Observability data is valuable for capacity planning
