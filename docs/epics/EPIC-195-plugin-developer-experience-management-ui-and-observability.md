# EPIC-195: Plugin Developer Experience, Management UI, and Observability

**Status:** Proposed
**Priority:** P2
**Created:** 2026-05-17
**Updated:** 2026-05-17
**Owner:** Platform Extensibility / Web Platform
**Parent:** EPIC-188
**Depends on:** EPIC-189, EPIC-190, EPIC-191
**Related:** EPIC-081, EPIC-146, EPIC-171

## Summary

Add the tooling, examples, management UI, and observability needed for operators to trust plugins and for developers to build plugins without reading API internals.

## Problem Statement

A plugin platform is not usable if operators cannot see plugin health, permissions, contribution inventory, denials, crashes, or scan results. It is also not adoptable if plugin authors lack SDK helpers, validation tools, local development harnesses, examples, and contract tests.

## Goals

- Provide SDK helpers for manifest creation, contribution declaration, runtime handlers, and local testing.
- Add a manifest validation CLI or script that plugin authors can run before install.
- Add example plugins for tools, workflow steps, event subscriptions, memory providers, and generic capability endpoints.
- Add plugin management UI for install/inspect/enable/disable/quarantine/uninstall after lifecycle APIs stabilize.
- Add plugin health, metrics, audit, scan result, and contribution inventory visibility.
- Prepare for optional signing and marketplace readiness without making marketplace release part of this epic.

## Non-Goals

- Public plugin marketplace.
- Remote plugin discovery service.
- Full plugin signing enforcement in the first UI/DX wave.
- Rich custom plugin UI panels beyond basic settings metadata unless the `ui.settings` contribution type is ready.

## Developer Experience Workstreams

### 1. SDK Authoring Helpers

- Add helpers for `definePlugin`, manifest validation, contribution declaration, and runtime handler typing.
- Keep SDK types independent of API-only imports.

Acceptance criteria:

- Plugin authors can define a plugin without importing from `apps/api`.
- SDK examples compile against published workspace packages.

### 2. Local Dev Harness

- Add a local runner that can load a plugin manifest, validate it, start the plugin runtime, and simulate kernel calls.

Acceptance criteria:

- Authors can test handshake, contribution declaration, invocation, event delivery, and shutdown locally.
- Harness can run without a full Nexus stack where possible.

### 3. Contract Tests

- Provide reusable tests for manifest validation, contribution schemas, runtime protocol conformance, and permission declarations.

Acceptance criteria:

- Example plugins run the same contract tests expected by the API install path.

### 4. Examples

- Add minimal and realistic plugin examples.

Expected examples:

- Tool plugin.
- Workflow step plugin.
- Event subscription plugin.
- Memory provider plugin.
- Capability endpoint plugin.

## Operator Experience Workstreams

### 1. Plugin Management UI

Add web UI screens or settings cards for:

- Plugin list.
- Plugin detail/inspect.
- Install from approved source.
- Scan result review.
- Enable/disable/quarantine/uninstall actions.
- Permission and isolation mode display.
- Contribution inventory.

Acceptance criteria:

- Operators can understand what a plugin contributes before enabling it.
- Dangerous actions require explicit confirmation.
- UI does not expose secrets.

### 2. Observability

Expose plugin operational state through API and UI.

Expected fields:

- Runtime status.
- Contribution count by type.
- Invocation latency and error rate.
- Crash-loop status.
- Last scan result.
- Permission denials.
- Last enable/disable/quarantine reason.

Acceptance criteria:

- Operators can diagnose why a plugin is disabled, denied, failed, or quarantined.
- Plugin health can be used by operations checks.

### 3. Documentation

- Update architecture docs.
- Add plugin authoring guide.
- Add operator runbook for safe plugin installation and incident response.

## Backlog

- [ ] E195-001 Add `definePlugin` SDK helper and manifest validation exports.
- [ ] E195-002 Add plugin local dev harness.
- [ ] E195-003 Add reusable plugin contract tests.
- [ ] E195-004 Add example tool plugin.
- [ ] E195-005 Add example workflow step plugin.
- [ ] E195-006 Add example event subscription plugin.
- [ ] E195-007 Add example memory provider plugin.
- [ ] E195-008 Add plugin management UI.
- [ ] E195-009 Add plugin observability API fields and operations checks.
- [ ] E195-010 Add authoring guide and operator runbook.

## Acceptance Criteria

- A plugin author can create, validate, and locally test a plugin without reading API source code.
- Operators can inspect plugin status, permissions, isolation mode, scan results, contribution inventory, errors, and denials.
- Example plugins demonstrate the supported contribution model.
- Plugin documentation clearly distinguishes bundled, local trusted, third-party, and quarantined plugins.
