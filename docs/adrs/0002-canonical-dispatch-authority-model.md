# ADR 0002: Canonical Dispatch Authority Model

Status: Accepted
Date: 2026-04-08
Deciders: Platform orchestration maintainers

> Superseded for orchestration authority by [ADR-0026: Agent-Driven Orchestration Authority](0026-agent-driven-orchestration-authority.md). Scheduler-driven dispatch is no longer an authoritative orchestration path; guarded dispatch remains as a runtime safety boundary for CEO-selected launches.

## Context

Dispatch execution authority was split between two paths:

1. CEO orchestration cycle (`project_orchestration_cycle_ceo`)
2. Scheduler-driven dispatch workflow (`work_item_todo_dispatch_default`)

This split made it difficult to determine which path was authoritative for execution, and it increased the risk of conflicting dispatch decisions during overlap windows.

## Decision

Use scheduler authority as the canonical dispatch execution model for this historical phase. This ADR predates the current Kanban-owned dispatch boundary; the removed API `dispatch_start_work_items` name is historical only.

1. Scheduler path was authoritative for dispatch execution through the then-current API dispatch bridge.
2. Current CEO-selected launches use Kanban-owned selected dispatch and lifecycle tooling, specifically `kanban.dispatch_selected_work_items` for selected work-item starts.
3. CEO cycle remains responsible for dispatch intent and rationale logging under the superseding agent-driven authority model.
4. Every dispatch decision must include `authoritySource` so diagnostics and decision logs are unambiguous.

## Historical Configuration and Controls (Pre-ADR-0026)

This section records the controls used during the pre-ADR-0026 scheduler-authority phase. It is not current operating guidance.

Historical primary setting:

- `orchestration_dispatch_authority_mode` (historical/superseded)
  - `scheduler` (default): scheduler authoritative
  - `ceo`: CEO authoritative

Telemetry and diagnostics:

- Decision logs persist `authoritySource`.
- Runtime action responses expose `authority_source`.
- Diagnostics surface latest `dispatch_authority_source`.
- Event ledger emits `orchestration.dispatch.authority_fallback` when fallback sources (`workflow` or `unknown`) are used.

## Consequences

Positive:

1. Deterministic dispatch ownership and easier incident triage.
2. Clear migration toggle between authority models.
3. Improved auditability via source markers across action and telemetry surfaces.

Trade-offs:

1. Non-authoritative path still runs advisory logic and must be monitored for drift.
2. Incorrect authority mode configuration can deny valid dispatch requests until corrected.

## Historical Rollback (Pre-ADR-0026)

The rollback below applied only while scheduler authority mode was active. Current CEO-selected dispatch should remain on the Kanban-owned selected dispatch boundary.

1. Switch `orchestration_dispatch_authority_mode` to the alternate mode.
2. Verify dispatch denial telemetry and diagnostics source values normalize after mode change.
3. Re-run dispatch polling and orchestration cycle smoke tests.
