# EPIC-124 — Event-Driven Workflow Lifecycle & Reactive Orchestration

**Status:** Proposed  
**Created:** 2026-04-19  
**Related Epics:** EPIC-033 (Observability/Event Sourcing), EPIC-123 (Service Decomposition)

---

## Background

The core orchestration engine currently relies on synchronous, tight coupling between the execution logic and side effects (logging, queuing, telemetry, cross-service fanout). Multiple services (`WorkflowEngineService`, `WorkflowRunJobExecutionService`, `WorkflowInternalCoreRunsService`) directly invoke `WorkflowEventLogService` and other side-effect handlers. This makes it difficult to add new cross-cutting concerns without modifying the central engine logic.

## Goals

1. **Reactive Flow:** Move from imperative "call service X then Y" to "emit event E, listeners react".
2. **Decoupling Side Effects:** Logging, auditing, Redis broadcasting, and secondary notifications should be handled by independent listeners.
3. **Resilience:** Use the NestJS `EventEmitter2` bus to separate critical execution paths from non-critical observability paths.
4. **Extensibility:** Allow new modules (like Kanban or Telemetry) to hook into the workflow lifecycle without modifying the core engine.

## Implementation Plan & Actionable Tasks

### Phase 1: Event Infrastructure & Canonical Definitions
Standardize the event schema to ensure listeners have all necessary context (Run ID, Job ID, Status, State Variables) without re-querying the database.

- **Task 1.1: Define Canonical Event Types and Payloads**
  - **File:** `apps/api/src/workflow/workflow-events.types.ts` (New)
  - **Action:** Define interfaces for `WorkflowRunEvent` and `WorkflowJobEvent`.
  - **Events:** `workflow.run.created`, `workflow.run.started`, `workflow.run.completed`, `workflow.run.failed`, `workflow.run.cancelled`, `workflow.run.paused`, `workflow.run.resumed`, `workflow.job.queued`, `workflow.job.started`, `workflow.job.completed`, `workflow.job.failed`.
- **Task 1.2: Standardize Event Name Constants**
  - **File:** `apps/api/src/workflow/workflow-events.constants.ts` (New)
  - **Action:** Define `const` strings for all event names to avoid typos across listeners.

### Phase 2: Refactor Core Services to Emit Events
Remove direct service calls and replace them with `EventEmitter2.emit()`.

- **Task 2.1: Refactor `WorkflowEngineService`**
  - **File:** `apps/api/src/workflow/workflow-engine.service.ts`
  - **Action:** Remove `WorkflowEventLogService`. Inject `EventEmitter2`. Emit events in `createAndStartRun`, `cancelWorkflowRun`, `pauseWorkflow`, and `resumeWorkflow`.
- **Task 2.2: Refactor `WorkflowRunJobExecutionService`**
  - **File:** `apps/api/src/workflow/workflow-run-job-execution.service.ts`
  - **Action:** Remove `WorkflowEventLogService`. Emit events in `enqueueJob`, `handleJobComplete`, `handleJobFailed`, and `progressDagOrComplete`.
- **Task 2.3: Refactor `WorkflowInternalCoreRunsService`**
  - **File:** `apps/api/src/workflow/workflow-internal-core-runs.service.ts`
  - **Action:** Remove direct calls to `WorkflowEventLogService` and `WorkflowCoreLifecycleFanoutService`. Emit canonical events instead.

### Phase 3: Implement Reactive Listeners
Create specialized listeners that encapsulate side-effect logic.

- **Task 3.1: Implement `WorkflowAuditListener`**
  - **File:** `apps/api/src/workflow/listeners/workflow-audit.listener.ts` (New)
  - **Action:** Subscribe to all `workflow.*` and `job.*` events. Call `WorkflowEventLogService.appendBestEffort`.
- **Task 3.2: Implement `WorkflowRedisPublisherListener`**
  - **File:** `apps/api/src/workflow/listeners/workflow-redis-publisher.listener.ts` (New)
  - **Action:** Subscribe to lifecycle events and call `StepEventPublisherService.publishBestEffort` to keep the UI synchronized.
- **Task 3.3: Implement `WorkflowCoreLifecycleFanoutListener`**
  - **File:** `apps/api/src/workflow/listeners/workflow-core-lifecycle-fanout.listener.ts` (New)
  - **Action:** Move the logic from `WorkflowInternalCoreRunsService` that fans out to the Kanban service into this listener.
- **Task 3.4: Implement `WorkflowTelemetryListener`**
  - **File:** `apps/api/src/workflow/listeners/workflow-telemetry.listener.ts` (New)
  - **Action:** Listen to events and update metrics via `MetricsService`.

### Phase 4: Migration & Cleanup
- **Task 4.1: Deprecate `WORKFLOW_RUN_STATUS_CHANGED_EVENT`**
  - **Action:** Migrate all existing listeners (e.g., `WorkItemDispatchCoordinator`, `AutomationHooksListener`) to listen to the new canonical `workflow.run.started/completed/failed` events.
- **Task 4.2: Integration Testing**
  - **Action:** Create a test suite that triggers a workflow and verifies that the Audit Log, Redis Stream, and Metrics are all updated via their respective listeners.

## Acceptance Criteria

- [ ] `WorkflowEngineService` and `WorkflowRunJobExecutionService` have zero direct dependencies on `WorkflowEventLogService`.
- [ ] Every major workflow state change is represented by a emitted event.
- [ ] Side effects (Logging, UI Updates, Kanban Fanout) are handled by listeners in the `workflow/listeners/` directory.
- [ ] Existing functionality (Audit Ledger, UI real-time updates) remains operational without regression.
- [ ] Event ordering and delivery are verified via integration tests.
