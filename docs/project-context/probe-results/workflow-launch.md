---
project_scope_id: 458935f0-213e-4bbe-89d1-8883e0efa9ad
probe_scope_id: workflow-launch
outcome: success
inferred_status: partial
confidence_score: 0.92
evidence_refs:
  - apps/api/src/workflow/workflow-launch/workflow-launch.types.ts
  - apps/api/src/workflow/workflow-launch/workflow-launch-contract.service.ts
  - apps/api/src/workflow/workflow-launch/workflow-launch-orchestration.service.ts
  - apps/api/src/workflow/workflow-launch/workflow-launch-orchestration.helpers.ts
  - apps/api/src/workflow/workflow-launch/workflow-launch.controller.ts
  - apps/api/src/workflow/workflow-launch/workflow-launch.module.ts
  - apps/api/src/workflow/workflow-launch/workflow-launch-contract.service.spec.ts
  - apps/api/src/workflow/workflow-delegation-tools/workflow-delegation-tool-projection.service.ts
  - apps/api/src/workflow/workflow-delegation-tools/workflow-delegation-tools.controller.ts
  - apps/api/src/workflow/workflow-delegation-tools/workflow-delegation-tools.module.ts
  - apps/api/src/workflow/workflow-delegation-tools/workflow-delegation-tool-projection.service.spec.ts
  - apps/api/src/workflow/workflow-delegation-tools/workflow-delegation-tools.controller.spec.ts
  - apps/api/src/workflow/workflow-delegation-tools/workflow-delegation-tool-projection.types.ts
source_paths:
  - apps/api/src/workflow/workflow-launch
  - apps/api/src/workflow/workflow-delegation-tools
updated_at: 2026-06-02T13:30:00.000Z
---

# Probe Result: Workflow Launch and Delegation

## Narrative Summary

The `workflow-launch` scope is mostly implemented with a well-structured orchestration pipeline, but test coverage is uneven — only `WorkflowLaunchContractService` has a spec file. The `workflow-delegation-tools` scope is fully implemented with solid test coverage on both the projection service and controller. Key capabilities include eligibility evaluation, launch preset management, trigger data normalization, and projection of workflow delegation configurations into the tool registry. The orchestration service handles dry-run execution, lifecycle event emission, and preset resolution but lacks its own spec file.

## Capability Updates

### Workflow Launch

| Capability | Status | Evidence |
|---|---|---|
| Launch contract building (trigger type, inputs, context requirements) | Implemented | `workflow-launch-contract.service.ts` |
| Launch eligibility evaluation (manual-only, context required) | Implemented | `WorkflowLaunchContractService.evaluateEligibility()` |
| Launch payload validation with typed input checking | Implemented | `WorkflowLaunchContractService.validateLaunchPayload()` |
| Orchestration service with dry-run support | Implemented | `workflow-launch-orchestration.service.ts` |
| Launch preset CRUD (create, list, update, delete) | Implemented | `WorkflowLaunchController` endpoints |
| Lifecycle event emission (requested, validated, rejected, executed) | Implemented | `emitLaunchLifecycleEvent()` in orchestration service |
| Controller endpoints (`GET /workflows/launch-options`, `GET :id/launch-contract`, `POST :id/execute`, preset endpoints) | Implemented | `workflow-launch.controller.ts` |
| Helper utilities (normalizeOptionalString, normalizeRecord, resolveActorId, buildLaunchValidationException, buildWorkflowLaunchDescriptor) | Implemented | `workflow-launch-orchestration.helpers.ts` |
| Module wiring with `WorkflowLaunchModule` | Implemented | `workflow-launch.module.ts` |

### Workflow Delegation Tools

| Capability | Status | Evidence |
|---|---|---|
| Delegation tool projection from seed JSON config | Implemented | `WorkflowDelegationToolProjectionService.loadDefinitions()` |
| Tool projection registration via `CapabilityRegistrarService` | Implemented | `projectEnabledTools()` method |
| Control-field stripping and trigger data assembly | Implemented | `buildTriggerData()`, `withoutControlFields()` |
| Invocation endpoint with agent context passthrough | Implemented | `WorkflowDelegationToolsController.invokeProjectedDelegation()` |
| OnModuleInit bootstrap of projected tools | Implemented | `WorkflowDelegationToolProjectionService` implements `OnModuleInit` |
| Tier restriction, fixed trigger data, and trigger field allowlisting | Implemented | Config schema in `workflow-delegation-tool-projection.types.ts` |
| Input schema to body mapping | Implemented | `buildBodyMapping()` in projection service |

## Health Findings

- **Test coverage — `workflow-launch`**: Only `WorkflowLaunchContractService` has a spec file with 5 test cases covering contract building, eligibility, payload validation, defaults, and type checking. `WorkflowLaunchOrchestrationService` has no spec file. `WorkflowLaunchController` has no spec file. Helpers have no spec file.
- **Test coverage — `workflow-delegation-tools`**: Both `WorkflowDelegationToolProjectionService` and `WorkflowDelegationToolsController` have spec files with realistic test cases (projection registration, invocation, control-field stripping, agent context parsing).
- **Module integration**: `WorkflowLaunchModule` is correctly isolated from `WorkflowModule` (verified by `workflow-kernel.spec.ts` to prevent circular imports). `WorkflowDelegationToolsModule` imports `ToolRegistryModule` and `WorkflowRuntimeModule`.
- **Security**: All controller endpoints are guarded by `JwtAuthGuard` and `RolesGuard` with role restrictions (`Admin`, `Developer`; delegation controller also allows `Agent`).
- **Runtime dependency resolution**: `WorkflowLaunchOrchestrationService` uses lazy resolution via `ModuleRef` as a fallback when injected dependencies are not yet available, supporting proper module initialization order.

## Open Questions

- The `workflow-launch-contract.service.spec.ts` is the only spec in the `workflow-launch` directory — the orchestration service and controller are tested only implicitly through integration or kernel specs if at all.
- `WorkflowDelegationToolProjectionService.loadDefinitions()` reads from `seed/workflow-delegation-tools/*.json` at runtime — the seed data existence in the deployed environment is not verified by tests.
- The delegation tool projection does not persist tool registration state; on restart, tools are re-projected from seed files, which means idempotency relies on the capability registrar's behavior.