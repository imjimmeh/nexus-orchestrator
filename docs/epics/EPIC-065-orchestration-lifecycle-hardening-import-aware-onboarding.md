# EPIC-065: Orchestration Lifecycle Hardening and Import-Aware Onboarding

Status: Proposed  
Priority: P0 (Critical)  
Created: 2026-04-08  
Last Updated: 2026-04-08  
Owner: TBD  
Theme: Reliability, governance, and continuity for semi-autonomous project delivery

---

## 1. Executive Summary

This epic hardens the orchestrator lifecycle so it behaves predictably and safely across three critical scenarios:

1. New project bootstrap and specs approval
2. Ongoing orchestration and dispatch decisions
3. Imported or existing repository onboarding

The platform already has strong event-driven foundations, orchestration mode policy, dispatch/poll/self-heal loops, and skill mounting. However, several high-impact gaps remain:

1. Discovery-to-approval can break due to malformed seed workflow structure.
2. Completion can be marked without robust project outcome validation.
3. Imported repositories are represented in metadata but not treated as first-class orchestration stages.
4. Dispatch authority is split across multiple decision paths.
5. Phase detection and stage semantics are not consistently modeled for governance decisions.
6. Skills are profile-scoped, but not lifecycle-stage-scoped.

This epic introduces a coherent stage model, unified completion guardrails, import-aware bootstrapping, deterministic dispatch authority, and stage-specific orchestration behavior.

---

## 2. Context and Problem Statement

### 2.1 Existing strengths to preserve

1. Dynamic event-trigger workflow registration and execution.
2. Mutating action policy by orchestration mode (autonomous/supervised/notifications_only).
3. Rich work-item lifecycle workflows (refinement -> implementation -> review -> merge -> hydration).
4. Multiple continuity paths for cycle progression (work_item_done, resume, restart, bootstrap_completed, self_heal, dispatch_poll).
5. Runtime skill mounting and prompt augmentation for both main and subagent execution paths.

### 2.2 High-priority reliability and governance gaps

1. Discovery workflow seed appears structurally malformed where emit_specs_ready should be defined.
2. Completion is available through direct controller and runtime mutating action paths, without comprehensive objective-level validation.
3. Import metadata exists, but orchestration lacks explicit stage branching for import/clone/assessment.
4. Dispatch outcomes can be driven by both CEO cycle and selector workflow paths, making authority and auditability less clear.
5. Phase detection has inconsistent pre-artifact branching behavior.
6. Lifecycle execution does not explicitly optimize skill strategy by stage (discovery, decomposition, implementation, review, merge, post-merge).

---

## 3. Goals

1. Guarantee deterministic bootstrap progression from start -> specs-ready -> approval -> work-item generation -> orchestrating.
2. Enforce strict completion guardrails across every completion entrypoint.
3. Add first-class import-aware orchestration stage(s) for existing repositories.
4. Establish a single authoritative dispatch decision model.
5. Make stage semantics explicit and testable across orchestrator services and summaries.
6. Add lifecycle-stage-aware skill strategy to improve quality and reduce repeated wrong-tool usage.
7. Improve operator diagnostics for blocked progress and decision rationale.

---

## 4. Non-Goals

1. Rewriting all existing workflow YAMLs unrelated to orchestration lifecycle.
2. Replacing Kanban lifecycle workflows (refinement/in-progress/in-review/merge) end-to-end.
3. Building a full external skill marketplace.
4. Introducing new LLM providers or model-selection policy changes.

---

## 5. Scope Overview

This epic is split into eight workstreams:

1. WS1: Discovery and approval handoff integrity
2. WS2: Completion guardrails and policy enforcement
3. WS3: Import-aware onboarding stage model
4. WS4: Dispatch authority unification
5. WS5: Stage and phase detection correctness
6. WS6: Mid-flight refinement loop for orchestrating projects
7. WS7: Stage-specific skills strategy
8. WS8: Observability, diagnostics, and operational readiness

---

## 6. Desired End-State Behavior

### 6.1 Bootstrap lifecycle

1. Start orchestration always reaches either awaiting_approval (with approve_specs request) or explicit failed state with actionable reason.
2. Specs-ready emit cannot be silently skipped due to malformed YAML structure.
3. Approval and rejection loops are deterministic and auditable.

### 6.2 Ongoing orchestration

1. There is exactly one authoritative dispatch decision route per cycle.
2. CEO cycle, polling, and self-heal complement one another without conflicting ownership semantics.
3. Decisions always include context and can be traced to workflow runs.

### 6.3 Completion safety

1. Project completion requires objective and lifecycle checks, not only status counts.
2. API and runtime paths share the same completion validator.
3. Rejection reasons are explicit when completion is denied.

### 6.4 Imported repository readiness

1. Existing-repo projects execute an explicit import readiness stage before discovery/decomposition.
2. Repository accessibility, base path, and branch readiness are validated consistently.
3. Orchestrator prompts receive import context automatically.

---

## 7. Workstreams and Detailed Tasks

### WS1: Discovery and Approval Handoff Integrity

Objective: eliminate malformed bootstrap handoff paths and enforce end-to-end discovery transition correctness.

### Task E065-001: Fix discovery seed workflow structure

Description:
Repair the discovery seed YAML so emit_specs_ready is a valid job, not prompt text.

Acceptance Criteria:

1. Discovery seed parses and registers without structural anomalies.
2. A successful discovery run emits ProjectOrchestrationSpecsReadyEvent.
3. Orchestration transitions to awaiting_approval and approve_specs request is created.

References:

1. apps/api/src/database/seeds/project-discovery-ceo.workflow.yaml
2. apps/api/src/project/project-orchestration-events.service.ts
3. apps/api/src/project/project-orchestration-lifecycle.operations.ts

### Task E065-002: Seed workflow integrity tests for orchestration bootstrap chain

Description:
Add tests that assert required emit_event job presence and event names for discovery/spec-revision/work-item-generation workflows.

Acceptance Criteria:

1. Missing or malformed emit steps fail tests.
2. Event names must match expected orchestration event contracts.
3. CI fails when bootstrap chain contracts drift.

References:

1. apps/api/src/database/seeds/project-discovery-ceo.workflow.yaml
2. apps/api/src/database/seeds/project-spec-revision-ceo.workflow.yaml
3. apps/api/src/database/seeds/project-work-item-generation-ceo.workflow.yaml
4. apps/api/src/workflow/workflow-event-trigger.service.ts

### Task E065-003: Startup validation for critical orchestration workflows

Description:
Add a validation pass at startup (or seed command) for critical orchestration workflow IDs and required trigger/events.

Acceptance Criteria:

1. Missing critical workflows are surfaced as startup validation errors with actionable messages.
2. Validation output identifies specific workflow ID and failed invariant.
3. Validation can run in CI as a standalone check.

References:

1. apps/api/src/workflow/workflow-event-trigger.service.ts
2. apps/api/src/workflow/workflow-trigger-registry.service.ts
3. docs/WORKFLOW_EVENT_TRIGGERS.md

---

### WS2: Completion Guardrails and Policy Enforcement

Objective: prevent premature completion and ensure completion is outcome-safe across all entrypoints.

### Task E065-004: Introduce unified completion validator service

Description:
Create a single validator that checks lifecycle, approvals, active work, unresolved blockers, and goals coverage before allowing completion.

Acceptance Criteria:

1. Validator exposes structured pass/fail reasons.
2. Validator checks are deterministic and side-effect free.
3. Validator supports dry-run diagnostics for UI/API surfaces.

References:

1. apps/api/src/project/project-orchestration.service.ts
2. apps/api/src/project/project-brief.service.ts
3. apps/api/src/project/project-phase-detector.service.ts

### Task E065-005: Enforce validator in direct completion endpoint

Description:
Apply completion validator in orchestration controller/service complete path.

Acceptance Criteria:

1. Direct complete rejects when guardrails fail.
2. Response includes structured failure reasons.
3. Existing completion success behavior remains unchanged when checks pass.

References:

1. apps/api/src/project/project-orchestration.controller.ts
2. apps/api/src/project/project-orchestration.service.ts
3. apps/api/src/project/project-orchestration-lifecycle.operations.ts

### Task E065-006: Enforce validator in runtime mutating completion path

Description:
Ensure complete_orchestration runtime action path uses the same validator.

Acceptance Criteria:

1. Runtime completion cannot bypass validator.
2. Decision log captures guardrail denial reasons.
3. Behavior is consistent across autonomous/supervised/notifications_only modes.

References:

1. apps/api/src/tool/capability-manifest.runtime.entries.ts
2. apps/api/src/workflow/workflow-runtime-orchestration-actions.service.ts
3. apps/api/src/project/project-orchestration-mutating-action.execution.ts
4. apps/api/src/project/project-orchestration-mutating-action.operations.ts

### Task E065-007: Add completion readiness diagnostic endpoint payload

Description:
Expose completion readiness in project diagnostics so operators can see exactly what blocks completion.

Acceptance Criteria:

1. Diagnostics include completion_readiness boolean and blocking_reasons array.
2. Blocking reasons map to actionable remediation text.
3. Telemetry captures repeated completion-denied events.

References:

1. apps/api/src/project/project-brief.service.ts
2. apps/api/src/telemetry/telemetry.gateway.ts

---

### WS3: Import-Aware Onboarding Stage Model

Objective: treat imported repositories as first-class orchestration start modes.

### Task E065-008: Define import-aware orchestration states and transitions

Description:
Extend orchestration stage model with explicit import readiness states and transition rules.

Acceptance Criteria:

1. New states are documented and represented in service types.
2. Transition graph prevents invalid state jumps.
3. Existing non-import projects preserve current behavior.

References:

1. apps/api/src/project/project-orchestration.service.types.ts
2. apps/api/src/project/project-orchestration-lifecycle.operations.ts
3. docs/SDD.md

### Task E065-009: Add repository accessibility and path readiness checks

Description:
Validate repository_url/base_path/github_secret_id combinations before orchestration starts for imported projects.

Acceptance Criteria:

1. Invalid import configuration fails fast with explicit error details.
2. Base path and git repository checks are consistent across services.
3. Branch discovery works for both local and remote contexts.

References:

1. apps/api/src/project/project.service.ts
2. apps/api/src/project/project-git-metadata.service.ts
3. apps/api/src/common/git/path/git-path.service.ts
4. apps/api/src/database/entities/project.entity.ts

### Task E065-010: Add import context to orchestration prompts/state summary

Description:
Provide import metadata and readiness summary to CEO discovery/cycle prompts to avoid greenfield assumptions.

Acceptance Criteria:

1. State summary includes import context when repository_url exists.
2. Discovery and cycle workflows consume import context in prompt inputs.
3. Prompt templates explicitly differentiate imported vs greenfield flows.

References:

1. apps/api/src/project/project-state-summary.service.ts
2. apps/api/src/database/seeds/project-discovery-ceo.workflow.yaml
3. apps/api/src/database/seeds/project-orchestration-cycle-ceo.workflow.yaml

### Task E065-011: Add start orchestration options for import strategy

Description:
Extend orchestration start DTO with optional import strategy input (for example: assess_only, assess_and_bootstrap).

Acceptance Criteria:

1. DTO validates and documents import strategy values.
2. Strategy is persisted in orchestration metadata and used by lifecycle operations.
3. Backward compatibility: existing start requests continue to work.

References:

1. apps/api/src/project/dto/start-orchestration.dto.ts
2. apps/api/src/project/project-orchestration-lifecycle.operations.ts

---

### WS4: Dispatch Authority Unification

Objective: remove split-brain dispatch decision ownership and improve auditability.

### Task E065-012: Decide and document canonical dispatch authority model

Description:
Produce ADR-level decision selecting either CEO-only execution authority or scheduler-only execution authority with CEO advisory logging.

Acceptance Criteria:

1. Single documented authority model approved.
2. Deprecated path(s) and fallback controls are explicitly defined.
3. Migration plan from current behavior is included.

References:

1. apps/api/src/database/seeds/project-orchestration-cycle-ceo.workflow.yaml
2. apps/api/src/database/seeds/work-item-todo-dispatch-default.workflow.yaml
3. apps/api/src/project/work-item-dispatch-coordinator.listener.ts
4. apps/api/src/project/work-item-dispatch-polling.consumer.ts

### Task E065-013: Implement authority model in workflow seeds and services

Description:
Update workflow seeds and coordinator/polling integration to enforce selected authority model.

Acceptance Criteria:

1. Exactly one path can execute Kanban-owned selected dispatch (`kanban.dispatch_selected_work_items`) by design. The old API dispatch action name is historical and removed.
2. Non-authoritative path emits advisory/telemetry only.
3. Existing dispatch capacity and dependency checks remain intact.

References:

1. apps/api/src/database/seeds/project-orchestration-cycle-ceo.workflow.yaml
2. apps/api/src/database/seeds/work-item-todo-dispatch-default.workflow.yaml
3. apps/api/src/project/work-item-dispatch-coordinator.listener.ts
4. apps/api/src/project/work-item-dispatch-polling.consumer.ts

### Task E065-014: Decision-log normalization for dispatch outcomes

Description:
Ensure dispatch decisions include authority source markers and correlation IDs across event paths.

Acceptance Criteria:

1. Decision entries indicate authoritative source.
2. Correlation with workflow run ID is preserved.
3. Diagnostics can reconstruct dispatch path without ambiguity.

References:

1. apps/api/src/project/project-orchestration-decision-log.service.ts
2. apps/api/src/project/project-orchestration-workflow-status.operations.ts
3. apps/api/src/project/project-orchestration.service.types.ts

---

### WS5: Stage and Phase Detection Correctness

Objective: make phase/stage semantics reliable for policy and diagnostics.

### Task E065-015: Fix pre-artifact phase detection branching

Description:
Correct duplicate/unreachable branch logic in phase detector.

Acceptance Criteria:

1. New, discovery, specs_ready, work_items_created, in_progress, nearing_completion, and complete phases are mutually coherent.
2. Unit tests cover each branch and threshold behavior.
3. No existing phase consumers regress.

References:

1. apps/api/src/project/project-phase-detector.service.ts
2. apps/api/src/project/project-state-summary.service.ts

### Task E065-016: Add explicit lifecycle stage contract to state summary

Description:
Expand summary outputs with stage rationale and key blockers to reduce ambiguous operator interpretation.

Acceptance Criteria:

1. Summary includes stage_rationale and blocker highlights.
2. Strategy/spec/work-item status are represented consistently.
3. Summary truncation behavior remains bounded and safe.

References:

1. apps/api/src/project/project-state-summary.service.ts

### Task E065-017: Align phase detection with completion validator

Description:
Ensure phase detector and completion validator share consistent semantics for complete/nearing-complete states.

Acceptance Criteria:

1. Complete phase requires validator success conditions.
2. Nearing-completion threshold remains informational unless validator passes.
3. Tests verify no mismatch between phase and completion readiness outputs.

References:

1. apps/api/src/project/project-phase-detector.service.ts
2. apps/api/src/project/project-brief.service.ts

---

### WS6: Mid-Flight Refinement Loop for Orchestrating Projects

Objective: allow safe, explicit re-spec/refinement during orchestration without reusing bootstrap-only workflow targets.

### Task E065-018: Create dedicated mid-flight refinement workflow

Description:
Add a new refinement workflow for orchestrating state that can delegate PM/architect updates without violating bootstrap restrictions.

Acceptance Criteria:

1. Workflow has explicit trigger/event contract.
2. Workflow does not overlap with bootstrap-protected workflow IDs.
3. Output updates strategy/spec context and records decision rationale.

References:

1. apps/api/src/project/project-orchestration-workflow-invocation.helpers.ts
2. apps/api/src/project/project-orchestration-workflow-invocation.service.ts
3. apps/api/src/database/seeds/project-orchestration-cycle-ceo.workflow.yaml

### Task E065-019: Add guarded invoke path for mid-flight refinement

Description:
Permit invoke_agent_workflow during orchestrating only for approved mid-flight refinement target(s).

Acceptance Criteria:

1. Guard rules explicitly allow refinement workflow IDs and deny bootstrap IDs.
2. Errors include valid alternatives when denied.
3. CEO delegation restrictions remain enforced.

References:

1. apps/api/src/project/project-orchestration-workflow-invocation.helpers.ts
2. apps/api/src/project/project-orchestration-workflow-invocation.service.ts

---

### WS7: Stage-Specific Skills Strategy

Objective: move from profile-only skill assignment to profile-plus-stage strategy where appropriate.

### Task E065-020: Define stage-to-skill policy model

Description:
Design policy schema mapping lifecycle stage to recommended/allowed skill packs.

Acceptance Criteria:

1. Policy supports fallback to profile-only behavior.
2. Policy can be evaluated at step and subagent runtime.
3. Policy is documented for operator governance.

References:

1. apps/api/src/workflow/step-support.service.ts
2. apps/api/src/tool/skill-mounting.service.ts
3. apps/api/src/workflow/step-agent-step-executor.helpers.ts
4. apps/api/src/workflow/subagent-orchestrator.service.ts

### Task E065-021: Runtime skill resolution includes lifecycle stage context

Description:
Augment skill resolution path to include stage context and provide deterministic skill catalogs per stage.

Acceptance Criteria:

1. Assigned skill set reflects active stage policy.
2. Prompt augmentation lists stage-relevant skills only.
3. Skill mount cleanup and lifecycle remain unchanged.

References:

1. apps/api/src/workflow/step-support.service.ts
2. apps/api/src/workflow/step-agent-step-executor.service.ts
3. apps/api/src/workflow/subagent-orchestrator.service.ts

### Task E065-022: Add stage-skill diagnostics in orchestration brief

Description:
Expose active stage-skill policy and selected skills in diagnostics.

Acceptance Criteria:

1. Diagnostics indicate current stage, policy source, and effective skills.
2. Missing or invalid skill policy is reported safely.
3. No sensitive prompt contents are exposed.

References:

1. apps/api/src/project/project-brief.service.ts
2. apps/api/src/telemetry/telemetry.gateway.ts

---

### WS8: Observability, Diagnostics, and Operational Readiness

Objective: make lifecycle failures and governance denials immediately diagnosable.

### Task E065-023: Expand orchestration diagnostics for lifecycle contracts

Description:
Add bootstrap chain status, completion readiness, dispatch authority source, and import stage diagnostics.

Acceptance Criteria:

1. Diagnostics endpoint returns all four categories with timestamps.
2. Missing data states are explicit and non-ambiguous.
3. Payload size remains bounded for UI use.

References:

1. apps/api/src/project/project-brief.service.ts
2. apps/api/src/project/project-orchestration-events.service.ts
3. apps/api/src/project/work-item-dispatch-polling-state.service.ts

### Task E065-024: Emit structured telemetry for denial and fallback paths

Description:
Emit explicit telemetry when completion is denied, import validation fails, or dispatch authority fallback is used.

Acceptance Criteria:

1. Events are queryable by project_id and workflow_run_id.
2. Payload includes machine-readable reason codes.
3. Existing dashboards can incorporate the new events without schema breakage.

References:

1. apps/api/src/telemetry/telemetry.gateway.ts
2. apps/api/src/observability/event-ledger.service.ts

### Task E065-025: Operational runbook updates

Description:
Document failure triage for bootstrap chain, completion denials, import stage failures, and dispatch authority mismatches.

Acceptance Criteria:

1. Runbook includes SQL/API checks and expected values.
2. Runbook includes rollback and feature-flag procedures.
3. On-call handoff checklist is updated.

References:

1. docs/operations/README.md
2. docs/operations
3. docs/architecture

---

## 8. Cross-Cutting Acceptance Criteria

The epic is complete only when all criteria below are met:

1. Bootstrap chain integrity:
   1. Start -> specs_ready -> awaiting_approval works for discovery and revision paths.
   2. Approval transitions to bootstrapping and then orchestrating.
2. Completion governance:
   1. Completion validator is enforced by controller and runtime action routes.
   2. Denied completion returns structured reasons.
3. Import-aware behavior:
   1. Imported projects follow explicit import readiness stage path.
   2. Import context appears in state summary and decision prompts.
4. Dispatch authority:
   1. Exactly one execution authority path remains active by design.
   2. Decision logs and telemetry clearly identify authority source.
5. Phase/stage correctness:
   1. Phase detector branches are logically consistent and covered by tests.
6. Stage-specific skill strategy:
   1. Runtime skills reflect lifecycle stage policy where configured.
7. Regression safety:
   1. Existing lifecycle and orchestration tests remain green.

---

## 9. Testing Strategy

### 9.1 Unit tests

1. Discovery seed structure validation.
2. Completion validator pass/fail reason permutations.
3. Phase detector branch correctness and threshold behavior.
4. Invocation guard rules for mid-flight refinement workflow allow/deny matrix.
5. Stage-skill policy evaluation and fallback behavior.

### 9.2 Integration tests

1. Orchestration bootstrap chain end-to-end event progression.
2. Runtime complete_orchestration denial when guardrails fail.
3. Import-aware orchestration start with valid and invalid repository contexts.
4. Dispatch authority unification behavior under poll + reconcile + cycle overlap.

### 9.3 E2E tests

1. New project scenario reaches awaiting_approval after discovery.
2. Approved specs generate work items and enter orchestrating.
3. Completion denied when active items remain or goals unresolved.
4. Imported repository scenario executes import readiness stage and proceeds.
5. Mid-flight refinement path updates strategy/spec context without bootstrap workflow violation.

### 9.4 Regression suites

1. API unit/integration suites for project orchestration and workflow runtime.
2. Deterministic Kanban integration tests in packages/e2e-tests.
3. Existing orchestration mode policy behavior tests.

---

## 10. Rollout Plan

### Phase A: Feature-flagged internal rollout

1. Enable completion validator in observe-only mode (logs only).
2. Enable bootstrap seed integrity checks in CI.
3. Introduce import stage model behind flag.

### Phase B: Enforcement rollout

1. Turn on completion validator hard enforcement.
2. Activate unified dispatch authority model.
3. Enable mid-flight refinement invoke path.

### Phase C: Optimization rollout

1. Enable stage-specific skill policy for selected profiles.
2. Expand diagnostics and dashboards.

### Rollback controls

1. Completion guardrail enforcement toggle.
2. Dispatch authority mode toggle.
3. Import stage model toggle.
4. Stage-specific skill policy toggle.

---

## 11. Risks and Mitigations

1. Risk: guardrails block valid completion in edge cases.
   Mitigation: observe-only rollout, reason-code telemetry, manual override path with audit trail.

2. Risk: import stage introduces startup latency.
   Mitigation: timeout budgets, retry policy, explicit degraded-mode fallback.

3. Risk: dispatch authority migration causes throughput dip.
   Mitigation: phased rollout, side-by-side telemetry during transition, reversible authority mode flag.

4. Risk: stage-skill policy misconfiguration degrades agent behavior.
   Mitigation: default fallback to profile-only skills and policy validation at save time.

---

## 12. Dependencies

1. Existing orchestration workflows and event contracts remain available.
2. Database migration capacity for any new stage metadata/policy fields.
3. Telemetry/event ledger availability for diagnostic enhancements.
4. CI pipeline support for new seed and lifecycle integrity tests.

---

## 13. Deliverables

1. Updated orchestration seed workflows and validation tests.
2. Unified completion validator and enforced completion paths.
3. Import-aware stage model with DTO/service integration.
4. Unified dispatch authority implementation and telemetry.
5. Corrected phase detection logic and expanded stage summaries.
6. Mid-flight refinement workflow and guarded invocation support.
7. Stage-specific skills policy support and diagnostics.
8. Updated operational documentation and runbooks.

---

## 14. Definition of Done

1. All tasks E065-001 through E065-025 are implemented or explicitly descoped with approval.
2. Cross-cutting acceptance criteria pass in CI and targeted E2E suites.
3. Feature flags and rollback procedures are documented and validated.
4. Operational runbooks are updated and reviewed.
5. Epic status can be moved to Implemented with evidence links to PRs/tests/run logs.

---

## 15. References

### Core architecture and lifecycle docs

1. docs/SDD.md
2. docs/architecture/workflow-engine.md
3. docs/architecture/tool-registry.md
4. docs/WORKFLOW_EVENT_TRIGGERS.md
5. docs/WORKFLOW_EVENT_TRIGGERS_IMPLEMENTATION.md

### Related epics

1. docs/epics/EPIC-046-autonomous-project-orchestrator.md
2. docs/epics/EPIC-049-orchestration-modes-behavioral-implementation.md
3. docs/epics/EPIC-056-capacity-aware-work-polling-true-kanban.md
4. docs/epics/EPIC-057-agent-skills-management-and-runner-sync.md
5. docs/epics/EPIC-058-ceo-agent-context-continuity-on-restart.md
6. docs/epics/EPIC-059-project-goals-first-class-management.md

### Key source files impacted by this epic

1. apps/api/src/database/seeds/project-discovery-ceo.workflow.yaml
2. apps/api/src/database/seeds/project-spec-revision-ceo.workflow.yaml
3. apps/api/src/database/seeds/project-work-item-generation-ceo.workflow.yaml
4. apps/api/src/database/seeds/project-orchestration-cycle-ceo.workflow.yaml
5. apps/api/src/database/seeds/work-item-todo-dispatch-default.workflow.yaml
6. apps/api/src/project/project-orchestration.service.ts
7. apps/api/src/project/project-orchestration-lifecycle.operations.ts
8. apps/api/src/project/project-orchestration-events.service.ts
9. apps/api/src/project/project-orchestration-workflow-status.operations.ts
10. apps/api/src/project/project-orchestration-workflow-self-heal.operations.ts
11. apps/api/src/project/project-orchestration-mode-policy.service.ts
12. apps/api/src/project/project-orchestration-mutating-action.operations.ts
13. apps/api/src/project/project-orchestration-mutating-action.execution.ts
14. apps/api/src/project/project-orchestration-workflow-invocation.helpers.ts
15. apps/api/src/project/project-orchestration-workflow-invocation.service.ts
16. apps/api/src/project/project-phase-detector.service.ts
17. apps/api/src/project/project-state-summary.service.ts
18. apps/api/src/project/project-brief.service.ts
19. apps/api/src/project/project.service.ts
20. apps/api/src/project/project-git-metadata.service.ts
21. apps/api/src/common/git/path/git-path.service.ts
22. apps/api/src/workflow/workflow-runtime-orchestration-actions.service.ts
23. apps/api/src/tool/capability-manifest.runtime.entries.ts
24. apps/api/src/project/work-item-dispatch-coordinator.listener.ts
25. apps/api/src/project/work-item-dispatch-polling.consumer.ts
26. apps/api/src/workflow/step-support.service.ts
27. apps/api/src/workflow/step-agent-step-executor.service.ts
28. apps/api/src/workflow/step-agent-step-executor.helpers.ts
29. apps/api/src/workflow/subagent-orchestrator.service.ts
30. apps/api/src/tool/skill-mounting.service.ts
