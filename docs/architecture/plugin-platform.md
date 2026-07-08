# Plugin Platform Kernel

**Status:** Current
**Domain:** Extensibility / Plugin Kernel

## Overview

The plugin platform kernel provides the durable contract for third-party plugin lifecycle management. It defines the manifest shape plugin authors publish, the registry fields operators inspect, the lifecycle transitions the API permits, the runtime policy gates the API enforces, and the audit events recorded for lifecycle and runtime operations.

The kernel records plugin identity, trust, permissions, selected isolation mode, scan and compatibility results, and contribution inventory before any runtime activity. Runtime execution is routed through policy-checked adapters so third-party plugins do not use the in-process path by default.

## Manifest Contract

Plugin manifests are parsed by `@nexus/plugin-sdk`. The current manifest fields are:

- `id` (string, required): Stable plugin identifier, such as `com.acme.git-ops`.
- `name` (string, required): Human-readable plugin name.
- `version` (string, required): Plugin version.
- `description` (string, optional): Operator-facing summary.
- `author` (string, optional): Plugin author or publisher.
- `packageName` (string, optional): Source package name when installed from a package source.
- `packageVersion` (string, optional): Source package version when distinct from plugin `version`.
- `checksum` (string, optional): Package integrity value. API responses omit this field from plugin-controlled records.
- `signature` (string, optional): Package signature value. API responses omit this field from plugin-controlled records.
- `nexusCompatibility` (object, required): Compatibility declaration for the plugin API and Nexus version range.
- `nexusCompatibility.pluginApiVersion` (string, required): Plugin API contract version targeted by the plugin.
- `nexusCompatibility.minVersion` (string, required): Minimum supported Nexus version.
- `nexusCompatibility.maxVersion` (string, optional): Maximum supported Nexus version.
- `entrypoints` (object, required): Runtime entrypoint declarations.
- `entrypoints.main` (string, required): Main plugin module path.
- `entrypoints.worker` (string, optional): Worker module path for worker-process execution.
- `isolationModes` (array, required): Isolation modes the plugin can support.
- `permissions` (array, required): Permission requests for review, audit, and runtime policy enforcement.
- `contributions` (array, required): Declared extension contributions.

Each contribution has:

- `id` (string, required): Stable contribution identifier unique within the manifest.
- `type` (string, required): Contribution kind, such as `tool`, `workflow.step`, `workflow.hook`, `event.subscription`, or the EPIC-190-compatible `special_step` type.
- `displayName` (string, required): Human-readable label.
- `description` (string, optional): Operator-facing description.
- `entrypoint` (string, optional): Contribution-specific entrypoint or export name.
- `config` (object, optional): Contribution-specific configuration.

## Contribution Contracts

`@nexus/plugin-sdk` defines the typed contribution contracts that EPIC-191 projects into existing Nexus systems:

- `tool`: Declares an input schema, optional output schema, and plugin runtime operation. Projected tool names are derived as plugin-owned capability names and invoked through the plugin kernel.
- `workflow.step`: Declares a workflow step type, input contract, plugin runtime operation, optional blocking behavior, and optional timeout. Step projections are registered into the workflow special-step path so workflow YAML can resolve them without loading plugin code directly.
- `workflow.hook`: Declares approved workflow lifecycle events, optional filters, blocking behavior, and plugin runtime operation. Hook projections are inventory-backed subscriptions; when the delivery helper is invoked, accepted events are delivered through the plugin runtime manager.
- `event.subscription`: Declares approved event topics or suffix wildcards, optional filters, delivery mode, retry policy, dead-letter policy, required permissions, and plugin runtime operation. Active subscriptions are projected by the plugin kernel and delivered through the runtime manager.
- `capability.endpoint`: Declares a policy-mediated endpoint with input/output JSON schema, required permissions, operation name, timeout metadata, retryability metadata, and caller visibility (`workflow`, `tool`, `internal`, `plugin`).
- `special_step`: Retained for EPIC-190 compatibility while `workflow.step` provides the typed contribution path.

Known contribution schemas reject unsupported types, malformed schemas, unsupported workflow hook event names, and unknown config fields for typed contribution kinds. Manifest and runtime declaration validation reject duplicate contribution ids within the same declaration.

## Permissions

The manifest supports these permission request kinds:

- `network`: Declares external hosts the plugin expects to contact.
- `filesystem`: Declares `read` or `write` access and the paths involved.
- `environment`: Declares environment variable names the plugin expects to read.
- `secrets`: Declares secret names the plugin expects to access.
- `internal_capability`: Declares Nexus internal capabilities the plugin expects to call.

Permissions are stored as requested and granted permission records for operator review and audit. The runtime policy service checks granted permissions before mediated secret, storage, and network decisions, and denies missing or mismatched grants before the runtime adapter is called.

## Trust Levels

Registry entries use these trust levels:

- `bundled`: Shipped with the Nexus deployment.
- `local_trusted`: Installed from a local source trusted by operators.
- `third_party`: Installed from a third-party package or source.
- `quarantined`: Marked unsafe or blocked from normal lifecycle progression.

Trust level is operator and policy metadata. It does not grant runtime sandboxing by itself.

## Isolation Modes

Manifests may declare and registry entries may select these isolation modes:

- `none`: No plugin isolation. The plugin is treated as trusted in-process or otherwise not isolated by the kernel.
- `worker_process`: Execution in a separate Node.js worker process using structured IPC.
- `container`: Execution in a managed container when the container runtime feature gate and runtime config allow it.

The selected mode is still only one input to policy. A plugin can declare support for a mode, but the kernel denies unsafe combinations before startup, invocation, event delivery, secret access, storage access, or network access.

## Runtime Protocol

The SDK exports the versioned runtime protocol from `packages/plugin-sdk/src/plugin-runtime-protocol.*`. Runtime messages are parsed with strict schemas before they cross the API/runtime boundary.

Supported message families are:

- `handshake.request` and `handshake.response`: Negotiate protocol version, plugin identity, runtime mode, and peer capabilities.
- `contributions.declare`: Reports runtime-declared contributions after startup.
- `invoke.request` and `invoke.response`: Executes a declared contribution operation.
- `event.deliver`: Delivers a subscribed event to a plugin runtime.
- `health.check.request` and `health.check.response`: Reports adapter/runtime health.
- `shutdown`: Requests runtime shutdown with a reason and optional deadline.
- `error`: Returns a structured plugin runtime error.

Protocol payloads and metadata must be JSON-compatible, finite, bounded by the SDK byte limits, and within the protocol depth limit. Non-JSON values, cyclic objects, unsupported protocol versions, malformed message types, missing correlation ids, oversized payloads, and invalid contribution declarations are rejected by schema parsing rather than passed through to plugin code.

## Runtime Policy

`PluginPolicyService` makes deterministic allow/deny decisions from explicit policy context. It does not load plugin code or query the database. The runtime manager builds policy context from the registry entry and calls policy before runtime activity.

Policy defines unsafe states and combinations, including:

- `quarantined` trust level.
- `none` isolation for `third_party` plugins.
- `none` isolation for `local_trusted` plugins unless an operator-approved unsafe isolation override is present.
- Enablement before scan and compatibility checks have passed. This rule is implemented and tested in `PluginPolicyService`, but lifecycle enablement does not yet call `decideEnable`.
- Runtime invocation, event delivery, mediated secret access, mediated storage access, or mediated network access while the plugin is disabled or runtime health is not healthy.
- Invocation of undeclared contributions or unsupported contribution operations.
- Secret, storage, or network requests that do not match granted permissions.
- Event delivery requests with unapproved topics, missing subscription declarations, topic mismatches, extension namespace impersonation, or missing required permissions.
- Capability endpoint invocation requests that fail contribution declaration checks, operation checks, visibility checks, or required permission checks.

Runtime policy denials are returned as safe reason codes and operator messages. Denials are audited where the runtime manager observes them, and the adapter is not called after a denial.

## Runtime Manager

`PluginRuntimeManagerService` is the API-side runtime boundary. It loads the registry entry, policy-checks each operation, selects the adapter by `isolation_mode`, enforces request size limits and operation timeouts, normalizes adapter errors, records safe audit and health updates, and reports crash-like failures to the runtime supervisor.

If a startup call times out but the adapter later reports success, the manager performs best-effort cleanup so a late successful runtime does not remain active unexpectedly. Audit writes for normal adapter operations use a best-effort path and must not break those runtime calls; policy-denial audit writes are currently awaited before the manager returns the normalized `policy_denied` result.

## Runtime Adapters

### `none`

`none` is only for explicitly registered trusted handlers. The adapter calls supplied handler maps for handshake, contribution declaration, invocation, event delivery, health, and shutdown. It does not dynamically import arbitrary package paths as part of this runtime path, and policy must still allow `none` for the plugin trust level.

### `worker_process`

`worker_process` starts a Node.js child process through IPC. The child receives only allowlisted environment data:

- `NODE_ENV`, when present.
- `NEXUS_PLUGIN_ID`.
- `NEXUS_PLUGIN_VERSION`.
- `NEXUS_PLUGIN_RUNTIME_MODE=worker_process`.
- `NEXUS_PLUGIN_PROTOCOL_VERSION`.

The worker adapter sends and receives only runtime protocol messages, enforces correlation ids and expected response types, rejects mismatched or invalid IPC messages, applies operation timeouts, and normalizes process exits and protocol errors. Worker mode is a process boundary, not a perfect OS sandbox. Secrets, storage, network, database access, and provider access must remain mediated by kernel capabilities rather than exposed directly through environment variables or raw handles.

### `container`

`container` is a feature-gated adapter boundary. The adapter returns an unavailable runtime error unless `PLUGIN_CONTAINER_RUNTIME_ENABLED=true`. Startup also requires explicit container runtime config with an image and a configured `PluginContainerRuntimeClient`; the default runtime client is unavailable.

Container behavior is intentionally constrained:

- The adapter passes no environment variables into the container config.
- Host volume mounts are rejected.
- Network is disabled unless the plugin runtime config asks for network and `PLUGIN_CONTAINER_RUNTIME_ALLOW_NETWORK=true` is set.
- Containers are labeled as Nexus-managed plugin runtimes with plugin id and version.
- Startup, invocation, event delivery, health, shutdown, timeout, and cleanup failures are normalized to safe runtime errors.

The current container path provides the policy and runtime-client abstraction needed for isolated plugin execution. It does not implement complete third-party package execution, marketplace package mounting, arbitrary host path mounts, env passthrough, or reputation-based image trust.

## Crash-Loop Quarantine

`PluginRuntimeSupervisorService` tracks crash-like runtime failures by plugin id, version, and isolation mode in a bounded in-memory window. Three crashes within ten minutes trigger `PluginLifecycleService.quarantinePlugin` through the safe lifecycle path with actor id `plugin-runtime-supervisor`.

Crash-loop quarantine blocks the plugin through normal lifecycle state rather than taking down the API process. A healthy runtime report clears the tracked crash window for that plugin/version/mode.

## Runtime Health

`PluginRuntimeHealthService` summarizes runtime state without exposing raw payloads or secrets. Health summaries include:

- Plugin id, version, and isolation mode.
- Adapter status such as starting, healthy, unhealthy, crashed, or stopped.
- Last health check timestamp.
- Sanitized last error code and message.
- Pending request count.
- Crash-loop and quarantine state.

Health records are operational diagnostics, not a raw plugin telemetry stream.

## Lifecycle States

The lifecycle state machine allows only these transitions:

| From          | Allowed To                                |
| ------------- | ----------------------------------------- |
| `discovered`  | `installed`, `quarantined`, `uninstalled` |
| `installed`   | `scanned`, `quarantined`, `uninstalled`   |
| `scanned`     | `enabled`, `quarantined`, `uninstalled`   |
| `enabled`     | `disabled`, `quarantined`, `uninstalled`  |
| `disabled`    | `enabled`, `quarantined`, `uninstalled`   |
| `quarantined` | `uninstalled`                             |
| `uninstalled` | None; terminal state                      |

State meanings:

- `discovered`: The kernel has found plugin metadata but has not installed it.
- `installed`: The plugin has a registry entry and persisted manifest-derived metadata.
- `scanned`: Scan and compatibility checks have been recorded.
- `enabled`: The plugin is marked active by lifecycle state and `enabled = true`.
- `disabled`: The plugin remains installed but is not active.
- `quarantined`: The plugin is blocked and can only move to `uninstalled`.
- `uninstalled`: Terminal lifecycle state for removed plugins.

## Registry Records

`PluginRegistryEntry` persists plugin state without loading plugin code. The management API exposes sanitized fields for normal operator review:

- Plugin identity, version, name, description, and author.
- Lifecycle state and enabled flag.
- Trust level and selected isolation mode.
- Requested and granted permissions.
- Scan and compatibility results.
- Contribution inventory.
- Last error.

The registry also persists internal diagnostics fields that are not exposed by public management API responses:

- Source type and raw source location.
- Internal metadata.
- Package internals, including checksum and signature values.
- Lifecycle timestamps and created/updated timestamps.

Access to raw source, metadata, package internals, and timestamp diagnostics requires database access or an internal diagnostics path. Management API responses sanitize plugin-controlled records and omit raw package internals such as source, metadata, checksum, and signature values.

## Contribution Registry And Projection

`PluginContributionRegistryService` is the API-side inventory for active plugin contributions. It validates manifest-declared contributions, exposes validation and projection metadata used by adapters without invoking plugin code, and provides cleanup candidates for projected contributions owned by a plugin id and version. Adapter and orchestrator calls return structured projection results.

Projection adapters keep plugin runtime details out of the owning modules:

- Tool projection maps valid `tool` contributions into `tool_registry` with deterministic plugin-owned tool names and callback ownership metadata. Existing tool governance remains in force, and conflicting non-plugin tools are not overwritten.
- Tool invocation uses the plugin-kernel bridge. The tool callback resolves the projected contribution, validates the request against the contribution contract, and calls `PluginRuntimeManagerService.invokePlugin` instead of calling plugin code directly.
- Workflow step projection maps valid `workflow.step` contributions into the workflow special-step registry. Workflow execution receives normalized plugin invocation output while existing in-process special-step handlers continue to work.
- Workflow hook projection maps valid `workflow.hook` contributions into inspectable lifecycle subscription inventory. When invoked by a caller, delivery helpers apply event-name and filter checks, route accepted events through the runtime manager, and normalize hook delivery failures. Workflow-engine dispatch wiring for hook delivery is not part of EPIC-191.
- Event subscription projection maps valid `event.subscription` contributions into active event-bus inventory. The delivery engine persists a delivery record before invocation, applies policy checks per candidate subscription, retries retryable failures with bounded exponential backoff, and dead-letters exhausted failures when configured.
- Capability endpoint registry maps valid `capability.endpoint` contributions into discoverable global endpoint names (`plugin:<pluginId>:<contributionId>`). Invocation routes through kernel policy and runtime manager with AJV input/output validation and safe error normalization.

`PluginProjectionOrchestratorService` coordinates refresh and cleanup across the projection adapters. Lifecycle cleanup for disable, quarantine, and uninstall removes plugin-owned projections and leaves unrelated built-in or non-plugin projections intact; hook refresh also reconciles stale subscriptions, and tested invalid cleanup cases remove stale tool projections. Cleanup and refresh failures are returned as safe projection errors and covered by regression tests alongside existing tool and special-step behavior.

## Management API

The plugin management API exposes:

- `GET /plugins`: List plugin summaries. Available to Admin and Developer roles.
- `GET /plugins/:id/inspect`: Inspect sanitized plugin details. Available to Admin and Developer roles.
- `POST /plugins/install`: Install a plugin. Admin only.
- `POST /plugins/:id/scan`: Record scan and compatibility results. Admin only.
- `POST /plugins/:id/enable`: Enable a scanned or disabled plugin. Admin only.
- `POST /plugins/:id/disable`: Disable an enabled plugin. Admin only.
- `POST /plugins/:id/quarantine`: Quarantine a plugin from `discovered`, `installed`, `scanned`, `enabled`, or `disabled`. `quarantined` can only transition to `uninstalled`, and `uninstalled` is terminal. Admin only.
- `DELETE /plugins/:id`: Move a plugin to `uninstalled`. Admin only.

Controllers remain transport-only. Lifecycle validation, persistence, and audit writes are owned by the plugin lifecycle service.

## Audit Events

Mutating lifecycle operations record audit events through `PluginAuditService` and `AuditLogRepository`.

Audit payloads use:

- `event_type`: `PluginLifecycle`.
- `resource_id`: `<pluginId>@<version>`.
- `action`: Lifecycle action, such as install, scan, enable, disable, quarantine, or uninstall.
- `result`: EPIC-189 lifecycle mutations record `success` after registry persistence succeeds. Denied and failure audit records are a future hardening item unless and until implemented.
- `metadata.plugin_id`: Plugin id.
- `metadata.version`: Plugin version.
- `metadata.from_state` (optional): Previous lifecycle state.
- `metadata.to_state` (optional): New lifecycle state.
- `metadata.details` (optional): Nested operation-specific details.

Install and non-install lifecycle transitions couple successful registry writes and audit writes in the same transaction.

Runtime operations use `event_type: PluginRuntime` with safe payloads. Runtime audit events cover startup, invocation, event delivery, health checks, shutdown, policy denials, timeouts, crashes, and quarantine triggers. Payloads include plugin id, version, isolation mode, operation, contribution id when relevant, result, and sanitized metadata such as denial reason or crash count. Raw plugin payloads, secrets, environment values, filesystem contents, and provider credentials are not recorded.

Runtime audit writes for adapter operations are best-effort. Runtime policy-denial audit writes are currently awaited alongside lifecycle denial audit writes before the manager returns the normalized denial result.

## Current Non-Goals

The plugin platform still intentionally does not implement:

- Provider extension points for memory, models, triggers, notifications, context, or secrets. Those remain EPIC-193 work.
- Workflow-engine dispatch wiring for plugin workflow hooks.

## Plugin Event Bus And Endpoint Observability

- `PluginEventPublisherService` accepts approved event envelopes and delegates to the delivery engine.
- `PluginEventDeliveryEngineService` persists delivery attempts, applies per-subscription policy decisions, and invokes runtime delivery only for allowed candidates.
- `PluginEventDeliveryWorkerService` claims due records, retries retryable failures, and marks exhausted failures as `dead_lettered` when dead-letter policy is enabled.
- `PluginEventDeliveryObservabilityService` exposes filtered recent deliveries, dead letters, and status counts. Payloads remain redacted by default and must be explicitly requested.
- Delivery semantics are at-least-once where retry is configured and best-effort otherwise. Exactly-once delivery is not guaranteed.
- Public marketplace install flows.
- Full marketplace/package execution.
- Plugin UI management surfaces.
- Marketplace reputation, package scoring, or remote trust feeds.
- Perfect OS-level sandboxing for worker-process mode.
- Raw database access for isolated plugins.
- Raw filesystem access outside mediated storage capabilities.
- Raw secret, provider, or environment access for isolated plugins.
- Replacement of dynamic tool sandboxing used by workflow/tool execution.
- Migration of existing built-in functionality into plugins.

The current kernel records contribution inventory and lifecycle state, enforces runtime policy before adapter activity, supervises runtime adapters, and projects EPIC-191 `tool`, `workflow.step`, and `workflow.hook` contributions into existing registries. It does not claim full marketplace execution, package installation, UI management, generic event-bus capability endpoints, or provider extension support.
