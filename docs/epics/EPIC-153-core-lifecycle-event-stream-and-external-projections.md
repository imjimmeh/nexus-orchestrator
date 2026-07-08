# EPIC-153: Core Lifecycle Event Stream and External Projections

Status: Proposed
Priority: P0
Depends On: EPIC-150, EPIC-151
Related: EPIC-124, EPIC-146, docs/analysis/2026-04-25-kanban-api-decoupling-plan.md
Last Updated: 2026-04-29

---

## 1. Summary

Replace the partial hard-coded service fanout path with a durable, replayable, domain-agnostic core lifecycle event stream that any external domain service can consume. Core should publish workflow run and step lifecycle events as agent OS facts. It must not know about kanban, call kanban, name kanban in configuration, or shape events around kanban projections.

Kanban may choose to consume this stream, but that is kanban-owned behavior outside core.

---

## 2. Current State Review

1. `apps/api/src/workflow/workflow-core-lifecycle-fanout.service.ts` currently POSTs core workflow events to kanban when `KANBAN_SERVICE_BASE_URL` is configured. This violates the target boundary.
2. `apps/kanban/src/core/core-events.controller.ts` ingests `POST /internal/core/events` and stores a local run projection. This should become a kanban-owned stream consumer, not a core-owned push target.
3. `apps/kanban/src/core/core-run-projection.service.ts` projects by `runId`, `projectId`, and `workItemId`.
4. `packages/core/src/schemas/events/event-envelope.schema.ts` uses core workflow event payload fields that still include kanban identity.
5. `apps/api/src/workflow/listeners/workflow-redis-publisher.listener.ts` publishes workflow events, but the current integration path is not a durable generic stream contract.

---

## 3. Goals

1. Define a durable core lifecycle stream contract using the generic opaque context object from EPIC-150.
2. Make Redis Stream the primary transport for replayable lifecycle consumption unless implementation chooses and records a better durable transport.
3. Remove hard-coded core-to-kanban fanout and `KANBAN_SERVICE_BASE_URL` style configuration.
4. Ensure external projection consumers are discovered/configured generically, or subscribe to the stream without core knowing they exist.
5. Support replay, cursoring, idempotency, and dead-letter handling.
6. Make core stream publishing observable without including domain-specific consumer details.

---

## 4. Non-Goals

1. Do not use the event stream for immediate domain commands.
2. Do not make core mutate external domain state.
3. Do not encode kanban-specific lifecycle events as core events.
4. Do not keep hard-coded HTTP fanout from core to kanban.

---

## 5. High-Level Work

1. Define core lifecycle event payloads using `runId`, `workflowId`, status, step identity, timestamps, correlation metadata, and the opaque context object from EPIC-150.
2. Add a Redis Stream publisher in core or formalize the existing publisher if it already satisfies durability and replay requirements.
3. Remove `WorkflowCoreLifecycleFanoutService` or replace it with a generic event publisher that has no external domain names.
4. Remove `KANBAN_SERVICE_BASE_URL` and any core configuration that names kanban as a lifecycle event target.
5. Move kanban projection consumption into `apps/kanban` as a subscriber to the generic stream.
6. Replace `projectId` and `workItemId` projection fields with kanban-owned context resolution from EPIC-150 contracts.
7. Add dead-letter or retry handling for malformed events and projection failures in consumers.
8. Add replay tooling for rebuilding external projections from a stream range.
9. Add operational metrics for core publishing, stream lag, retry count, projection failures, and last processed event ID without coupling metrics to kanban.

---

## 6. Deliverables

1. Durable core lifecycle event stream publisher.
2. Generic stream contract with no hard-coded external domain target.
3. Kanban-owned lifecycle stream consumer and projection service.
4. Replay and cursor management tooling.
5. Projection schema updated to generic context metadata.
6. Tests covering idempotent replay, out-of-order events, malformed events, and consumer restart.

---

## 7. Acceptance Criteria

1. External projections can be rebuilt from durable core lifecycle events.
2. Core lifecycle payloads do not contain first-class kanban `projectId` or `workItemId` fields.
3. Core code and configuration do not name kanban as a lifecycle event target.
4. Kanban can tolerate duplicate lifecycle events without corrupting projections.
5. Kanban exposes projection health metrics or diagnostics from kanban-owned code.
6. The hard-coded HTTP fanout path is removed.

---

## 8. Suggested Quality Gates

1. `npm run test:api`
2. `npm run test:kanban`
3. Stream replay integration test with disposable Redis.
4. Projection idempotency tests.
5. Contract tests for core lifecycle event schemas.
6. Static check proving `apps/api/src/workflow` has no `KANBAN_SERVICE_BASE_URL` or hard-coded kanban lifecycle fanout.

---

## 9. Risks

1. Risk: event projection creates UI consistency lag.
2. Mitigation: commands still go through the owning domain service; lifecycle stream only projects core run state.
3. Risk: Redis Stream semantics are implemented inconsistently across environments.
4. Mitigation: provide local docker setup, explicit consumer group naming, and restart tests.
