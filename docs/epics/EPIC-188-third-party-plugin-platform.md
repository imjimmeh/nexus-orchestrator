# EPIC-188: Third-Party Plugin Platform

**Status:** Proposed
**Priority:** P0
**Created:** 2026-05-17
**Updated:** 2026-05-17
**Owner:** Platform Extensibility
**Parent:** None
**Depends on:** EPIC-081, EPIC-140, EPIC-181, EPIC-182
**Related:** EPIC-127, EPIC-171, EPIC-186, `docs/plans/2026-05-17-third-party-plugin-extensibility-design.md`

## Summary

Build a first-class third-party plugin platform for Nexus that supports sandboxed plugins, explicit lifecycle management, typed contribution contracts, generic event-based extension, and optional no-isolation execution for trusted bundled plugins.

This epic is the umbrella for the complete extensibility track. It expands the narrower plugin lifecycle work in EPIC-081 into a platform architecture that can make tools, workflow steps, memory, model providers, triggers, notifications, schedules, context providers, secret providers, and future features plugin-extensible.

## Problem Statement

Nexus currently has multiple extension-like surfaces, but they are fragmented. Workflow special-step plugins are trusted in-process code. Dynamic tools have a registry and sandbox path, but they are tool-specific. MCP and ACP project external capabilities into the tool registry, but they are not general plugin packages. Memory is configurable by backend, not by plugin contribution. Internal runtime tools and seed data are hardcoded into API modules.

The result is that Nexus can be extended in several places but does not have one plugin lifecycle, one trust model, one policy gate, one contribution registry, or one safe third-party runtime boundary.

## Goals

- Prioritize third-party sandboxed plugins as the default extensibility path.
- Support `none`, `worker_process`, and `container` isolation modes, with policy selecting the allowed mode.
- Provide a durable plugin registry for install, scan, enable, disable, quarantine, inspect, and uninstall operations.
- Define a manifest and SDK contract that supports typed contributions and generic extension points.
- Make practical platform behavior plugin-extensible without turning the entire API into plugins.
- Allow existing functionality to move into bundled plugins over time where it improves modularity.
- Preserve current external API contracts while internal modules learn to consume plugin contributions.
- Make all plugin behavior policy-checked, auditable, observable, and reversible.

## Non-Goals

- Public marketplace release in the first implementation wave.
- Executing unsigned remote code by default.
- Giving isolated plugins direct NestJS provider, database, raw filesystem, or raw secret access.
- Moving core orchestration, auth, persistence primitives, policy, audit, registry, or the plugin kernel itself into plugins.
- Maintaining legacy compatibility shims indefinitely after a pluginized replacement is available.

## Child Epics

- EPIC-189: Plugin Kernel, Registry, and Lifecycle
- EPIC-190: Plugin Isolation Runtime and Policy Enforcement
- EPIC-191: Plugin Contribution Contracts and Projection Adapters
- EPIC-192: Plugin Event Bus and Emergent Capability Endpoints
- EPIC-193: Provider Extension Points for Memory, Models, Triggers, Notifications, Context, and Secrets
- EPIC-194: Bundled Plugin Migration and Internal Capability Extraction
- EPIC-195: Plugin Developer Experience, Management UI, and Observability

## Architecture Direction

The API should add a `PluginKernelModule` that owns plugin lifecycle, policy, runtime supervision, contribution validation, event routing, and calls into isolated plugin runtimes. API feature modules should not call plugin code directly. They should ask the plugin kernel or a narrow contribution resolver to execute a contributed capability.

The platform should combine two extension models:

- Typed contribution contracts for known feature families such as tools, workflow steps, memory providers, model providers, triggers, notifications, schedules, context providers, and secret providers.
- Generic event subscriptions and capability endpoints for behavior that does not yet deserve a first-class contract.

## Implementation Phases

### Phase 1: Kernel Foundation

- Create the plugin manifest and schema contract.
- Add durable plugin registry state and lifecycle APIs.
- Add policy evaluation for trust level, permissions, compatibility, and isolation mode.
- Add audit events for install, scan, enable, disable, quarantine, invocation, and denial.
- Keep existing special-step plugins, dynamic tools, MCP/ACP, and memory behavior working.

### Phase 2: Safe Third-Party Runtime

- Add `worker_process` runtime as the default third-party execution mode.
- Add structured IPC contracts for handshake, contribution declaration, invocation, event delivery, and shutdown.
- Add `container` runtime after IPC contracts stabilize.
- Retain `none` only for bundled or explicitly trusted local plugins.

### Phase 3: Contribution Projection

- Support third-party `tool`, `workflow.step`, and `event.subscription` contributions first.
- Add projection adapters into existing tool registry and workflow special-step registries.
- Add generic `capability.endpoint` calls through the kernel.

### Phase 4: Provider Extension Points

- Add provider contribution contracts for memory, models, triggers, notifications, schedules, context, and secrets.
- Refactor existing hardcoded resolvers behind contribution-aware seams.

### Phase 5: Bundled Plugin Extraction

- Move existing built-in functionality into bundled plugins where it reduces coupling.
- Preserve core modules for platform primitives and API contracts.

### Phase 6: Operator and Developer Experience

- Add plugin health, status, scan results, contribution inventory, permission denials, and runtime metrics.
- Add SDK helpers, examples, local dev harness, manifest validation CLI, and contract tests.
- Add management UI after API lifecycle is stable.

## Acceptance Criteria

- A third-party plugin can be installed, scanned, enabled, invoked, disabled, quarantined, and uninstalled through explicit lifecycle paths.
- Enabled plugins can contribute at least tools, workflow steps, event subscriptions, and generic capability endpoints through sandboxed runtime boundaries.
- Policy blocks disallowed permissions, isolation modes, network/storage/secret access, and event subscriptions.
- Plugin contributions are auditable and removable when a plugin is disabled or quarantined.
- Existing tools, special steps, MCP/ACP projections, and memory behavior continue to work during migration.
- Operators can identify plugin health, contribution inventory, denials, errors, and crash-loop state.

## Risks and Mitigations

| Risk | Mitigation |
| ---- | ---------- |
| Plugin platform becomes a rewrite of the API | Keep policy, auth, persistence, audit, registry, and orchestration primitives in core. Use adapters instead of rewrites. |
| Third-party plugins create security exposure | Default to sandboxed runtimes, deny-by-default permissions, policy checks, static scan, and auditable calls. |
| Contribution contracts become too narrow | Pair typed contracts with event subscriptions and generic capability endpoints. |
| Plugin runtime instability affects API availability | Supervise runtimes separately, apply timeouts, quarantine crash loops, and normalize plugin errors. |
| Migration breaks existing functionality | Preserve current surfaces until contribution adapters prove parity with tests. |
