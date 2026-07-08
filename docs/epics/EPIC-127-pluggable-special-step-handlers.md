# EPIC-127 — Pluggable Special Step Handlers for Workflow Engine

**Status:** MVP Implemented
**Created:** 2026-04-19  
**Related Epics:** EPIC-081 (Plugin SDK), EPIC-028 (Workflow Jobs and Steps), EPIC-119 (Domain Hardening)

---

## Background

The workflow engine currently supports a fixed set of special step handlers (e.g. `register_tool`, `invoke_workflow`, `run_command`, `web_automation`, `emit_event`, `amend_entity`, `git_operation`, `manage_tool_candidate`). These are hard-coded in `WorkflowModule` and registered via a static NestJS DI token `SPECIAL_STEP_HANDLERS`. This means end users cannot add custom special step logic without modifying the core application and rebuilding it.

## Goals

1. **Plugin Architecture:** Allow end users to extend the application with custom special step handlers without rebuilding the core app.
2. **Runtime Discovery:** Support loading plugin handlers at runtime from a designated plugin directory.
3. **Type Safety:** Maintain strong typing for core handlers while allowing dynamic registration for plugin handlers.
4. **Security & Validation:** Validate plugin manifests in the MVP and document that sandbox enforcement is future hardening work.
5. **Backwards Compatibility:** Existing core handlers and YAML workflows must continue to work unchanged.

## Stories

### 1. Relax Type System for Dynamic Registration
- Convert `SupportedSpecialStepType` from a strict string union to a runtime-validated string type.
- Split into `CORE_SPECIAL_STEP_TYPES` (static) and a dynamic plugin type registry.
- Update `WorkflowSpecialJobType` in `@nexus/core` to accept any string.
- Update `SpecialStepExecutionResult` to support generic plugin result shapes.

### 2. Create Plugin SDK & Manifest Interface
- Define `ISpecialStepPluginHandler` interface in a new shared package or SDK module.
- Define `IPluginManifest` with metadata, version, and handler array.
- Provide a JSON Schema or Zod schema for manifest validation.
- Document the plugin contract for external authors.

### 3. Implement Plugin Loader Service
- Create `SpecialStepPluginLoaderService` that discovers plugins from a configurable directory (e.g. `./plugins` or env var `NEXUS_SPECIAL_STEP_PLUGIN_DIR`).
- Scan for packages with a `nexus-plugin` keyword or manifest file.
- Load and validate each plugin manifest.
- Register valid handlers with `StepSpecialStepRegistryService` at startup.

### 4. Update Registry for Runtime Registration
- Modify `StepSpecialStepRegistryService` to:
  - Keep core handlers injected statically via `SPECIAL_STEP_HANDLERS`.
  - Add a `registerPluginHandler()` method for dynamic registration.
  - Remove or relax the strict "all types must have handlers" validation — only enforce for core types.
- Ensure `getHandler()` works for both core and plugin types.

### 5. Sandbox & Security Hardening
- Validate plugin manifests before loading (type uniqueness, descriptor correctness).
- Optionally sandbox plugin execution using `vm2` or `isolated-vm` for untrusted code.
- Implement a permission model (e.g. filesystem, network, host mounts) that plugins must declare.
- Support plugin signature verification in production environments.

### 6. Out-of-Process Plugin Alternative (Optional/Future)
- Design an HTTP-based plugin protocol where plugins run as separate services.
- Define the request/response contract for external handlers.
- This allows language-agnostic plugins and stronger process isolation.

### 7. Documentation & Examples
- Provide a sample plugin package (e.g. `send_webhook` handler).
- Document plugin directory structure, manifest format, and deployment.
- Update workflow YAML authoring docs to mention plugin step types.

## Acceptance Criteria

- [ ] A plugin handler can be dropped into `./plugins/` and is automatically registered on app startup.
- [ ] YAML workflows can reference plugin step types by string (e.g. `type: send_webhook`) and execute successfully.
- [ ] Core handlers (`register_tool`, `invoke_workflow`, etc.) continue to work without any changes.
- [ ] Plugin manifest validation rejects invalid or duplicate type registrations.
- [ ] Unit tests cover plugin loading, registration, and execution paths.
- [ ] Documentation includes a "Getting Started" guide for plugin authors.

## Files Affected

| File | Change |
|------|--------|
| `apps/api/src/workflow/step-special-step.types.ts` | Relax `SupportedSpecialStepType`, add plugin result shape |
| `packages/core/src/interfaces/workflow-legacy.types.ts` | Change `WorkflowSpecialJobType` to `string` |
| `apps/api/src/workflow/step-special-step-registry.service.ts` | Add `registerPluginHandler()`, relax validation |
| `apps/api/src/workflow/workflow.module.ts` | Add `SpecialStepPluginLoaderService` to providers |
| *(new)* `apps/api/src/workflow/plugin/special-step-plugin-loader.service.ts` | Plugin discovery & loading |
| *(new)* `packages/plugin-sdk/src/special-step-plugin.types.ts` | Plugin SDK types |
| *(new)* `docs/guides/writing-workflow-plugins.md` | Authoring guide |

## Notes

- Consider leveraging existing `EPIC-081` (Plugin SDK) infrastructure if it provides a generic plugin loading framework.
- The current `SPECIAL_STEP_HANDLERS` factory injection pattern should be preserved for core handlers; plugin handlers are additive.
- For MVP, in-process JS/TS plugins are sufficient. Out-of-process plugins can be a follow-up story.
- Implementation note (2026-04-29): The MVP loads trusted in-process special-step plugins from `NEXUS_SPECIAL_STEP_PLUGIN_DIR`, using one subdirectory per plugin package with a validated `nexus.plugin.json` manifest. Permission declarations are validation/metadata only; sandboxing, signature verification, and out-of-process isolation remain future hardening work.
