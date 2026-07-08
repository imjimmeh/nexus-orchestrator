# EPIC-081: Plugin SDK and Extension Lifecycle

Status: Proposed
Priority: P1
Depends On: EPIC-004, EPIC-057, EPIC-080
Last Updated: 2026-04-12

---

## 1. Summary

Introduce a formal extension model above existing tools and skills so Nexus can load, validate, enable, disable, and version plugin packages with policy controls.

This is the lowest-risk path to ecosystem expansion before service split.

---

## 2. Problem

Current extensibility is fragmented:

1. Dynamic tools are ad hoc and registry-bound.
2. Skills are file-based guidance, not runtime extension modules.
3. No plugin manifest, lifecycle, or trust model.

---

## 3. Goals

1. Define plugin manifest and SDK contract for runtime registration.
2. Add plugin lifecycle APIs: install, inspect, enable, disable, uninstall.
3. Add plugin trust controls: allowlist, denylist, scan status.
4. Support plugin contributions for tools and workflow hooks.

## 4. Non-Goals

1. Public marketplace release in v1.
2. Executing unsigned remote code by default.

---

## 5. Architecture

### 5.1 Plugin Manifest

Manifest fields:

1. id, name, version
2. capabilities (tools, hooks, providers)
3. entrypoints
4. permissions requested
5. compatibility range

### 5.2 Plugin Runtime

1. Plugin loader resolves enabled plugins from configured paths.
2. Plugin sandbox policy validates requested permissions.
3. Plugin contributions are registered into existing runtime services.

### 5.3 Security

1. Static scan at install/update.
2. Manifest validation and signature support hook.
3. Runtime policy block on disallowed capabilities.

### 5.4 API

1. GET /plugins
2. POST /plugins/install
3. POST /plugins/:id/enable
4. POST /plugins/:id/disable
5. DELETE /plugins/:id
6. GET /plugins/:id/inspect

---

## 6. Workstreams

1. Manifest schema and validator.
2. Plugin registry and loader.
3. Policy and scan pipeline.
4. Contribution adapters into tools and hooks.
5. Management API and UI panel.

---

## 7. Backlog

- [ ] E081-001 Add plugin manifest schema and validation service.
- [ ] E081-002 Add plugin registry entity and migration.
- [ ] E081-003 Add plugin loader and enablement resolver.
- [ ] E081-004 Add capability permission gate for plugin contributions.
- [ ] E081-005 Add tool contribution bridge into ToolRegistryService.
- [ ] E081-006 Add hook contribution bridge into automation hook runtime.
- [ ] E081-007 Add plugin install and scan API.
- [ ] E081-008 Add plugin enable/disable/uninstall API.
- [ ] E081-009 Add plugin management UI with status badges.
- [ ] E081-010 Add tests for validation, policy blocks, and runtime load order.

---

## 8. Acceptance Criteria

1. Plugin packages can be installed and inspected with manifest validation.
2. Only enabled plugins contribute runtime capabilities.
3. Permission policy blocks disallowed plugin behavior.
4. Plugin lifecycle is auditable and reversible.

---

## 9. Risks and Mitigation

1. Runtime instability from plugin errors.
   - Mitigate with plugin isolation boundaries and fail-closed loading.
2. Security regression from untrusted plugins.
   - Mitigate with default deny policy and scan requirement.
