---
project_scope_id: 458935f0-213e-4bbe-89d1-8883e0efa9ad
probe_scope_id: workflow-step-execution
outcome: success
inferred_status: implemented
confidence_score: 0.88
evidence_refs:
  - apps/api/src/workflow/workflow-step-execution/step-execution.consumer.ts
  - apps/api/src/workflow/workflow-step-execution/step-execution.consumer.spec.ts
  - apps/api/src/workflow/workflow-step-execution/step-execution-orchestrator.service.ts
  - apps/api/src/workflow/workflow-step-execution/step-execution-orchestrator.service.spec.ts
  - apps/api/src/workflow/workflow-step-execution/step-execution.service.ts
  - apps/api/src/workflow/workflow-step-execution/step-execution.service.spec.ts
  - apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.service.ts
  - apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.multistep.ts
  - apps/api/src/workflow/workflow-step-execution/step-support.service.ts
  - apps/api/src/workflow/workflow-step-execution/step-support.service.spec.ts
  - apps/api/src/workflow/workflow-step-execution/step-required-tool-retry.service.ts
  - apps/api/src/workflow/workflow-step-execution/step-required-tool-retry.service.spec.ts
  - apps/api/src/workflow/workflow-step-execution/workflow-auto-retry-activation-guard.service.ts
  - apps/api/src/workflow/workflow-step-execution/workflow-auto-retry-activation-guard.service.spec.ts
  - apps/api/src/workflow/workflow-step-execution/step-agent-container-support.service.ts
  - apps/api/src/workflow/workflow-step-execution/step-container-runtime.service.ts
  - apps/api/src/workflow/workflow-step-execution/step-event-publisher.service.ts
  - apps/api/src/workflow/workflow-step-execution/workflow-step-execution.module.ts
  - apps/api/src/workflow/workflow-step-execution/step-execution.helpers.ts
  - apps/api/src/workflow/workflow-step-execution/step-execution.service.types.ts
source_paths:
  - apps/api/src/workflow/workflow-step-execution/
updated_at: 2026-06-02T12:00:00.000Z
---

# Probe Result: Workflow Step Execution

## Narrative Summary

The workflow step execution scope is **fully implemented** as a layered architecture that dispatches BullMQ jobs through an orchestrator down to Docker container-based agent execution. The system handles capability preflight validation, job condition evaluation, special-step delegation (tool registration, workflow invocation), container provisioning and lifecycle, step-by-step execution with transition state machines, output contract retry enforcement, and real-time event publishing via Redis streams and pub/sub.

The key layers are:
1. **BullMQ Consumer** (`StepExecutionConsumer`) — processes workflow-step queue jobs with concurrency=4, legacy format normalization, stale auto-retry guard, and failure finalization.
2. **Orchestrator** (`StepExecutionOrchestratorService`) — validates run existence and status, publishes `job_start` events, evaluates job-level conditions, gates via capability preflight, delegates to special step executor or agent executor.
3. **Agent Executor** (`StepAgentStepExecutorService` + `executeJobCore`) — provisions Docker containers, injects sessions, streams logs, executes agent steps via in-container HTTP server, handles provider transient failure retry, saves sessions, enforces output contract retry via `StepRequiredToolRetryService`.
4. **Step Execution Service** (`StepExecutionService`) — inner loop executing steps sequentially with transitions, loop limits, needs-based skipping, conditional evaluation, and `on_error: continue` handling.
5. **Support Services** (`StepSupportService`) — tool selection, agent profile resolution, upstream context building, worktree path resolution, skill assignment, workflow invocation polling.
6. **Infrastructure** — container support, log streaming, event publishing, auto-retry activation guard.

## Capability Updates

| Capability | Status | Notes |
|---|---|---|
| BullMQ job processing (workflow-steps queue) | ✅ Implemented | `StepExecutionConsumer` with concurrency=4, legacy format support, stale auto-retry guard |
| Run existence and status validation | ✅ Implemented | `StepExecutionOrchestratorService.resolveRunnableRun` |
| Job condition evaluation | ✅ Implemented | Condition expression resolution via `StepSupportService.resolveJobInputs` |
| Capability preflight gating | ✅ Implemented | `CapabilityPreflightService.preflightJobExecution` in orchestrator; skips on failure |
| Special step handling (register_tool, invoke_workflow) | ✅ Implemented | Delegated to `StepSpecialStepExecutorService` |
| Agent step execution in Docker container | ✅ Implemented | `StepAgentStepExecutorService` → `executeJobCore` → in-container agent server |
| Session injection from prior review rejection | ✅ Implemented | `injectPreviousSessionCore` via `SessionHydrationService` |
| Session persistence after job completion | ✅ Implemented | `saveSessionAndUpdateResourceCore` |
| In-session transient retry (429/529 handling) | ✅ Implemented | `StepAgentInSessionTransientRetryHelpers` with configurable backoff, jitter, unbounded flags |
| Output contract retry enforcement | ✅ Implemented | `StepRequiredToolRetryService.checkRequiredToolCallsAndRetryJob` with auto-satisfy fallback for orchestration decisions |
| Container provisioning (light/heavy tier) | ✅ Implemented | `StepAgentContainerSupportService.provisionJobContainer` |
| Container startup and log streaming | ✅ Implemented | `StepAgentContainerSupportService.startContainer` + `StepContainerRuntimeService` |
| Container cleanup | ✅ Implemented | `StepAgentContainerSupportService.cleanupJobResources` with host-mount audit events |
| Stale auto-retry job guard | ✅ Implemented | `WorkflowAutoRetryActivationGuardService.shouldSkipStaleAutoRetryJob` |
| Tool selection per job | ✅ Implemented | `StepSupportService.selectToolsForJob` + `resolveAllowedToolNames` |
| Agent profile resolution | ✅ Implemented | `StepSupportService.resolveAgentProfileFromJobInputs` |
| Upstream context building | ✅ Implemented | `StepSupportService.buildUpstreamContextForJob` with implicit context inference |
| Skill assignment per profile and stage | ✅ Implemented | `StepSupportService.resolveAssignedSkillsForProfile` via `WorkflowStageSkillPolicyService` |
| Workflow invocation polling | ✅ Implemented | `StepSupportService.waitForWorkflowRunCompletion` |
| Worktree path resolution | ✅ Implemented | `StepSupportService.resolveWorktreePathFromTrigger` with explicit, project-scoped, and basePath fallbacks |
| Step-by-step execution (inner loop) | ✅ Implemented | `StepExecutionService.execute` with transitions, loop limits, needs-based skipping, `on_error: continue` |
| Run command step execution | ✅ Implemented | `executeCommandStepOnContainer` |
| Job failure finalization | ✅ Implemented | `StepExecutionConsumer.onFailed` with retry exhaustion detection |
| Event publishing (Redis stream + pubsub) | ✅ Implemented | `StepEventPublisherService.publishBestEffort` |

## Health Findings

### Test Coverage

- **`step-execution.consumer.spec.ts`**: 6 test cases covering process delegation, stale auto-retry skip, matching auto-retry, failure finalization (exhausted vs in-flight), and error swallowing.
- **`step-execution-orchestrator.service.spec.ts`**: 6 test cases covering special-step delegation, agent executor delegation, capability preflight failure, run-not-found, run-not-running, and condition-false skip.
- **`step-execution.service.spec.ts`**: 9 test cases covering sequential execution, conditional transitions, loop limits, `fail_job` target, `on_error: continue`, `ok:false` handling, and explicit transition routing.
- **`step-support.service.spec.ts`**: 15 test cases covering agent tool policy resolution, worktree path resolution (explicit, fallback, orchestration-lifecycle sentinel, project-scoped), and various trigger field permutations.
- **`step-required-tool-retry.service.spec.ts`**: 7 test cases covering no-contract path, contract-satisfied audit, contract-unsatisfied retry, retry exhaustion, fallback-to-stateless, and orchestration decision auto-satisfy.
- **`workflow-auto-retry-activation-guard.service.spec.ts`**: 5 test cases covering non-auto-retry pass-through, auto-retry queue ID mismatch, matching auto-retry, terminal run skip, and stale attempt metadata.

**Missing specs:**
- `step-agent-step-executor.service.spec.ts` — main execution service has no dedicated unit tests (covered indirectly through orchestrator tests)
- `step-agent-container-support.service.spec.ts` — container provisioning and cleanup not directly unit-tested
- `step-container-runtime.service.spec.ts` — log streaming not directly unit-tested
- Several helper files lack direct test coverage: `step-agent-step-executor.helpers.ts`, `step-agent-step-executor.completion.ts`, `step-agent-container-support.helpers.ts`, `step-agent-container-config.helpers.ts`, `step-support.helpers.ts`, `step-support-inputs.helpers.ts`, `step-support-context.helpers.ts`, `step-support-tool-policy.helpers.ts`

### Code Quality

- Clean separation of concerns: BullMQ consumer delegates to orchestrator, orchestrator delegates to executor, executor delegates to container support and step execution service.
- `JobExecutionDependencies` interface centralizes all runtime callbacks and services, enabling testability and separation of concerns.
- Provider transient failure classification (`classifyProviderTransientFailure`) is wired into the execution path with configurable retry behavior.
- Host mount lifecycle audit events emitted via `HostMountAuditService`.
- Legacy job format normalization is handled in the consumer layer with a compatibility wrapper.

### Churn Signals

- `step-agent-step-executor.service.ts` is large (500+ lines) with complex retry config resolution logic — consider extracting retry configuration parsing into a dedicated helper.
- `StepSupportService` handles many responsibilities (tool resolution, profile, worktree, upstream context, skill assignment, workflow polling) — may benefit from decomposition over time.

## Open Questions

1. **`step-agent-step-executor.service.spec.ts` missing**: The main service handling container provisioning and job execution lacks dedicated unit tests; coverage relies on orchestrator-level integration tests. Consider adding direct unit tests for container lifecycle mock interactions.
2. **Helper file spec coverage**: Multiple helper modules (`helpers.ts`, `helpers.spec.ts`, `*.helpers.ts`) are not directly tested — behavioral coverage depends on consumer/orchestrator integration.
3. **`step-container-runtime.service.ts` not reviewed**: Log streaming implementation and error handling path not examined in detail.
4. **In-session retry config migration**: The system reads retry settings from `SystemSettingsService` with hardcoded environment variable fallbacks; behavior when settings service is unavailable is unverified.
5. **Orchestration decision auto-satisfy scope creep**: `StepRequiredToolRetryService.autoSatisfyOrchestrationDecisionContract` applies a hardcoded job name match (`ceo_orchestration_decision`) — this pattern may need generalization if more auto-satisfy cases emerge.