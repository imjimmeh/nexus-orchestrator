# Workflow-Driven Kanban Policy Boundary

Status: Accepted

Date: 2026-05-11

## Context

Kanban lifecycle behavior is workflow-driven, but policy ownership spans two services:

1. `apps/kanban` (domain state and orchestration lifecycle)
2. `apps/api` (workflow trigger/execution/runtime/repair)

Previous documentation emphasized workflow module decomposition but did not fully capture the production split between kanban domain services and API workflow infrastructure.

At the same time, process policy has expanded beyond QA routing to include:

- refinement gates and split behavior
- dispatch and cycle decisions
- merge compensation behavior
- restart continuity fields (`isRestart`, `stateSummary`)
- tool approval and mode-aware human decision handling

## Decision

The boundary remains: API and domain services own invariants, workflows own process choices.

### API and domain invariants (must remain code-enforced)

- legal status transitions and transition validation
- authorization and policy enforcement for mutations
- repository persistence and projection integrity
- event emission and trigger registration mechanics
- run linkage persistence (`linked_run_id`) and idempotency key usage
- dependency graph validity and capacity ceilings
- runtime capability governance and approval enforcement

### Workflow-owned process choices

- status-routing policy (review accept/reject targets, refinement exits)
- split decomposition and parent/child orchestration semantics
- dispatch and orchestration-cycle decision policy
- merge conflict compensation strategy
- continuation/retry narratives and escalation heuristics
- restart-context usage in prompts and branching

## Placement Rules

New policy evaluators must be placed behind the narrowest owning boundary:

1. Work-item lifecycle policy belongs in `apps/kanban` work-item/orchestration services unless it becomes reusable workflow metadata.
2. Runtime bridge actions and capability execution schemas belong in `apps/api` `WorkflowRuntimeModule`.
3. Domain mutation execution belongs in `apps/api` `WorkflowSpecialStepsModule`.
4. Failure classification and repair delegation belongs in `apps/api` `WorkflowRepairModule`.
5. Run reconciliation and cleanup policy belongs in `apps/api` `WorkflowRunOperationsModule` and kanban dispatch reconciliation where linkage is owned.
6. Trigger binding and listener registration logic belongs in `apps/api` workflow trigger services, not in workflow YAML or ad-hoc controllers.

## Consequences

1. `WorkItemService.updateStatus()` in `apps/kanban` remains the canonical transition mutation path.
2. Workflow status transitions must call the canonical kanban mutation tools/services, not bypass persistence rules.
3. Compatibility endpoints may delegate to policy evaluators, but must not duplicate workflow mapping logic.
4. Documentation and tests must verify that changing workflow YAML policy can alter routing behavior without central service branch edits.
5. New policy providers should not be added to root `WorkflowModule` unless they are true core engine infrastructure.
6. Orchestration decision flows must preserve linkage contracts (`scopeId`, `contextId`, `linked_run_id`, correlation/idempotency metadata).

## Current Architecture Alignment

This decision is implemented alongside:

- `docs/architecture/ARCH-kanban-workflow.md` (full lifecycle contracts)
- `docs/architecture/workflow-module-decomposition.md` (API workflow module ownership)
- `docs/architecture/tool-permissions-and-approvals.md` (governance boundary)

Together, these documents define where policy is authored, where invariants are enforced, and how orchestration behavior is linked end-to-end.
