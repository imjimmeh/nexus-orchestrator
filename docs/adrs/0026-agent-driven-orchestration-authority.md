# ADR-0026: Agent-Driven Orchestration Authority

## Status

Accepted

## Date

2026-05-12

## Context

The scheduler-authority model in ADR-0002 made scheduler-driven dispatch the default owner of work-item launch decisions while the CEO orchestration cycle remained advisory unless a configuration flag changed authority mode. That split conflicts with the event-driven, workflow-driven architecture implemented by EPIC-170.

Kanban now emits facts, stores project/work-item state, publishes lifecycle events, and enforces mutation safety. The API workflow runtime routes events and enforces execution guarantees such as idempotency, concurrency, and active-run guardrails. Durable process automation belongs in workflow YAML. Strategic orchestration choices need one mutating authority so continuation, dispatch, publishing, blocking, and completion decisions remain auditable and can evolve without TypeScript scheduler policy.

## Decision

`project_orchestration_cycle_ceo` is the canonical mutating orchestration authority for project-level decisions.

Services emit facts, persist state, and enforce runtime invariants. Workflow YAML owns durable process automation. Agents choose orchestration actions through authorized tools after reading project state and timeline and recording the cycle decision.

Scheduler-driven dispatch is demoted to guarded launch execution. Dispatch services validate explicit selections, reject unsafe launches, enforce runtime ceilings, and return per-item guardrail outcomes; they do not decide project strategy or rank work as an orchestration authority.

Advisor workflows remain read-only advice. They may inform CEO judgment but must not become a second mutating orchestration authority.

## Consequences

Positive:

1. There is one canonical mutating authority for project orchestration decisions.
2. Dispatch policy can change through agent/workflow behavior without changing Kanban scheduler code.
3. Scheduler-driven dispatch is demoted to guarded launch execution.
4. Runtime services still enforce safety invariants rather than relying on prompt compliance.
5. Event wakeups can be idempotent facts instead of hidden continuation decisions.

Trade-offs:

1. The CEO prompt and workflow contract become part of the critical orchestration surface and require seed validation.
2. Guarded launch endpoints must be explicit about accepted selections and failure reasons.
3. Historical references to scheduler authority must be marked superseded to avoid reintroducing split-brain orchestration.

## Supersedes

This ADR supersedes the scheduler-authority portions of [ADR 0002: Canonical Dispatch Authority Model](0002-canonical-dispatch-authority-model.md). ADR-0002 remains useful historical context for why split dispatch authority needed an explicit decision record.
