# EPIC-118: Refinement-First Planning and Subtask Readiness Gates

**Epic ID:** EPIC-118  
**Status:** Proposed  
**Created:** 2026-04-18  
**Last Updated:** 2026-04-18  
**Priority:** P0 - Critical  
**Theme:** Kanban Lifecycle Quality, Readiness Governance, and Orchestrator Planning Behavior

---

## 1. Executive Summary

Establish a refinement-first readiness model where nearly all work items are planned and decomposed before execution, without creating brittle hard blocks that stall operators.

Target operating model:

1. `backlog -> refinement -> todo -> in-progress -> in-review -> done`
2. Work items should clear refinement at least once before execution.
3. Planning should be default behavior, not strict universal enforcement.
4. Refinement must produce subtasks before a work item exits refinement.
5. Refinement may split work into child items; planning occurs after split on execution candidates.

Key implementation stance:

1. Keep `backlog -> todo` manually allowed.
2. Enforce readiness at execution gate (`todo -> in-progress`) with auto-reroute to refinement.
3. Drive policy through workflows, prompts, skills, and transition guards.

---

## 2. Background and Current Context

Current system capabilities already provide most required primitives:

1. Dispatch can route to `refinement` via preflight settings in [apps/api/src/project/project-orchestration-dispatch.execution.ts](../../apps/api/src/project/project-orchestration-dispatch.execution.ts).
2. Refinement workflow exists and can persist preflight and implementation artifacts in [seed/workflows/work-item-refinement-default.workflow.yaml](../../seed/workflows/work-item-refinement-default.workflow.yaml).
3. In-progress workflow has fallback planning behavior for selected cases in [seed/workflows/work-item-in-progress-default.workflow.yaml](../../seed/workflows/work-item-in-progress-default.workflow.yaml).
4. Orchestration decision behavior is prompt-driven in [seed/workflows/prompts/project-orchestration-cycle-ceo/decide.md](../../seed/workflows/prompts/project-orchestration-cycle-ceo/decide.md).
5. Planning and orchestration guidance skills exist in [seed/skills/implementation-planning/SKILL.md](../../seed/skills/implementation-planning/SKILL.md) and [seed/skills/orchestration-patterns/SKILL.md](../../seed/skills/orchestration-patterns/SKILL.md).

Related prior epics:

1. Preflight planning pipeline: [docs/epics/EPIC-053-pre-flight-planning-pipeline-pm-architect.md](EPIC-053-pre-flight-planning-pipeline-pm-architect.md)
2. Capacity-aware pull loop: [docs/epics/EPIC-056-capacity-aware-work-polling-true-kanban.md](EPIC-056-capacity-aware-work-polling-true-kanban.md)

---

## 3. Problem Statement

The platform currently allows too many items to enter execution without robust planning/subtask decomposition, which increases churn, QA rework, and orchestration uncertainty.

At the same time, strict hard blocking on early board movement (`backlog -> todo`) can create operator friction and deadlocks.

We need a model that:

1. Raises planning/subtask quality floor.
2. Preserves operator flexibility in board management.
3. Enforces readiness only when execution actually begins.

---

## 4. Goals

1. Make planning and refinement the default path for almost all work items.
2. Require that execution candidates have passed refinement at least once.
3. Require subtasks before exiting refinement.
4. Support split-then-plan behavior in refinement.
5. Update orchestrator prompts/skills/processes so policy is followed autonomously.
6. Preserve non-blocking operator board movement where practical.

---

## 5. Non-Goals

1. Building fully customizable per-project lifecycle engines.
2. Removing existing review/merge governance.
3. Replacing all current preflight artifacts and contracts.
4. Enforcing planning at work item creation time.

---

## 6. Proposed Lifecycle and Transition Policy

### 6.1 Canonical Flow

1. `backlog -> refinement -> todo -> in-progress -> in-review -> done`

`blocked` remains a side-state destination from active statuses as today.

### 6.2 Transition Matrix (Target)

1. `backlog -> todo`: allowed (manual/operator flexibility).
2. `backlog -> refinement`: allowed.
3. `todo -> refinement`: allowed.
4. `refinement -> todo`: allowed only if readiness gates pass.
5. `todo -> in-progress`: guarded; auto-reroute to refinement if unready.
6. `in-progress -> in-review`: unchanged.
7. `in-review -> done` (or existing merge intermediate): unchanged.

### 6.3 Readiness Gates

Readiness criteria for execution:

1. `hasClearedRefinementOnce = true`
2. `executionConfig.implementationPlan` present
3. Minimum subtasks policy satisfied
4. Split disposition resolved (no unresolved split-required state)

Enforcement point:

1. Primary enforcement at `todo -> in-progress`
2. Secondary enforcement at `refinement -> todo`

### 6.4 Auto-Reroute Rule

When an item is selected for execution dispatch from `todo` and fails readiness:

1. Do not fail hard.
2. Transition to `refinement` automatically.
3. Emit decision/telemetry reason (`unrefined`, `missing_plan`, `missing_subtasks`, `split_pending`).

---

## 7. Refinement Behavior Model

### 7.1 War Room Requirement

Refinement must always run a multi-agent war room coordination step.

Required participant roles:

1. Product manager role
2. Architect role
3. Delivery/implementation role
4. QA role

### 7.2 Split-Then-Plan Rule

If refinement determines the work item is too large or compound:

1. Create/synchronize child work items first.
2. Set parent split disposition (`superseded` or `umbrella`, selected via policy).
3. Run planning on execution candidate children.
4. Prevent parent from progressing as direct execution unit when superseded.

### 7.3 Subtask Requirement

Before leaving refinement, each execution candidate work item must have subtasks.

Minimum subtask contract:

1. At least one subtask.
2. Each subtask has title.
3. Each subtask has acceptance signal/verification note.
4. Each subtask has intended owner profile or execution strategy.

---

## 8. Data and Contract Changes

### 8.1 Work Item Metadata Extensions

Add lifecycle/readiness metadata:

1. `metadata.refinement.hasClearedOnce: boolean`
2. `metadata.refinement.lastCompletedAt: string`
3. `metadata.refinement.version: number`
4. `metadata.refinement.lastOutcome: approved | split_required | needs_rework`
5. `metadata.readiness.lastFailureReasons: string[]`
6. `metadata.split.parentId?: string`
7. `metadata.split.childIds?: string[]`
8. `metadata.split.disposition?: superseded | umbrella | blocked_awaiting_children`

### 8.2 Execution Config Extensions

1. Persist and version implementation plan source/version.
2. Preserve existing rejection/delta-replan behavior.

### 8.3 Transition Guard Contract

Extend transition guard decision payload to include:

1. `allowed: boolean`
2. `autoRerouteStatus?: refinement`
3. `reasons: string[]`

---

## 9. Workflow Changes

### 9.1 Refinement Workflow

File: [seed/workflows/work-item-refinement-default.workflow.yaml](../../seed/workflows/work-item-refinement-default.workflow.yaml)

Changes:

1. Preserve PM + architect preflight sequence.
2. Make war room step unconditional.
3. Add split decision step and child materialization path.
4. Add subtask generation/validation step.
5. Add readiness metadata record step (`hasClearedRefinementOnce`).
6. Change terminal transition from `in-progress` to `todo`.

### 9.2 In-Progress Workflow

File: [seed/workflows/work-item-in-progress-default.workflow.yaml](../../seed/workflows/work-item-in-progress-default.workflow.yaml)

Changes:

1. Keep fallback planner for safety only.
2. Prefer using persisted refinement outputs as primary context.
3. Preserve QA-driven delta replan branch.

### 9.3 Dispatch and Execution Gate

Files:

1. [apps/api/src/project/project-orchestration-dispatch.execution.ts](../../apps/api/src/project/project-orchestration-dispatch.execution.ts)
2. status transition guard/service files under `apps/api/src/project`

Changes:

1. Add readiness checks before dispatching to execution.
2. If not ready, route to `refinement` with reason telemetry.
3. Keep capacity/dependency scheduling intact.

---

## 10. Prompt and Skill Changes

### 10.1 Orchestrator Decision Prompt

File: [seed/workflows/prompts/project-orchestration-cycle-ceo/decide.md](../../seed/workflows/prompts/project-orchestration-cycle-ceo/decide.md)

Add policy guidance:

1. Planning-first dispatch policy.
2. Prefer unready items into refinement.
3. Allow bypass only for explicit urgent/trivial rationale.
4. Require rationale logging when bypassing recommendation.

### 10.2 Architect Refinement Prompt

File: [seed/workflows/prompts/work-item-refinement-default/architect-refine.md](../../seed/workflows/prompts/work-item-refinement-default/architect-refine.md)

Changes:

1. Planning expected by default, not merely optional.
2. Explicit split recommendation schema.
3. Require subtask-ready decomposition guidance.
4. If no plan provided, require omission reason and risk level.

### 10.3 Skill Updates

Files:

1. [seed/skills/orchestration-patterns/SKILL.md](../../seed/skills/orchestration-patterns/SKILL.md)
2. [seed/skills/implementation-planning/SKILL.md](../../seed/skills/implementation-planning/SKILL.md)

Changes:

1. Add readiness-gate and reroute patterns.
2. Add split-first planning pattern.
3. Add minimal viable subtask contract guidance.

---

## 11. Process and Operating Model Changes

1. Operators may still move items to `todo` for board management.
2. System enforces execution readiness when work starts.
3. Refinement acts as deterministic intake quality gate.
4. Orchestrator policy becomes planning-biased by default.

---

## 12. Feature Flags and Rollout

Add new settings/flags:

1. `refinement_exit_to_todo_enabled` (default false)
2. `enforce_refinement_before_in_progress` (default false)
3. `enforce_subtasks_before_refinement_exit` (default false)
4. `auto_reroute_unready_todo_to_refinement` (default true once enabled)
5. `refinement_war_room_always_required` (default false in rollout, true target)

Rollout stages:

1. Dark ship (all new flags false).
2. Enable prompt/skill behavior first.
3. Enable refinement exit to todo + metadata tracking.
4. Enable subtask and readiness reroute gates.
5. Enable always-war-room once throughput validated.

---

## 13. Acceptance Criteria

### 13.1 Epic-Level Acceptance

1. New lifecycle supports `backlog -> refinement -> todo -> in-progress -> in-review -> done`.
2. `backlog -> todo` remains allowed.
3. Unready `todo -> in-progress` attempts are rerouted to refinement with reason telemetry.
4. Refinement requires war room completion.
5. Refinement cannot exit without subtasks meeting minimum contract.
6. Refinement cannot exit without implementation plan (or explicit policy-approved omission reason).
7. Split-required items are decomposed before planning execution candidates.
8. Orchestrator prompt and skills bias toward planning-first decisions.
9. Deterministic tests pass for enabled and disabled rollout modes.

### 13.2 Non-Regression Acceptance

1. Existing capacity-aware scheduling and dependency gating remains functional.
2. Existing QA reject/delta replan behavior remains functional.
3. Existing manual board operations do not hard-fail unexpectedly.

---

## 14. Detailed PR-Ready Task Breakdown

### Phase A: Contracts and Metadata

1. Add refinement/readiness/split metadata types and serializers.
2. Add transition guard contract extensions (`reasons`, reroute target).
3. Add migration/backfill strategy for legacy items (`hasClearedRefinementOnce = false` default).

### Phase B: Transition and Dispatch Enforcement

1. Implement readiness checks for `todo -> in-progress`.
2. Implement auto-reroute to `refinement` for unready items.
3. Emit observability events for reroute reasons.

### Phase C: Refinement Workflow Hardening

1. Update refinement workflow terminal transition to `todo`.
2. Add mandatory war room completion step.
3. Add split branch with parent/child disposition handling.
4. Add subtask generation + validation step.
5. Record `hasClearedRefinementOnce` and `lastCompletedAt`.

### Phase D: Prompt and Skill Updates

1. Update CEO decision prompt with planning-first rules.
2. Update architect refinement prompt to require plan/split rationale.
3. Update orchestration and implementation-planning skills for gate/reroute behavior.

### Phase E: API and UI Surface Adjustments

1. Add readiness diagnostics to project state response.
2. Surface refinement history and readiness flags in work item detail panels.
3. Surface reroute reasons in orchestration timeline/telemetry UI.

### Phase F: Tests and Deterministic Validation

1. Unit tests for transition guards and reroute logic.
2. Integration tests for refinement exit gates (plan + subtasks + war room).
3. Integration tests for split-then-plan path.
4. E2E tests for lifecycle with flags on/off.
5. Deterministic kanban regression pass.

---

## 15. Task Checklist (PR Tracking)

1. [ ] PR-1: Metadata contracts + persistence scaffolding.
2. [ ] PR-2: Transition guard + dispatch reroute enforcement.
3. [ ] PR-3: Refinement workflow updates (`exit -> todo`, war room, subtasks, split flow).
4. [ ] PR-4: Prompt updates (CEO + architect refinement).
5. [ ] PR-5: Skill updates (orchestration-patterns + implementation-planning).
6. [ ] PR-6: API diagnostics + telemetry reason surfaces.
7. [ ] PR-7: UI readiness and refinement observability enhancements.
8. [ ] PR-8: Full test suite updates and deterministic kanban validation.

Each PR must include:

1. Scope statement and linked acceptance criteria.
2. Backward-compatibility notes.
3. Explicit flag behavior and defaults.
4. Test evidence (unit + integration + relevant e2e slices).

---

## 16. Risks and Mitigations

1. Throughput slowdown from mandatory war room.
   - Mitigation: rollout flag and instrumentation before full enforcement.
2. Refinement loop churn for frequently changing items.
   - Mitigation: staleness policy and explicit re-refinement triggers.
3. Parent/child ambiguity after split.
   - Mitigation: explicit split disposition enum and parent closure rules.
4. Operator confusion on allowed board moves vs readiness gates.
   - Mitigation: UI explanations and telemetry reason messages.

---

## 17. Open Decisions

1. Parent split disposition default: `superseded` vs `umbrella`.
2. Minimum subtask count for large items (`>= 2`?) beyond universal minimum `>= 1`.
3. Policy for plan omission approvals (who can approve and how recorded).
4. Whether `ready-to-merge` remains explicit in this lifecycle slice or remains outside this epic scope.

---

## 18. References

Architecture and behavior references:

1. [docs/architecture/workflow-engine.md](../architecture/workflow-engine.md)
2. [docs/architecture/tool-registry.md](../architecture/tool-registry.md)
3. [docs/architecture/agent-capability-orchestration.md](../architecture/agent-capability-orchestration.md)

Implementation references:

1. [seed/workflows/work-item-refinement-default.workflow.yaml](../../seed/workflows/work-item-refinement-default.workflow.yaml)
2. [seed/workflows/work-item-in-progress-default.workflow.yaml](../../seed/workflows/work-item-in-progress-default.workflow.yaml)
3. [seed/workflows/prompts/project-orchestration-cycle-ceo/decide.md](../../seed/workflows/prompts/project-orchestration-cycle-ceo/decide.md)
4. [seed/workflows/prompts/work-item-refinement-default/architect-refine.md](../../seed/workflows/prompts/work-item-refinement-default/architect-refine.md)
5. [seed/skills/orchestration-patterns/SKILL.md](../../seed/skills/orchestration-patterns/SKILL.md)
6. [seed/skills/implementation-planning/SKILL.md](../../seed/skills/implementation-planning/SKILL.md)
7. [apps/api/src/project/project-orchestration-dispatch.execution.ts](../../apps/api/src/project/project-orchestration-dispatch.execution.ts)
8. [apps/api/src/settings/system-settings.service.ts](../../apps/api/src/settings/system-settings.service.ts)

---

## 19. Implementation Pseudocode (Normative)

### 19.1 Readiness Guard for `todo -> in-progress`

```ts
type ReadinessReason =
  | "unrefined"
  | "missing_plan"
  | "missing_subtasks"
  | "split_pending";

interface ReadinessDecision {
  allowed: boolean;
  autoRerouteStatus?: "refinement";
  reasons: ReadinessReason[];
}

function evaluateExecutionReadiness(workItem: WorkItem): ReadinessDecision {
  const reasons: ReadinessReason[] = [];

  const hasClearedRefinementOnce =
    workItem.metadata?.refinement?.hasClearedOnce === true;
  if (!hasClearedRefinementOnce) reasons.push("unrefined");

  const hasPlan = !!workItem.executionConfig?.implementationPlan;
  if (!hasPlan) reasons.push("missing_plan");

  const subtaskCount = workItem.subtasks?.length ?? 0;
  if (subtaskCount < 1) reasons.push("missing_subtasks");

  const splitDisposition = workItem.metadata?.split?.disposition;
  const splitPending =
    splitDisposition === "blocked_awaiting_children" ||
    splitDisposition === "needs_split_resolution";
  if (splitPending) reasons.push("split_pending");

  if (reasons.length === 0) {
    return { allowed: true, reasons: [] };
  }

  return {
    allowed: false,
    autoRerouteStatus: "refinement",
    reasons,
  };
}
```

Behavioral requirements:

1. Guard runs on dispatch-start and direct status mutation paths.
2. If disallowed and reroute flag enabled, status mutates to `refinement`.
3. If reroute disabled, mutation fails with typed error and reason list.

### 19.2 Refinement Exit Guard for `refinement -> todo`

```ts
function evaluateRefinementExit(workItem: WorkItem): {
  allowed: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];

  if (!workItem.executionConfig?.implementationPlan) {
    reasons.push("missing_plan");
  }

  if ((workItem.subtasks?.length ?? 0) < 1) {
    reasons.push("missing_subtasks");
  }

  const warRoomClosed =
    workItem.metadata?.refinement?.warRoom?.status === "closed";
  if (!warRoomClosed) {
    reasons.push("war_room_incomplete");
  }

  const splitDisposition = workItem.metadata?.split?.disposition;
  if (splitDisposition === "blocked_awaiting_children") {
    reasons.push("split_pending");
  }

  return { allowed: reasons.length === 0, reasons };
}
```

---

## 20. Prompt and Skill Patch Content (Copy-Ready)

### 20.1 Insert Block for CEO Decision Prompt

File target: [seed/workflows/prompts/project-orchestration-cycle-ceo/decide.md](../../seed/workflows/prompts/project-orchestration-cycle-ceo/decide.md)

Insert under required behavior section:

```md
### Planning-First Dispatch Policy

When selecting work items to start:

1. Prefer items that have already cleared refinement and have a recorded implementation plan.
2. If an item is selected but is not execution-ready (unrefined, missing plan, or missing subtasks), route it to refinement instead of in-progress.
3. Only bypass this policy for urgent/trivial exceptions and record explicit rationale in submit_orchestration_decision.
4. If splitting is required, treat parent as non-executable until split resolution completes.
```

### 20.2 Replace Block for Architect Refinement Prompt

File target: [seed/workflows/prompts/work-item-refinement-default/architect-refine.md](../../seed/workflows/prompts/work-item-refinement-default/architect-refine.md)

Replace artifact requirements block with:

```md
MUST call submit_preflight_artifacts exactly once with:

- architect_summary: concise technical plan summary
- sdd_targets: array of SDD sections/docs to update
- implementation_plan: expected structured plan object for executionConfig persistence
- split_recommendation: one of none | split_required
- split_children: optional candidate child work item specs when split_required
- subtask_blueprint: minimum executable subtask set for refinement exit

If implementation_plan is omitted, include:

- omission_reason
- risk_level: low | medium | high
```

### 20.3 Insert Block for Orchestration Skill

File target: [seed/skills/orchestration-patterns/SKILL.md](../../seed/skills/orchestration-patterns/SKILL.md)

Append to instructions:

```md
6. Apply readiness gating before execution dispatch: refined once, planned, and subtasked.
7. Reroute unready todo items to refinement with explicit reason tags.
8. Treat split-pending parent items as non-executable.
```

### 20.4 Insert Block for Planning Skill

File target: [seed/skills/implementation-planning/SKILL.md](../../seed/skills/implementation-planning/SKILL.md)

Append to instructions:

```md
6. Produce subtask-ready plans: each milestone maps to one or more executable subtasks.
7. If scope is compound, recommend split before detailed execution plan finalization.
8. For trivial work, produce a lightweight plan with at least one milestone and one verification command.
```

---

## 21. Workflow Patch Outline (YAML-Level)

### 21.1 `work_item_refinement_default` Required Edits

File target: [seed/workflows/work-item-refinement-default.workflow.yaml](../../seed/workflows/work-item-refinement-default.workflow.yaml)

1. Make `war_room_refinement_alignment` unconditional by removing current condition.
2. Add `resolve_split` execution job after architect refinement.
3. Add `materialize_split_children` special/invoke job conditional on split_required.
4. Add `generate_subtasks` job (agent or special step) for execution candidates.
5. Add `validate_refinement_exit_readiness` job.
6. Update final transition job:
   - `target_status: todo`
   - depends on readiness validation and split handling.

### 21.2 `work_item_in_progress_default` Required Edits

File target: [seed/workflows/work-item-in-progress-default.workflow.yaml](../../seed/workflows/work-item-in-progress-default.workflow.yaml)

1. Keep fallback planner condition but add comment or metadata label `fallback_only`.
2. Ensure implement prompt consumes refinement outputs and subtask blueprint first.

### 21.3 Dispatch Runtime Required Edits

File target: [apps/api/src/project/project-orchestration-dispatch.execution.ts](../../apps/api/src/project/project-orchestration-dispatch.execution.ts)

1. Evaluate readiness for selected execution candidates.
2. Partition selected IDs:
   - execution-ready -> normal target (`in-progress`)
   - not-ready -> reroute target (`refinement`)
3. Emit telemetry per rerouted item with structured reasons.

---

## 22. Detailed Test Matrix

### 22.1 Unit Tests

1. `evaluateExecutionReadiness` returns `allowed=true` for refined+planned+subtasked item.
2. Returns `unrefined` when refinement flag absent.
3. Returns `missing_plan` when implementation plan absent.
4. Returns `missing_subtasks` when no subtasks.
5. Returns `split_pending` when unresolved split disposition present.
6. `evaluateRefinementExit` enforces war room closure, plan, and subtasks.

### 22.2 Integration Tests

1. Dispatch attempt on unready `todo` item reroutes to `refinement`.
2. Dispatch attempt on ready `todo` item transitions to `in-progress`.
3. `refinement -> todo` blocked when subtasks missing.
4. `refinement -> todo` blocked when plan missing.
5. `refinement -> todo` blocked when war room not closed.
6. Split-required parent does not progress to executable path.
7. Split children receive planning artifacts and subtasks.

### 22.3 E2E Deterministic Scenarios

1. New item created and moved to `todo` manually, then auto-rerouted to refinement at dispatch.
2. Refinement run with split-required path creates children and supersedes parent.
3. Refinement run without split exits to `todo` only after plan + subtasks.
4. Follow-up dispatch starts only ready items and leaves unready items in refinement.
5. Existing QA reject flow still triggers delta replan path and remains green.

### 22.4 Acceptance Criteria Traceability

Map tests to criteria in Section 13:

1. AC-1/AC-2: transition and board-move tests.
2. AC-3: reroute dispatch integration tests.
3. AC-4/AC-5/AC-6: refinement exit validation tests.
4. AC-7: split-then-plan integration/e2e tests.
5. AC-8: prompt/skill golden tests or deterministic orchestration behavior assertions.
6. AC-9: deterministic kanban suite execution.

---

## 23. Execution Tracker Appendix (Issue Template)

Use this structure for each PR issue:

1. Objective
2. In-scope files
3. Out-of-scope files
4. Acceptance criteria (linked to Section 13 IDs)
5. Test evidence required
6. Rollback strategy
7. Feature flag behavior

Suggested task issue titles:

1. `EPIC-118 PR-1: Add readiness metadata and contracts`
2. `EPIC-118 PR-2: Add execution guard and reroute behavior`
3. `EPIC-118 PR-3: Update refinement workflow for todo exit and split-first planning`
4. `EPIC-118 PR-4: Patch CEO and architect prompts for planning-first policy`
5. `EPIC-118 PR-5: Update orchestration/planning skills for readiness gating`
6. `EPIC-118 PR-6: Surface readiness diagnostics and reroute telemetry`
7. `EPIC-118 PR-7: Update UI for refinement/readiness observability`
8. `EPIC-118 PR-8: Complete deterministic regression matrix`
9. [seed/skills/implementation-planning/SKILL.md](../../seed/skills/implementation-planning/SKILL.md)
10. [apps/api/src/project/project-orchestration-dispatch.execution.ts](../../apps/api/src/project/project-orchestration-dispatch.execution.ts)
11. [apps/api/src/settings/system-settings.service.ts](../../apps/api/src/settings/system-settings.service.ts)

Related epics:

1. [docs/epics/EPIC-053-pre-flight-planning-pipeline-pm-architect.md](EPIC-053-pre-flight-planning-pipeline-pm-architect.md)
2. [docs/epics/EPIC-056-capacity-aware-work-polling-true-kanban.md](EPIC-056-capacity-aware-work-polling-true-kanban.md)
