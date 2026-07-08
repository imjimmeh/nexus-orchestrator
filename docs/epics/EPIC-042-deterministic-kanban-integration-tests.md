# EPIC-042 Deterministic Kanban Integration Tests

## Status
Planned -> In Progress

## Problem Statement
The current kanban lifecycle tests are true end-to-end tests that depend on a separately deployed API stack, mutable long-lived infrastructure state, and live AI/provider behavior. This causes flakiness, long feedback loops, and non-deterministic failures.

Current behavior characteristics:
- Test command targets the lifecycle runner in packages/e2e-tests and calls an external API URL.
- DB state is shared/persistent when using docker-compose volume-backed Postgres.
- AI setup is runtime-configured via provider secrets/models/profiles and may depend on real external provider behavior.
- Polling and timestamp-based resource naming increase nondeterministic execution behavior.

## Goals
Create deterministic integration-test variants of kanban lifecycle tests that:
1. Do not require a deployed docker API server.
2. Run against fresh local databases each run using testcontainers.
3. Mock LLM/agent step execution deterministically.
4. Leave existing e2e tests and commands intact.
5. Provide a dedicated command path for deterministic lifecycle validation.

## Non-Goals
- Replacing or deleting existing live e2e tests.
- Refactoring the production workflow engine semantics.
- Introducing provider-level mocking in the pi-runner package for this milestone.
- Expanding deterministic coverage to all historical lifecycle checkpoints in one pass.

## Current-State Analysis Summary
Existing kanban lifecycle execution path:
- Root script -> packages/e2e-tests script -> single lifecycle test through checkpoint 6.
- Lifecycle runner interacts through HTTP with `/api/...` endpoints and drives phases with polling.

Observed test flow constraints:
- Runner currently executes mandatory phases through phase 6 by default command.
- Separate checkpoint tests exist for phases 1..9, but main lifecycle command targets phase 6.
- AI bootstrap is invoked unless explicitly skipped.

Existing integration seams useful for deterministic mode:
- Workflow step execution is delegated via `StepExecutionOrchestratorService` -> `StepAgentStepExecutorService`.
- QA decision and dispatch start side effects are domain-supported via existing controller/service/helper paths.
- App can be bootstrapped in-process via Nest testing module with provider overrides.

## Proposed Architecture
Introduce a deterministic integration test harness in `apps/api/test` that:
- Boots fresh PostgreSQL + Redis containers with testcontainers per run.
- Boots local Nest app in-process (AppModule) using container connection env vars.
- Overrides `StepAgentStepExecutorService` with a deterministic mock executor.
- Points existing lifecycle runner to local in-process API listener.

This design preserves lifecycle assertions while replacing only runtime transport/infrastructure/provider variability.

## Deterministic Mocking Strategy
Mock `StepAgentStepExecutorService.executeJob` behavior by job intent:
- `review_work_item`: submit deterministic QA accept decision through `WorkItemService.submitQaDecision`.
- `select_and_start`: deterministically start first `slots` candidate work items via `WorkItemService.updateStatus(..., in-progress)`.
- `implement_and_commit` for PM decomposition work item: synthesize hydrated epic/story/task work items with `metadata.specFile` to satisfy phase 5/6 hierarchy assertions.
- all other execution jobs: return successful completion output and advance run via `WorkflowEngineService.handleJobComplete`.

Why this seam:
- Minimal production changes.
- Preserves workflow DAG transitions and special-step execution behavior.
- Avoids external LLM/provider calls entirely.

## Delivery Plan

### Slice 1: Epic Documentation
- Add this epic with implementation detail, acceptance criteria, and rollout notes.

### Slice 2: Deterministic Test Harness
- Add deterministic kanban integration e2e spec under `apps/api/test`.
- Add testcontainers setup/teardown for Postgres and Redis.
- Add local app bootstrap helper and env wiring.

### Slice 3: Mock Step Executor
- Add deterministic `StepAgentStepExecutorService` override used only by deterministic spec.
- Implement job-specific deterministic side effects for phases through checkpoint 6.

### Slice 4: Command Wiring
- Add workspace script in `apps/api/package.json` for deterministic kanban integration.
- Add root proxy script in root `package.json`.

### Slice 5: Validation
- Run deterministic script.
- Run typechecks and linting for touched workspaces.

## File Plan
Documentation:
- `docs/epics/EPIC-042-deterministic-kanban-integration-tests.md`

Implementation (new):
- `apps/api/test/kanban-lifecycle-deterministic.e2e-spec.ts`

Implementation (updated):
- `apps/api/package.json`
- `package.json`

## Acceptance Criteria
Functional:
- Deterministic command runs locally without requiring docker-compose API service.
- Each test run starts with fresh Postgres/Redis containers.
- No live provider credentials or external LLM calls are required.
- Lifecycle deterministic variant reaches successful completion through phase 6 assertions.
- Existing `test:e2e:kanban` command remains unchanged and still targets current suite.

Quality:
- New/updated code passes typecheck for impacted workspace(s).
- New/updated code passes lint for impacted workspace(s).
- No changes to existing live e2e test behavior.

## Risks and Mitigations
Risk: deterministic mock misses critical side effects expected by phase logic.
- Mitigation: route side effects through existing domain services/helpers (QA and dispatch), not direct DB mutation where possible.

Risk: lifecycle phase 5 hydration assertions depend on content generated by PM workflow.
- Mitigation: deterministic executor synthesizes hydrated hierarchy with required metadata markers consumed by phase checks.

Risk: BullMQ/Redis timing flakiness.
- Mitigation: use real Redis container and deterministic constrained updates in mock executor.

Risk: cross-module test compilation and decorator metadata issues.
- Mitigation: place deterministic suite in `apps/api/test` using existing e2e vitest config with SWC decorator metadata support.

## Operational Notes
- Deterministic suite is intentionally separate from live e2e suite.
- It should be runnable on developer machines with Docker available for testcontainers.
- It is designed for fast, stable regression checks during workflow and lifecycle refactors.

## Rollout / Follow-ups
Recommended follow-up increments after this epic:
1. Add deterministic variants for phase checkpoints 7..9.
2. Add CI job for deterministic suite with container reuse disabled.
3. Extract deterministic mock executor into reusable test utility for additional workflow integration suites.
4. Add optional metrics/assertions around run counts and event types for deeper invariants.

## Definition of Done
- Epic doc merged.
- Deterministic kanban integration command implemented.
- Existing e2e command left untouched.
- Typecheck and lint pass for changed code.
- Commits are organized by logical slices (doc, implementation).