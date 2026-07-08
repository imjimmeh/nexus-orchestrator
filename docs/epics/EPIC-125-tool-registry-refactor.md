# EPIC-125 — Pluggable Tool Registry & Capability Handler Pattern

**Status:** In Progress (Core + Runtime Dispatcher Implemented)  
**Created:** 2026-04-19  
**Related Epics:** EPIC-004 (Tool Registry), EPIC-123 (Service Decomposition)

---

## Background

Currently, the tools available to agents are hardcoded as methods within `WorkflowRuntimeToolsService` and grouped into monolithic handlers (`ProjectToolsHandler`, `WorkItemToolsHandler`, etc.). Adding or modifying a tool requires changing these large classes, violating the Open/Closed Principle. 

## Goals

1. **Open/Closed Architecture:** Add or modify internal tools (API-based capabilities) without modifying core orchestration services.
2. **Internal Tool Registry:** A central service that automatically discovers and manages `IInternalToolHandler` instances.
3. **Standardized Tool Interface:** Every internal tool implements a common interface for execution, metadata, and schema generation.
4. **Decoupled Dispatcher:** Refactor `WorkflowRuntimeToolsService` into a pure dispatcher that resolves and executes tools from the registry.

## Actionable Phases & Tasks

### Phase 1: Core Framework (Infrastructure)

- **Task E125-001: Define Core Interfaces & Types**
  - Create `packages/core/src/interfaces/internal-tool.types.ts`.
  - Define `IInternalToolHandler<TParams, TResult>`:
    ```ts
    export interface IInternalToolHandler<TParams = any, TResult = any> {
      getName(): string;
      getDefinition(): RuntimeCapabilityDefinition;
      execute(context: InternalToolExecutionContext, params: TParams): Promise<TResult>;
    }
    ```
  - Define `InternalToolExecutionContext` containing `workflowRunId`, `jobId`, `projectId`, `userId`, `userRoles`, `agentProfileName`.
  - **Files:** `packages/core/src/interfaces/internal-tool.types.ts`, `packages/core/src/index.ts`.

- **Task E125-002: Implement `InternalToolRegistryService`**
  - Create `apps/api/src/tool/internal-tool-registry.service.ts`.
  - Use NestJS `@Inject(INTERNAL_TOOL_HANDLER)` to collect all registered handlers dynamically.
  - Implement lookup by name and metadata aggregation for capability snapshots.
  - **Files:** `apps/api/src/tool/internal-tool-registry.service.ts`, `apps/api/src/tool/tool.module.ts`.

---

### Phase 2: Granular Tool Extraction (Handlers to Tools)

- **Task E125-003: Migrate Project Tools**
  - Extract `getProjectState`, `getProjectBrief`, and `getRunDiagnostics` into individual tool classes.
  - **Files:** 
    - `apps/api/src/workflow/tools/project/get-project-state.tool.ts`
    - `apps/api/src/workflow/tools/project/get-project-brief.tool.ts`
    - `apps/api/src/workflow/tools/project/get-run-diagnostics.tool.ts`

- **Task E125-004: Migrate Memory Tools**
  - Extract `queryMemory` into its own tool class.
  - **Files:** `apps/api/src/workflow/tools/memory/query-memory.tool.ts`.

- **Task E125-005: Migrate Work Item Tools**
  - Extract `getWorkItems`, `getWorkItem`, `getTodoList`, `manageTodoList`, `getWorkItemHistory`, and `getOrchestrationTimeline`.
  - **Files:** `apps/api/src/workflow/tools/work-items/*.tool.ts`.

- **Task E125-006: Migrate Workflow & Schedule Meta-Tools**
  - Extract workflow CRUD and schedule management tools.
  - **Files:** `apps/api/src/workflow/tools/workflow/*.tool.ts`, `apps/api/src/workflow/tools/schedule/*.tool.ts`.

---

### Phase 3: Dispatcher Refactor

- **Task E125-007: Refactor `WorkflowRuntimeToolsService` into a Dispatcher**
  - Inject `InternalToolRegistryService` and `WorkflowRuntimeCapabilityExecutorService`.
  - Implement a generic `executeInternalTool(name, params, userContext)` method.
  - Update legacy methods to proxy through the registry (or remove if no longer needed).
  - **Files:** `apps/api/src/workflow/workflow-runtime-tools.service.ts`.

---

### Phase 4: Integration & Validation

- **Task E125-008: Update `WorkflowRuntimeToolsController`**
  - Ensure all tool endpoints correctly route through the new dispatcher.
  - Add a generic `POST /workflow-runtime/call` endpoint for dynamic tool invocation by agents (optional enhancement, primarily for agent generic call routes if we want to avoid generating unique controller paths for every internal tool).
  - **Files:** `apps/api/src/workflow/workflow-runtime-tools.controller.ts`.

- **Task E125-009: Regression Testing & Manifest Validation**
  - Verify that `CapabilityPreflightService` correctly generates capability snapshots and manifests from the new registry.
  - Run E2E tests for tool execution (e.g., `workflow-logic.e2e-spec.ts`).
  - **Files:** `apps/api/src/tool/capability-preflight.service.ts` (if adjustments are needed), E2E test suites.

## Acceptance Criteria

- [x] A new internal tool can be added by creating a single class and registering it as a provider with the `INTERNAL_TOOL_HANDLER` token.
- [x] `WorkflowRuntimeToolsService` has fewer than 7 direct dependencies (decoupled from individual handlers).
- [x] Tool metadata (Zod schemas) are exposed from each handler's `getDefinition()` method.
- [x] Existing workflow-runtime internal tools are migrated to individual internal-tool handlers.
- [x] Unit tests for `InternalToolRegistryService` cover lookup, duplicate detection, and execution proxying.

## Implementation Notes (2026-04-19)

- Added shared internal tool contracts in `packages/core/src/interfaces/internal-tool.types.ts` and exported them through core barrels.
- Added `INTERNAL_TOOL_HANDLER` token and `InternalToolRegistryService` in API tool infrastructure.
- Extracted runtime tools into granular classes under `apps/api/src/workflow/tools/**` for:
  - project tools
  - memory tools
  - work-item tools
  - workflow-definition tools
  - schedule tools
- Refactored `WorkflowRuntimeToolsService` into a dispatcher-oriented service with:
  - capability snapshot and chat capability APIs
  - generic `executeInternalTool(...)` execution path
  - reduced direct dependencies on monolithic handlers
- Updated `WorkflowRuntimeToolsController` with a generic `POST /workflow-runtime/call` endpoint and routed internal-tool endpoints through dispatcher calls.
- Added unit tests for `InternalToolRegistryService` and updated runtime tools service tests to validate registry-based dispatching.
- Updated import-boundary exceptions for existing allowlisted workflow -> project constants imports to keep architecture guardrail tests green.