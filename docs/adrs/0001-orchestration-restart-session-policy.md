# ADR-0001: Orchestration Restart Session Policy

## Status

Accepted - 2026-04-06

## Context

EPIC-058 introduced restart continuity fields (`isRestart`, `stateSummary`) and restart-aware CEO prompts.
A remaining decision was whether to restore prior CEO session trees automatically on orchestration restart.

Session-tree restoration for orchestration restart has trade-offs:

- It can improve continuity, but may also rehydrate stale/conflicting reasoning from failed runs.
- It introduces cross-entry-point variance unless every restart path applies the same policy.
- It increases operational complexity for token budgets and truncation behavior.

## Decision

Adopt a summary-first restart policy for orchestration-level CEO restarts:

1. On restart, emit and consume `isRestart` plus `stateSummary` as the continuity contract.
2. Keep CEO orchestration restart on a fresh session container by default.
3. Defer automatic session-tree restoration for CEO orchestration restarts.
4. Keep existing work-item execution resume/session-tree behavior unchanged.

## Consequences

Positive:

- Deterministic restart behavior across orchestration entry points.
- Lower risk of replaying stale failed-run context.
- Simpler operational diagnostics and smaller prompt budgets.

Negative:

- CEO does not get full conversation replay automatically.
- Some historical nuance remains tool-driven (`get_orchestration_timeline`, `get_project_state`) instead of session hydration.

## Follow-up Criteria

Revisit this ADR if either condition becomes true:

1. Multiple restart incidents show summary-first continuity is insufficient.
2. A safe, bounded, policy-aware session restoration design is implemented and tested across all orchestration restart paths.

## Related

- docs/epics/EPIC-058-ceo-agent-context-continuity-on-restart.md
- docs/operations/ceo-restart-continuity-runbook.md
- docs/architecture/workflow-engine.md
