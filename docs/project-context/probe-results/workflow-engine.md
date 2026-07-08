---
project_scope_id: 458935f0-213e-4bbe-89d1-8883e0efa9ad
probe_scope_id: workflow-engine
outcome: success
inferred_status: implemented
confidence_score: 0.92
evidence_refs:
  - apps/api/src/workflow/workflow-engine.service.ts
  - apps/api/src/workflow/workflow-engine.types.ts
  - apps/api/src/workflow/workflow.module.ts
  - apps/api/src/workflow/state-machine.service.ts
  - apps/api/src/workflow/dag-resolver.service.ts
  - apps/api/src/workflow/workflow-persistence.service.ts
  - apps/api/src/workflow/workflow-concurrency-manager.service.ts
  - apps/api/src/workflow/workflow-parser.service.ts
  - apps/api/src/workflow/kernel/interfaces/workflow-kernel.ports.ts
  - apps/api/src/workflow/workflow-step-execution/step-execution.consumer.ts
  - apps/api/src/workflow/workflow-step-execution/step-execution-orchestrator.service.ts
  - apps/api/src/workflow/workflow-subagents/mesh-delegation.service.ts
  - apps/api/src/workflow/workflow-repair/repair-policy.service.ts
  - apps/api/src/workflow/workflow-trigger-registry.service.ts
  - apps/api/src/workflow/workflow-launch/workflow-launch-orchestration.service.ts
  - apps/api/src/workflow/workflow-definition-loader.service.ts
  - apps/api/src/workflow/workflow-events.constants.ts
source_paths:
  - apps/api/src/workflow/
updated_at: 2026-05-22T00:00:00.000Z
---

# Probe Result: Workflow Engine Core

## Narrative Summary

The Workflow Engine Core is a fully implemented, production-grade orchestration engine with clear separation of concerns across launch, execution, persistence, concurrency control, and repair/retry concerns. The engine supports DAG-based job scheduling with parallel groups, concurrency policies (skip/queue/cancel_running), launch deduplication, dry-run mode, subagent delegation via mesh architecture, and a comprehensive repair subsystem for failure classification and automated remediation.

The architecture follows an event-driven pattern with canonical lifecycle events (`workflow.run.started`, `workflow.run.completed`, `workflow.run.cancelled`, etc.) that decouple listeners (audit, telemetry, Redis publisher, core lifecycle stream) from core execution logic. Step execution uses a BullMQ queue consumer with 4-concurrency worker pool.

## Capability Updates

**Core Engine Capabilities (Implemented)**
- `WorkflowEngineService.startWorkflow()` with concurrency check, launch dedupe, and run creation
- `WorkflowEngineService.cancelWorkflowRun()` with cascade cancellation of child runs and Docker container cleanup
- `WorkflowEngineService.pauseWorkflow()` / `resumeWorkflow()` with PENDING/RUNNING state transitions
- `WorkflowEngineService.handleJobComplete()` delegation to job execution service
- `WorkflowEngineService.resumeJobWithMessage()` / `retryJobWithMessage()` for user-driven retry

**DAG Resolution & Scheduling**
- `DAGResolverService.buildDependencyGraph()` with transition target validation
- `DAGResolverService.detectCycles()` using DFS with recursion stack
- `DAGResolverService.topologicalSort()` for parallel job grouping
- `DAGResolverService.findParallelJobs()` returning topological levels as parallel groups
- Initial job scheduling excludes transition targets from startup jobs

**State Machine & Transitions**
- `StateMachineService.evaluateTransition()` using expr-eval for condition evaluation
- Support for `&&`/`||` syntax normalization to `and`/`or`
- Conditional job skipping at execution time

**Concurrency Management**
- `ConcurrencyPolicyService` for max_runs enforcement with scope support
- `WorkflowConcurrencyManager.runExclusive()` with promise-based lock tracking
- Conflict resolution strategies: `proceed`, `skip`, `queue`, `cancel_running`
- Queued run coalescing by dedupe key and trigger context

**Persistence & Repository Layer**
- `WorkflowRepositoryAggregator` aggregating workflow/run/repo access
- `WorkflowPersistenceService` with CRUD for workflows and runs
- Paged query support with workflow ID normalization
- Status update via domain methods on entity

**Parser & Definition Loading**
- `WorkflowParserService.parseWorkflow()` with YAML parsing and schema validation
- `WorkflowDefinitionLoaderService.loadExecutableDefinition()` adding prompt resolution and full validation
- Support for `trigger.launch.inputs` with typed input validation
- Steps-to-jobs normalization for legacy workflow format compatibility
- `{{...}}` template variable extraction

**Step Execution**
- `StepExecutionConsumer` (BullMQ processor, concurrency: 4) handling legacy and new job data formats
- `StepExecutionOrchestratorService.executeJob()` with capability preflight, condition evaluation, and special job handling
- `StepSupportService` for tool policy application, agent profile resolution, and input resolution
- `StepSpecialStepExecutorService` for special job types (register_tool, invoke_workflow, etc.)

**Launch Orchestration**
- `WorkflowLaunchOrchestrationService.executeWorkflowInternal()` with contract validation
- Launch presets support with preset-specific trigger data injection
- Launch eligibility evaluation via `WorkflowLaunchContractService`
- Event ledger lifecycle events (`launch_requested`, `launch_validated`, `launch_executed`, `launch_rejected`)

**Subagent / Mesh Delegation**
- `MeshDelegationService` with governance evaluation and dispatch
- Lineage tracking (trace_id, parent_trace_id, lineage_depth, lineage_path)
- Contract lifecycle recording (queued, denied, completed, failed, cancelled)
- `MeshDelegationDispatchService` for queue depth management
- `MeshDelegationGovernanceService` for tool/capability policy enforcement

**Trigger Registry**
- `WorkflowTriggerRegistryService.resolveEventBindings()` / `resolveWebhookBindings()`
- Duplicate binding suppression across workflow definitions
- Recency-based sorting for deterministic binding resolution
- Diagnostic reporting with parse error tracking

**Repair Subsystem**
- `RepairPolicyService.applyPolicy()` with safety tags, confidence thresholds, human-required checks
- `WorkflowFailureClassificationService` for error categorization
- `WorkflowFailureDoctorCompletionListener` for automated repair completion
- Repair executor registry with configurable action policies
- Continuation policy service for post-repair workflow continuation

**Special Steps**
- `step-emit-event-special-step.handler` for workflow event emission
- `step-git-operation-special-step.handler` for version control operations
- `step-http-webhook-special-step.handler` for external HTTP calls
- `step-invoke-workflow-special-step.handler` for nested workflow execution
- `step-mcp-tool-call-special-step.handler` for MCP tool invocation
- `step-run-command-special-step.handler` for shell command execution
- `step-web-automation-special-step.handler` for browser automation

## Health Findings

**Test Coverage**
- 80+ `.spec.ts` files across the workflow engine
- Core engine spec: 19 test cases covering dedupe, concurrency policy, child cancellation, container cleanup
- DAG resolver spec: cycle detection, topological sorting, parallel job grouping
- State machine spec: transition evaluation with expr-eval
- Step execution orchestrator spec: condition evaluation, preflight failure handling
- Repair subsystem: failure classification rules, repair policy, dispatch service
- Subagents: mesh delegation, coordination, reaper service

**Code Quality Indicators**
- All services use `@Injectable()` decorator with proper constructor injection
- Kernel interfaces define contracts (`IWorkflowEngineService`, `IWorkflowPersistenceService`, etc.)
- Domain ports pattern for chat session abstraction
- Type-safe DTOs and entity types with explicit interfaces
- Well-documented constant files for event names

**Architecture Patterns**
- Event emitter pattern for lifecycle notification
- Repository aggregator pattern for data access
- Promise-based lock tracking in concurrency manager (prevents deadlocks)
- Template method pattern in kernel ports for extensible service contracts
- Hexagonal architecture with domain-ports, kernel interfaces, and infrastructure

## Open Questions

- **Scalability of BullMQ queue consumer**: The 4-concurrency fixed worker pool may need dynamic scaling based on workflow load
- **Circuit breaker for mesh delegation**: No explicit circuit breaker pattern found for subagent dispatch failures
- **Replay deduplication**: `MeshDelegationService.getReplay()` aggregates events; potential performance concern for long-running workflows with many delegations
- **Repair policy hot reload**: `REPAIR_POLICY_CONFIG` is statically defined; no runtime config refresh mechanism observed
- **Concurrency scope locking granularity**: Locks based on `concurrencyScope` string; potential for key collisions with complex scope patterns