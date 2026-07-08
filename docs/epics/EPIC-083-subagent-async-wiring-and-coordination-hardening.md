# EPIC-083: Subagent Async Wiring and Coordination Hardening

Status: Proposed
Priority: P0
Depends On: EPIC-048, EPIC-054, EPIC-068
Last Updated: 2026-04-12

---

## 1. Summary

Finish and harden the async multi-subagent execution path so concurrent delegation is reliably usable in production.

This epic closes known runtime gaps documented in subagent architecture notes.

---

## 2. Problem

Backend async support exists but remains partially wired and inconsistent across runner, gateway, and orchestration service layers.

Known gaps include:

1. Action exposure mismatch.
2. wait_for_subagents payload inconsistency.
3. incomplete status and authorization handling.
4. limited coordination safety controls.

---

## 3. Goals

1. Complete end-to-end async action wiring.
2. Enforce payload and schema consistency.
3. Add stronger safety and cancellation behavior.
4. Improve visibility of subagent progress and outcomes.

## 4. Non-Goals

1. Full distributed swarm planner.
2. Cross-service message bus redesign.

---

## 5. Architecture

### 5.1 Action and Payload Contract

Standardize actions:

1. spawn_subagent
2. spawn_subagent_async
3. wait_for_subagents
4. check_subagent_status

Standardize wait payload:

1. execution_ids optional list
2. timeout_seconds optional

### 5.2 Coordination Safety

1. Require assigned_files for async multi-subagent mode.
2. Add central overlap and lock checks.
3. Add cancellation propagation from parent abort.

### 5.3 Observability

1. Add lifecycle telemetry for spawn, wait, status, completion, timeout, cancellation.
2. Add per-execution progress and failure reason normalization.

---

## 6. Workstreams

1. Runner action exposure completion.
2. Gateway schema and handler alignment.
3. Service-level wait and status semantics hardening.
4. Coordination safety and cancellation controls.
5. Diagnostics and frontend timeline improvements.

---

## 7. Backlog

- [ ] E083-001 Align runner action schemas for async spawn, wait, and status.
- [ ] E083-002 Align gateway handlers with payload contracts.
- [ ] E083-003 Implement execution_ids-aware wait semantics.
- [ ] E083-004 Implement timeout-aware wait semantics.
- [ ] E083-005 Implement robust check_subagent_status path.
- [ ] E083-006 Enforce required assigned_files policy for concurrent runs.
- [ ] E083-007 Add cancellation propagation on parent abort.
- [ ] E083-008 Add structured lifecycle telemetry for async execution states.
- [ ] E083-009 Add tests for race conditions and status correctness.

---

## 8. Acceptance Criteria

1. Async spawn, wait, and status are usable end-to-end from model action to service response.
2. wait_for_subagents respects execution_ids and timeout_seconds.
3. Parent abort cancels all active child executions deterministically.
4. Async subagent runs are observable with actionable failure diagnostics.

---

## 9. Risks and Mitigation

1. Race conditions in concurrent state transitions.
   - Mitigate with idempotent state writes and optimistic checks.
2. Resource exhaustion with high fan-out.
   - Mitigate with stricter caps and per-run quotas.
