---
project_scope_id: 458935f0-213e-4bbe-89d1-8883e0efa9ad
probe_scope_id: plugin-platform
outcome: success
inferred_status: partial
confidence_score: 0.85
evidence_refs:
  - apps/api/src/plugin-kernel/plugin-kernel.module.ts
  - apps/api/src/plugin-kernel/plugin-lifecycle.service.ts
  - apps/api/src/plugin-kernel/plugin-policy.service.ts
  - apps/api/src/plugin-kernel/contributions/plugin-tool-invocation.service.ts
  - apps/api/src/plugin-kernel/events/plugin-event-delivery-engine.service.ts
  - apps/api/src/plugin-kernel/runtime/plugin-runtime-manager.service.ts
  - packages/plugin-sdk/src/plugin-manifest.types.ts
  - packages/plugin-sdk/src/plugin-runtime-protocol.types.ts
  - packages/plugin-sdk/src/plugin-contribution.types.ts
source_paths:
  - apps/api/src/plugin-kernel
  - packages/plugin-sdk/src
  - packages/plugin-platform/src
updated_at: 2026-06-02T01:15:00Z
---

# Probe Result: Plugin Platform

## Narrative Summary

The Plugin Platform scope is substantially implemented with a complete lifecycle management system, multi-layered policy enforcement, and flexible runtime isolation. The plugin kernel in `apps/api/src/plugin-kernel` provides comprehensive plugin management including installation, scanning, enablement, quarantine, and uninstallation workflows. Three runtime adapters support isolation modes: `none`, `worker_process`, and `container`. The event delivery system implements retry with exponential backoff and dead-letter queuing. The SDK in `packages/plugin-sdk` defines the manifest schema, contribution types, and runtime protocol. However, the `packages/plugin-platform/src` directory contains only minimal code (one integration test), suggesting this package may be incomplete or serve as a placeholder for future platform-level features.

## Capability Updates

### Plugin Lifecycle Management
- **Discovered**: `plugin-lifecycle.service.ts` implements full lifecycle state machine with transitions: discovered → installed → scanned → enabled ↔ disabled → quarantined → uninstalled
- **Manifest parsing**: Uses `parsePluginManifest` from SDK with validation, trust levels, and isolation modes
- **Persistence**: `PluginRegistryEntry` entity with 8 state timestamps, permissions, contributions, and metadata columns

### Contribution System
- **Types**: 6 contribution types supported: tool, workflow.step, workflow.hook, event.subscription, capability.endpoint, special_step
- **Registry**: `PluginContributionRegistryService` maintains contribution metadata with projection to ToolRegistry, WorkflowSpecialSteps
- **Invocation**: `PluginToolInvocationService` routes calls to runtime adapters with policy checks

### Policy Enforcement
- **12 Decision Points** in `plugin-policy.service.ts`:
  - `decideInstall`, `decideEnable` for lifecycle transitions
  - `decideRuntimeStart`, `decideRuntimeInvocation` for runtime operations
  - `decideEventDelivery`, `decideCapabilityEndpointInvocation` for contributions
  - `decideSecretAccess`, `decideStorageAccess`, `decideNetworkAccess` for permissions
- **Trust levels**: bundled, local_trusted, third_party, quarantined with isolation enforcement
- **Static safety checks**: scan required, compatibility passed, plugin enabled, runtime healthy

### Event Delivery System
- **Engine**: `PluginEventDeliveryEngineService` matches subscriptions by topic pattern
- **Delivery modes**: blocking and non-blocking with per-subscription configuration
- **Retry logic**: Exponential backoff with configurable initial delay (100ms-60s) and multiplier (1x-10x), max 300s cap
- **Dead letter**: Optional dead-letter queue for exhausted deliveries
- **Observability**: `PluginEventDeliveryObservabilityService` tracks metrics

### Runtime Management
- **Adapters**: 3 isolation modes with adapter pattern:
  - `PluginNoneRuntimeAdapter` - in-process execution
  - `PluginWorkerRuntimeAdapter` - child process with IPC
  - `PluginContainerRuntimeAdapter` - container-based isolation
- **Health**: `PluginRuntimeHealthService` tracks startup, requests, shutdown, and errors
- **Supervisor**: `PluginRuntimeSupervisorService` manages crash loops with auto-quarantine

### SDK Types
- **Manifest**: `PluginManifest` with nexusCompatibility, entrypoints, isolationModes, permissions, contributions
- **Runtime protocol**: 10 message types for handshake, contributions.declare, invoke.request/response, event.deliver, health.check, shutdown, error
- **Permissions**: 5 kinds - network, filesystem, environment, secrets, internal_capability

## Health Findings

- **Test Coverage**: 32 spec files in plugin-kernel covering lifecycle, policy, contributions, events, runtime
- **Integration Tests**: Capability endpoint and event bus integration tests present
- **Database Layer**: Full entity definitions with constraints and indexes; repositories for registry and event delivery
- **Controller Layer**: REST endpoints with Swagger docs, JWT auth, role guards (Admin, Developer, Agent)
- **Audit Trail**: `PluginAuditService` records lifecycle and runtime events with sanitized metadata

## Open Questions

- **packages/plugin-platform/src**: Contains only `integration/` with one test file. Is this package intended for platform-level abstractions above the SDK? If so, what features are planned?
- **Container runtime adapter**: Implementation exists but may need Docker/OCI integration details
- **Plugin quarantine automation**: Supervisor auto-quarantines on crash loop threshold, but configuration parameters (crash threshold, time window) need verification
- **Manifest signature verification**: Plugin SDK supports signature field but no explicit verification service observed in kernel