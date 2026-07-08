# EPIC-166: Kanban Workflow Trigger Bridge and Contract Hardening

Status: Completed
Priority: P0
Depends On: EPIC-152, EPIC-162, EPIC-164
Related: docs/analysis/ANALYSIS-kanban-orchestration-functional-gaps-2026-05-11.md, docs/analysis/ANALYSIS-kanban-orchestration-doc-implementation-drift-2026-05-11.md
Last Updated: 2026-05-11

---

## 1. Summary

Implement and harden the missing lifecycle trigger bridge between kanban status transitions and workflow event triggers, enforce a stable status event payload contract, fix contradictory workflow permissions, restore reliable regression coverage for end-to-end orchestration chaining, and close the imported-repository workflow context propagation gaps found during live autonomous reruns.

This epic addresses the highest-risk gaps identified in the May 11 audit where lifecycle workflows are seeded and registered but not guaranteed to chain from status updates due to missing emission and payload-enrichment guarantees.

---

## 2. Problem Statement

Current orchestration behavior has six critical reliability risks:

1. Status transitions do not reliably emit the canonical lifecycle event `kanban.work_item.status_changed.v1` for workflow-owned status routing.
2. Seeded workflows assume enriched trigger payload shape, including `trigger.resource`, `trigger.status`, and `trigger.previousStatus`, but this contract is not centrally enforced.
3. The in-progress implementation workflow has contradictory permissions (same tool in allow_tools and deny_tools).
4. Legacy project-layer e2e lifecycle coverage references removed modules and no longer validates the active kanban architecture.
5. Project Discovery CEO forwards imported-repository hydration into a child workflow without carrying `orchestrationMode` and `humanDecisionPolicy`, so autonomous runs can silently fall back to supervised imported backlog reconciliation.
6. CEO-cycle dispatch can launch a workflow with `invoke_agent_workflow` while leaving the referenced Kanban work items blocked and unlinked, creating an apparent dispatch with no board movement.

These gaps can break orchestration chaining (refinement -> in-progress -> in-review -> ready-to-merge -> done), reduce determinism, keep autonomous imported repositories blocked, and hide regressions.

### Live Run Findings: 2026-05-11

During a rebuilt-stack rerun for project `dad09d35-4e5a-47fa-9dc0-ffa3b8960af4`, the parent Project Discovery CEO trigger contained `orchestrationMode: "autonomous"` and `humanDecisionPolicy: "decide_without_approval"`, but the child `imported_repo_synthesis_and_hydration` run received neither field. The actual `kanban.reconcile_imported_repository_backlog` tool call therefore omitted `orchestration_mode` and `human_decision_policy`, defaulted to supervised behavior, and published 26 blocked `human_decision` work items with `feedbackNeeded: true` and `autonomousDecision: false`.

The same run also showed that the CEO cycle can report three work items as dispatched through `standard_feature_flow` while their Kanban rows remain `blocked` with empty `current_execution_id` and `linked_run_id`. No Kanban domain events were emitted for those claimed dispatches. This epic now includes contract hardening for parent-to-child workflow context propagation and a guardrail/diagnostic task for dispatch claims that do not mutate Kanban execution state.

---

## 3. Goals

1. Add a canonical lifecycle event emission bridge for status-driven workflow triggers.
2. Define and enforce the status event payload contract used by seeded workflows.
3. Ensure `previousStatus` and `status` are consistently captured and propagated.
4. Remove contradictory workflow permission entries and add validation coverage.
5. Replace stale lifecycle e2e coverage with active kanban-path integration tests.
6. Keep architecture and trigger documentation synchronized with implementation.
7. Preserve autonomous imported-repository mode/policy context across parent and child workflows.
8. Ensure workflow launch paths that claim Kanban dispatch either mutate/link Kanban items or are made explicit as non-dispatch workflow starts.

---

## 4. Non-Goals

1. Rewriting workflow engine trigger registration internals.
2. Replacing existing seeded workflow business logic outside trigger/contract and permission correctness.
3. Large refactors of orchestration decision policy unrelated to lifecycle chaining reliability.
4. Introducing new persistence models unless required for contract observability.

---

## 5. Scope

### In Scope

1. apps/kanban/src/work-item/work-item.service.ts
2. apps/kanban/src/mcp/tools/mutation/work-item-transition-status.tool.ts
3. apps/kanban/src/core/core-workflow-client.service.ts or adjacent bridge service if needed
4. apps/api/src/workflow/workflow-event-trigger.service.ts (payload handling/contract checks)
5. seed/workflows/work-item-in-progress-default.workflow.yaml
6. lifecycle trigger documentation and analysis artifacts
7. active test suites in apps/kanban and apps/api for lifecycle chaining
8. seed/workflows/project-discovery-ceo.workflow.yaml
9. seed/workflows/imported-repo-synthesis-and-hydration.workflow.yaml
10. imported repository orchestration seed contract tests

### Out of Scope

1. New workflow definitions unrelated to lifecycle trigger reliability.
2. UI redesign work.
3. Cross-service auth model changes.

---

## 6. Proposed Implementation

### Phase 1: Lifecycle Event Emission Bridge

1. Add post-persist emission path in kanban status mutation flow.
2. Emit `kanban.work_item.status_changed.v1` for actual status changes and let workflow-owned conditions route automation statuses.
3. Ensure emission is idempotent per transition operation and does not fire on no-op same-status updates.

### Phase 2: Payload Enrichment Contract

1. Build canonical payload envelope for lifecycle status events:
   - event
   - scopeId
   - contextId
   - workItemId
   - previousStatus
   - status
   - actor
   - resource (full work-item snapshot with executionConfig and metadata)
2. Centralize envelope construction in one reusable helper/service.
3. Add contract tests to prevent payload drift.

### Phase 3: Workflow Permission Sanity

1. Remove allow/deny overlap in work_item_in_progress_default implement_and_commit job.
2. Add seed contract tests to fail on any allow_tools and deny_tools overlap within the same scope.

### Phase 4: Lifecycle Regression Coverage

1. Replace stale project-layer e2e lifecycle tests with active kanban-module integration tests.
2. Add chain tests validating event emission and downstream workflow start for:
   - in-progress
   - in-review
   - ready-to-merge

### Phase 5: Documentation and Operations Sync

1. Update trigger and architecture docs with final implemented behavior.
2. Add operational troubleshooting steps for lifecycle trigger bridge verification.

### Phase 6: Imported Repository Context Propagation

1. Pass `orchestrationMode` and `humanDecisionPolicy` from Project Discovery CEO into the imported repository synthesis/hydration child workflow.
2. Add seed contract tests proving parent-to-child input propagation and child prompt/tool-call instructions stay aligned.
3. Validate autonomous hydration emits `kanban.reconcile_imported_repository_backlog` instructions with `orchestration_mode` and `human_decision_policy` populated from trigger context.

### Phase 7: Dispatch Claim Hardening

1. Identify the workflow/tool path used by CEO cycle for `invoke_agent_workflow` dispatch claims.
2. Add tests or diagnostics proving whether the path updates Kanban status/linkage.
3. Route actual Kanban dispatch through the canonical dispatcher or change the workflow language/output contract so non-mutating workflow launches are not represented as dispatched work items.

---

## 7. Actionable Tasks

- [ ] E166-001 Add lifecycle event emission after successful status transition persistence.
- [ ] E166-002 Emit only mapped automation statuses and avoid duplicate emission for no-op transitions.
- [ ] E166-003 Implement canonical lifecycle payload builder with resource snapshot.
- [ ] E166-004 Propagate previousStatus and status through lifecycle status event payloads.
- [ ] E166-005 Add tests for payload contract required fields and shape.
- [ ] E166-006 Remove allow/deny overlap in work_item_in_progress_default implement_and_commit permissions.
- [ ] E166-007 Add seed validation test to reject allow_tools and deny_tools overlaps.
- [ ] E166-008 Replace legacy project-layer lifecycle e2e coverage with current kanban-path tests.
- [ ] E166-009 Add integration test: transition to in-review triggers work_item_in_review_default.
- [ ] E166-010 Add integration test: review accept route triggers ready-to-merge workflow chain.
- [ ] E166-011 Align trigger and architecture docs to implemented payload/emission behavior.
- [ ] E166-012 Add runbook note for lifecycle emission and payload contract diagnostics.
- [ ] E166-013 Propagate `orchestrationMode` from Project Discovery CEO into imported repository hydration child workflow inputs.
- [ ] E166-014 Propagate `humanDecisionPolicy` from Project Discovery CEO into imported repository hydration child workflow inputs.
- [ ] E166-015 Add seed contract tests for Project Discovery CEO parent-to-child imported hydration context propagation.
- [ ] E166-016 Add regression coverage that autonomous imported hydration child trigger can drive non-blocking reconciliation arguments.
- [ ] E166-017 Audit CEO-cycle dispatch claims and add a failing test for workflow launch without Kanban status/linkage mutation.
- [ ] E166-018 Either route CEO dispatch through canonical Kanban dispatch or rename/contract non-mutating workflow launch output to avoid false dispatch claims.

---

## 8. Acceptance Criteria

1. Transitioning a work item into refinement, in-progress, in-review, or ready-to-merge emits `kanban.work_item.status_changed.v1` with enriched payload.
2. Lifecycle status event payload always includes event, scopeId, contextId, workItemId, previousStatus, status, actor, and resource.
3. Seeded lifecycle workflows resolve trigger.resource fields required by prompts and job inputs.
4. No allow_tools and deny_tools overlap exists in seeded workflows.
5. Seed validation tests fail when permission overlap is introduced.
6. Integration tests prove status transition -> event emission -> workflow start chaining for review and merge paths.
7. Legacy stale lifecycle e2e coverage is either removed or replaced with active equivalent coverage.
8. Documentation reflects implemented behavior and known operational checks.
9. Imported repository hydration child workflows receive `orchestrationMode` and `humanDecisionPolicy` whenever the parent Project Discovery CEO trigger has them.
10. Autonomous imported repository reconciliation tool calls include `orchestration_mode: autonomous` and `human_decision_policy: decide_without_approval` in contract coverage.
11. A workflow path cannot claim Kanban work items were dispatched unless tests prove the corresponding work items transition/link to an execution, or the output is explicitly described as a non-mutating workflow launch.

---

## 9. Suggested Quality Gates

1. npm run test --workspace=apps/kanban -- src/work-item/work-item.service.spec.ts
2. npm run test --workspace=apps/kanban -- src/mcp/tools/mutation/work-item-transition-status.tool.spec.ts
3. npm run test --workspace=apps/api -- workflow-event-trigger.service.spec.ts
4. npm run test --workspace=apps/api -- database/seeds/workflows.seed.contract.spec.ts
5. npm run validate:seed-data
6. npm run lint:summary
7. npm run test --workspace=apps/kanban -- src/seeds/workflows.seed.contract.spec.ts

---

## 10. Risks and Mitigations

1. Risk: duplicate emission causes duplicate workflow starts.
   Mitigation: emit only after state change and enforce idempotency metadata where applicable.
2. Risk: resource enrichment adds heavy query overhead.
   Mitigation: use minimal required projection and reuse existing work-item fetch paths.
3. Risk: permission tightening accidentally blocks required tools.
   Mitigation: add focused workflow step execution tests for implement_and_commit.
4. Risk: test migration removes useful legacy assertions.
   Mitigation: port equivalent assertions to new kanban-path integration tests before deletion.
5. Risk: child workflow prompts look correct but parent invoke-workflow inputs omit required context.
   Mitigation: add parent workflow input contract tests for every child workflow that depends on mode/policy context.
6. Risk: workflow launches are mistaken for Kanban dispatches.
   Mitigation: require tests that assert work item status/linkage changes for any path that reports dispatched work.

---

## 11. Done Definition

The epic is complete when lifecycle status transitions reliably chain seeded workflows in tests and operational checks, payload contract drift is prevented by automated tests, seeded permission overlaps are blocked by validation, and docs/runbooks match the implemented architecture.
