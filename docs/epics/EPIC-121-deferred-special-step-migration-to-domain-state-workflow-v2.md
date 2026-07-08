# EPIC-121 - Deferred Special-Step Migration to Domain/State Workflow V2

Status: Implementation-Ready Design  
Created: 2026-04-19  
Updated: 2026-04-19  
Owner: Workflow + Kanban Platform  
Related Epics: EPIC-120, EPIC-119, EPIC-075, EPIC-074, EPIC-037, EPIC-053

---

## Executive Summary

EPIC-120 established the new workflow direction: output contracts, state-driven completion, and generic special handlers. A significant part of that transition is complete in runtime and tooling, but four deferred legacy areas remain and are currently coupled to old workflow semantics:

1. record_metadata
2. manage_execution
3. check_orchestration_status
4. hydrate_work_items_from_specs

This epic completes that migration by replacing those deferred legacy behaviors with:

- Generic domain actions via amend_entity and related domain ports
- Output-contract based execution semantics using set_job_output
- Declarative workflow control using condition, switch/default, and for_each
- Synchronous, durable state transitions instead of implicit handler side effects

The result is a single workflow model where orchestration behavior is encoded declaratively in YAML and validated against explicit contracts, with domain logic implemented in reusable services.

---

## Problem Statement

### What is broken now

The codebase currently mixes two incompatible workflow models:

- Runtime and validator support only the new registered special-step types
- Seeded workflows still include legacy step types and tool-centric output conventions

This creates real execution and maintenance risks:

- Legacy workflow jobs can be parsed and persisted but are not consistently executable by the registered runtime handler set.
- Core shared interfaces still include deprecated special job type literals, while validator/runtime behavior has moved ahead.
- Some seed workflows still use output_tool and required_tool_calls, which bypasses the new output_contract gate and keeps old tool coupling alive.
- Deferred domain logic remains fragmented in helper files rather than a clear, generic domain-action surface.

### Why this matters

If unresolved, workflow correctness and maintainability continue to degrade:

- Higher chance of runtime failures for valid-looking workflow definitions
- Difficult evolution of workflow authoring due to ambiguous "what is supported"
- Continued duplication of business logic in bespoke handler paths
- Incomplete realization of EPIC-120 goals (state-first completion and generic handlers)

---

## Goals

1. Fully migrate all deferred legacy behavior to domain/state/workflow-v2 primitives.
2. Remove runtime dependence on record_metadata, manage_execution, check_orchestration_status, hydrate_work_items_from_specs special job types.
3. Replace output_tool and required_tool_calls usage in active seed workflows with output_contract and set_job_output.
4. Enforce startup-time workflow validation guarantees so unsupported step types cannot be launched.
5. Keep deterministic behavior for kanban/orchestration flows with no regression in lifecycle transitions or hydration outcomes.

---

## Non-Goals

1. Rewriting unrelated orchestration policies, agent profile governance, or telemetry architecture outside migration touch points.
2. Introducing new business domains beyond existing work_item, project, execution, and orchestration lifecycle concepts.
3. Running broad UI redesign. UI updates in scope are contract-field parity and workflow detail visibility only.

---

## In Scope

### Deferred migrations

- record_metadata actions and side effects
- manage_execution lifecycle orchestration
- check_orchestration_status gating behavior
- hydrate_work_items_from_specs reconciliation behavior

### Required supporting changes

- Seed workflow rewrites to v2 primitives
- Validator alignment for supported special job types
- Shared interface cleanup once compatibility window closes
- Documentation and skills updates for authoring model
- Deterministic regression coverage for affected orchestration and kanban paths

---

## Target Architecture

### Principle 1: Job completion by state contract

Execution jobs declare output_contract.required fields and must satisfy them via set_job_output.

### Principle 2: Domain mutation through generic actions

Business side effects happen via generic domain operations (primarily amend_entity and explicit runtime orchestration tools), not bespoke step-handler logic.

### Principle 3: Declarative workflow logic

Branching, loops, and conditional behavior belong in YAML using condition, switch/default, and for_each.

### Principle 4: Validation as guardrail

Unsupported or deprecated workflow step types are rejected before run start.

---

## Current-State Evidence (Summary)

1. Registered special-step runtime supports only v2 handler set (amend_entity, git_operation, manage_tool_candidate, plus core handlers).
2. Seed workflows still contain legacy types such as record_metadata, check_orchestration_status, hydrate_work_items_from_specs, attempt_merge, manage_worktree, transition_status.
3. Shared workflow type unions still include deprecated literals, creating contract drift with runtime support.
4. Step-required retry path is output_contract-driven, but jobs without output_contract skip contract enforcement.

This epic resolves these mismatches.

---

## Workstreams and Detailed Tasks

## Workstream A - Extend Generic Domain Mutation Surface

### Objective

Expand amend_entity (and adjacent domain ports) to absorb deferred record_metadata and manage_execution semantics without reintroducing bespoke workflow handlers.

### Tasks

1. Add new amend_entity entity/action matrix

- entity_type: work_item
  - create
  - update
  - upsert
  - transition_status
  - patch_metadata
  - patch_execution_config
  - append_metadata_array
  - archive
- entity_type: work_item_subtask
  - create
  - upsert
  - archive
- entity_type: execution
  - resume
  - restart
  - cancel
  - fail

2. Refactor existing record_metadata behaviors into domain-focused services

- Move logic from helper-centric workflow code into reusable service methods invoked by amend_entity action handlers.
- Preserve business invariants and input validation semantics.

3. Add explicit action contracts and validation

- Strong input validation for each entity_type/action combination
- Clear error messages that identify missing/invalid inputs by key

4. Ensure audit/event parity

- Keep domain and workflow event logging equivalent or richer than legacy path

### Expected Outcome

All legacy record_metadata and manage_execution behaviors are represented by generic entity/action operations with explicit contracts.

---

## Workstream B - Migrate check_orchestration_status to State-Driven Guards

### Objective

Remove bespoke orchestration-status special-step dependency and replace with declarative or execution-job state checks.

### Migration Strategy

Preferred model:

1. Acquire orchestration state via runtime context tool(s) in an execution guard job.
2. Persist required state fields through set_job_output.
3. Route with condition or switch/default based on output fields.

Alternative (where trigger already contains status):

- Skip guard job and use direct condition expressions.

### Tasks

1. Rewrite orchestration cycle workflows to replace check_orchestration_status jobs.
2. Add output_contract fields for guard jobs (example: status, active, reason).
3. Ensure skip/proceed semantics match current behavior.
4. Add tests for status mismatch path and orchestrating-happy path.

### Expected Outcome

No workflow depends on check_orchestration_status type; orchestration gating is contract-based and declarative.

---

## Workstream C - Replace hydrate_work_items_from_specs with Publish/Hydrate V2 Flow

### Objective

Migrate spec-hydration workflows off bespoke step type onto runtime capability and/or declarative scan+for_each patterns.

### Strategy

Phase-safe path:

1. Replace hydrate_work_items_from_specs jobs with execution jobs that call `kanban.publish_specs`.
2. Capture created_count, updated_count, archived_count, errored_count via set_job_output.
3. Route downstream events using condition/switch on captured counts.

Optional advanced path (later in this epic if capacity allows):

- execution scan job returns to_create/to_update/to_archive arrays
- for_each + amend_entity performs reconciliation in pure YAML domain operations

### Tasks

1. Update post-merge hydration and bootstrap generation workflows.
2. Ensure hydration summaries remain available to downstream event jobs.
3. Verify deterministic behavior for no-op, create/update, and archive scenarios.

### Expected Outcome

Spec hydration is expressed through v2 runtime capability and output contracts, not legacy step type handlers.

---

## Workstream D - Migrate record_metadata-heavy Seed Workflows

### Objective

Rewrite active workflows that still use record_metadata and related legacy patterns.

### Priority Workflow Files

1. work-item-refinement-default.workflow.yaml
2. work-item-in-progress-default.workflow.yaml
3. work-item-in-review-default.workflow.yaml
4. work-item-ready-to-merge-default.workflow.yaml
5. project-orchestration-cycle-ceo.workflow.yaml
6. project-work-item-generation-ceo.workflow.yaml
7. work-item-post-merge-spec-hydration.workflow.yaml

### Tasks

1. Replace output_tool/required_tool_calls with output_contract.
2. Replace record_metadata jobs with amend_entity + condition/switch/for_each patterns.
3. Replace transition_status and attempt_merge/manage_worktree legacy types with amend_entity and git_operation actions.
4. Preserve current domain outcomes:

- refinement readiness gating
- split-child materialization
- QA rejection policy and feedback history
- merge lifecycle metadata updates
- orchestration cycle skip/proceed behavior

### Expected Outcome

All active seed workflows use only supported v2 special job types and output contracts.

---

## Workstream E - Validation, Parser, and Shared-Contract Hardening

### Objective

Eliminate type/validator/runtime drift and prevent unsupported workflows from launching.

### Tasks

1. Enforce full workflow validation on workflow start paths (not only dry-run or create/update API paths).
2. Align workflow shared type literals with supported runtime types after seed migration cutover.
3. Add explicit deprecation-rejection errors for legacy types and fields once compatibility window closes.
4. Update workflow seeding contract tests to ensure all seeded files pass v2 type checks.

### Expected Outcome

Unsupported workflow step types and deprecated output fields are caught before execution begins.

---

## Workstream F - Docs, Skills, and Runbooks

### Objective

Make v2 model the only documented authoring path.

### Tasks

1. Update docs and readmes to remove legacy examples.
2. Update workflow authoring skill references to amend_entity + output_contract + set_job_output patterns.
3. Update operations runbooks for hydration and orchestration troubleshooting using v2 fields/events.
4. Add migration cookbook with before/after YAML patterns for each deferred legacy type.

### Expected Outcome

Engineering and agent guidance consistently reflects v2 architecture.

---

## Workstream G - Explicit Legacy Code File Removal

### Objective

Make deletion of legacy workflow code explicit and mandatory, not implied. This workstream is complete only when legacy files are removed from source control and references are fully eliminated.

### Mandatory Removal Policy

1. Do not leave legacy handlers/helpers dormant behind dead branches or deprecated exports.
2. Do not keep temporary re-export shims for removed legacy paths.
3. Update all imports and module wiring to the new v2 surfaces before deleting files.
4. Deletion is required once replacement behavior is verified by tests.

### File Removal Checklist

The following files are legacy and must be removed as part of this epic once their behavior is covered by v2 replacements:

1. apps/api/src/workflow/step-record-metadata.helpers.ts
2. apps/api/src/workflow/step-record-metadata-mutation.helpers.ts
3. apps/api/src/workflow/step-record-metadata-refinement.helpers.ts
4. apps/api/src/workflow/step-record-metadata-refinement-materialization.helpers.ts
5. apps/api/src/workflow/step-hydrate-work-items-special-step.utils.ts
6. apps/api/src/workflow/step-hydrate-work-items-spec-parser.ts
7. apps/api/src/workflow/step-hydrate-work-items-spec-parser.types.ts
8. apps/api/src/workflow/step-hydrate-work-items-reconcile.helpers.ts
9. apps/api/src/workflow/step-hydrate-work-items-reconcile.types.ts
10. apps/api/src/workflow/step-hydrate-work-items-reconcile.utils.ts
11. apps/api/src/workflow/step-hydrate-work-items-discovery.helpers.ts
12. apps/api/src/workflow/step-hydrate-work-items-batch.helpers.ts
13. apps/api/src/workflow/step-hydrate-work-items-orchestrator.helpers.ts

If additional legacy-only files are discovered during migration, they must be added to this list and removed in the same epic.

### Removal Exit Criteria

1. No references to removed files remain in apps/api/src imports.
2. No workflow seeds reference legacy deferred step types.
3. Workflow module registration and special-step registry contain only supported v2 handlers.
4. All tests formerly covering legacy code paths are either removed or migrated to v2 behavior tests.
5. Grep checks for legacy signatures return no source matches in active code paths:

- record_metadata
- manage_execution
- check_orchestration_status
- hydrate_work_items_from_specs
- output_tool
- required_tool_calls

### Expected Outcome

Legacy workflow implementation code is physically removed, preventing accidental fallback to deprecated behavior.

---

## Detailed Task Backlog

## Phase 1 - Foundation and Guardrails

1. Expand amend_entity action support (metadata, execution config, subtasks, execution lifecycle).
2. Add unit tests for each new entity/action branch and invalid-input branch.
3. Harden workflow start-path validation behavior.
4. Add validator test cases that reject unsupported legacy step types in active flow.

Deliverable: v2 generic mutation surface available; launch-path validation guarantees in place.

## Phase 2 - Orchestration and Hydration Deferred Types

1. Migrate check_orchestration_status usage in orchestration cycle workflow(s).
2. Migrate hydrate_work_items_from_specs usage to `kanban.publish_specs` output-contract flow.
3. Add integration tests for proceed/skip and hydration summary routing.

Deliverable: no active usage of check_orchestration_status or hydrate_work_items_from_specs.

## Phase 3 - record_metadata-heavy Workflow Migration

1. Rewrite refinement flow actions to amend_entity + declarative controls.
2. Rewrite in-progress and in-review flows for policy/feedback/plan persistence via v2 operations.
3. Rewrite ready-to-merge flow to git_operation + amend_entity.
4. Validate event parity and lifecycle outcomes.

Deliverable: no active usage of record_metadata, transition_status, attempt_merge, manage_worktree.

## Phase 4 - Contract Cleanup and Documentation

1. Remove deprecated literals from shared workflow special job type unions.
2. Remove stale docs and seed guides showing legacy types.
3. Publish migration cookbook and update skills.
4. Delete all legacy workflow files listed in Workstream G and verify zero references.

Deliverable: workflow authoring and runtime contracts are consistent and legacy-free.

---

## File Inventory (Planned)

### Primary API Runtime Files

- apps/api/src/workflow/step-amend-entity-special-step.handler.ts
- apps/api/src/workflow/domain-ports/\*
- apps/api/src/workflow/validation/workflow-validation.job-validators.ts
- apps/api/src/workflow/workflow-engine.service.ts
- apps/api/src/workflow/step-special-step.types.ts

### Workflow Definitions

- seed/workflows/work-item-refinement-default.workflow.yaml
- seed/workflows/work-item-in-progress-default.workflow.yaml
- seed/workflows/work-item-in-review-default.workflow.yaml
- seed/workflows/work-item-ready-to-merge-default.workflow.yaml
- seed/workflows/project-orchestration-cycle-ceo.workflow.yaml
- seed/workflows/project-work-item-generation-ceo.workflow.yaml
- seed/workflows/work-item-post-merge-spec-hydration.workflow.yaml

### Shared Contracts

- packages/core/src/interfaces/workflow-legacy.types.ts

### Tests

- apps/api/src/workflow/\*.spec.ts (new and updated)
- apps/api/src/workflow/testing/workflow-dry-run.definitions.spec.ts
- apps/api/src/database/seeds/workflows.seed.contract.spec.ts
- packages/e2e-tests relevant orchestration and kanban suites

### Documentation and Skills

- docs/architecture/workflow-engine.md
- docs/guides/workflow-authoring-v2.md
- apps/api/src/database/seeds/WORKFLOW_SEEDING_GUIDE.md
- .agents/skills/workflow-yaml-authoring/SKILL.md
- seed/skills/workflow-schema-explainer/references/\*

---

## Testing Strategy

## Unit

1. amend_entity action matrix

- happy path for each action
- validation failures for missing keys and incompatible combinations

2. validator hardening

- unsupported type rejection
- deprecated field rejection after cutover flag

3. output contract behavior

- missing required fields
- satisfied contract and proceed path

## Integration

1. refinement flow outcomes

- readiness pass/fail
- split-required and split-not-required paths

2. orchestration cycle

- proceed when orchestrating
- skip when not orchestrating

3. hydration

- no changes path
- create/update/archive paths

## E2E (targeted)

1. Work item refinement lifecycle
2. In-progress to in-review transition lifecycle
3. In-review QA decision lifecycle
4. Ready-to-merge lifecycle and post-merge hydration
5. Orchestration cycle decision gating

Note: prioritize targeted suites first, then broaden based on touched orchestration surfaces.

---

## Rollout and Compatibility Plan

## Stage 1 - Dual acceptance with warnings

- Keep parsing compatibility where necessary but reject unsupported runtime types at startup validation for active workflows.
- Add migration warnings in validation output for remaining legacy fields.

## Stage 2 - Seed cutover complete

- All active seeded workflows use v2 types and output_contract.
- Legacy fields no longer appear in seed definitions.

## Stage 3 - Hard fail legacy contracts

- Remove deprecated special job type literals from shared interfaces.
- Remove legacy examples from docs and skills.

---

## Success Metrics

1. Zero active seeded workflows contain:

- record_metadata
- manage_execution
- check_orchestration_status
- hydrate_work_items_from_specs
- output_tool
- required_tool_calls

2. Zero runtime launches with unsupported step types.
3. 100% pass on touched unit/integration suites.
4. Deterministic orchestration/kanban regressions pass for migrated paths.
5. No loss of lifecycle side-effect fidelity (status transitions, metadata persistence, hydration summaries).

---

## Risks and Mitigations

1. Risk: behavior drift in refinement metadata side effects

- Mitigation: encode each legacy action with golden test fixtures before migration

2. Risk: orchestration cycle regressions from guard-job rewrite

- Mitigation: explicit proceed/skip parity tests and event assertions

3. Risk: hydration semantics differ from legacy handler output shape

- Mitigation: preserve output field names (created_count, updated_count, archived_count, errored_count) for downstream transition compatibility

4. Risk: incomplete seed migration causes startup/runtime failures

- Mitigation: contract test gate requiring all seeded workflows pass validator before merge

---

## Definition of Done

This epic is done when all criteria below are true:

1. All deferred legacy step behaviors are migrated to v2 domain/state/workflow primitives.
2. No active seeded workflow file uses legacy deferred step types or legacy output_tool/required_tool_calls fields.
3. Runtime and shared contracts are aligned; unsupported types are rejected before execution.
4. amend_entity supports required entity/action surface for migrated workflows.
5. check_orchestration_status behavior is implemented via declarative state-driven workflow logic.
6. hydrate_work_items_from_specs behavior is implemented via `kanban.publish_specs` output-contract (and/or approved v2 declarative reconciliation pattern).
7. All touched unit and integration tests pass.
8. Deterministic kanban/orchestration regression checks for touched flows pass.
9. Docs and skills are updated to reflect only v2 authoring model for these areas.
10. Operational runbooks for troubleshooting these flows are updated and validated.
11. Legacy file deletion checklist in Workstream G is fully completed and verified.

---

## Appendix A - Legacy-to-V2 Mapping Matrix

| Legacy Type/Action                                 | V2 Replacement                                                                                        |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| record_metadata:set_preflight_artifacts            | execution output_contract + set_job_output + amend_entity patch_metadata or planning artifact service |
| record_metadata:set_implementation_plan            | amend_entity patch_execution_config                                                                   |
| record_metadata:append_qa_feedback                 | amend_entity append_metadata_array                                                                    |
| record_metadata:set_review_rejection_policy        | amend_entity patch_metadata                                                                           |
| record_metadata:resolve_refinement_split           | execution decision output + amend_entity patch_metadata                                               |
| record_metadata:materialize_split_children         | for_each + amend_entity create work_item                                                              |
| record_metadata:materialize_refinement_subtasks    | for_each + amend_entity create work_item_subtask                                                      |
| record_metadata:validate_refinement_exit_readiness | execution validator with output_contract + condition gates                                            |
| record_metadata:mark_refinement_completed          | amend_entity patch_metadata                                                                           |
| record_metadata:record_merge_lifecycle             | amend_entity patch_metadata                                                                           |
| manage_execution:\*                                | amend_entity entity_type=execution action=\*                                                          |
| check_orchestration_status                         | execution guard + set_job_output + condition/switch                                                   |
| hydrate_work_items_from_specs                      | `kanban.publish_specs` tool flow with output_contract and declarative routing                         |

---

## Appendix B - Example Acceptance Checklist for PRs in This Epic

1. Workflow definitions use only supported special job types.
2. Execution jobs with required outputs declare output_contract.required.
3. Agent prompts instruct set_job_output for required fields.
4. No new bespoke workflow-only domain logic is introduced in handler files.
5. Domain mutation behavior is covered by unit tests.
6. Migration keeps downstream output keys stable where needed.
7. No lint suppressions or type-check bypasses are introduced.
8. Updated docs include before/after examples for changed workflows.

---

End of EPIC-121
