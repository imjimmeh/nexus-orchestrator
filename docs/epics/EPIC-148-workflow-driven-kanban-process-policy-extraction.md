# EPIC-148: Workflow-Driven Kanban Process Policy Extraction

Status: Implemented
Priority: P0
Depends On: EPIC-034 (Workflow-Driven Kanban Lifecycle), EPIC-118 (Refinement-First Planning and Subtask Readiness Gates), EPIC-119 (Workflow Engine Resilience and Domain Hardening), EPIC-120 (Output Tool and Job Output Contract Evolution), EPIC-137 (Playbook-Driven Stateful Orchestration), EPIC-147 (Workflow Module Decomposition and Submodule Extraction)
Depends On: EPIC-034 (Workflow-Driven Kanban Lifecycle), EPIC-118 (Refinement-First Planning and Subtask Readiness Gates), EPIC-119 (Workflow Engine Resilience and Domain Hardening), EPIC-120 (Output Tool and Job Output Contract Evolution), EPIC-137 (Playbook-Driven Stateful Orchestration), EPIC-147 (Workflow Module Decomposition and Submodule Extraction)
Last Updated: 2026-05-13

---

## 2026-05-13 Supersession Note

EPIC-170 (`docs/epics/EPIC-170-agent-driven-orchestration-and-event-wakeups.md`) and ADR-0026 supersede the scheduler-authority and transition-graph assumptions in this epic. The current architecture treats `project_orchestration_cycle_ceo` as the canonical mutating orchestration authority; Kanban emits facts, stores state, and enforces mutation safety. Work item status movement now allows any known status-to-status move without source-to-target transition graph validation. Dispatch is agent-selected guarded launch, and continuation policy is wakeup-only: the CEO cycle decides repeat, pause, block, or complete.

## 1. Summary

The API historically owned too much kanban and project orchestration process policy in TypeScript. Workflows already drove the major happy-path stages - refinement, implementation, review, and merge - but the API still decided many of the important lifecycle branches:

1. Which status a QA decision should transition to.
2. When a work item is execution-ready.
3. When an unready item should be rerouted to refinement.
4. Which work items are eligible for dispatch.
5. Which authority source is allowed to dispatch.
6. How orchestration action approval and rejection work.
7. How failed or stale orchestration cycles recover.
8. How incomplete review workflows are compensated.
9. Which hard-coded bridge actions agents can call.

This epic moved process policy out of API services and into workflows or workflow-owned declarative policy contracts. Superseded boundary detail: earlier versions treated several scheduler and transition policies as API-owned. Current EPIC-170 direction narrows the service boundary: APIs validate known status values, persist audited mutations, enforce authorization and capacity safety, emit events, and expose stable domain operations; `project_orchestration_cycle_ceo` owns mutating orchestration strategy.

The outcome is a smaller, safer API surface where `WorkItemService.updateStatus()` and related mutation paths are durable domain primitives, while kanban lifecycle behavior becomes inspectable, testable, and customizable through workflow definitions.

EPIC-147 changed where workflow-adjacent responsibilities belong. This epic must not re-expand the root `WorkflowModule`; new policy evaluators, registries, and listeners should land behind the narrowest decomposed module boundary.

Implementation note (2026-04-29): This epic is implemented through policy seams that keep API invariants in place while moving process decisions into workflow-owned policy services and contracts. The initial implementation preserves default seeded workflow behavior while making QA routing, readiness, dispatch targeting/blocking, orchestration lifecycle triggers, continuation decisions, repair continuation, review compensation, current execution cleanup, and action execution extensible without editing the core mutation paths.

---

## 2. Background

### 2.1 Current Hybrid Model

The current system is partially workflow-driven and partially hard-coded.

Workflow-owned behavior already exists:

| Concern                     | Current owner                                               | Evidence                                                                                                                                                 |
| --------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status-triggered automation | Workflow trigger registry plus `WorkItemAutomationService`  | `apps/api/src/project/work-items/work-item-automation.service.ts:40-113`                                                                                 |
| Refinement execution        | `work_item_refinement_default` workflow                     | `seed/workflows/work-item-refinement-default.workflow.yaml`                                                                                              |
| Implementation execution    | `work_item_in_progress_default` workflow                    | `seed/workflows/work-item-in-progress-default.workflow.yaml`                                                                                             |
| QA review execution         | `work_item_in_review_default` workflow                      | `seed/workflows/work-item-in-review-default.workflow.yaml`                                                                                               |
| Merge execution             | `work_item_ready_to_merge_default` workflow                 | `seed/workflows/work-item-ready-to-merge-default.workflow.yaml`                                                                                          |
| Dispatch selection agent    | `work_item_todo_dispatch_default` workflow                  | `seed/workflows/work-item-todo-dispatch-default.workflow.yaml`                                                                                           |
| Workflow-to-kanban mutation | `amend_entity` special step in `WorkflowSpecialStepsModule` | `apps/api/src/workflow/workflow-special-steps/step-amend-entity-special-step.handler.ts`, `apps/api/src/project/amend-entity.service.helpers.ts:114-156` |
| Workflow-to-kanban mutation | `amend_entity` special step in `WorkflowSpecialStepsModule` | `apps/api/src/workflow/workflow-special-steps/step-amend-entity-special-step.handler.ts`, `apps/api/src/project/amend-entity.service.helpers.ts:114-156` |

Hard-coded API-owned process policy still exists:

| Concern                               | Current owner                                                                                                              | Why this is a problem                                                                 |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| QA accept/reject routing              | `qa-decision-routing.ts` and `work-item-submit-qa.helpers.ts`                                                              | Duplicates workflow YAML and makes review behavior non-customizable.                  |
| Readiness gates and reroutes          | `work-item-readiness*.helpers.ts`                                                                                          | Process policy is hidden in TypeScript instead of visible in lifecycle definitions.   |
| Dispatch target/reroute/blocker logic | `project-orchestration-dispatch.execution.ts`                                                                              | Dispatch workflow only selects from candidates after API pre-decides most policy.     |
| Orchestration action execution        | `project-orchestration-mutating-action*.ts`                                                                                | Action router, approval, denial, and failure handling are a hard-coded state machine. |
| Orchestration lifecycle               | `project-orchestration-lifecycle.operations.ts`                                                                            | Project lifecycle is a code-level state machine rather than workflow-defined.         |
| Failure and recovery policies         | `work-item-run-status.listener.ts`, dispatch polling/recovery, `WorkflowRepairModule` listeners                            | Recovery behavior is coupled to fixed workflow IDs and fixed status transitions.      |
| Bridge actions                        | `telemetry-interaction.gateway.ts`, `telemetry-gateway-orchestration.handlers.ts`, `WorkflowRuntimeModule` runtime actions | Agent-facing actions are hard-coded decorators and payload/result schemas.            |
| Failure and recovery policies         | `work-item-run-status.listener.ts`, dispatch polling/recovery, `WorkflowRepairModule` listeners                            | Recovery behavior is coupled to fixed workflow IDs and fixed status transitions.      |
| Bridge actions                        | `telemetry-interaction.gateway.ts`, `telemetry-gateway-orchestration.handlers.ts`, `WorkflowRuntimeModule` runtime actions | Agent-facing actions are hard-coded decorators and payload/result schemas.            |

### 2.2 Relationship To EPIC-034

`EPIC-034: Workflow-Driven Kanban Lifecycle` moved major lifecycle execution concerns toward workflows: implementation, review, merge, worktree operations, metadata recording, and status transitions. Much of that work has since landed in a different shape than originally planned:

1. Direct legacy special step types like `transition_status`, `manage_execution`, `manage_worktree`, and `attempt_merge` are now reserved/unsupported.
2. Workflow-owned mutation now flows through `amend_entity` and `git_operation`.
3. QA decision mapping already exists in `work-item-in-review-default.workflow.yaml`.
4. Merge lifecycle is mostly workflow-owned in `work-item-ready-to-merge-default.workflow.yaml`.

This epic is the next layer: remove the remaining hard-coded process decisions from the API while preserving API-owned invariants and mutation safety.

### 2.3 Core Principle

The API should answer: "Is this requested mutation legal, authorized, durable, auditable, and safe?"

The workflow layer should answer: "Given current project/work-item state, what should happen next?"

### 2.4 Relationship To EPIC-147

EPIC-147 decomposes workflow responsibilities into focused modules. This epic builds on that module map instead of adding new policy code to the root workflow module.

Policy ownership should follow these boundaries:

| Concern in this epic                                                 | Target module boundary        |
| -------------------------------------------------------------------- | ----------------------------- |
| Workflow launch/resume compatibility paths                           | `WorkflowLaunchModule`        |
| Run-facing cleanup, idle tracking, and run operations                | `WorkflowRunOperationsModule` |
| Domain mutation bridges such as `amend_entity` and `invoke_workflow` | `WorkflowSpecialStepsModule`  |
| Agent-facing runtime actions and bridge action schemas               | `WorkflowRuntimeModule`       |
| Failure classification, repair dispatch, and repair completion       | `WorkflowRepairModule`        |
| Internal tool action adapters                                        | `WorkflowInternalToolsModule` |
| Browser automation policy inputs/artifacts                           | `WebAutomationModule`         |
| War-room/refinement collaboration signals                            | `WarRoomModule`               |

The root `WorkflowModule` should remain focused on parser, validation, DAG resolution, persistence, state, event triggers, and lifecycle fanout. If a phase below proposes a new provider, it should first identify the decomposed module that owns it.

### 2.4 Relationship To EPIC-147

EPIC-147 decomposes workflow responsibilities into focused modules. This epic builds on that module map instead of adding new policy code to the root workflow module.

Policy ownership should follow these boundaries:

| Concern in this epic                                                 | Target module boundary        |
| -------------------------------------------------------------------- | ----------------------------- |
| Workflow launch/resume compatibility paths                           | `WorkflowLaunchModule`        |
| Run-facing cleanup, idle tracking, and run operations                | `WorkflowRunOperationsModule` |
| Domain mutation bridges such as `amend_entity` and `invoke_workflow` | `WorkflowSpecialStepsModule`  |
| Agent-facing runtime actions and bridge action schemas               | `WorkflowRuntimeModule`       |
| Failure classification, repair dispatch, and repair completion       | `WorkflowRepairModule`        |
| Internal tool action adapters                                        | `WorkflowInternalToolsModule` |
| Browser automation policy inputs/artifacts                           | `WebAutomationModule`         |
| War-room/refinement collaboration signals                            | `WarRoomModule`               |

The root `WorkflowModule` should remain focused on parser, validation, DAG resolution, persistence, state, event triggers, and lifecycle fanout. If a phase below proposes a new provider, it should first identify the decomposed module that owns it.

---

## 3. Goals

1. Make workflows or workflow-owned policy definitions the single source of truth for kanban process routing.
2. Remove duplicated QA routing from the API.
3. Extract readiness, reroute, and override policy from TypeScript services into declarative lifecycle policy.
4. Move dispatch candidate/target/reroute policy into workflow-driven selection and execution contracts.
5. Move orchestration action approval, denial, execution, and failure routing into a workflow state machine or declarative action policy registry.
6. Move stale/failure recovery decisions into workflows or workflow metadata.
7. Replace hard-coded workflow ID checks with workflow metadata or declarative continuation policies.
8. Preserve API-owned domain invariants: known status values, persistence, authorization, audit, entity validation, capacity safety, and telemetry emission. Superseded: source-to-target status transition graph validation is no longer an API-owned invariant.
9. Add test coverage proving policies can change without TypeScript service edits.
10. Leave existing seeded workflows behaviorally equivalent unless a phase explicitly changes behavior.

---

## 4. Non-Goals

1. Do not remove `WorkItemService.updateStatus()` as the canonical mutation path.
2. Do not allow workflows to bypass `WorkItemService.updateStatus()` or known status validation.
3. Do not introduce custom per-project board columns in this epic.
4. Do not extract the kanban service into a separate deployable service. That is related to EPIC-091 and EPIC-134.
5. Do not rewrite all workflows at once. Migration must happen in small, reversible phases.
6. Do not remove existing REST/API compatibility endpoints until workflow-backed replacements are verified.
7. Do not move database entities out of `apps/api/src/database/entities/`.
8. Do not weaken event ledger or realtime broadcast coverage.
9. Do not make LLM agents responsible for enforcing safety invariants. Agents may recommend or request actions; API validates and persists.

---

## 5. Target Architecture

### 5.1 Policy Boundary

Introduce an explicit distinction between invariants and policies.

API-owned invariants:

| Invariant                                  | Owner                                                  | Reason                                                                |
| ------------------------------------------ | ------------------------------------------------------ | --------------------------------------------------------------------- |
| Known work-item status values              | `WorkItem` entity / domain service                     | Prevents unsupported persisted states.                                |
| Work item existence and project ownership  | API repositories/services                              | Security and data integrity.                                          |
| Authorization and actor provenance         | API services                                           | Trust boundary.                                                       |
| Event ledger and realtime broadcast        | API services                                           | Observability and UI consistency.                                     |
| Capacity hard ceilings                     | API services                                           | Prevents runaway execution.                                           |
| Dependency graph integrity                 | API services                                           | Prevents invalid DAGs and orchestration corruption.                   |
| Workflow run persistence and state updates | Core `WorkflowModule` plus focused workflow submodules | Runtime durability without re-centralizing policy in the root module. |
| Workflow run persistence and state updates | Core `WorkflowModule` plus focused workflow submodules | Runtime durability without re-centralizing policy in the root module. |

Workflow-owned policies:

| Policy                                | Desired owner                                             | Reason                                                                                                          |
| ------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| QA decision routing                   | Review workflow / lifecycle policy                        | Review behavior should be configurable and visible.                                                             |
| Rejection feedback persistence shape  | Review workflow / domain action contract                  | Feedback belongs to review process.                                                                             |
| Readiness gate criteria               | Refinement/dispatch lifecycle policy                      | Gate behavior evolves with workflow design.                                                                     |
| Reroute targets and reason codes      | Workflow policy                                           | Status target is process-specific.                                                                              |
| Dispatch candidate scope and priority | Dispatch workflow                                         | Scheduling strategy should be configurable.                                                                     |
| Orchestration action approval rules   | Action policy workflow / `WorkflowRuntimeModule` registry | Approval is process/state-machine behavior exposed through runtime actions.                                     |
| Failure compensation                  | Recovery workflows / `WorkflowRepairModule`               | Recovery paths differ by workflow.                                                                              |
| Delegation continuation behavior      | Superseded by EPIC-170 wakeups plus CEO cycle judgment    | Historical target; continuation is now wakeup-only and the CEO cycle decides repeat, pause, block, or complete. |
| Orchestration action approval rules   | Action policy workflow / `WorkflowRuntimeModule` registry | Approval is process/state-machine behavior exposed through runtime actions.                                     |
| Failure compensation                  | Recovery workflows / `WorkflowRepairModule`               | Recovery paths differ by workflow.                                                                              |
| Delegation continuation behavior      | Superseded by EPIC-170 wakeups plus CEO cycle judgment    | Historical target; continuation is now wakeup-only and the CEO cycle decides repeat, pause, block, or complete. |

### 5.2 Workflow Policy Contract

Add a first-class workflow policy layer. This can be implemented as YAML metadata, dedicated policy workflows, or persisted policy definitions. The minimal target contract should support:

```yaml
policy:
  domain: kanban
  lifecycle:
    status: in-review
    terminal_compensation:
      when: workflow_completed_without_status_change
      action:
        type: transition_status
        status: blocked
        reason_code: incomplete_review_workflow

  transitions:
    qa_decision:
      source_status: in-review
      mapping:
        accept: ready-to-merge
        reject: in-progress
      metadata:
        append: qaFeedback
        patch_execution_config_on_reject: true
```

This example is illustrative, not the required final syntax. The implementation should favor the smallest contract that solves the current duplication.

### 5.3 Stable Domain Actions

Workflows should continue to mutate domain state through versioned domain actions, not raw repository writes.

Current bridge:

```yaml
- id: apply_qa_decision
  type: amend_entity
  inputs:
    entity_type: work_item
    action: transition_status
    updates:
      status: ready-to-merge
```

Target constraints:

1. `amend_entity` remains the workflow bridge for domain mutation in the short term.
2. Each action must have a stable input contract and validation tests.
3. Process policy must not be hidden inside `amend_entity`; the handler should execute requested domain actions only.
4. New policy behavior should be visible in YAML/policy definitions, not embedded in special-step handler branches.
5. Special-step handlers live in `WorkflowSpecialStepsModule`; adding policy there is a boundary violation unless the code is only validating or executing a declared domain action.
6. Special-step handlers live in `WorkflowSpecialStepsModule`; adding policy there is a boundary violation unless the code is only validating or executing a declared domain action.

### 5.4 Compatibility Wrappers

Existing API endpoints and bridge actions should become compatibility wrappers around workflow-backed policy decisions.

Example:

1. `POST /work-items/:id/qa-decision` validates request shape and actor permissions.
2. API starts or resumes the review-decision policy path, or calls a workflow policy evaluator.
3. Policy returns requested domain mutations: append feedback, patch execution config, transition status.
4. API applies mutations through canonical services.
5. Response shape remains compatible.

This preserves external consumers while removing duplicated process logic.

---

## 6. Detailed Audit Inventory

### 6.1 Work Item Lifecycle Policy

#### `apps/api/src/project/intelligence/qa-decision-routing.ts`

Manual logic:

1. `resolveQaDecisionTargetStatus()` maps `accept` to `ready-to-merge`.
2. Every non-accept decision defaults to `in-progress`.
3. This exactly duplicates the YAML mapping in `seed/workflows/work-item-in-review-default.workflow.yaml:102-107`.

Migration:

1. Remove this as a source of truth.
2. Replace with workflow policy lookup or call path through the review workflow contract.
3. Keep only DTO-level decision validation in the API.

#### `apps/api/src/project/work-items/work-item-submit-qa.helpers.ts`

Manual logic:

1. Only permits QA decisions while the item is `in-review`.
2. Normalizes missing execution config to `main` and `feature/<workItemId>` on reject.
3. Writes `metadata.qaFeedback`.
4. Writes `executionConfig.rejectionFeedback` and `executionConfig.rejectionCount`.
5. Calls `updateStatus()` with hard-coded provenance and target status.

Migration:

1. Keep `in-review` validation unless lifecycle policy provides equivalent source-status validation.
2. Move target status mapping to workflow policy.
3. Move feedback persistence shape to workflow-owned domain action or policy action list.
4. Keep branch normalization only if still required for legacy rejected items; otherwise move branch defaults to work item creation/refinement.

#### `apps/api/src/project/work-items/work-item-readiness.helpers.ts`

Manual logic:

1. Execution readiness depends on refinement metadata, implementation plan, subtask count, and split state.
2. Refinement exit readiness depends on implementation plan, subtasks, war-room closure, and split state.
3. Auto-reroute target is hard-coded to `refinement`.

Migration:

1. Express readiness conditions as policy inputs consumed by refinement/dispatch workflows.
2. Preserve a read-only helper if useful for compatibility, but stop allowing it to be the process source of truth.
3. Add tests proving readiness criteria can change in policy without service edits.

#### `apps/api/src/project/work-items/work-item-readiness-transition.helpers.ts`

Manual logic:

1. Intercepts transitions into `in-progress`.
2. Bypasses gates when `bypassReadinessGates` is true.
3. Auto-reroutes unready work from `todo` or `backlog` to `refinement` based on setting.
4. Throws `BadRequestException` when gates fail and reroute is disabled.
5. Enforces P0-only readiness override behavior.
6. Requires acknowledgement on repeated overrides.
7. Clears stale phantom split metadata on `blocked -> todo`.

Migration:

1. Move gate/reroute decision to workflow policy.
2. Move override policy to workflow or declarative policy.
3. Keep stale metadata cleanup as compatibility migration logic unless split state is fully owned by workflows.
4. Keep API enforcement for explicit manual override authorization.

#### `apps/api/src/project/work-items/work-item-run-status.listener.ts`

Manual logic:

1. Hard-codes `kanban.ticket.in_review` as the review trigger.
2. If an in-review workflow completes or fails and the item is still `in-review`, forces `blocked` with `suppressAutomation` and reason `incomplete_review_workflow`.

Migration:

1. Move compensation behavior into review workflow metadata or a workflow terminal compensation policy.
2. Keep listener only as generic terminal event fanout and realtime broadcaster.
3. Policy should define whether terminal-without-decision blocks, retries, escalates, or asks for input.

#### `apps/api/src/project/work-items/work-item-restart.helpers.ts`

Manual logic:

1. Restart is allowed from a fixed set of statuses.
2. Restart triggers same-status automation.
3. Restart updates `currentExecutionId` from the new run.

Migration:

1. Make restart eligibility policy-driven by status/workflow metadata.
2. Keep hard API prevention for unsafe restart mutations unless policy explicitly authorizes the action first.
3. Preserve run-link persistence in API.

#### `apps/api/src/project/work-items/work-item-transition-provenance.helpers.ts`

Manual logic:

1. `in-progress -> blocked` requires a transition reason unless `systemForced`.
2. Default blocked reason codes are derived from origin: `incomplete_review_workflow`, `qa_rejection_threshold`, `needs_rework_escalation`, `manual_block`.

Migration:

1. Keep reason-required invariant.
2. Move default reason taxonomy to workflow policy metadata.
3. Require workflows to pass explicit reason codes for process transitions.

#### `apps/api/src/project/work-items/work-item-hydration-transition-policy.helpers.ts`

Manual logic:

1. Pending-review imported items can fast-track `in-review -> done`.
2. Automation is suppressed for specific pending-review hydration cases.

Migration:

1. Keep until import/hydration lifecycle is workflow-owned.
2. Later convert to import workflow policy.

### 6.2 Dispatch Policy

#### `apps/api/src/project/orchestration/project-orchestration-dispatch.execution.ts`

Manual logic:

1. Reads max active project capacity and agent capacity.
2. Reads preflight settings.
3. Determines target status as `refinement` or `in-progress`.
4. Evaluates execution readiness.
5. Emits hard-coded reroute reasons like `preflight_required`, `dispatch_blocked_materialization_gap`, and `split_pending`.
6. Mutates selected work items to target statuses.

Migration:

1. Keep capacity ceilings and assignment safety in API.
2. Move candidate target status, readiness gate, reroute target, blocker reason, and transition reason to workflow/policy.
3. Make `kanban.dispatch_selected_work_items` execute a workflow-defined plan rather than embedding the plan in this helper.

#### `apps/api/src/project/work-item-dispatch/work-item-dispatch-reconcile.service.ts`

Manual logic:

1. Active statuses are hard-coded as `in-progress`, `in-review`, and `ready-to-merge`.
2. Candidates are hard-coded to `todo`.
3. Skip reasons are hard-coded.
4. Deferred reconcile delay is hard-coded to 30 seconds.
5. Emits `WorkItemDispatchSelectEvent` with prefiltered candidates.

Migration:

1. Move active/candidate status sets into dispatch workflow metadata.
2. Move skip reason taxonomy into policy definitions.
3. Keep dependency graph validation and capacity snapshot building in API.
4. Allow the dispatch workflow to inspect richer candidate state when needed.

#### `apps/api/src/project/work-item-dispatch/work-item-dispatch-polling.consumer.ts`

Manual logic:

1. Polls `orchestrating` and `failed` project orchestrations.
2. Uses fixed active statuses and todo statuses.
3. Uses fixed minimum cycle request cooldown.
4. Emits CEO cycles for stale orchestration or dispatch opportunity.
5. Uses `dispatch_poll` source and fixed reason formats.

Migration:

1. Superseded by EPIC-170: replace scheduler-owned trigger policy with domain-event wakeups that launch `project_orchestration_cycle_ceo`.
2. Keep queue mechanics and duplicate job prevention in API.
3. Make stale threshold behavior policy-owned rather than service-owned.

#### `apps/api/src/project/work-item-dispatch/work-item-dispatch-polling.recovery.ts`

Manual logic:

1. Failed orchestration can auto-recover to `orchestrating`.
2. Recovery emits a cycle after cooldown.
3. Recovery is controlled by hard-coded setting keys.

Migration:

1. Move failed orchestration recovery to a recovery workflow.
2. Keep setting reads only as policy inputs.
3. The workflow should decide whether to retry, pause, fail permanently, or request human approval.

#### `apps/api/src/project/work-items/work-item-scheduling-graph.helpers.ts`

Manual logic:

1. Dispatch eligibility requires all dependencies to be `done`.
2. Dispatch eligibility requires current status `todo`.

Migration:

1. Keep dependency graph integrity checks in API.
2. Move eligible status set and dependency-ready criteria to dispatch policy when customizable scheduling is needed.

### 6.3 Orchestration Action And Lifecycle Policy

#### `apps/api/src/project/orchestration/project-orchestration-mutating-action.execution.ts`

Manual logic:

1. `DIRECT_EXECUTORS` maps action names to fixed TypeScript handlers.
2. Goal mutations are specially acknowledged.
3. Unknown non-goal actions call `complete()`.
4. `update_kanban` normalizes status and calls the API update path.

Migration:

1. Replace action router with workflow/action registry metadata.
2. Remove unknown-action-completes behavior.
3. Define action schemas and result schemas declaratively.

#### `apps/api/src/project/orchestration/project-orchestration-mutating-action.operations.ts`

Manual logic:

1. Resolves orchestration mode.
2. Resolves dispatch authority.
3. Evaluates allow, deny, or require approval.
4. Creates action request when approval is required.
5. Executes action immediately in autonomous mode.
6. Appends fixed decision log records for each path.
7. Catches errors and records `action_execution_failed`.

Migration:

1. Move this decision tree into an action policy workflow.
2. Keep repository writes and decision-log persistence as domain actions.
3. Make action approval behavior testable from workflow/policy fixtures.

#### `apps/api/src/project/orchestration/project-orchestration-mode-policy.service.ts`

Manual logic:

1. `autonomous` allows direct execution.
2. `supervised` requires approval.
3. Other modes deny.

Migration:

1. Replace with declarative mode policy.
2. Keep this service only as a thin evaluator over data.

#### `apps/api/src/project/work-item-dispatch/work-item-dispatch-authority.service.ts`

Manual logic:

1. Classifies source by inspecting workflow definition IDs.
2. Superseded by EPIC-170: `work_item_todo_dispatch_default` no longer represents an authoritative scheduler dispatch path.
3. `project_orchestration_cycle_ceo` means CEO cycle.
4. Historically denied scheduler/CEO based on configured mode; current authority is the CEO cycle plus guarded runtime execution.

Migration:

1. Add workflow metadata for authority source.
2. Stop parsing YAML text to infer workflow ID/source.
3. Policy should define which authority source can perform which action.

#### `apps/api/src/project/orchestration/project-orchestration-action-request-approval.operations.ts`

Manual logic:

1. Hard-coded request statuses: pending, approved, executed, failed, rejected.
2. `approve_specs` is special-cased to orchestration lifecycle approve/reject.
3. Non-spec approval executes the mutating action immediately.
4. Execution failures mark action request failed and append fixed decision records.

Migration:

1. Convert approval request lifecycle to a workflow state machine.
2. Make `approve_specs` a declared action type with declared continuation.
3. Keep action request entity persistence and uniqueness in API.

#### `apps/api/src/project/orchestration/project-orchestration-lifecycle.operations.ts`

Manual logic:

1. Start initializes or restarts orchestration.
2. Existing work items shortcut start into `orchestrating` and emit a CEO cycle.
3. Approve moves `awaiting_approval -> bootstrapping`.
4. Reject moves back to `initializing` and emits revision requested.
5. Pause/resume/complete are hard-coded status transitions.
6. Resume emits a work item done event and a cycle request.

Migration:

1. Convert project orchestration lifecycle to workflow-state policy.
2. Keep persistence, status validity checks, and completion guardrails in API.
3. Move emitted continuation events into lifecycle workflow definitions.

#### `apps/api/src/project/orchestration/project-orchestration-events.service.ts`

Manual logic:

1. Specs ready always sets `awaiting_approval` and creates an `approve_specs` action request.
2. Bootstrap completed always sets `orchestrating`, emits lifecycle work item done, and requests a CEO cycle.

Migration:

1. Move event-to-transition behavior into orchestration lifecycle workflow.
2. Keep event listeners as generic dispatchers into workflow/event policy.

#### `apps/api/src/project/orchestration/project-orchestration-workflow-status.operations.ts`

Manual logic:

1. Hard-coded trigger sources identify orchestration workflow runs.
2. Running status links `currentWorkflowRunId`.
3. Completed clears current run and self-heals undispatched work items.
4. Cancelled clears current run.
5. Failed marks orchestration failed, appends decision, and may auto-restart.

Migration:

1. Keep run-link persistence in API.
2. Move terminal status reaction policy into orchestration workflow metadata.
3. Move self-heal and auto-restart decisions into recovery workflows.

### 6.4 Telemetry Bridge And Agent-Facing Actions

After EPIC-147, workflow runtime capabilities live under `WorkflowRuntimeModule`. Bridge action registration and schemas should be owned there, while telemetry remains websocket transport and context validation.

#### `apps/api/src/telemetry/telemetry-interaction.gateway.ts`

Manual logic:

1. Hard-coded bridge action decorators for selected dispatch, `update_kanban`, `update_project_strategy`, `invoke_agent_workflow`, and `complete_orchestration`.
2. Hard-coded result event names.
3. Hard-coded warning messages for missing services.

Migration:

1. Introduce workflow-declared bridge action registry.
2. Register action name, input schema, result schema, handler domain action, and permissions from workflow/capability metadata.
3. Place runtime-facing registry/evaluator code in `WorkflowRuntimeModule`, not the root workflow module or telemetry gateway.
4. Keep gateway as transport only.

#### `apps/api/src/telemetry/telemetry-gateway-orchestration.handlers.ts`

Manual logic:

1. Requires agent run context.
2. Routes fixed actions through `handleProcessMutatingActionCompat`.
3. Emits fixed result payloads.

Migration:

1. Keep agent-run-context validation.
2. Replace fixed action union and result mapping with registry lookup.
3. Let action schema determine result payload shape.

### 6.5 Workflow Special-Step And Recovery Glue

#### `apps/api/src/workflow/workflow-special-steps/step-amend-entity-special-step.handler.ts`

Manual logic:

1. Hard-coded entity types: `work_item`, `work_item_subtask`, `execution`.
2. Hard-coded action sets for each entity.
3. Requires trigger context shape.
4. Resolves execution run from `currentExecutionId`.

Migration:

1. Keep as a versioned domain operation bridge.
2. Document and test each action contract.
3. Do not add process-specific branching to this handler.
4. Consider splitting action handlers by domain only after policy migration stabilizes.
5. Keep ownership inside `WorkflowSpecialStepsModule`; policy decisions should be passed in as declared action inputs.

#### `apps/api/src/workflow/workflow-special-steps/step-invoke-workflow-special-step.handler.ts`

Manual logic:

1. Resolves workflow identifiers by DB ID, name, or YAML `workflow_id`.
2. Starts child workflow with parent run and step context.
3. Waits by default unless `wait_for_completion: false`.

Migration:

1. Keep as core workflow primitive.
2. Add metadata support so child workflow invocation can declare continuation behavior rather than requiring listeners keyed by IDs.
3. Keep invocation mechanics in `WorkflowSpecialStepsModule`; continuation policy belongs to workflow metadata and generic listeners.

#### `apps/api/src/project/orchestration/orchestration-delegation-completion.listener.ts`

Manual logic:

1. Hard-coded delegation workflow IDs trigger CEO cycle continuation.
2. Emits `delegation_completion` source and fixed reason.

Migration:

1. Superseded by EPIC-170: emit wakeups and let `project_orchestration_cycle_ceo` decide continuation strategy.
2. Listener should evaluate generic completion policies instead of workflow ID sets.

#### `apps/api/src/workflow/workflow-repair/workflow-failure-doctor-completion.listener.ts`

Manual logic:

1. Hard-coded `workflow_failure_doctor` workflow ID.
2. Hard-coded `diagnose_failure` job ID.
3. Retries original failed job when doctor output says `fixable`.

Migration:

1. Move doctor completion behavior into repair policy metadata.
2. Keep retry service as primitive.
3. Support multiple doctor/repair workflows without listener code changes.
4. Keep repair-specific listeners and policy evaluation in `WorkflowRepairModule`.

---

## 7. Implementation Plan

Each phase should be independently shippable. Each commit should leave the API buildable and the relevant tests passing.

### Phase 1: Define Policy Boundary And Test Harness

Scope:

1. Add a short architecture document or ADR defining API invariants vs workflow-owned policy.
2. Add tests around current behavior before extraction.
3. Add fixtures for workflow policy evaluation without launching full agent runs.

Implementation tasks:

1. Create `apps/api/src/project/work-items/work-item-lifecycle-policy.types.ts` or equivalent shared contract.
2. Define canonical policy concepts: source status, target status, reason code, action list, compensation action, guard outcome.
3. Add test fixtures for QA decision, readiness decision, dispatch target decision, and terminal compensation.
4. Add regression tests for current seeded workflow dry-run behavior.
5. Document the target module boundary for each policy evaluator before adding providers, using EPIC-147's decomposed module map.

Acceptance criteria:

1. The codebase documents what must stay API-owned.
2. Current QA, readiness, dispatch, and review compensation behavior is captured by tests.
3. Tests can evaluate policy fixtures without starting real LLM agents.
4. Policy test harnesses do not require importing the full root `WorkflowModule` unless they are explicitly testing core workflow behavior.
5. No behavior changes are introduced in this phase.

### Phase 2: Consolidate QA Decision Routing

Scope:

1. Remove duplicated QA decision target mapping from API as a source of truth.
2. Keep the external QA decision API compatible.
3. Make workflow policy/YAML the source of accept/reject status mapping.

Implementation tasks:

1. Replace `resolveQaDecisionTargetStatus()` with a workflow policy lookup or compatibility call into the review policy contract.
2. Update `submitQaDecisionWithMetadata()` so it delegates mapping and action construction to policy.
3. Ensure `work-item-in-review-default.workflow.yaml` remains the canonical default mapping.
4. Add tests proving changing the mapping fixture changes API behavior without editing `qa-decision-routing.ts`.
5. Decide whether rejection count remains an API compatibility field or becomes a workflow action output.

Acceptance criteria:

1. `accept -> ready-to-merge` and `reject -> in-progress` still work with default workflows.
2. The mapping is not duplicated in a standalone TypeScript function.
3. QA feedback and failed deliverables are still recorded.
4. Existing API clients can still submit QA decisions.
5. Seed workflow dry-run tests pass.

### Phase 3: Extract Readiness And Reroute Policy

Scope:

1. Move execution readiness and refinement exit decisions out of hard-coded service helpers.
2. Keep API mutation safety and known-status validation.
3. Preserve default behavior for existing seeded workflows.

Implementation tasks:

1. Introduce a declarative readiness policy format or policy workflow job.
2. Express default execution readiness conditions: refinement cleared, implementation plan exists, at least one subtask exists, split is not pending.
3. Express default refinement exit conditions: implementation plan exists, subtasks exist, war room closed, split is not pending.
4. Express default reroute: unready start intent routes to `refinement` when auto-reroute is enabled.
5. Express default override policy: P0-only, acknowledgement required after first override.
6. Refactor `applyReadinessTransitionGuards()` into a thin policy evaluator call plus invariant checks.
7. Keep phantom split cleanup as a compatibility path or move it to a one-time migration workflow.

Acceptance criteria:

1. Default readiness behavior is unchanged.
2. Readiness reasons and reroute target are policy data, not embedded process branches.
3. Tests can modify readiness policy and observe changed routing without service edits.
4. Unsupported direct status values are still rejected by the API.
5. Manual bypass/override behavior remains auditable.

### Phase 4: Make Dispatch Policy Workflow-Driven

Scope:

1. Move dispatch candidate status sets, active status sets, target status, reroute reasons, and blocker reasons into workflow policy.
2. Keep capacity ceilings and dependency graph validation API-owned.
3. Let the dispatch workflow own more of the selection and execution plan.

Implementation tasks:

1. Add dispatch policy metadata to `work_item_todo_dispatch_default` or a new dispatch policy definition.
2. Replace hard-coded `ACTIVE_STATUSES`, `TODO_WORK_ITEM_STATUSES`, and dispatch active status arrays with policy-derived values.
3. Replace hard-coded target status logic in `determineTargetStatus()` with policy evaluation.
4. Replace hard-coded reroute/blocker reason strings with policy outputs.
5. Update `kanban.dispatch_selected_work_items` action handling so workflows can pass an explicit dispatch plan containing target status, assignments, and reason codes.
6. Add validation to ensure dispatch plans cannot exceed capacity or request unsupported status values.

Acceptance criteria:

1. Dispatch still starts eligible todo work when capacity is available.
2. Existing preflight/refinement behavior remains intact by default.
3. Candidate and active statuses are policy-derived.
4. Dispatch plan validation rejects over-capacity plans and unsupported status values.
5. Dispatch selection workflow can be changed without modifying `project-orchestration-dispatch.execution.ts`.

### Phase 5: Convert Orchestration Action Approval To Workflow Policy

Scope:

1. Replace hard-coded mutating action routing with declarative action definitions.
2. Move allow/deny/require-approval behavior into policy.
3. Preserve current action request persistence and UI compatibility.

Implementation tasks:

1. Define action registry metadata for `update_kanban`, `kanban.dispatch_selected_work_items`, `invoke_agent_workflow`, `update_project_strategy`, `complete_orchestration`, and goal mutations.
2. Add schemas for action inputs and result payloads.
3. Convert `ProjectOrchestrationModePolicyService` into a data-backed evaluator.
4. Convert `processMutatingAction()` into a thin orchestrator over policy outcomes.
5. Convert approval and rejection behavior into a workflow state machine or policy transition table.
6. Remove unknown-action-completes behavior.

Acceptance criteria:

1. Existing bridge actions still work.
2. Supervised mode still queues action requests.
3. Autonomous mode still executes allowed actions.
4. Recommendation/deny mode still denies mutations.
5. Unknown actions fail safely and never complete orchestration.
6. Adding a new action does not require editing the central router.

### Phase 6: Convert Project Orchestration Lifecycle To Workflow Policy

Scope:

1. Move project orchestration lifecycle transitions into workflow-owned state policy.
2. Keep completion guardrails, persistence, and event emission primitives in API.

Implementation tasks:

1. Define lifecycle states and allowed transitions as policy data.
2. Move specs-ready handling into lifecycle policy.
3. Move bootstrap-completed handling into lifecycle policy.
4. Move approve/reject/pause/resume continuation behavior into policy.
5. Keep `ProjectOrchestrationRepository` updates centralized.
6. Add tests for each lifecycle event-to-transition mapping.

Acceptance criteria:

1. Start, restart, approve, reject, pause, resume, and complete behavior remains compatible.
2. Lifecycle event-to-transition rules are visible in workflow/policy definitions.
3. Specs approval behavior no longer requires a hard-coded `approve_specs` branch.
4. Resume and bootstrap continuations are declared rather than embedded in service code.

### Phase 7: Move Failure And Recovery Policies To Workflows

Scope:

1. Move incomplete-review compensation.
2. Move stale orchestration cycle triggering.
3. Move failed orchestration recovery.
4. Move failure doctor and sysadmin repair continuation behavior.

Implementation tasks:

1. Add terminal compensation metadata for review workflows.
2. Add recovery workflow for failed orchestration cycles.
3. Superseded by EPIC-170: use stale-cycle wakeups to the CEO cycle instead of scheduler policy.
4. Superseded by EPIC-170: replace hard-coded delegation workflow ID sets with wakeups; the CEO cycle decides follow-up action.
5. Replace hard-coded doctor workflow/job IDs with repair policy metadata.
6. Keep retry, steering, and event emission as API primitives.
7. Keep repair policy evaluators and repair completion listeners in `WorkflowRepairModule`.

Acceptance criteria:

1. Review workflows that end without QA decision still block or recover according to default policy.
2. Failed orchestration recovery behavior is workflow-defined.
3. Delegation completion can trigger continuation without listener code knowing specific workflow IDs.
4. Failure doctor completion can retry failed jobs without hard-coded workflow/job IDs.
5. Recovery policies are covered by unit tests and at least one integration-style workflow dry run.

### Phase 8: Define Current Execution Cleanup Semantics

Scope:

1. Fix unclear `currentExecutionId` lifecycle.
2. Decide when terminal workflow runs should clear active execution references.
3. Avoid stale execution pointers on work items.

Implementation tasks:

1. Define semantics for parent runs, child runs, same-status restarts, terminal failures, cancelled runs, ready-to-merge, and done.
2. Use the existing domain port cleanup capability where appropriate.
3. Update `WorkItemRunStatusListener` or equivalent generic listener to apply cleanup policy.
4. Ensure workflows can opt out when a terminal child run should not clear the parent work item execution.

Acceptance criteria:

1. Terminal implementation/review/merge runs do not leave stale `currentExecutionId` unless policy says they should.
2. UI execution status remains correct after completion, failure, and cancellation.
3. Restart behavior still links the new run.
4. Tests cover completed, failed, cancelled, and child workflow cases.

### Phase 9: Replace Hard-Coded Bridge Action Registration

Scope:

1. Move agent-facing bridge action definitions out of decorators and fixed handler unions.
2. Keep websocket transport and agent run context validation in telemetry.

Implementation tasks:

1. Create bridge action registry fed by workflow/capability metadata.
2. Define action input and output schemas.
3. Convert gateway handlers to registry lookup plus generic result emission.
4. Keep backwards-compatible event names during migration.
5. Add tests for missing service, invalid action, invalid payload, and successful action.
6. Own runtime action definitions in `WorkflowRuntimeModule`; telemetry should not become the policy registry.

Acceptance criteria:

1. Existing runner actions continue to work.
2. New bridge actions can be registered without editing `TelemetryInteractionGateway`.
3. Invalid actions fail with clear error events.
4. Result payloads are schema-driven.

---

## 8. Test Strategy

### 8.1 Unit Tests

Add focused tests for:

1. QA decision policy mapping.
2. QA feedback action construction.
3. Readiness policy evaluation.
4. Reroute policy evaluation.
5. Dispatch policy active/candidate status resolution.
6. Dispatch plan validation against capacity.
7. Orchestration mode policy evaluation from data.
8. Action registry lookup and unknown action failure.
9. Lifecycle event-to-transition policy.
10. Terminal compensation policy.
11. Current execution cleanup policy.

### 8.2 Workflow Dry-Run Tests

Extend `apps/api/src/workflow/testing/seed-workflows.dry-run.spec.ts` to cover:

1. Review accept still routes to `ready-to-merge`.
2. Review reject still routes to `in-progress` and records failed deliverables.
3. In-progress repeated failure still escalates to blocked.
4. Refinement still materializes subtasks and transitions to todo.
5. Dispatch workflow can select and start candidates through the policy path.
6. Ready-to-merge workflow still transitions clean/conflict success to done.

### 8.3 Integration Tests

Add integration-style tests with mocked workflow engine/runner for:

1. External QA decision API wrapper.
2. Work item status update into in-progress with readiness policy.
3. Dispatch reconcile to selection event to dispatch action to status update.
4. Supervised action request approval through policy.
5. Failed review workflow terminal compensation.
6. Stale orchestration recovery policy.

### 8.4 Regression Tests

Preserve tests for API invariants:

1. Unsupported status values are rejected.
2. `in-progress -> blocked` without reason is rejected unless system-forced.
3. Cross-project work item mutation is rejected.
4. Capacity limits cannot be bypassed by workflow dispatch plan.
5. Dependency graph errors remain blocked.
6. Event ledger entries are emitted on success and failure.

---

## 9. Data And Contract Changes

### 9.1 Likely New Contracts

The exact shape should be refined during Phase 1, but expected contracts include the following. Contract placement should follow EPIC-147 module boundaries rather than creating a new grab-bag under the root workflow directory.

1. `KanbanLifecyclePolicy`
2. `WorkItemTransitionPolicyAction`
3. `WorkItemReadinessPolicy`
4. `DispatchPolicy`
5. `OrchestrationActionDefinition`
6. `OrchestrationModePolicy`
7. `WorkflowTerminalCompensationPolicy`
8. `WorkflowContinuationPolicy`
9. `CurrentExecutionCleanupPolicy`

Initial placement guidance:

1. Work-item lifecycle and readiness policy contracts should live with `project/work-items` unless they are reusable workflow metadata contracts.
2. Special-step action contracts should live in `workflow/workflow-special-steps`.
3. Runtime bridge action contracts should live in `workflow/workflow-runtime`.
4. Repair and continuation contracts should live in `workflow/workflow-repair` unless they are generic workflow metadata.
5. Shared workflow metadata types should live in the smallest existing workflow submodule that consumes them, only moving to core workflow when multiple submodules need the same contract.

### 9.2 Database Changes

Prefer no database schema changes for the first migration slice. Start with policy metadata embedded in workflow YAML or seed definitions.

Potential later schema changes:

1. `workflow_policy_definitions` table if policy should be editable independently of workflow YAML.
2. `workflow_metadata` JSONB column if existing workflow rows need parsed metadata.
3. `orchestration_action_definitions` table if action definitions need runtime admin UI.

These should be deferred until the YAML/seed approach proves the contract.

### 9.3 API Contract Changes

No external contract breaks are allowed in the default migration path.

Compatibility wrappers must preserve:

1. Existing QA decision endpoint behavior.
2. Existing websocket bridge action names.
3. Existing result event names where clients depend on them.
4. Existing work item status update DTOs.
5. Existing event ledger domains and core event names.

---

## 10. Observability Requirements

Every policy-driven decision must be observable.

Required event ledger payload fields:

1. `policyId` or workflow definition ID.
2. `policyVersion` or workflow row version when available.
3. `decisionType` such as `qa_route`, `readiness_gate`, `dispatch_plan`, `terminal_compensation`.
4. `inputSummary` with non-sensitive identifiers and statuses.
5. `outcome` such as `allowed`, `denied`, `rerouted`, `queued`, `executed`, `compensated`.
6. `reasonCode` and `reason`.
7. `requestedMutations` for transition/action plans.
8. `appliedMutations` after API validation.

Debuggability requirements:

1. A developer can answer why an item moved to `refinement` from event logs.
2. A developer can answer why dispatch skipped a candidate.
3. A developer can answer why an action was queued for approval.
4. A developer can answer why an orchestration cycle restarted.
5. A developer can see which workflow/policy definition made the decision.

---

## 11. Migration Risks

### 11.1 Risk: Policy Moves But API Side Effects Remain Coupled

If process decisions move to workflows but `updateStatus()` still triggers hidden automation branches, behavior remains confusing.

Mitigation:

1. Keep `updateStatus()` focused on validation, persistence, eventing, and automation trigger fanout.
2. Remove or isolate process branches phase by phase.
3. Add tests that fail when hard-coded routing remains duplicated.

### 11.2 Risk: Workflow Policy Can Request Unsafe Mutations

Workflows may request unsupported status values, over-capacity dispatch, or cross-project mutations.

Mitigation:

1. API validates every mutation through existing domain services.
2. Dispatch plan validation enforces capacity ceilings.
3. Policy test fixtures include invalid mutation cases.

### 11.3 Risk: Configuration Drift Between YAML And TypeScript

If TypeScript retains fallback policy, defaults may diverge from YAML.

Mitigation:

1. Keep one default source per behavior.
2. Generate or load defaults from workflow policy definitions.
3. Add tests that compare API compatibility paths against seeded workflows.

### 11.4 Risk: Too Much Abstraction Too Soon

Building a full rules engine before migrating concrete cases could slow delivery.

Mitigation:

1. Start with QA routing because workflow YAML already owns it.
2. Extract minimal contracts from real cases.
3. Do not add DB-backed policy tables until YAML metadata is insufficient.

### 11.5 Risk: Legacy API Consumers Depend On Current Behavior

External clients may call QA decision or bridge actions directly.

Mitigation:

1. Keep compatibility wrappers.
2. Preserve response shapes.
3. Emit deprecation telemetry before removing legacy paths.
4. Do not remove endpoints in this epic unless all clients are migrated.

### 11.6 Risk: Long-Running Workflow State Gets Stale

Policy decisions based on trigger payload may be stale by the time a workflow applies mutations.

Mitigation:

1. Re-read current entity state before applying domain mutations.
2. Include source status preconditions in policy actions.
3. Fail safely when source state changed unexpectedly.

---

## 12. Rollout Plan

### 12.1 Feature Flags

Use feature flags or system settings during migration:

1. `workflow_policy_qa_decision_enabled`
2. `workflow_policy_readiness_enabled`
3. `workflow_policy_dispatch_enabled`
4. `workflow_policy_orchestration_actions_enabled`
5. `workflow_policy_failure_recovery_enabled`

Default each flag to false until the corresponding phase is verified. Remove flags after stable rollout.

### 12.2 Compatibility Mode

For each migrated policy:

1. Run old and new policy in shadow mode where practical.
2. Emit comparison telemetry.
3. Switch to policy-driven execution only after parity is proven.
4. Keep rollback path for one release cycle.

### 12.3 Rollback

Rollback must be possible per phase:

1. QA routing can fall back to existing mapping temporarily.
2. Readiness policy can fall back to existing helper temporarily.
3. Dispatch policy can fall back to existing status sets and target logic temporarily.
4. Orchestration action policy can fall back to existing action router temporarily.
5. Recovery policy can fall back to existing listeners temporarily.

Rollback paths should be removed after the migration is stable to avoid permanent dual sources of truth.

---

## 13. Definition Of Done

This epic is complete when:

1. QA decision routing has exactly one source of truth, owned by workflow/policy.
2. Readiness/reroute behavior is policy-driven by default.
3. Dispatch candidate/target/reroute policy is workflow-driven by default.
4. Orchestration action allow/deny/approval behavior is policy-driven by default.
5. Project orchestration lifecycle event-to-transition behavior is workflow/policy-driven by default.
6. Failure/recovery continuation behavior is workflow/policy-driven by default.
7. Hard-coded workflow ID listeners are replaced by workflow metadata or generic policy evaluation.
8. Bridge action registration is registry-driven rather than hard-coded in the websocket gateway.
9. API still rejects unsupported status values and unsafe mutations.
10. Existing seeded workflow behavior is preserved unless explicitly changed in a documented migration note.
11. Tests cover policy defaults, policy overrides, compatibility wrappers, and invariant failures.
12. Event ledger exposes enough policy-decision context to debug lifecycle behavior.

---

## 14. Acceptance Criteria By Capability

### QA Decision

1. Given a review workflow outputs `accept`, the work item transitions to `ready-to-merge` using workflow/policy mapping.
2. Given a review workflow outputs `reject`, the work item transitions to `in-progress` using workflow/policy mapping.
3. Given the mapping is changed in policy, tests observe the changed status without modifying routing service code.
4. QA feedback history remains intact.
5. Rejection failed deliverables remain available to the next implementation run.

### Readiness

1. Unrefined work still routes to refinement by default.
2. Missing implementation plan still blocks or reroutes according to default policy.
3. Missing subtasks still blocks or reroutes according to default policy.
4. Split-pending work is not dispatched into implementation.
5. P0 override behavior remains auditable.

### Dispatch

1. Dispatch honors project and agent capacity.
2. Dispatch honors dependency readiness.
3. Dispatch target status is policy-derived.
4. Reroute reason codes are policy-derived.
5. Dispatch workflow can choose candidates without TypeScript service changes.

### Orchestration Actions

1. Autonomous mode executes allowed actions.
2. Supervised mode queues action requests.
3. Recommendation/deny mode denies direct mutations.
4. Dispatch authority is metadata/policy-driven.
5. Unknown actions fail safely.

### Failure Recovery

1. Incomplete review workflow compensation is policy-driven.
2. Stale orchestration cycle behavior is policy-driven.
3. Failed orchestration recovery behavior is policy-driven.
4. Failure doctor and sysadmin repair continuation behavior is metadata-driven.

### API Invariants

1. Unsupported status values remain rejected.
2. Cross-project mutations remain rejected.
3. Missing required transition reasons remain rejected where required.
4. Event ledger records success and failure outcomes.
5. Realtime work item updates continue to broadcast.

---

## 15. Files Most Likely To Change

Work item lifecycle:

1. `apps/api/src/project/intelligence/qa-decision-routing.ts`
2. `apps/api/src/project/work-items/work-item-submit-qa.helpers.ts`
3. `apps/api/src/project/work-items/work-item-readiness.helpers.ts`
4. `apps/api/src/project/work-items/work-item-readiness-transition.helpers.ts`
5. `apps/api/src/project/work-items/work-item-run-status.listener.ts`
6. `apps/api/src/project/work-items/work-item-restart.helpers.ts`
7. `apps/api/src/project/work-items/work-item-transition-provenance.helpers.ts`
8. `apps/api/src/project/work-items/work-item-service-mutations.helpers.ts`

Dispatch:

1. `apps/api/src/project/orchestration/project-orchestration-dispatch.execution.ts`
2. `apps/api/src/project/orchestration/project-orchestration-dispatch.service.ts`
3. `apps/api/src/project/work-item-dispatch/work-item-dispatch-reconcile.service.ts`
4. `apps/api/src/project/work-item-dispatch/work-item-dispatch-polling.consumer.ts`
5. `apps/api/src/project/work-item-dispatch/work-item-dispatch-polling.recovery.ts`
6. `apps/api/src/project/work-item-dispatch/work-item-dispatch-authority.service.ts`
7. `apps/api/src/project/work-items/work-item-scheduling-graph.helpers.ts`

Orchestration lifecycle and actions:

1. `apps/api/src/project/orchestration/project-orchestration-mutating-action.execution.ts`
2. `apps/api/src/project/orchestration/project-orchestration-mutating-action.operations.ts`
3. `apps/api/src/project/orchestration/project-orchestration-mode-policy.service.ts`
4. `apps/api/src/project/orchestration/project-orchestration-action-request-approval.operations.ts`
5. `apps/api/src/project/orchestration/project-orchestration-lifecycle.operations.ts`
6. `apps/api/src/project/orchestration/project-orchestration-events.service.ts`
7. `apps/api/src/project/orchestration/project-orchestration-workflow-status.operations.ts`
8. `apps/api/src/project/orchestration/orchestration-delegation-completion.listener.ts`

Telemetry and workflow bridge:

1. `apps/api/src/telemetry/telemetry-interaction.gateway.ts`
2. `apps/api/src/telemetry/telemetry-gateway-orchestration.handlers.ts`
3. `apps/api/src/workflow/workflow-special-steps/step-amend-entity-special-step.handler.ts`
4. `apps/api/src/project/amend-entity.service.helpers.ts`
5. `apps/api/src/workflow/workflow-special-steps/step-invoke-workflow-special-step.handler.ts`
6. `apps/api/src/workflow/workflow-runtime/workflow-runtime-orchestration-actions.service.ts`
7. `apps/api/src/workflow/workflow-runtime/workflow-runtime-capability.contracts.ts`
8. `apps/api/src/workflow/workflow-repair/workflow-failure-doctor-completion.listener.ts`
9. `apps/api/src/workflow/workflow-special-steps/workflow-special-steps.module.ts`
10. `apps/api/src/workflow/workflow-runtime/workflow-runtime.module.ts`
11. `apps/api/src/workflow/workflow-repair/workflow-repair.module.ts`

Seed workflows:

1. `seed/workflows/work-item-in-review-default.workflow.yaml`
2. `seed/workflows/work-item-in-progress-default.workflow.yaml`
3. `seed/workflows/work-item-refinement-default.workflow.yaml`
4. `seed/workflows/work-item-ready-to-merge-default.workflow.yaml`
5. `seed/workflows/work-item-todo-dispatch-default.workflow.yaml`
6. `seed/workflows/project-orchestration-cycle-ceo.workflow.yaml`
7. `seed/workflows/orchestration-invoke-agent-default.workflow.yaml`
8. `seed/workflows/workflow-failure-doctor.workflow.yaml`
9. `seed/workflows/workflow-environment-repair.workflow.yaml`

---

## 16. Open Questions

1. Should policy definitions live inside workflow YAML, separate YAML files, or database rows?
2. Should the first implementation use shadow-mode comparison before switching each policy?
3. Should `submitQaDecision` remain a public API long term, or become an internal compatibility wrapper only?
4. Should readiness policy be deterministic only, or can it invoke an agent for ambiguous cases?
5. Should dispatch policy allow non-`todo` statuses as candidates in future?
6. Should action approval workflow be project-specific or global?
7. Should bridge action schemas be derived from workflow metadata, internal tool metadata, or both?
8. What is the exact desired `currentExecutionId` cleanup behavior for failed review and failed merge runs?
9. Should failed orchestration recovery remain automatic by default, or require supervised approval?
10. How long should rollback flags remain after each phase ships?

---

## 17. Recommended First Slice

Start with QA decision consolidation.

Why this slice first:

1. It has clear duplication today.
2. The workflow YAML already contains the desired mapping.
3. It is narrow and testable.
4. It creates the first reusable policy contract without touching dispatch or orchestration lifecycle complexity.
5. It immediately validates the architecture boundary: API validates/applies, workflow/policy decides.

First slice deliverables:

1. A minimal lifecycle policy contract for QA decisions.
2. Compatibility wrapper for the existing QA decision API.
3. Removal or demotion of `qa-decision-routing.ts` as source of truth.
4. Tests proving default accept/reject behavior.
5. Tests proving policy can change mapping without editing routing code.
6. Event ledger entry showing the policy decision source.

---

## 18. Future Follow-Ups

Likely follow-up epics after this work:

1. Runtime editable lifecycle policies in the web UI.
2. Per-project kanban lifecycle customization.
3. Custom board columns and transition graphs.
4. Visual workflow/policy debugger for lifecycle decisions.
5. Full kanban service extraction after policy boundaries are clean.
6. Workflow metadata schema versioning and migration tooling.
7. Policy simulation UI for dispatch and readiness decisions.
8. End-to-end event-sourced lifecycle replay.
