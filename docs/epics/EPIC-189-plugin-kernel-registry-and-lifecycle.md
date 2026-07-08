# EPIC-189: Plugin Kernel, Registry, and Lifecycle

**Status:** Completed
**Priority:** P0
**Created:** 2026-05-17
**Updated:** 2026-05-17
**Owner:** Platform Extensibility
**Parent:** EPIC-188
**Depends on:** EPIC-081, EPIC-181, EPIC-182
**Related:** EPIC-140, EPIC-171

## Summary

Introduce the `PluginKernelModule`, plugin manifest contract, durable plugin registry, lifecycle state machine, and management APIs that all later plugin work depends on.

## Problem Statement

Current extension mechanisms do not share lifecycle semantics. Special-step plugins are loaded at startup from a directory. Dynamic tools are stored in the tool registry. MCP/ACP servers have their own configuration and projection lifecycle. There is no central plugin record that describes installed package state, trust level, scan status, permissions, isolation policy, contribution inventory, or audit history.

## Goals

- Add a central `PluginKernelModule` as the API boundary for plugin lifecycle and contribution inventory.
- Define the plugin manifest schema and SDK-facing types.
- Persist installed plugin state in database tables.
- Implement lifecycle states: `discovered`, `installed`, `scanned`, `enabled`, `disabled`, `quarantined`, and `uninstalled`.
- Add lifecycle APIs for list, inspect, install, scan, enable, disable, quarantine, and uninstall.
- Record auditable lifecycle events.
- Keep current special-step plugin loading, dynamic tools, MCP/ACP, and memory behavior unchanged while the kernel is introduced.

## Non-Goals

- Implement worker-process or container isolation in this epic.
- Implement every contribution type in this epic.
- Add public marketplace install flows.
- Move existing built-in functionality into plugins yet.
- Project enabled contributions into runtime registries or remove active contribution projections during disable/quarantine; this is deferred to EPIC-191 and EPIC-194.

## Workstreams

### 1. Manifest Contract

Define a versioned plugin manifest that includes:

- `id`, `name`, `version`, `description`, `author`.
- `nexusCompatibility` version/range.
- `entrypoints` for each supported runtime mode.
- Supported `isolationModes`.
- Requested `permissions`.
- Declared `contributions`.
- Optional package metadata, checksum, and signature fields.

Acceptance criteria:

- Invalid manifests fail with structured validation messages.
- Duplicate contribution ids and malformed permission declarations are rejected.
- Manifest parsing is available from `@nexus/plugin-sdk` or a shared package without API-only imports.

### 2. Registry Persistence

Add plugin registry persistence for installed package state.

Expected data:

- Plugin identity and version.
- Source type and package location.
- Lifecycle state and enabled flag.
- Trust level and selected isolation mode.
- Declared permissions and granted permissions.
- Scan result and compatibility result.
- Contribution inventory.
- Last error, last started time, last stopped time, created/updated timestamps.

Acceptance criteria:

- Registry rows can represent installed, disabled, enabled, quarantined, and uninstalled plugins.
- Registry state is queryable without loading plugin code.
- Migrations are reversible and registered with the API migration list.

### 3. Lifecycle Service

Implement lifecycle operations as service methods before adding controller routes.

Required operations:

- `discoverPackage`
- `installPlugin`
- `scanPlugin`
- `enablePlugin`
- `disablePlugin`
- `quarantinePlugin`
- `uninstallPlugin`
- `inspectPlugin`
- `listPlugins`

Acceptance criteria:

- Invalid state transitions are rejected with clear errors.
- Disable and quarantine paths update durable lifecycle state; active contribution projection and removal are deferred to EPIC-191 and EPIC-194.
- Lifecycle operations emit audit records.

### 4. Management API

Expose lifecycle operations under a dedicated plugin controller.

Expected routes:

- `GET /plugins`
- `GET /plugins/:id/inspect`
- `POST /plugins/install`
- `POST /plugins/:id/scan`
- `POST /plugins/:id/enable`
- `POST /plugins/:id/disable`
- `POST /plugins/:id/quarantine`
- `DELETE /plugins/:id`

Acceptance criteria:

- Mutating routes are Admin-only.
- Inspect/list routes are available to Admin and Developer roles.
- Responses never expose raw secrets, env values, or package internals beyond safe metadata.

## Backlog

- [x] E189-001 Define plugin manifest schema and SDK exports.
- [x] E189-002 Add plugin registry entity, repository, and migration.
- [x] E189-003 Add lifecycle state machine and transition validation.
- [x] E189-004 Add plugin lifecycle service with unit tests.
- [x] E189-005 Add plugin management controller and DTO schemas.
- [x] E189-006 Add audit events for lifecycle transitions.
- [x] E189-007 Add docs for manifest fields and lifecycle states.

## Acceptance Criteria

- Plugins have durable lifecycle state independent of runtime loading.
- Operators can inspect plugin metadata, permissions, compatibility, scan status, and contribution declarations.
- Enabled, disabled, and quarantined state transitions are auditable and constrained by the lifecycle state machine.
- The kernel records contribution inventory; active contribution projection and removal are deferred to EPIC-191 and EPIC-194.
- Existing extension surfaces remain operational while the kernel is introduced.
