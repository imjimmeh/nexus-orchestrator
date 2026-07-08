# EPIC-184: WorkflowEngineService Reduction

**Status:** Implemented
**Priority:** P1
**Depends On:** EPIC-183 (WorkflowPersistenceService Deepening)
**Related Epics:** EPIC-147 (Workflow Module Decomposition), EPIC-173 (Large Service Decomposition), EPIC-124 (Event-Driven Orchestration)
**Last Updated:** 2026-05-17

---

## 1. Summary

`WorkflowEngineService` (`apps/api/src/workflow/workflow-engine.service.ts`, 538 lines, 9 constructor dependencies) is the central orchestrator but it directly depends on persistence, concurrency, state management, DAG resolution, prompt loading, job execution, message queuing, event emitters, deduplication, and Docker. It also exposes workflow catalog pass-throughs such as `createWorkflow`, `getWorkflow`, and `getWorkflowRuns`.

The codebase already has an orchestration kernel port: `IWorkflowEngineService` and `WORKFLOW_ENGINE_SERVICE` in `apps/api/src/workflow/kernel/interfaces/workflow-kernel.ports.ts`. This epic narrows and corrects that existing port instead of introducing a parallel `WorkflowOrchestrationPort` abstraction.

---

## 2. High-Level Context

### 2.1 Current Structure

```typescript
@Injectable()
export class WorkflowEngineService {
  constructor(
    private readonly persistence: WorkflowPersistenceService,       // 1
    private readonly concurrency: WorkflowConcurrencyManager,       // 2
    private readonly stateManager: StateManagerService,             // 3
    private readonly dagResolver: DAGResolverService,               // 4
    private readonly promptLoader: PromptLoaderService,             // 5
    private readonly runExecution: WorkflowRunJobExecutionService,  // 6
    private readonly jobMessageQueue: WorkflowJobMessageQueueService, // 7
    private readonly eventEmitter: EventEmitter2,                   // 8
    private readonly workflowLaunchDedupe: WorkflowLaunchDedupeService, // 9
    @Inject(DOCKER_CLIENT) @Optional() private readonly docker?: Docker,
    @Optional() private readonly workflowRunRepository?: WorkflowRunRepository,
  ) {}

  // ~30 methods, many are pass-throughs:
  async createWorkflow(yamlDefinition: string): Promise<IWorkflow> {
    return this.persistence.createWorkflow(yamlDefinition);  // pass-through
  }

  async getWorkflow(id: string): Promise<IWorkflow> {
    return this.persistence.getWorkflow(id);  // pass-through
  }

  // Some have orchestration logic:
  async startWorkflow(...) {
    // dedupe check → concurrency check → parse → validate → create → emit event → resolve DAG → execute
  }

  // ... ~28 more methods
}
```

### 2.2 Problems

1. **God service:** 538 lines, 9 constructor dependencies, ~30 methods spanning CRUD, orchestration, and lifecycle management.
2. **Pass-through methods:** Workflow catalog and run query methods directly delegate to persistence.
3. **Stale kernel interface:** `IWorkflowEngineService` declares methods such as `pauseWorkflowRun`, `resumeWorkflowRun`, `completeWorkflowRun`, and `failWorkflowRun` that the concrete engine does not implement.
4. **Mixed responsibilities:** CRUD operations, lifecycle orchestration, DAG resolution, and event emission all sit on the same concrete class.
5. **Hard to test:** Testing one lifecycle path requires mocking many dependencies.
6. **Port too broad for callers:** Step executors only need `handleJobComplete`; launch/invoke paths only need `startWorkflow`; read-only tools need persistence, not orchestration.

### 2.3 What Callers Actually Need

Looking at who calls `WorkflowEngineService`:

- `WorkflowController` — mostly needs persistence for workflow catalog operations and run queries; launch routes live in `WorkflowLaunchModule`.
- `WorkflowAdHocSessionController` — needs `createAdHocSession`, `getAdHocSession`
- Internal services — need lifecycle control (start, pause, resume, cancel, stop)

The common pattern is not one port. It is **lifecycle orchestration for execution paths** plus **persistence/read ports for catalog and run queries**.

---

## 3. Goals

1. Reuse `IWorkflowEngineService` / `WORKFLOW_ENGINE_SERVICE` as the canonical orchestration port.
2. Correct `IWorkflowEngineService` so it only declares methods implemented by `WorkflowEngineService` and needed by orchestration callers.
3. Move read-only and workflow catalog callers to `IWorkflowPersistenceService` / `WORKFLOW_PERSISTENCE_SERVICE` where they do not need orchestration.
4. Remove persistence pass-through methods from the engine after callers no longer use them.
5. Reduce constructor coupling by moving workflow definition loading into the seam introduced by EPIC-183.
6. Preserve external behavior, HTTP contracts, event names, and database schema.

---

## 4. Non-Goals

1. No changes to the internal logic of any service the engine depends on.
2. No changes to database schema or repository structure.
3. No changes to external API contracts (HTTP routes, DTOs, event names).
4. No changes to DAG resolution, state machine, or concurrency policy internals.

---

## 5. Implementation Phases

### Phase 1: Correct the Existing Engine Port

- **Task E184-001: Narrow `IWorkflowEngineService` in place**
  - File: `apps/api/src/workflow/kernel/interfaces/workflow-kernel.ports.ts`.
  - Keep the existing `WORKFLOW_ENGINE_SERVICE` token.
  - Remove workflow catalog CRUD/query methods that belong to `IWorkflowPersistenceService`.
  - Remove methods that are declared but not implemented by `WorkflowEngineService`.
  - Keep orchestration methods used by runtime callers:
    ```typescript
    startWorkflow(...): Promise<string | null | WorkflowDryRunResult>;
    cancelWorkflowRun(runId: string, reason?: string): Promise<void>;
    handleJobComplete(workflowRunId: string, jobId: string, output: Record<string, unknown>): Promise<void>;
    resumeJobWithMessage(workflowRunId: string, sessionTreeId: string, userMessage: string): Promise<string>;
    retryJobWithMessage(...): Promise<void>;
    ```
  - Do not create a second `IWorkflowOrchestrationPort` token.

### Phase 2: Reduce the Engine

- **Task E184-002: Move read-only/catalog callers off the engine**
  - Update `WorkflowController` to inject `WORKFLOW_PERSISTENCE_SERVICE` for create/list/get/update/delete workflow operations and run queries.
  - Update `WorkflowMetaToolsHandler` to inject `WORKFLOW_PERSISTENCE_SERVICE` for workflow catalog tools.
  - Update `WorkflowInternalCoreRunsService` to use persistence for `getWorkflowRun` after start.
  - Update `WorkflowRunSteeringService.abort` to validate run existence through persistence instead of engine read pass-throughs.

- **Task E184-003: Remove pass-through methods from `WorkflowEngineService`**
  - Remove `createWorkflow`, `getWorkflow`, `getAllWorkflows`, `getAllWorkflowsPaged`, `getWorkflowRuns`, `getWorkflowRunsPaged`, `getWorkflowRun`, `updateWorkflow`, and `deleteWorkflow` once callers have moved.
  - Replace internal uses of `this.getWorkflow(...)` with `this.persistence.getWorkflow(...)` or the EPIC-183 definition loader.

- **Task E184-004: Keep orchestration-only methods**
  - `startWorkflow`, `pauseWorkflow`, `resumeWorkflow`, `cancelWorkflow` — these have real orchestration logic.
  - `dryRunWorkflow` — this has real orchestration simulation logic.
  - `getWorkflowStatus`, `getWorkflowMetrics` — these aggregate state from multiple services.

- **Task E184-005: Make `WorkflowEngineService` implement the existing port**
  - Add `implements IWorkflowEngineService`.
  - Keep the `WORKFLOW_ENGINE_SERVICE` binding as `useExisting: WorkflowEngineService`.
  - **Files:** `workflow/workflow-engine.service.ts`.

### Phase 3: Update Callers

- **Task E184-006: Update `WorkflowController`**
  - Inject `IWorkflowPersistenceService` via `WORKFLOW_PERSISTENCE_SERVICE` instead of `WorkflowEngineService` for current catalog/read operations.
  - **Files:** `workflow/workflow.controller.ts`.

- **Task E184-007: Update all other callers**
  - Find all files that inject `WorkflowEngineService`.
  - Update to inject `IWorkflowEngineService` or `IWorkflowPersistenceService` as appropriate.
  - **Scope:** Controllers, internal services, event listeners.

### Phase 4: Register the Port

- **Task E184-008: Keep existing binding in `WorkflowModule`**
  - Keep:
    ```typescript
    { provide: WORKFLOW_ENGINE_SERVICE, useExisting: WorkflowEngineService }
    ```
  - Do not add `IWorkflowOrchestrationPort`.

### Phase 5: Verify

- **Task E184-009: Run build and typecheck**
  - `npm run build:api`
  - Verify zero TypeScript errors.

- **Task E184-010: Run tests**
  - `npm run test:api`
  - Verify all tests pass.

- **Task E184-011: Measure reduction**
  - Count pass-through methods — target 0 workflow catalog CRUD/query pass-throughs.
  - Count `IWorkflowEngineService` methods — target only orchestration/runtime methods that callers actually use.
  - Treat `WorkflowEngineService` line count as a follow-up metric. Reaching ≤150 lines likely requires a second extraction epic for start/cancel/resume internals.

---

## 6. Expected Outcomes

| Metric                                      | Before            | After                                                            |
| ------------------------------------------- | ----------------- | ---------------------------------------------------------------- |
| `IWorkflowEngineService` stale declarations | Present           | Removed                                                          |
| Workflow catalog pass-through methods       | Present on engine | Removed from engine                                              |
| Read-only callers depending on engine       | Present           | Depend on persistence port                                       |
| Parser/validator access through persistence | Present           | Removed via EPIC-183 loader                                      |
| `WorkflowEngineService` lines               | 538               | Reduced; ≤150 deferred to a follow-up extraction if still needed |

---

## 7. Risk and Mitigation

| Risk                                                 | Mitigation                                                                                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Some callers need both orchestration and persistence | Inject both existing ports: `WORKFLOW_ENGINE_SERVICE` and `WORKFLOW_PERSISTENCE_SERVICE`                                        |
| `WorkflowEngineService` remains >150 lines           | Accept as expected for this epic; plan a follow-up extraction of start/cancel/resume internals if needed                        |
| Duplicate orchestration abstraction                  | Reuse `WORKFLOW_ENGINE_SERVICE`; do not add a new orchestration token                                                           |
| Circular dependencies during caller migration        | Preserve existing `useExisting` token bindings and lazy `ModuleRef` lookups where they are already used to break startup cycles |
