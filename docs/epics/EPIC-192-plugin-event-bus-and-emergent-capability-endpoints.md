# EPIC-192: Plugin Event Bus and Emergent Capability Endpoints

**Status:** Implemented
**Priority:** P1
**Created:** 2026-05-17
**Updated:** 2026-05-18
**Owner:** Platform Extensibility / Workflow Platform
**Parent:** EPIC-188
**Depends on:** EPIC-189, EPIC-190
**Related:** EPIC-124, EPIC-146, EPIC-153, EPIC-170, EPIC-172

## Summary

Add a plugin event bus and generic capability endpoint model so plugins can build useful behavior even before Nexus has a dedicated first-class extension point for that behavior.

## Problem Statement

Typed contribution contracts are essential for governance and stable API boundaries, but they cannot anticipate every useful extension. The platform should allow plugins to observe approved domain events, publish approved events, maintain their own state, and expose narrow operations callable by workflows, tools, internal services, or other plugins through policy.

## Goals

- Provide typed domain event subscriptions for plugin runtimes.
- Support generic custom extension events with namespacing and policy checks.
- Add `capability.endpoint` contributions as policy-mediated RPC-like operations.
- Add delivery retries, dead-letter handling, and observability for plugin event delivery.
- Keep event delivery and endpoint invocation decoupled from controllers.

## Non-Goals

- Replace the event ledger or workflow event model wholesale.
- Guarantee exactly-once delivery for all plugin events.
- Let plugins subscribe to all internal events by default.
- Let plugin endpoint calls bypass permission checks.

## Event Model

Plugins can subscribe to two event families:

- Typed Nexus domain events, such as workflow run started, workflow step completed, workflow run failed, memory recorded, tool invoked, approval requested, schedule fired, and model invocation completed.
- Namespaced extension events, such as `plugin.<pluginId>.<eventName>` or `extension.<domain>.<eventName>`.

Event subscriptions include:

- Event topic or pattern.
- Optional filters.
- Delivery mode: blocking or non-blocking where supported.
- Retry policy.
- Dead-letter policy.
- Required permissions.

## Capability Endpoint Model

`capability.endpoint` contributions expose small plugin operations that other runtime components can call through the kernel.

Endpoint declarations include:

- Endpoint id and display name.
- Input schema and output schema.
- Required permissions.
- Timeout and retryability metadata.
- Visibility to workflows, tools, internal services, or other plugins.

## Workstreams

### 1. Event Topic Catalog

- Define the first supported domain event topics and payload schemas.
- Map existing workflow, tool, memory, and runtime events into publishable plugin events.

### 2. Subscription Registry

- Store plugin subscriptions as active contributions.
- Enforce permission checks before delivery.

### 3. Delivery Engine

- Deliver events to worker-process and container runtimes through the runtime protocol.
- Add retry and dead-letter behavior.
- Ensure non-blocking subscriber failures do not fail the originating operation.

### 4. Capability Endpoint Invocation

- Add endpoint contribution schema.
- Add kernel-mediated endpoint invocation.
- Add endpoint discovery for workflows, tools, and internal services where appropriate.

## Backlog

- [x] E192-001 Define plugin event envelope and topic schemas.
- [x] E192-002 Add event subscription contribution support.
- [x] E192-003 Publish initial workflow/tool/memory lifecycle events.
- [x] E192-004 Add policy-filtered event delivery to plugin runtimes.
- [x] E192-005 Add retry and dead-letter behavior.
- [x] E192-006 Define `capability.endpoint` contribution schema.
- [x] E192-007 Add kernel-mediated endpoint invocation service.
- [x] E192-008 Add tests for denied subscriptions, retries, and endpoint permission checks.

## Acceptance Criteria

- Plugins can subscribe to approved domain events without direct access to internal services.
- Event delivery is permission-checked, observable, retried where configured, and dead-lettered on repeated failure.
- Plugins can expose generic capability endpoints with schema validation and policy checks.
- A plugin can implement behavior that does not yet have a first-class Nexus feature module by combining event subscriptions, plugin storage, and capability endpoints.

## Implementation Notes

- Event delivery remains at-least-once where retry is configured and best-effort otherwise. Exactly-once delivery is intentionally out of scope.
- Runtime delivery and endpoint invocation are both policy-mediated and return safe normalized errors.
- Delivery observability is available through plugin-kernel services and repository query paths. Payloads are redacted by default.
- A dedicated HTTP controller surface for capability endpoint discovery/invocation was intentionally skipped for this epic because current callers are internal kernel/workflow/tool/memory paths.
