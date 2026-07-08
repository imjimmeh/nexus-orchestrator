---
project_scope_id: 458935f0-213e-4bbe-89d1-8883e0efa9ad
probe_scope_id: workflow-subagents
outcome: success
inferred_status: implemented
confidence_score: 0.92
evidence_refs:
  - workflow-subagents.module.ts (module definition)
  - subagent-orchestrator.spawn.operations.ts (spawn pipeline)
  - subagent-orchestrator.runtime.operations.ts (completion handling)
  - mesh-delegation.service.ts (governance-aware delegation)
  - agent-communication-mesh.service.ts (inter-agent communication)
  - subagent-execution-reaper.service.ts (stale execution cleanup)
  - 11 *.spec.ts test files (test coverage)
source_paths:
  - apps/api/src/workflow/workflow-subagents
updated_at: 2026-06-02T00:00:00.000Z
---

# Probe Result: Workflow Subagents

## Narrative Summary

The `workflow-subagents` scope is a fully implemented, production-grade subsystem for spawning, coordinating, and managing subagent executions within workflow runs. It provides a clean split between concerns: the **SubagentOrchestrator** handles spawn/runtime operations, **MeshDelegationService** owns inter-agent delegation contracts with governance enforcement, **SubagentCoordinationService** handles wait/cancel/status operations, **SubagentProvisioningService** encapsulates the spawn pipeline (validation → skill mount → container → runner config), and **SubagentExecutionReaperService** cleans up abandoned executions on a 60-second interval.

Key architectural characteristics:
- **Governance-first delegation**: `MeshDelegationGovernanceService` validates tool access, budget constraints, and privileged tool policies before any delegation is dispatched.
- **Lineage tracking**: Delegation contracts carry `trace_id`, `parent_trace_id`, `lineage_depth`, and `lineage_path` for full execution tree reconstruction.
- **Parent-locking**: `SubagentParentLockService` serializes all operations on a given parent container to prevent race conditions during concurrent coordination.
- **Lifecycle event emission**: All state transitions emit events via `SubagentLifecycleEventService` for observability.
- **Execution reaper**: Stale subagents (spawn timeout >5min, running timeout >30min, or orphaned containers) are reaped with log capture and audit trails.
- **11 test files** cover spawn operations, runtime operations, coordination, reaper, mesh service, governance, and utilities.

## Capability Updates

| Capability | Status | Evidence |
|---|---|---|
| Subagent spawn (async) | Implemented | `subagent-orchestrator.spawn.operations.ts` – depth limit, concurrency limit, skill mount, host mounts, chat session creation |
| Subagent lifecycle events | Implemented | `subagent-lifecycle-event.service.ts` – `spawn.requested`, `spawn.succeeded`, `spawn.failed`, `wait.requested`, `wait.completed`, etc. |
| Mesh delegation contracts | Implemented | `mesh-delegation.service.ts` – create, dispatch, sweep, complete, cancel, replay; delegates to governance first |
| Mesh delegation governance | Implemented | `mesh-delegation-governance.service.ts` – tool allow/deny, IAM policy, budget limits, privileged tool approval |
| Mesh delegation dispatch | Implemented | `mesh-delegation-dispatch.service.ts` – queue depth control, queue processing, timeout sweep |
| Agent communication mesh | Implemented | `agent-communication-mesh.service.ts` – mentionAgent, checkAgentMentions, resolveAgentThread |
| Coordination (wait/cancel/status) | Implemented | `subagent-coordination.service.ts` – waitForSubagents, checkStatus, cancelActiveForParent, cancelExecution |
| Execution reaper | Implemented | `subagent-execution-reaper.service.ts` – 60s sweep interval, spawn-timeout/running-timeout/container-lost classification |
| Provisioning service | Implemented | `subagent-provisioning.service.ts` – orchestration wrapper around spawn operations with full context injection |
| Parent lock service | Implemented | `subagent-parent-lock.service.ts` – exclusive task serialization per parent container |
| Parent resume service | Implemented | `subagent-parent-resume.service.ts` – resumable parent execution after subagent completion |
| Container config operations | Implemented | `subagent-orchestrator.container-config.operations.ts` – subagent container image, entrypoint, env vars, mounts |
| Runtime operations | Implemented | `subagent-orchestrator.runtime.operations.ts` – checkSubagentStatusOperation, handleSubagentCompletionOperation |
| Coordination operations | Implemented | `subagent-orchestrator.coordination.operations.ts` – cancelSubagentExecutionOperation, emitWaitLifecycleEventOperation |
| Kickoff execution | Implemented | `subagent-orchestrator.kickoff-execution.operations.ts` – runner config staging, subagent signal |

## Health Findings

- **Test coverage**: 11 `.spec.ts` files provide good coverage of critical paths (spawn, runtime, coordination, governance, reaper, mesh service). No obvious gaps in core business logic testing.
- **Code quality**: Services follow single responsibility principle well; operations are extracted into focused modules (`.operations.ts` files). No circular dependencies detected.
- **Churn indicators**: All files use consistent patterns (Injectable, typed interfaces, normalized input normalization). No deprecated API usage visible.
- **Module exports**: Module exports a focused set of services (`AgentCommunicationMeshService`, `MeshDelegationService`, `SubagentCoordinationService`, `SubagentExecutionReaperService`, `SubagentProvisioningService`) with clear contracts.
- **No migrations**: No migration files present (subagent and delegation contracts may be defined in parent database entities).

## Open Questions

1. **Integration boundary with workflow engine**: How does the workflow engine invoke subagent orchestration? The spawn entrypoint (`spawnSubagentAsyncOperation`) is wired through `SubagentProvisioningService`, but the workflow-step-executor consumer call-site is outside this scope.
2. **Delegation contract lifecycle**: When a parent workflow run is aborted, are all outstanding delegation contracts automatically cancelled? The `cancelDelegation` method exists, but trigger behavior is unclear.
3. **Resumption semantics**: `SubagentParentResumeService` handles resumption — under what conditions does a parent resume vs. wait indefinitely for child completion?
4. **Mesh capacity policy**: `MeshDelegationCapacityPolicyService` exists but its policy enforcement logic was not read in detail; whether it blocks dispatch under resource pressure is unknown.
5. **Test isolation**: Some spec files (e.g., `subagent-lifecycle-regression.spec.ts`) suggest regression testing; the full regression suite scope is not visible from this probe.