# EPIC-048: Subagent Runtime Wiring and Coordination Baseline

> **Status:** In Progress
> **Priority:** High
> **Estimate:** 1-2 weeks
> **Created:** 2026-04-05
> **Owner:** TBD

---

## 1. Epic Summary

Close critical runtime gaps in subagent orchestration so the documented capabilities are actually reachable from agent tool calls.

This epic focuses on wiring completeness, payload correctness, and baseline observability for:

1. Asynchronous subagent spawning.
2. Explicit wait-by-execution-id semantics.
3. Subagent status checks.
4. Gateway/runner parity for orchestration actions.

---

## 2. Problem Statement

The backend service supports concurrent subagents, but key paths are incompletely wired:

1. Runner bridge only exposes `spawn_subagent` through `nexus_orchestrator` actions.
2. `wait_for_subagents` payload (`execution_ids`, `timeout_seconds`) is not honored by gateway/service flow.
3. `check_subagent_status` exists in tool definitions but has no runtime handler path.
4. Tool/action contracts are inconsistent across runner, gateway, and service layers.

This creates a gap between declared platform capability and what agents can reliably execute.

---

## 3. Goals

1. Add runner bridge actions for:
   - `spawn_subagent_async`
   - `wait_for_subagents`
   - `check_subagent_status`
2. Add gateway handlers and event responses for async wait/status flows.
3. Extend orchestrator service with:
   - Wait with optional `execution_ids` filter
   - Wait with configurable timeout
   - Per-execution status lookup scoped to parent container
4. Add/adjust targeted unit tests for runner bridge and gateway behavior.

---

## 4. Non-Goals

1. Full inter-agent messaging bus.
2. Distributed lock manager for file coordination.
3. UI-level orchestration redesign.
4. Changing synchronous `spawn_subagent` dehydration semantics.

---

## 5. Technical Scope

### Files

- `packages/pi-runner/src/nexus-bridge-tools.ts`
- `packages/pi-runner/src/nexus-bridge-tools.spec.ts`
- `apps/api/src/telemetry/telemetry.gateway.ts`
- `apps/api/src/telemetry/telemetry.gateway.spec.ts`
- `apps/api/src/workflow/subagent-orchestrator.service.ts`
- `apps/api/src/workflow/subagent-orchestrator.service.spec.ts`

### Deliverables

1. Runner `nexus_orchestrator` action enum/schema includes async spawn, wait, and status actions.
2. Gateway supports `check_subagent_status` and payload-aware `wait_for_subagents`.
3. Service methods return deterministic scoped status/wait results.
4. Tests verify new action emission and gateway/service invocation contracts.

---

## 6. Acceptance Criteria

- [ ] `nexus_orchestrator(action=spawn_subagent_async)` emits `spawn_subagent_async` with validated payload.
- [ ] `nexus_orchestrator(action=wait_for_subagents)` emits `wait_for_subagents` with `execution_ids` and optional timeout.
- [ ] `nexus_orchestrator(action=check_subagent_status)` emits `check_subagent_status` with execution ID.
- [ ] Gateway `wait_for_subagents` handler forwards payload options to service.
- [ ] Gateway `check_subagent_status` handler returns success/error events.
- [ ] Service wait supports filtering to requested execution IDs.
- [ ] Service wait supports custom timeout seconds.
- [ ] Service status lookup enforces parent-container ownership.
- [ ] Targeted unit tests pass for changed modules.

---

## 7. Risks and Mitigations

1. Contract drift between action schema and backend handler payload.
   - Mitigation: add targeted unit tests at runner and gateway layers.
2. Invalid execution IDs causing ambiguous wait behavior.
   - Mitigation: explicit validation and clear `BadRequestException` messages.
3. Backward compatibility with existing no-payload wait callers.
   - Mitigation: keep default behavior when `execution_ids` is omitted.
