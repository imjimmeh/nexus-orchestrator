# EPIC-126 — Unified Context Resolution & Rich Domain Models

**Status:** Proposed  
**Created:** 2026-04-19  
**Related Epics:** EPIC-119 (Domain Hardening), EPIC-123 (Service Decomposition)

---

## Background

The project currently has scattered logic for resolving execution context (Project ID, Run ID, User identity) from various sources. Additionally, many core business rules—such as status transition logic—are located in services rather than in the domain entities themselves. This lead to "Anemic Domain Models" where entities are just data bags.

## Goals

1. **Context Uniformity:** Provide a single, reliable way to resolve domain context across all layers (API, Workflow, Tools).
2. **Logic Locality:** Move business rules and state transition logic into the domain entities (Rich Domain Model).
3. **Reduced Redundancy:** Eliminate repeated code for extracting context from request headers or state variables.
4. **Improved Integrity:** Ensure entities are always in a valid state by encapsulating mutations.

## Actionable Tasks

### PR 1: Unified `ExecutionContextResolver` & Context Uniformity
- **Goal:** Centralize context resolution (ProjectId, WorkflowRunId, AgentIdentity).
- **Tasks:**
  - [ ] Implement `ExecutionContextResolver` service in `apps/api/src/workflow/`.
  - [ ] Standardize parsing of agent identity from `userId` format `agent:runId:jobId`.
  - [ ] Replace manual context extraction in `WorkflowRuntimeToolsService`.
  - [ ] Replace manual context extraction in `WorkflowInternalCoreRunsService`.
  - [ ] Standardize header-based context extraction in controllers.
- **Files to Change:**
  - `apps/api/src/workflow/execution-context-resolver.service.ts` (New)
  - `apps/api/src/workflow/workflow-runtime-tools.service.ts`
  - `apps/api/src/workflow/workflow-internal-core-runs.service.ts`
  - `apps/api/src/workflow/workflow-runtime-tools.context.ts` (Refactor)
  - `apps/api/src/workflow/workflow.module.ts` (Register new service)

### PR 2: Rich Domain Model — `WorkItem`
- **Goal:** Move status transition logic into the `WorkItem` entity.
- **Tasks:**
  - [ ] Add `transitionTo(status: WorkItemStatus): void` method to `WorkItem` entity.
  - [ ] Migrate `WORK_ITEM_ALLOWED_TRANSITIONS` (rename to `WORK_ITEM_TRANSITIONS`) as a static member of `WorkItem`.
  - [ ] Move validation logic from `work-item-service-mutations.helpers.ts` into `WorkItem.transitionTo`.
  - [ ] Refactor `WorkItemService` and its helpers to use the domain method.
- **Files to Change:**
  - `apps/api/src/database/entities/work-item.entity.ts`
  - `apps/api/src/project/work-item.constants.ts` (Refactor/Deprecate)
  - `apps/api/src/project/work-item-service-mutations.helpers.ts`
  - `apps/api/src/project/work-item.service.ts`

### PR 3: Rich Domain Model — `WorkflowRun`
- **Goal:** Move status and state management into the `WorkflowRun` entity.
- **Tasks:**
  - [ ] Add `updateStatus(status: WorkflowStatus): void` method to `WorkflowRun`.
  - [ ] Add `setStateVariable(path: string, value: any): void` method to `WorkflowRun`.
  - [ ] Ensure `WorkflowRun` encapsulates its internal state mutations.
  - [ ] Update `WorkflowPersistenceService` and `WorkflowEngineService` to use entity methods.
- **Files to Change:**
  - `apps/api/src/database/entities/workflow-run.entity.ts`
  - `apps/api/src/workflow/workflow-persistence.service.ts`
  - `apps/api/src/workflow/workflow-engine.service.ts`

### PR 4: Repository & Service Cleanup
- **Goal:** Standardize database queries involving JSONB `state_variables`.
- **Tasks:**
  - [ ] Standardize the way `projectId` and `workItemId` are queried in `WorkflowRunRepository`.
  - [ ] Use `ExecutionContextResolver` across all remaining high-level services in the orchestration layer.
- **Files to Change:**
  - `apps/api/src/database/repositories/workflow-run.repository.ts`
  - `apps/api/src/database/repositories/workflow-event.repository.ts`

## Acceptance Criteria

- [ ] A single `ExecutionContextResolver` is used across at least 80% of the orchestration layer.
- [ ] Logic for status transitions is moved from `WorkItemService` into the `WorkItem` entity.
- [ ] No manual extraction of `projectId` from JSONB `state_variables` remains in high-level services.
- [ ] Unit tests for entities (`WorkItem`, `WorkflowRun`) cover all valid and invalid state transitions.
- [ ] All `state_variables` mutations in `WorkflowRun` are performed via domain methods.
