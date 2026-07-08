# EPIC-033: Observability — Correlation IDs, Request Context & Workflow Event Sourcing

## Summary

Add end-to-end request correlation, contextual logging, and an immutable workflow event log to the Nexus platform. Currently, logs and telemetry events cannot be traced back to a single user request, and workflow state transitions are not persisted as an auditable history.

## Motivation

### Current State

The platform has a solid observability foundation:
- **Audit logs** in Postgres (`audit_logs` table)
- **Real-time telemetry** via Redis Pub/Sub + Streams + WebSocket gateway
- **Structured logging** via Winston (console + JSON files)
- **OpenTelemetry SDK** configured with HTTP + NestJS auto-instrumentation
- **Prometheus metrics** for workflows, containers, and HTTP requests

However, there are critical gaps:

1. **No correlation IDs** — HTTP requests receive no unique identifier. There is no `X-Request-ID` header, no `AsyncLocalStorage`-based context, and no way to correlate a log line to the request that produced it.
2. **No request context in logs** — Winston logs contain only the message and NestJS context name. They lack `requestId`, `workflowRunId`, `userId`, or `stepId` unless manually added per call site.
3. **No workflow event sourcing** — Only the *current* status of a workflow run is stored (`workflow_runs.status`). There is no immutable log of state transitions. Questions like "when did step X start?" or "why did the run fail?" require digging through scattered log files and Redis streams.
4. **Exception filter lacks context** — The global `AllExceptionsFilter` logs only the error message and stack trace. No request ID, route, or user information is captured.

### Why Now

As the platform scales to handle more concurrent workflow runs and multiple users, the inability to correlate logs, trace requests, and audit workflow history becomes a significant operational and debugging liability.

## Goals

1. Every HTTP request receives a unique `requestId` (UUID), propagated through all logs and responses.
2. All Winston log lines automatically include `requestId`, `workflowRunId`, `userId` when available.
3. Error responses include `requestId` for client-side correlation.
4. An immutable `workflow_events` table records every workflow state transition and step lifecycle event.
5. A REST endpoint exposes paginated workflow event history.

## Non-Goals

1. Distributed trace propagation to pi-runner containers (Tier 3 — future work).
2. Adding TypeORM/Redis/BullMQ OTEL instrumentations (future work).
3. Centralized log aggregation (ELK/Loki — infrastructure concern).
4. Changing existing audit log or telemetry gateway behaviour.

## Technical Approach

### Phase 1: Request Context & Correlation IDs

1. **`RequestContextService`** — Wraps `AsyncLocalStorage` to store per-request context (`requestId`, `userId`, `workflowRunId`). Globally provided.
2. **`CorrelationIdMiddleware`** — HTTP middleware that generates a UUID `requestId` (or honours incoming `X-Request-ID`), stores it in `RequestContextService`, and adds it to the response header.
3. **Winston logger enhancement** — Add a custom Winston format that reads from `RequestContextService` and injects `requestId`, `userId`, `workflowRunId` into every log entry.
4. **`AllExceptionsFilter` enhancement** — Include `requestId` in error response bodies and in error log output.
5. **CORS `allowedHeaders`** — Expose `X-Request-ID` in response headers.

### Phase 2: Workflow Event Sourcing

6. **`WorkflowEvent` entity** — Immutable append-only table: `id`, `workflow_run_id`, `event_type`, `step_id`, `job_id`, `actor_id`, `correlation_id`, `payload` (JSONB), `timestamp`. Indexed on `(workflow_run_id, timestamp)`.
7. **`WorkflowEventRepository`** — Repository with `append()` and `findByRunId()` (paginated, ordered by timestamp).
8. **`WorkflowEventLogService`** — Service that appends events and reads history. Integrates `RequestContextService` for automatic `correlation_id` tagging.
9. **Integration into `WorkflowEngineService`** — Emit `workflow.started`, `workflow.completed`, `workflow.failed`, `workflow.hibernated`, `job.queued`, `job.completed` events on every status change.
10. **REST endpoint** — `GET /api/workflow-runs/:id/events?limit=&offset=` returns paginated event history.

## Affected Files

### New Files
- `apps/api/src/common/request-context.service.ts`
- `apps/api/src/common/correlation-id.middleware.ts`
- `apps/api/src/database/entities/workflow-event.entity.ts`
- `apps/api/src/database/repositories/workflow-event.repository.ts`
- `apps/api/src/workflow/workflow-event-log.service.ts`
- `apps/api/src/workflow/workflow-event-log.controller.ts`

### Modified Files
- `apps/api/src/common/logger.config.ts` — Add request context format
- `apps/api/src/common/all-exceptions.filter.ts` — Add requestId to error logs/responses
- `apps/api/src/main.ts` — Expose `X-Request-ID` in CORS allowedHeaders
- `apps/api/src/app.module.ts` — Register middleware, import new providers
- `apps/api/src/database/database.module.ts` — Register `WorkflowEvent` entity + repository
- `apps/api/src/workflow/workflow.module.ts` — Register event log service + controller
- `apps/api/src/workflow/workflow-engine.service.ts` — Emit workflow events on transitions
- `apps/api/src/observability/observability.module.ts` — Export `RequestContextService`

### Test Files
- `apps/api/src/common/request-context.service.spec.ts`
- `apps/api/src/common/correlation-id.middleware.spec.ts`
- `apps/api/src/workflow/workflow-event-log.service.spec.ts`

## Acceptance Criteria

- [ ] Every HTTP response includes an `X-Request-ID` header.
- [ ] All Winston JSON log entries include a `requestId` field when within a request scope.
- [ ] Error responses (4xx/5xx) include `requestId` in the response body.
- [ ] Starting a workflow run creates a `workflow.started` event in the `workflow_events` table.
- [ ] Completing a workflow run creates a `workflow.completed` event.
- [ ] Failing a workflow run creates a `workflow.failed` event.
- [ ] Queuing and completing a job creates `job.queued` and `job.completed` events.
- [ ] `GET /api/workflow-runs/:id/events` returns paginated events ordered by timestamp.
- [ ] All new code has unit test coverage.
- [ ] TypeScript compilation passes with no errors.
