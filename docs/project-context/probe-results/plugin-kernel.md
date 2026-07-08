---
project_scope_id: 458935f0-213e-4bbe-89d1-8883e0efa9ad
probe_scope_id: plugin-kernel
outcome: success
inferred_status: implemented
confidence_score: 0.95
evidence_refs:
  - apps/api/src/plugin-kernel/plugin-kernel.module.ts
  - apps/api/src/plugin-kernel/plugin-lifecycle.service.ts
  - apps/api/src/plugin-kernel/plugin-lifecycle-state-machine.service.ts
  - apps/api/src/plugin-kernel/plugin-policy.service.ts
  - apps/api/src/plugin-kernel/plugin-audit.service.ts
  - apps/api/src/plugin-kernel/plugin-management.controller.ts
  - apps/api/src/plugin-kernel/database/entities/plugin-registry-entry.entity.ts
  - apps/api/src/plugin-kernel/database/entities/plugin-event-delivery.entity.ts
  - apps/api/src/plugin-kernel/database/repositories/plugin-registry-entry.repository.ts
  - apps/api/src/plugin-kernel/database/repositories/plugin-event-delivery.repository.ts
  - apps/api/src/plugin-kernel/contributions/plugin-contribution-registry.service.ts
  - apps/api/src/plugin-kernel/contributions/plugin-projection-orchestrator.service.ts
  - apps/api/src/plugin-kernel/contributions/plugin-tool-projection.service.ts
  - apps/api/src/plugin-kernel/contributions/plugin-tool-invocation.service.ts
  - apps/api/src/plugin-kernel/contributions/plugin-workflow-step-projection.service.ts
  - apps/api/src/plugin-kernel/contributions/plugin-workflow-hook-projection.service.ts
  - apps/api/src/plugin-kernel/capabilities/plugin-capability-endpoint-registry.service.ts
  - apps/api/src/plugin-kernel/capabilities/plugin-capability-endpoint-invocation.service.ts
  - apps/api/src/plugin-kernel/events/plugin-event-publisher.service.ts
  - apps/api/src/plugin-kernel/events/plugin-event-delivery-engine.service.ts
  - apps/api/src/plugin-kernel/events/plugin-event-delivery-worker.service.ts
  - apps/api/src/plugin-kernel/events/plugin-event-delivery-observability.service.ts
  - apps/api/src/plugin-kernel/events/plugin-event-subscription-projection.service.ts
  - apps/api/src/plugin-kernel/events/plugin-event-topic-catalog.ts
  - apps/api/src/plugin-kernel/runtime/plugin-runtime-manager.service.ts
  - apps/api/src/plugin-kernel/runtime/plugin-runtime-supervisor.service.ts
  - apps/api/src/plugin-kernel/runtime/plugin-none-runtime.adapter.ts
  - apps/api/src/plugin-kernel/runtime/plugin-worker-runtime.adapter.ts
  - apps/api/src/plugin-kernel/runtime/plugin-container-runtime.adapter.ts
  - apps/api/src/plugin-kernel/runtime/plugin-runtime-health.service.ts
source_paths:
  - apps/api/src/plugin-kernel
updated_at: 2026-06-15T17:29:46Z
---

# Probe Result: Plugin Kernel

## Narrative Summary

The Plugin Kernel (`apps/api/src/plugin-kernel/`) is a comprehensively implemented NestJS module that provides the full plugin management surface area for the Nexus API. It is wired into the application via `PluginKernelModule` (`plugin-kernel.module.ts`) with explicit provider registration, DI tokens for runtime adapters/process factories, and exports of the policy, lifecycle, contribution, event, and runtime subsystems to other parts of the API (Authorization, ToolRegistry, WorkflowSpecialSteps).

The kernel exposes a REST surface through `PluginManagementController` (CRUD-style plugin management: list, inspect, install, scan, enable, disable, quarantine, uninstall) and `PluginToolInvocationController` (tool invocations by contribution). Inputs are validated via Zod schemas in `dto/plugin-management.dto.ts` and class-validator DTOs for event delivery observability in `dto/plugin-event-delivery.dto.ts`. Responses are sanitized to strip sensitive keys (secrets, tokens, passwords, checksums, signatures, raw logs) before being returned.

Plugin lifecycle is enforced through `PluginLifecycleStateMachineService` (`plugin-lifecycle-state-machine.service.ts`) with explicit allowed transitions: `discovered → installed → scanned → enabled ⇄ disabled → quarantined → uninstalled`. `PluginLifecycleService` performs install/scan/enable/disable/quarantine/uninstall within TypeORM transactions, writes lifecycle audit events through `PluginAuditService`, and orchestrates contribution projection cleanup or refresh through `PluginProjectionOrchestratorService`.

Policy is centralized in `PluginPolicyService` which exposes a uniform `decide*` API for install, enable, runtime start, runtime invocation, capability endpoint invocation, event delivery, secret access, storage access, and network access. The policy accounts for trust level, scan/compatibility status, runtime health, isolation mode, declared vs. granted permissions, contribution declarations, supported operations, event topic approval, and per-subscription topic patterns. The result is a structured allow/deny decision with reason codes mapped to human-readable messages.

Contribution projection is decomposed into four specialized projection services coordinated by `PluginProjectionOrchestratorService`: tool projection (registers plugin tools into `ToolRegistryService` with `api_callback` transport pointing at the per-contribution invocation route), workflow step projection (registers `PluginWorkflowStepHandler` with `StepSpecialStepRegistryService`), workflow hook projection (maintains an in-memory subscription table per `eventName`), and event subscription projection (maintains an in-memory subscription table per `pluginId/version/contributionId`). All four honor cleanup-on-disable/uninstall.

The event bus is end-to-end: `PluginEventPublisherService` validates topic ownership (approved exact topics and `plugin.<pluginId>.*` namespace with an allow-list of suffixes), then delegates to `PluginEventDeliveryEngineService` which creates a `PluginEventDelivery` row, checks policy, dispatches through `PluginRuntimeManagerService`, and updates the row status (delivered, failed, or dead_lettered). A separate `PluginEventDeliveryWorkerService` claims due deliveries with `FOR UPDATE SKIP LOCKED`, applies exponential backoff (bounded 100ms–60s initial delay, multiplier 1–10, cap 5 minutes), and increments attempt counts. Observability is provided by `PluginEventDeliveryObservabilityService` with raw-payload redaction enforced in both the service and the repository query (`payload` is intentionally excluded from SELECT lists).

Three runtime adapters implement the `PluginRuntimeAdapter` interface: `PluginNoneRuntimeAdapter` (in-process `TrustedPluginRuntimeHandlers`), `PluginWorkerRuntimeAdapter` (Node `child_process.fork` with structured IPC protocol from `@nexus/plugin-sdk` — handshake, invoke, event deliver, health check, shutdown), and `PluginContainerRuntimeAdapter` (provisions docker containers via `ContainerOrchestratorService`, opt-in via `PLUGIN_CONTAINER_RUNTIME_ENABLED`, blocks host volume mounts and secret-like env passthrough). Adapter selection is done by isolation mode at runtime. `PluginRuntimeManagerService` enforces per-call request size, applies timeouts (default 30s), records audit events, tracks health, and delegates crash detection to `PluginRuntimeSupervisorService`, which maintains a per-runtime crash window (3 crashes in 10 minutes triggers auto-quarantine through the lifecycle service).

## Capability Updates

- **Plugin lifecycle management**: install/scan/enable/disable/quarantine/uninstall with state-machine-enforced transitions, transactional DB writes, and audit emission (`plugin-lifecycle.service.ts`, `plugin-lifecycle-state-machine.service.ts`).
- **Policy enforcement**: uniform `decide*` policy surface covering install, enable, runtime start, runtime invocation, capability endpoint invocation, event delivery, secret access, storage access, network access; structured reason codes and messages (`plugin-policy.service.ts`, `plugin-policy.types.ts`).
- **Audit logging**: lifecycle and runtime events recorded through `PluginAuditService` to the shared `AuditLog` entity, with runtime metadata whitelisting (`plugin-audit.service.ts`).
- **Registry and persistence**: `PluginRegistryEntry` and `PluginEventDelivery` TypeORM entities with check constraints, indexes, and a dedicated `PluginRegistryEntryRepository` / `PluginEventDeliveryRepository`; optimistic update via `markLifecycleState` checks the expected state and timestamps the appropriate lifecycle column (`database/entities/`, `database/repositories/`).
- **Contribution registry and projection**: validated inventory, lifecycle-aware cleanup, and four projection services for tools, workflow steps, workflow hooks, and event subscriptions (`contributions/`).
- **Tool invocation**: schema-validated input via Ajv, runtime invocation through the manager, and a separate REST controller for contribution-direct invocation (`plugin-tool-invocation.service.ts`, `plugin-tool-invocation.controller.ts`).
- **Capability endpoint surface**: registry, AJV-validated input/output, and policy-gated invocation through runtime manager (`capabilities/`).
- **Event publishing and delivery**: topic ownership checks, blocking/non-blocking delivery, policy-gated dispatch, attempt-based retry, dead-letter handling, worker-based async processing with row-level locking, and redacted observability queries (`events/`).
- **Workflow hook bridge**: per-event subscription table with filter matching, best-effort delivery, and cleanup-on-disable (`plugin-workflow-hook-projection.service.ts`).
- **Runtime isolation**: three adapters (`none`, `worker_process`, `container`) with per-adapter configuration, IPC protocol support, container image/host-volume/env passthrough safety checks, and unified runtime health tracking (`runtime/`).
- **Crash detection and auto-quarantine**: per-runtime crash window with supervisor-driven auto-quarantine and corresponding runtime audit emission (`plugin-runtime-supervisor.service.ts`).
- **REST surface**: `/plugins` for management (zod-validated, JWT/Permissions-guarded) and `/plugins/:pluginId/:version/contributions/:contributionId/invoke` for tool invocation (Roles-guarded); sensitive response keys are stripped before returning (`plugin-management.controller.ts`, `plugin-tool-invocation.controller.ts`).
- **Module composition**: `PluginKernelModule` imports `AuthorizationModule`, `ToolRegistryModule`, and `WorkflowSpecialStepsModule`; provides and exports every service; binds `PLUGIN_RUNTIME_ADAPTERS` via a useFactory and exposes injectable tokens for the projection orchestrator, runtime supervisor, container runtime client/env, and worker process factory/env (`plugin-kernel.module.ts`).

## Health Findings

- **Test coverage is very high**: 30 `.spec.ts` files are co-located with services, including unit tests for the lifecycle service (~1200 lines, exercises install/scan/enable/disable/quarantine/uninstall, transition validation, projection orchestration, and audit emission), the state machine, the policy service, the audit service, the management controller, the contribution registry, the projection orchestrator, every projection service, both capability services, the event bus (engine, worker, observability, publisher, subscription, topic catalog), and all three runtime adapters (none, worker, container), plus the runtime manager, health, and supervisor. Integration tests cover the event bus end-to-end (`plugin-event-bus.integration.spec.ts`) and capability endpoint invocation (`plugin-capability-endpoint.integration.spec.ts`).
- **Test framework**: tests use `vitest` with `@nestjs/testing` and mock the repositories/services through typed `Mock` helpers; lifecycle and policy tests are notably thorough.
- **Code quality**: the module uses constructor-based DI with explicit `@Inject` tokens for the projection orchestrator and runtime adapters; runtime services are written defensively (try/catch around audit writes, optional dependencies for health/supervisor lookups, timeouts on adapter calls, request-size enforcement). There is a clear separation between trust levels, isolation modes, and capability endpoint visibility.
- **Sensitive data handling**: response sanitization strips a hard-coded key set plus a regex pattern (secret/token/password/authorization/credential/private[_-]?key/api[_-]?key/access[_-]?key/client[_-]?key/checksum/signature/raw[_-]?log) for both top-level and nested records. Observability DTOs force `payload: null` to prevent raw event payloads from leaking.
- **Backwards-compat shims**: `PluginEventDeliveryObservabilityService` retains deprecated `listObservabilityRecords`, `listDeadLetterDeliveries`, and `getStatusCounts` methods that map to the new DTOs, which is a small surface-area concern for ongoing maintenance.
- **Container runtime client**: `PLUGIN_CONTAINER_RUNTIME_CLIENT` defaults to a `DisabledPluginContainerRuntimeClient` that returns `container_runtime_client_unavailable` errors; the kernel is functional without a real container client, but full container isolation requires the client to be supplied elsewhere (intentional DI seam).
- **No significant churn indicators** were observed in the file structure; the spec files are co-located with their services, indicating a consistent test-as-you-go discipline.

## Open Questions

- The `PluginToolInvocationController` is included in the kernel but is not exported from the kernel module as a separate concern; it is registered as a controller directly. Whether this is the desired placement versus a dedicated tools module is a design choice the parent workflow may want to confirm.
- Container runtime client wiring is left to the caller (`PLUGIN_CONTAINER_RUNTIME_CLIENT` token default-undefined). The probe did not find the production client implementation in this scope — it may live in `apps/api/src/docker/` or another module, but verification is out of scope here.
- The `plugin-management.controller` and `plugin-tool-invocation.controller` apply different guards (`JwtAuthGuard`+`PermissionsGuard`+`@RequirePermission` vs. `JwtAuthGuard`+`RolesGuard`+`@Roles`). The intent appears to be permission-based vs. role-based access, but the parent workflow may want to confirm that this split is intentional.
- The `plugin-lifecycle.service` does not appear to be called from the management controller for the `uninstall` endpoint with the `actorId` argument source — the controller body destructures `enablePluginSchema` for both `enable` and `delete`, which is a minor inconsistency that may warrant a follow-up.
