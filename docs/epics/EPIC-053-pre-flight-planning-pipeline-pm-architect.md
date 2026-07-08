# EPIC-053: Pre-Flight Planning Pipeline (PM -> Architect -> Developer)

> Status: Implemented (v1 shipped)
> Priority: Critical
> Estimate: 3-5 weeks
> Created: 2026-04-05
> Last Updated: 2026-04-06
> Owner: TBD
> Depends On: EPIC-034, EPIC-038, EPIC-039

---

## 1. Epic Summary

Add a dedicated pre-development refinement stage so work items do not jump directly from todo to developer implementation.

Target flow:

1. todo -> refinement
2. PM agent validates business requirements and decomposition readiness
3. Architect agent drafts technical approach and SDD deltas
4. refinement -> in-progress (developer implementation begins)

This introduces an explicit planning pipeline before coding and makes planning artifacts first-class inputs to implementation.

### 1.1 Implementation Snapshot (2026-04-06)

Implemented in current codebase:

1. Lifecycle and status expansion to include `refinement` across API and Web status models.
2. New seeded `work_item_refinement_default` workflow triggered by `kanban.ticket.refinement`.
3. PM and Architect pre-flight artifact capture with persisted metadata (`metadata.preflight`) and implementation-plan handoff.
4. Dispatch routing that supports pre-flight policy via system settings:
   - `work_item_preflight_pipeline_enabled`
   - `work_item_preflight_required`
5. In-progress workflow prompt/context harmonization to consume pre-flight artifacts when present.
6. Kanban/UI updates including a dedicated Refinement column and pre-flight summary rendering in work-item detail.
7. Test coverage for dispatch/status behavior and metadata handling in API and Web suites.

---

## 2. Current-State Analysis (Codebase Review)

### 2.1 Dispatch currently starts implementation directly

Current dispatch action transitions selected items straight to in-progress:

1. apps/api/src/project/project-orchestration.service.ts (`dispatchStartWorkItems`)
2. items are updated with status `in-progress`
3. this triggers `kanban.ticket.in_progress` automation

### 2.2 Status machine has no refinement stage

Current status model is hardcoded to:

1. backlog
2. todo
3. in-progress
4. in-review
5. ready-to-merge
6. blocked
7. done

Primary definitions:

1. apps/api/src/project/work-item.constants.ts
2. apps/web/src/lib/api/types.ts

### 2.3 In-progress workflow already contains partial planning, but too late and incomplete

In-progress workflow currently includes an architect planning step only for selected conditions (for example large scope), then implementation:

1. apps/api/src/database/seeds/work-item-in-progress-default.workflow.yaml
2. no guaranteed PM review pass
3. no explicit pre-dev gate before dispatch

### 2.4 UI is status-driven and currently lacks a refinement column

Kanban columns and grouping are static and will require status expansion:

1. apps/web/src/pages/kanban/kanban.utils.ts
2. apps/web/src/pages/kanban/kanban.board-helpers.ts
3. multiple workspace/session views classify active statuses using hardcoded sets

### 2.5 Automation architecture is already event-driven and extensible

Status-triggered workflows already exist and map cleanly to a new refinement stage:

1. apps/api/src/project/work-item-automation.service.ts
2. apps/api/src/database/seeds/work-item-\*.workflow.yaml
3. workflow event naming already supports status-token mapping (`kanban.ticket.<status>`, `_` <-> `-` normalization)

Conclusion: the platform already has the right orchestration primitives; this epic mainly adds one lifecycle stage plus routing changes and consistency updates across API/UI/tests.

---

## 3. Goals

1. Introduce a mandatory or configurable pre-flight refinement stage before developer execution.
2. Ensure PM business validation happens before architect technical planning.
3. Ensure architect output (implementation plan + SDD delta guidance) is persisted and consumed by implementation workflow.
4. Keep the system workflow-driven (minimal hardcoded branching in services).
5. Preserve backward compatibility with staged rollout controls.

---

## 4. Non-Goals

1. Full customizable board/state-machine per project.
2. Replacing current review/merge flows.
3. Building a complete visual planning artifact editor in this epic.
4. Multi-project portfolio planning.

---

## 5. Target Behavior

### 5.1 Lifecycle

Default lifecycle after this epic:

1. backlog -> todo
2. todo -> refinement
3. refinement -> in-progress
4. in-progress -> in-review -> ready-to-merge -> done

### 5.2 New refinement workflow

New status-triggered workflow: `work_item_refinement_default`

Trigger:

1. `kanban.ticket.refinement`

Jobs:

1. PM refinement pass (`agent_profile: product-manager`)
2. Architect planning pass (`agent_profile: architect-agent`)
3. Persist planning artifacts to metadata/execution config
4. Transition status to `in-progress`

### 5.3 Planning artifact contract

Persist structured pre-flight outputs so implementation can consume them deterministically.

Proposed fields:

1. `workItem.metadata.preflight.pmSummary`
2. `workItem.metadata.preflight.acceptanceClarifications`
3. `workItem.metadata.preflight.architectSummary`
4. `workItem.metadata.preflight.sddTargets`
5. `workItem.executionConfig.implementationPlan` (existing field, populated earlier)

### 5.4 Dispatch behavior

When pre-flight is enabled, dispatch starts refinement, not implementation.

1. dispatch selector still chooses todo items
2. mutating action transitions to refinement
3. in-progress starts only after refinement workflow completes

---

## 6. Implementation Plan

## Phase 1: Status and Contract Expansion

1. Add `refinement` to backend status constants and transition map.
2. Extend DTO/status validators and API typing surfaces.
3. Extend web status union and all status-indexed maps.
4. Add/adjust tests for transition validity and serialization.

Primary files:

1. apps/api/src/project/work-item.constants.ts
2. apps/api/src/project/dto/create-work-item.dto.ts
3. apps/api/src/project/dto/update-work-item-status.dto.ts
4. apps/web/src/lib/api/types.ts
5. apps/web/src/pages/kanban/kanban.utils.ts
6. apps/web/src/pages/kanban/kanban.board-helpers.ts

## Phase 2: Refinement Workflow and Tooling

1. Add workflow seed: `work-item-refinement-default.workflow.yaml`.
2. Define PM and architect step outputs (reuse existing output tool where possible; add dedicated refinement output tool only if needed).
3. Persist refinement artifacts via existing metadata step patterns.
4. Ensure profile/tool permissions support the required output contract.

Primary files:

1. apps/api/src/database/seeds/work-item-refinement-default.workflow.yaml (new)
2. apps/api/src/database/seeds/workflows.seed.ts (seed loading should discover automatically)
3. apps/api/src/security/iam-policy.service.ts
4. apps/api/src/database/seeds/agent-profiles/profiles/product-manager.profile.ts
5. apps/api/src/database/seeds/agent-profiles/profiles/architect-agent.profile.ts

## Phase 3: Dispatch Routing to Refinement

1. Update the Kanban-owned selected dispatch execution path (`kanban.dispatch_selected_work_items`) to set status `refinement` when feature is enabled.
2. Update active-capacity status sets to include refinement.
3. Keep fallback behavior for disabled mode or migration windows.

Primary files:

1. apps/api/src/project/project-orchestration.service.ts
2. apps/api/src/project/project-orchestration.service.types.ts
3. apps/api/src/project/work-item.service.spec.ts
4. apps/api/src/project/project-orchestration.service.spec.ts

## Phase 4: In-Progress Workflow Harmonization

1. Ensure in-progress workflow consumes pre-flight plan instead of re-planning unnecessarily.
2. Keep existing large-scope planning as fallback when refinement artifacts are absent.
3. Preserve QA reject delta-replan behavior.

Primary files:

1. apps/api/src/database/seeds/work-item-in-progress-default.workflow.yaml
2. apps/api/src/project/work-item-automation.service.ts (payload completeness checks)

## Phase 5: Web UX and Operator Visibility

1. Add Refinement column to Kanban board.
2. Update active-session/workspace/session filters where active states are hardcoded.
3. Surface pre-flight artifact summary in work-item details.
4. Ensure drag/drop behavior and execution-config modal logic are coherent for refinement.

Primary files:

1. apps/web/src/pages/kanban/kanban.utils.ts
2. apps/web/src/pages/kanban/KanbanBoard.tsx
3. apps/web/src/pages/kanban/WorkItemDetailSheet\*.tsx
4. apps/web/src/pages/project-workspace/SessionsTab.tsx
5. apps/web/src/pages/projects/projects.utils.ts
6. apps/web/src/pages/project-workspace/workspace.utils.ts

## Phase 6: E2E and Rollout Hardening

1. Update kanban lifecycle E2E to include refinement checkpoint.
2. Add dedicated E2E covering PM->architect->implementation handoff.
3. Add feature flag and staged rollout plan.
4. Add telemetry events for refinement start/complete/failure.

Primary files:

1. packages/e2e-tests/src/kanban-lifecycle/phase\*.test.ts
2. packages/e2e-tests/src/kanban-lifecycle/kanban-lifecycle-runner.ts
3. apps/api/src/observability/\* (event instrumentation touched by implementation)

---

## 7. Feature Flags and Rollout Strategy

Add system settings:

1. `work_item_preflight_pipeline_enabled` (default `false`)
2. `work_item_preflight_required` (default `false`)

Rollout sequence:

1. Ship dark (enabled=false)
2. Enable in staging for selected projects
3. Enable in production with required=false (allow manual bypass initially)
4. Move to required=true after E2E and operational confidence

---

## 8. Acceptance Criteria

1. Dispatch no longer moves todo directly to in-progress when pre-flight is enabled.
2. Selected todo items transition to refinement and trigger refinement workflow.
3. PM step and architect step both execute before in-progress begins.
4. Architect output persists and is consumed by implementation flow.
5. Kanban UI shows refinement status cleanly and supports drag/drop transitions consistent with policy.
6. Active counts/capacity calculations treat refinement consistently.
7. Existing projects can operate with pipeline disabled (backward compatibility).
8. Unit/integration/E2E tests pass for both enabled and disabled modes.

---

## 9. Risks and Mitigations

1. Risk: Status proliferation breaks hardcoded status maps.
   Mitigation: exhaustive type-driven updates and targeted grep sweep across API/web/tests.

2. Risk: Duplicate planning between refinement and in-progress workflow.
   Mitigation: explicit fallback conditions; refinement artifacts become primary source.

3. Risk: Dispatch throughput drops due to additional stage.
   Mitigation: include refinement in capacity model and expose metrics for queue latency.

4. Risk: PM/architect outputs are unstructured or inconsistent.
   Mitigation: strict output tool contracts and metadata schema validation.

5. Risk: Operational complexity during rollout.
   Mitigation: two-step feature flags (`enabled` and `required`) and phased enablement.

---

## 10. Open Decisions

1. Should manual drag todo -> in-progress be auto-rerouted to refinement when required=true?
2. Should refinement consume the same concurrency slot budget as in-progress/review?
3. Should architect step directly modify SDD files in repo, or only emit structured SDD-delta metadata?
4. Should rejected pre-flight return to todo or blocked by default?

Recommended defaults:

1. Auto-reroute todo -> in-progress to refinement when required=true.
2. Count refinement as active for concurrency safety.
3. Start with metadata-based SDD deltas, then optionally enable direct document edits.
4. Return to todo with explicit metadata feedback.

---

## 11. Validation Plan

1. Unit tests:
   1. status transitions (including refinement)
   2. dispatch routing behavior
   3. workflow trigger payload shaping

2. Integration tests:
   1. status update -> refinement workflow trigger
   2. refinement completion -> in-progress trigger chain

3. E2E tests:
   1. full lifecycle with refinement enabled
   2. backward-compat lifecycle with refinement disabled
   3. PM/architect artifact persistence and developer handoff

4. Non-functional checks:
   1. no regressions in review/merge flows
   2. dispatch idempotency under concurrent reconcile events
   3. telemetry completeness for new stage
