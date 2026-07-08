# EPIC: Dependency-Aware Parallelization with Critical Path Scheduling

**Epic ID:** EPIC-055  
**Status:** Implemented (core shipped)  
**Created:** 2026-04-05  
**Last Updated:** 2026-04-06  
**Priority:** P0 - Critical  
**Theme:** Orchestration Intelligence and Throughput

## 1. Executive Summary

The platform already stores work-item dependency edges and can start multiple work items in a single CEO action. However, CEO decision quality is currently limited by missing graph-level scheduling context. There is no deterministic topological/critical-path view in `get_project_state`, and there is no active in-source coordinator service that consumes `work_item.dispatch.reconcile` to emit candidate selection events.

This epic adds a dependency-graph scheduling layer that computes:

- topological levels,
- critical path ordering,
- ready parallel frontiers,
- and deterministic dispatch recommendations.

The CEO can then automatically dispatch multiple non-dependent tickets in parallel (bounded by capacity), prioritizing critical-path work to reduce total completion time.

### 1.1 Implementation Snapshot (2026-04-06)

Implemented in current codebase:

1. `WorkItemSchedulingService` for deterministic topological ordering, frontier detection, and critical-path scoring.
2. `get_project_state` enrichment with scheduling metadata (`topologicalOrder`, `topologicalLevels`, `criticalPath`, `parallelFrontiers`, `dispatchRecommendation`).
3. In-source `WorkItemDispatchCoordinatorService` wired to reconcile events and selection emission.
4. Dispatch candidate ranking driven by critical-path length first, then priority and deterministic tie-breakers.
5. CEO orchestration prompt/contracts updated to consume scheduling context.
6. Scheduler settings introduced for rollout and weighting control:

- `work_item_scheduler_enabled`
- `work_item_scheduler_scope_weight_large`
- `work_item_scheduler_scope_weight_standard`

7. Supporting tests for scheduling/service integration and dispatch selection behavior.

## 2. Current-State Findings (Codebase Review)

### 2.1 Existing Foundations

- Dependency edges are persisted and indexed via `work_item_dependencies` and repository helpers.
- Cycle prevention exists for dependency updates.
- CEO selected dispatch uses the Kanban-owned mutation boundary that accepts multiple IDs: `kanban.dispatch_selected_work_items`.
- Server-side capacity enforcement is already implemented in dispatch mutation handlers.
- Workflow DAG utilities already implement topological sorting for workflow jobs and can inform implementation approach.

### 2.2 Key Gaps Blocking This Feature

- `get_project_state` currently returns grouped status data but no graph analytics (topological levels, longest path, readiness frontier).
- `work_item.dispatch.reconcile` is emitted from work-item mutations, but there is no active source file for `WorkItemDispatchCoordinatorService` in `apps/api/src/project`, despite tests/docs referencing it.
- `work-item-todo-dispatch-default.workflow.yaml` expects `slots` and `candidates` in trigger payload, but there is no active in-source coordinator emitter currently producing those payloads.
- CEO workflow prompt is strategy-oriented, but does not receive deterministic critical-path metadata to enforce dependency-aware parallelization behavior.

## 3. Goals and Non-Goals

### 3.1 Goals

- Provide deterministic topological ordering of project work items.
- Compute critical-path metadata to prioritize blockers and minimize project makespan.
- Auto-dispatch multiple dependency-ready items in parallel when capacity allows.
- Ensure CEO decisions are grounded in computed scheduling data, not only free-form reasoning.
- Keep event-driven architecture (no polling loop).

### 3.2 Non-Goals

- Full Gantt/chart UI in this epic.
- Cross-project dependency scheduling.
- ML-based duration prediction.
- Replacing mode policy controls (`autonomous`, `supervised`, `notifications_only`).

## 4. Proposed Design

### 4.1 Scheduling Domain Model

Add a scheduling projection layer for each project:

- Nodes: work items (`id`, `status`, `priority`, `scope`, optional effort metadata).
- Edges: `work_item_id -> depends_on_work_item_id` (direct dependencies).
- Derived fields:
  - `topologicalIndex`
  - `topologicalLevel`
  - `criticalPathLength`
  - `criticalPathSuccessorId`
  - `isDependencyReady`
  - `isDispatchEligible`

### 4.2 Topological Sort

Implement Kahn-based topological sorting for the project dependency graph:

- Reuse algorithm patterns from workflow DAG resolver where practical.
- Run over all active/planned items (exclude deleted).
- Return deterministic order by tie-breakers:
  1. priority (`p0` > `p1` > `p2` > `p3`),
  2. created time,
  3. updated time,
  4. id.

### 4.3 Critical Path Computation

Compute longest remaining path over DAG from each node:

- Default duration weight:
  - `large` scope = 2
  - `standard` scope = 1
- Optional override from metadata (future-safe): `metadata.estimatedEffort`.
- For `done` nodes, remaining weight = 0.

Output per node:

- `criticalPathLength`
- `nextCriticalDependency`
- `isOnCurrentCriticalPath`

Project-level output:

- `criticalPath`: ordered list of work-item IDs
- `estimatedRemainingWork`

### 4.4 Parallel Frontier Selection

Define candidate frontier as TODO items where all dependencies are `done`.

Selection policy for dispatch (until slot limit):

1. highest `criticalPathLength` first,
2. then priority,
3. then deterministic timestamp/id tie-breakers.

This policy ensures we parallelize where safe while still preferring critical-path blockers.

### 4.5 CEO-Orchestration Integration

Enhance `get_project_state` payload to include `scheduling` block:

- `topologicalOrder`
- `parallelFrontiers`
- `criticalPath`
- `dispatchRecommendation`

Update CEO cycle workflow prompt to require:

- consuming scheduling metadata,
- dispatching up to available slots from recommended frontier,
- explaining any deviation from recommendation.

### 4.6 Reconcile Coordinator Restoration

Reintroduce or replace `WorkItemDispatchCoordinatorService` as the source of `WorkItemDispatchSelectEvent`:

- Listen for `work_item.dispatch.reconcile`.
- Acquire project-scoped lock/idempotency guard.
- Compute capacity and scheduling frontier.
- Emit selection payload with candidates and slots.
- Emit decision telemetry (`work_item.dispatch.decision`).

Without this layer, auto-dispatch workflow triggers remain under-fed.

## 5. Implementation Plan

### Phase 1: Graph Scheduling Core

- Create `apps/api/src/project/work-item-scheduling.service.ts` (new).
- Add pure graph helpers (topological sort, longest path, frontier detection).
- Add unit tests for DAG cases, tie-break determinism, and done-node pruning.

Acceptance criteria:

- Deterministic topological order for same input.
- Critical path output stable across repeated runs.
- Clear error path for malformed or cyclic graph data (defensive check).

### Phase 2: Project State Enrichment

- Extend `ProjectStateSnapshot` types with `scheduling` payload.
- Update `ProjectOrchestrationService.getProjectState` to include graph analytics.
- Update telemetry orchestration compat tests to assert enriched payload shape.

Acceptance criteria:

- `get_project_state_result` contains status grouping and scheduling data.
- Existing consumers continue to work when new fields are ignored.

### Phase 3: Dispatch Coordinator (Event-Driven Reconcile)

- Add `apps/api/src/project/work-item-dispatch-coordinator.service.ts` (new).
- Wire provider in `project.module.ts`.
- Handle `WORK_ITEM_DISPATCH_RECONCILE_EVENT` and emit `WorkItemDispatchSelectEvent`.
- Emit `work_item.dispatch.decision` telemetry with counts and selected IDs.

Acceptance criteria:

- Reconcile events trigger candidate selection event emission.
- Capacity and dependency constraints are respected before selection emission.
- Duplicate/concurrent reconcile events do not over-dispatch.

### Phase 4: CEO Prompt and Workflow Contract Upgrades

- Update `project-orchestration-cycle-ceo.workflow.yaml` prompt to use `state.scheduling`.
- Update `ceo.profile.ts` rules to enforce critical-path-first parallelization behavior.
- Update `work-item-todo-dispatch-default.workflow.yaml` candidate prompt to include scheduling hints (critical path score/level when present).

Acceptance criteria:

- CEO decision logs reference scheduling context.
- In autonomous mode, CEO selects multi-item starts when slots > 1 and independent candidates exist.

### Phase 5: Hardening and Rollout Controls

- Add system settings for optional scheduler tuning:
  - `work_item_scheduler_scope_weight_large` (default 2)
  - `work_item_scheduler_scope_weight_standard` (default 1)
- Add feature flag for progressive rollout:
  - `work_item_scheduler_enabled` (default false in initial deploy)
- Add telemetry counters for recommendation-vs-execution divergence.

Acceptance criteria:

- Feature can be toggled per environment.
- Operator can verify behavior from telemetry without deep logs.

## 6. Testing Strategy

### 6.1 Unit Tests

- Graph builder, topological sort, longest-path calculation.
- Frontier extraction with mixed done/todo/in-progress dependencies.
- Deterministic tie-break behavior.

### 6.2 Service Tests

- `ProjectOrchestrationService.getProjectState` includes valid scheduling payload.
- Dispatch coordinator reconcile flow emits expected events and skip reasons.

### 6.3 Integration and E2E

- Scenario: chain + parallel branch graph with capacity 2 and 3.
- Verify non-dependent tasks start concurrently.
- Verify dependent task waits until parent is done.
- Verify critical-path item is selected before same-priority non-critical alternatives when slots are constrained.

### 6.4 Regression Coverage

- Mode policy behavior unchanged in supervised mode.
- Existing dispatch capacity guard still caps starts at execution boundary.
- No workflow loop regressions from reconcile-triggered events.

## 7. Risks and Mitigations

- Risk: Stale docs/tests reference removed coordinator implementation.
  - Mitigation: Reintroduce coordinator service and update stale imports/docs in same epic.

- Risk: CEO may still choose non-optimal set despite recommendations.
  - Mitigation: Put deterministic recommendation in payload and require deviation reasoning in decision log.

- Risk: Over-dispatch under race conditions.
  - Mitigation: Keep server-side capacity enforcement and add project lock in reconcile step.

- Risk: Critical-path heuristic may not match real effort.
  - Mitigation: configurable scope weights and optional metadata effort override.

## 8. Deliverables

- Scheduling service and graph utilities.
- Enriched project state API/tool response with scheduling metadata.
- Restored event-driven dispatch coordinator.
- Updated CEO and dispatch workflow prompts/contracts.
- Unit/service/e2e coverage for critical-path parallel dispatch.
- Updated API README section for scheduling and dispatch behavior.

## 9. Definition of Done

- CEO can automatically start multiple non-dependent work items in one cycle when slots are available.
- Dispatch prioritizes critical-path blockers under constrained capacity.
- Dependency constraints are never violated.
- All relevant unit/integration/e2e tests pass.
- Documentation reflects new scheduling fields and behavior.
