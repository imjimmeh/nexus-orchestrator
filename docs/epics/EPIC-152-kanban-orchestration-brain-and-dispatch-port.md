# EPIC-152: Kanban Orchestration Brain and Dispatch Port

Status: Proposed
Priority: P0
Depends On: EPIC-151
Related: EPIC-148, docs/analysis/2026-04-25-kanban-api-decoupling-plan.md
Last Updated: 2026-04-29

---

## 1. Summary

Move kanban orchestration, work-item scheduling, dispatch, review policy, and project intelligence behavior out of `apps/api` and into `apps/kanban`. Core should execute workflows and emit lifecycle events; kanban should decide what work should run, when it should run, and how project-specific decisions are represented.

War-room is not kanban. It is core-owned, project-agnostic multi-agent collaboration: sessions, participants, messages, blackboard, signoff, and consensus should remain in `apps/api` after project/work-item coupling is removed.

This epic moves the brain of the software-development hub to kanban.

---

## 2. Current State Review

1. `apps/api/src/project/work-items/work-item-scheduling.service.ts` still computes scheduling and dependency readiness in core.
2. `apps/api/src/project/work-item-dispatch/*` still owns dispatch authority, polling, reconciliation, policy, and queue consumers.
3. `apps/api/src/project/orchestration/*` still owns orchestration state, action requests, lifecycle, decisions, observability, runtime, and workflow status behavior.
4. `apps/api/src/project/intelligence/*` still owns project steering and amend-entity planning.
5. `apps/api/src/war-room/*` owns war-room domain persistence and behavior, but its types still include optional `project_id` and `work_item_id` fields.
6. `apps/kanban/src/orchestration`, `review`, and `war-room` exist, but current behavior is partial and mostly not authoritative.

---

## 3. Goals

1. Port work-item scheduling and dependency graph behavior to kanban.
2. Port dispatch authority, dispatch polling, dispatch reconciliation, and capacity-aware selection to kanban.
3. Port project orchestration state, action requests, lifecycle, diagnostics, and decision log behavior to kanban.
4. Port review policy that is specific to the kanban workflow.
5. Remove the kanban-side war-room facade/policy unless a later product decision defines a true kanban-specific collaboration feature outside core war-room.
6. Replace direct workflow-engine calls with generic core workflow run requests using the contracts from EPIC-150.
7. Keep core unaware of kanban status, work-item readiness, dispatch authority, and project orchestration semantics.

---

## 4. Non-Goals

1. Do not change the workflow engine execution semantics.
2. Do not move generic agent session, runtime capability, or workflow repair behavior out of core.
3. Do not move war-room out of core.
4. Do not build MCP tools in this epic unless needed as an implementation seam for kanban-owned decisions.
5. Do not delete API modules until EPIC-157.

---

## 5. High-Level Work

1. Rebuild `apps/kanban/src/orchestration` around kanban-owned repositories and core workflow run client calls.
2. Port scheduling graph helpers and policy services from `apps/api/src/project/work-items` to kanban.
3. Port dispatch services from `apps/api/src/project/work-item-dispatch` to kanban.
4. Port orchestration action request, lifecycle, validation, decision log, observability, and diagnostics behavior from `apps/api/src/project/orchestration` to kanban.
5. Port review policy from API modules to kanban modules.
6. Delete or neutralize `apps/kanban/src/war-room` so kanban does not pretend to own core collaboration.
7. Replace all in-process `WorkflowEngineService` calls with core internal workflow run request/status/control clients.
8. Add idempotency keys and correlation metadata for every kanban-triggered core workflow run.
9. Add integration tests where kanban schedules work and core only accepts workflow run requests.
10. Add failure-mode tests for core unavailable, duplicate dispatch, stale run status, and rejected action requests.

---

## 6. Deliverables

1. Kanban-owned scheduling and dispatch module.
2. Kanban-owned orchestration module with action requests, diagnostics, lifecycle, and decision log APIs.
3. Kanban-owned review module, with war-room left in core as generic collaboration.
4. Core workflow run client usage for all run launches and controls.
5. Deterministic tests for dispatch, review, merge, and orchestration action flows.

---

## 7. Acceptance Criteria

1. `apps/api` no longer decides which work item should dispatch next.
2. `apps/api` no longer owns kanban orchestration action approval, rejection, or lifecycle policy.
3. Kanban can trigger dispatch, review, merge, and orchestration workflows through generic core run contracts.
4. Duplicate dispatch attempts are idempotent.
5. Kanban tests prove that core workflow execution can be mocked as an external service.
6. No epic task moves `apps/api/src/war-room` into `apps/kanban`.

---

## 8. Suggested Quality Gates

1. `npm run test:kanban`
2. `npm run build:kanban`
3. Targeted integration tests with a mocked core workflow client.
4. Dispatch race-condition tests.
5. Contract tests for workflow run requests emitted by kanban.

---

## 9. Risks

1. Risk: moving scheduling changes runtime behavior.
2. Mitigation: snapshot current scheduling outputs before porting and compare against kanban implementation.
3. Risk: kanban orchestration relies on core internals not exposed as contracts.
4. Mitigation: add narrow generic core APIs instead of importing core services.
