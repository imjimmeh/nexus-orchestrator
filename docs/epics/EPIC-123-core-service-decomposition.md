# EPIC-123 — Core Service Decomposition & Dependency Decoupling

**Status:** Proposed  
**Created:** 2026-04-19  
**Related Epics:** EPIC-119 (Domain Hardening), EPIC-124 (Event-Driven Orchestration)

---

## Background

The current orchestration logic is concentrated in a few "God Services" such as `WorkflowEngineService` and `WorkflowRuntimeToolsService`. These classes have grown to handle 12+ dependencies and multiple disparate responsibilities (CRUD, execution, concurrency, tool logic, etc.). This leads to tight coupling, fragile tests, and high cognitive load for developers.

## Goals

1. **Adhere to SRP:** Ensure every service has a single, well-defined responsibility.
2. **Reduce Constructor Bloat:** Target a maximum of 5-7 dependencies per service.
3. **Improve Testability:** Enable isolated unit testing of orchestration logic without mocking the entire world.
4. **Clean Boundaries:** Separate persistence logic from orchestration and tool execution logic.

## Stories

### 1. Decompose `WorkflowEngineService`
- Split into `WorkflowPersistenceService` (CRUD/Repo access).
- Split into `WorkflowConcurrencyManager` (Locking and Deduplication).
- `WorkflowEngineService` becomes a high-level coordinator.

### 2. Decompose `WorkflowRuntimeToolsService`
- Extract core tool categories (Project, Work Item, Memory) into dedicated handler services.
- Move formatting logic into pure utility functions or dedicated formatting services.

### 3. Introduce Dependency Aggregators (Facades)
- Create `WorkflowRepositoryAggregator` to group multiple related repositories.
- Use these aggregators to reduce constructor noise in orchestrator-level services.

## Acceptance Criteria

- [ ] `WorkflowEngineService` constructor has < 7 dependencies.
- [ ] `WorkflowRuntimeToolsService` constructor has < 7 dependencies.
- [ ] New persistence-only services created for Workflow and WorkflowRun entities.
- [ ] All existing tests pass after refactoring.
- [ ] No circular dependencies introduced during decomposition.
