# EPIC-190: Plugin Isolation Runtime and Policy Enforcement

**Status:** Completed
**Priority:** P0
**Created:** 2026-05-17
**Updated:** 2026-05-18
**Owner:** Platform Extensibility / Security
**Parent:** EPIC-188
**Depends on:** EPIC-189
**Related:** EPIC-171, EPIC-160, EPIC-140

## Summary

Add policy-selected plugin isolation modes and runtime supervision so third-party plugins execute outside the API process by default, while trusted bundled plugins can explicitly opt into no isolation.

## Problem Statement

The current first-class plugin surface executes trusted special-step plugins in process. That is acceptable for bundled or locally trusted code, but not for third-party packages. Third-party plugins need execution boundaries, structured IPC, timeouts, crash handling, controlled environment variables, mediated secrets, mediated storage, mediated network access, and auditable policy decisions.

## Goals

- Support three isolation modes: `none`, `worker_process`, and `container`.
- Make `worker_process` the default third-party runtime.
- Add container runtime support for higher-risk plugins after IPC contracts stabilize.
- Allow `none` only for bundled plugins or explicitly approved local trusted plugins.
- Define and test trust-level and permission policy for enablement decisions, and enforce runtime policy before every runtime call.
- Normalize plugin startup, invocation, timeout, crash, and shutdown behavior.

## Non-Goals

- Full marketplace signing or remote reputation scoring.
- Perfect OS-level sandboxing for worker-process mode.
- Direct database, raw filesystem, raw secret, or NestJS provider access for isolated plugins.
- Replacing dynamic tool sandboxing in this epic.

## Isolation Modes

### `none`

Trusted runtime path for bundled plugins only by default. Code runs in the API runtime boundary and has the same risk profile as current in-process plugin code.

Acceptance criteria:

- `none` is denied for `third_party` plugins.
- `none` plugins still go through manifest validation, lifecycle state, contribution registration, and audit events.

### `worker_process`

Default third-party TypeScript/JavaScript runtime. Plugin code runs in a separate Node.js process and communicates with the API over structured IPC.

Acceptance criteria:

- Runtime supports handshake, contribution declaration, invocation, event delivery, health check, and shutdown.
- Runtime enforces timeouts, request size limits, limited environment variables, and crash-loop quarantine.
- Secrets, storage, and network access are mediated by kernel capability calls.

### `container`

Feature-gated high-isolation adapter boundary. The current implementation provisions a constrained container and calls a `PluginContainerRuntimeClient` abstraction, but the default client is unavailable and EPIC-190 does not provide third-party package mounting, marketplace image distribution, or a complete container plugin bootstrap.

Acceptance criteria:

- Container mode preserves the same logical runtime protocol boundary as worker-process mode through the runtime-client abstraction.
- Container startup requires an explicit image, rejects env passthrough and host volumes, and requires an operator feature flag before enabling network.
- Container startup failure and crash loops quarantine the plugin after configured retries.

## Policy Model

Policy decisions should consider:

- Plugin trust level: `bundled`, `local_trusted`, `third_party`, `quarantined`.
- Requested permissions.
- Granted permissions.
- Selected isolation mode.
- Compatibility and scan status.
- Operator overrides.
- Runtime health and crash-loop state.
- Target contribution and requested operation.

Permission families include:

- `tools.register`, `tools.execute`
- `workflow.steps.register`, `workflow.hooks.subscribe`, `workflow.runs.launch`
- `memory.read`, `memory.write`, `memory.provider`
- `models.invoke`, `models.provider`
- `triggers.emit`, `notifications.send`
- `secrets.read:<scope>`
- `storage.read/write:<scope>`
- `network.connect:<host-or-policy>`
- `events.publish`, `events.subscribe:<topic>`

## Workstreams

### 1. Runtime Protocol

- Define plugin runtime protocol messages for handshake, contribution declaration, invocation, event delivery, health, error, and shutdown.
- Version the protocol independently from plugin manifest version.

### 2. Worker-Process Runtime

- Implement process launch, IPC, heartbeat, timeout, shutdown, and crash-loop handling.
- Ensure plugin processes receive only approved environment variables.

### 3. Container Runtime

- Implement container runtime adapter using the same logical protocol as worker mode.
- Add feature-gated container startup with explicit image and network settings.

### 4. Policy Enforcement

- Add `PluginPolicyService` checks for install, enable, contribution registration, invocation, event delivery, secret access, storage access, and network access.
- Emit or attempt safe audit events for runtime denials observed by the runtime manager.

## Implemented Runtime Behavior

The runtime protocol is exported from `@nexus/plugin-sdk` and covers handshake, contribution declaration, invocation, event delivery, health checks, shutdown, and structured errors. Protocol schemas are versioned and strict; payloads and metadata must be bounded JSON-compatible values.

`PluginPolicyService` defines and tests unsafe enablement decisions for quarantined trust, scan failures, compatibility failures, and unsafe `none` isolation. Lifecycle enablement does not yet call `decideEnable`, so operators should not treat EPIC-190 as complete enablement-time policy enforcement. Runtime activity is policy-checked before adapter calls, including disabled runtime activity, `none` isolation for third-party plugins, `local_trusted` `none` isolation without explicit override, missing permissions, and network/storage/secret mismatches.

`PluginRuntimeManagerService` policy-checks runtime calls, routes by selected isolation mode, enforces size limits and timeouts, normalizes errors, records denials and runtime audit/health events, reports crash-like failures to the supervisor, and performs best-effort cleanup for late successful starts after a timeout.

Supported adapter modes are:

- `none`: Explicitly registered trusted handlers only; still policy-gated.
- `worker_process`: Node IPC with protocol validation, correlated responses, timeouts, process-exit normalization, and allowlisted environment variables only.
- `container`: Feature-gated by `PLUGIN_CONTAINER_RUNTIME_ENABLED=true`, requires an explicit image, rejects env passthrough and host volumes, and only enables network when both runtime config requests it and `PLUGIN_CONTAINER_RUNTIME_ALLOW_NETWORK=true` is set. The default runtime client is unavailable, so this is a container adapter boundary rather than a complete third-party package execution path.

Crash-loop supervision tracks crashes by plugin id, version, and isolation mode in a bounded window. Three crashes within ten minutes trigger lifecycle quarantine through actor `plugin-runtime-supervisor` without taking down the API process.

Runtime health summarizes adapter status, last health check, sanitized last error, pending requests, and crash-loop/quarantine state. Runtime audit events use `PluginRuntime` safe payloads for startup, invocation, event delivery, health, shutdown, denial, timeout, crash, and quarantine trigger behavior. Audit writes for normal adapter operations are best-effort; policy-denial audit writes are currently awaited before returning the normalized denial result.

Remaining non-goals are marketplace reputation or scoring, a perfect OS sandbox for worker mode, raw database/filesystem/secret/provider access, and replacement of dynamic tool sandboxing.

## Backlog

- [x] E190-001 Define runtime protocol message schemas.
- [x] E190-002 Add plugin runtime manager and runtime adapter interface.
- [x] E190-003 Implement `none` adapter for bundled plugins.
- [x] E190-004 Implement `worker_process` adapter.
- [x] E190-005 Add crash-loop detection and quarantine transition.
- [x] E190-006 Implement policy service and permission evaluation tests.
- [x] E190-007 Implement container adapter behind feature flag or explicit config.
- [x] E190-008 Add runtime health and audit events.

## Acceptance Criteria

- Third-party plugins do not execute in process by default.
- Runtime adapter calls are policy-checked, timed out, audited through the runtime audit path, and normalized.
- Worker-process plugins can handshake, declare contributions, receive invocations, and shut down cleanly.
- Container mode exposes the same logical protocol boundary behind a feature flag and runtime-client abstraction, but full third-party package execution remains follow-up work.
- Crash loops can quarantine a plugin without taking down the API.
- Runtime policy violations are denied and audited before invoking the runtime adapter; denial audit writes are currently awaited.
