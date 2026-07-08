# EPIC-031: Workflow Validation Refactor

## Summary

Refactor workflow validation into a modular, extensible, and robust validation system that follows SOLID, DRY, and separation-of-concerns principles.

The current implementation works for many happy paths, but it centralizes too much responsibility in one service, duplicates concerns already present in DAG logic, and has fragile runtime assumptions that can lead to unhandled exceptions when malformed YAML is parsed into unexpected runtime shapes.

This epic introduces a validator architecture with clear contracts, pluggable job/step validators, shared typed predicates, deterministic error collection, and improved performance characteristics.

## Motivation

### Current Pain Points

1. Runtime fragility from unchecked dynamic input:

- Validation currently assumes certain values are strings and may call string methods on unknown values.
- Malformed payloads can cause validation-time exceptions instead of collected validation errors.

2. Missing explicit job-type validation contract:

- Unknown or unsupported job types are not rejected early in a single canonical place.
- This can defer failures to execution-time code paths.

3. Duplicate concerns and drift risk:

- Dependency/transition checks exist in both workflow validation and DAG resolver logic.
- Parallel validation logic increases maintenance overhead and can drift in behavior.

4. Monolithic validation service:

- A single large method handles workflow structure, job checks, step checks, graph checks, and external lookups.
- This violates single responsibility and reduces extensibility.

5. DRY and performance debt:

- Duplicate detection uses repeated list scans.
- Tool existence checks are performed serially per job/tool.

6. Coverage gaps around malformed runtime types:

- Existing tests cover many paths but do not fully guard against non-string/non-record malformed values in dynamic fields.

### Why Now

Workflow authoring is becoming more expressive (job/step types, transitions, retries, control flow). Validation is the first defense line for correctness and safety. A stronger architecture reduces production risk and simplifies future feature additions.

## Goals

1. Ensure validation never crashes due to malformed input; always return structured validation errors.
2. Enforce explicit and centralized rules for supported job and step types.
3. Extract validators into modular units with clear responsibilities.
4. Eliminate duplicated graph/dependency validation concerns.
5. Improve runtime efficiency for duplicate detection and tool checks.
6. Keep public behavior stable for callers (`validateWorkflow`, `validateAndThrow`) while improving internals.
7. Make adding new job/step types possible without editing a large monolith.

## Non-Goals

1. Changing workflow execution semantics.
2. Rewriting DAG resolver algorithms.
3. Introducing a third-party schema framework in this epic.
4. Changing API contracts for workflow creation/update endpoints.

## Scope

### In Scope

1. Refactor files in workflow validation domain.
2. Add internal validator interfaces and registry patterns.
3. Add/expand unit tests for validation edge cases and malformed runtime types.
4. Keep error messages stable where practical; normalize format where needed.
5. Update docs for validation extension points.

### Out of Scope

1. Large parser redesign.
2. Workflow engine orchestration changes unrelated to validation.
3. Cross-service API redesign.

## Proposed Architecture

### 1. Validation Orchestrator

Keep `WorkflowValidationService` as orchestration facade only:

- Build validation context.
- Invoke validator modules in order.
- Return `{ valid, errors }`.
- Throw in `validateAndThrow` when invalid.

### 2. Shared Contracts

Introduce internal contracts:

- `ValidationContext`
  - `definition`
  - `jobIds`
  - caches (for tools and counts)

- `ValidationIssue`
  - `code`
  - `message`
  - `path` (optional)

- `ValidationCollector`
  - add issue
  - dedupe issue
  - export plain string errors for backward compatibility

- `WorkflowValidator` interface
  - `validate(context, collector): Promise<void> | void`

### 3. Validator Modules (SRP)

Planned modules:

1. `WorkflowStructureValidator`

- Workflow-level required fields.
- Top-level policy structure.
- Jobs array presence and non-empty check.

2. `JobCollectionValidator`

- Job ID presence and uniqueness.
- Shared job field checks (`tier`, scalar types).

3. `JobTypeValidatorRegistry`

- Dispatch by `job.type`.
- Reject unsupported/unknown types early.
- Plug-in model for new job types.

4. `ExecutionJobValidator`

- `max_step_loops` validation.
- Step collection checks.
- Delegation to step validators.

5. `RegisterToolJobValidator`

- Required input shape and types.

6. `InvokeWorkflowJobValidator`

- Resolve child workflow id.
- Forbid self-invocation.

7. `JobControlFieldsValidator`

- `required_tool_calls`, `max_retries`, `retry_prompt`.

8. `GraphValidationAdapter`

- Delegates DAG integrity checks to resolver (single source of truth).

9. `ToolReferenceValidator`

- De-duplicated tool lookup strategy with caching.

### 4. Step Validation Registry

`StepTypeValidatorRegistry` for step-level type rules:

1. `AgentStepValidator`

- Requires non-empty prompt.

2. `RunCommandStepValidator`

- Requires non-empty command.

3. `SetVariableStepValidator`

- Requires record variables object.

4. `WaitStepValidator`

- Validates `timeout_ms` positive integer if provided.

5. `StepFlowValidator`

- `on_error` type checks and target validation.
- Transition target validation (`done`, `fail_job`, `goto:*`, direct step id).

### 5. Shared Guard Utilities

Create typed predicate/util module for dynamic runtime safety:

- `isRecord`
- `isNonEmptyString`
- `isStringArray`
- `isPositiveInteger`
- `isNonNegativeInteger`

No validator should call methods on unknown values without guard checks.

### 6. Performance and DRY Improvements

1. Replace repeated filter scans with counting maps for duplicates.
2. Precompute reusable sets/maps once per workflow.
3. Batch unique tool existence checks and reuse cached lookup results.

## Implementation Plan

### Phase 0: Baseline Tests (Red)

1. Add tests for malformed runtime values:

- non-string `on_error`
- non-string transition targets
- malformed policy object shapes

2. Add tests for unknown job type rejection.
3. Add tests proving validator returns errors instead of throwing for malformed fields.

### Phase 1: Safety Hardening (Green)

1. Add guard utility module.
2. Replace fragile runtime assumptions with guarded checks.
3. Keep existing service structure mostly intact in this phase to minimize risk.

### Phase 2: Modular Extraction

1. Introduce `ValidationCollector` and context.
2. Extract workflow-level and shared job-level validators.
3. Extract step-level validation into dedicated module(s).

### Phase 3: Extensibility via Registries

1. Add `JobTypeValidatorRegistry` and `StepTypeValidatorRegistry`.
2. Move type-specific branches into pluggable validators.
3. Ensure adding a new type requires registration, not editing monolith logic.

### Phase 4: Single Source for Graph Rules

1. Remove duplicate dependency/transition checks from workflow validator where DAG resolver already validates.
2. Keep one canonical ownership for graph integrity.

### Phase 5: Performance and Cleanup (Refactor)

1. Optimize duplicate detection to linear scans.
2. Optimize tool lookups with unique name caching.
3. Align and normalize error wording.
4. Remove dead/internal duplicate helpers.

### Phase 6: Documentation and Rollout

1. Document validator architecture and extension points.
2. Add a short contributor section describing how to add a new job/step validator.
3. Confirm existing caller behavior remains backward compatible.

## Testing Strategy

1. Unit tests for each validator module.
2. Registry tests:

- unknown type behavior
- correct validator dispatch

3. Property-style edge tests for malformed unknown input (object/array/string/null combinations).
4. Integration tests at service facade level (`validateWorkflow`, `validateAndThrow`).
5. Regression tests for all currently supported valid workflow fixtures.

## Acceptance Criteria

1. Validation does not throw on malformed workflow field types; returns deterministic errors.
2. Unsupported job and step types are rejected explicitly.
3. Workflow validation service is decomposed into modular validators with clear ownership.
4. Duplicate graph validation logic is removed from validator and delegated to a canonical owner.
5. Tool lookups are de-duplicated and cached per validation run.
6. Existing callers continue to use unchanged public methods.
7. Existing validation tests pass and new edge-case tests are added.

## Risks and Mitigations

1. Risk: Error message changes may break brittle tests.

- Mitigation: Introduce stable error codes internally; preserve message text where practical.

2. Risk: Refactor introduces behavior drift.

- Mitigation: Add baseline regression suite before extraction; extract in phases.

3. Risk: Registry indirection adds complexity.

- Mitigation: Keep contracts minimal and module boundaries explicit.

## Dependencies

1. Existing `DAGResolverService` remains available as graph validation dependency.
2. `ToolRegistryRepository` access remains available for tool existence checks.

## Deliverables

1. Refactored validation architecture in workflow domain.
2. Expanded unit tests for robustness and malformed inputs.
3. Updated documentation for validation extension model.

## Initial Work Breakdown

1. Story A: Validation guards and malformed type safety.
2. Story B: Modular extraction of workflow/job shared validators.
3. Story C: Step-level validator registry and flow validation module.
4. Story D: Job-type validator registry and type-specific validators.
5. Story E: Graph validation ownership cleanup.
6. Story F: Tool lookup optimization and duplicate detection performance pass.
7. Story G: Documentation updates and migration notes.

## Success Metric

A new job or step type can be added by implementing and registering a validator module, without editing a single monolithic validation method, while maintaining deterministic and non-throwing validation behavior for malformed input.
