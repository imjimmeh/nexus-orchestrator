---
project_scope_id: 458935f0-213e-4bbe-89d1-8883e0efa9ad
probe_scope_id: workflow-special-steps
outcome: success
inferred_status: implemented
confidence_score: 0.95
evidence_refs:
  - apps/api/src/workflow/workflow-special-steps/step-special-step-registry.service.ts
  - apps/api/src/workflow/workflow-special-steps/step-special-step-executor.service.ts
  - apps/api/src/workflow/workflow-special-steps/step-special-step-registry.service.spec.ts
  - apps/api/src/workflow/workflow-special-steps/step-special-step-executor.service.spec.ts
  - apps/api/src/workflow/workflow-special-steps/step-special-step-handler.di.spec.ts
  - apps/api/src/workflow/workflow-special-steps/plugin/special-step-plugin-loader.service.ts
  - apps/api/src/workflow/workflow-special-steps/plugin/special-step-plugin-loader.service.spec.ts
source_paths:
  - apps/api/src/workflow/workflow-special-steps
updated_at: 2026-06-02T00:00:00Z
---

# Probe Result: Workflow Special Step Handlers

## Narrative Summary

The `apps/api/src/workflow/workflow-special-steps/` directory is a well-structured, fully implemented feature scope containing the core special step handler system. It provides a registry-based architecture with 9 core handlers (register_tool, invoke_workflow, run_command, emit_event, web_automation, http_webhook, mcp_tool_call, git_operation, manage_tool_candidate), a pluggable registry service supporting dynamic plugin registration/unregistration, a dedicated executor service with switch/conditional input resolution and for_each iteration support, and a plugin loader service that validates andSandboxes plugin handlers. All core handlers have corresponding test coverage, and the plugin loader has its own isolated test suite.

## Capability Updates

### Core Special Step Handlers (9 implemented)

| Handler | File | Key Behaviors |
|---|---|---|
| `register_tool` | `step-register-tool-special-step.handler.ts` | Creates tools via ToolRegistryService; accepts name, schema, typescript_code, optional tier_restriction |
| `invoke_workflow` | `step-invoke-workflow-special-step.handler.ts` | Starts child workflow runs; resolves symbolic workflow IDs; prevents duplicate child spawns on parent retry (active child lookup); supports continue_on_concurrency_skip; optionally waits for child completion |
| `run_command` | `step-run-command-special-step.handler.ts` | Executes shell commands via `sh -c`; configurable timeout (default 30s, max 300s); configurable working_dir; returns exit_code, stdout/stderr lines |
| `emit_event` | `step-emit-event-special-step.handler.ts` | Emits NestJS EventEmitter2 events with optional payload; strict event_name validation |
| `web_automation` | `step-web-automation-special-step.handler.ts` | Delegates to WebAutomationActionExecutorService; returns action result including failure_artifact_id |
| `http_webhook` | `step-http-webhook-special-step.handler.ts` | URL allowlist + method allowlist policy enforcement; timeout with configurable ceiling; JSON body handling; event ledger audit for succeeded/failed/blocked |
| `mcp_tool_call` | `step-mcp-tool-call-special-step.handler.ts` | Server + tool allowlist policy enforcement; local MCP service invocation; run-scoped external MCP HTTP mount support (from trigger.externalMcpMounts); timeout with configurable ceiling; event ledger audit |
| `git_operation` | `step-git-operation-special-step.handler.ts` | 5 sub-actions: merge, provision_worktree, remove_worktree, create_branch, commit_paths; extracts repository/worktree context from workflow run state_variables or explicit inputs; validates target branch normalization; resolves stale target branch from managed worktree branch |
| `manage_tool_candidate` | `step-manage-tool-candidate-special-step.handler.ts` | Unified handler for validate + publish actions; delegates to ToolCandidateService |

### Registry Service

- **`StepSpecialStepRegistryService`**: Constructor-injected handler array; `onModuleInit` validates all 9 core types present; `getHandler()` for lookup; `registerPluginHandler()` with validation (owningDomain=plugin, non-empty pluginId, not a core/reserved type duplicate); `unregisterPluginHandler()` keyed by pluginId + version + contributionId; `getDescriptors()` for inspection.
- **Fail-fast on startup**: Missing required core handler → `MissingSpecialStepHandlerRegistrationError`; duplicate handler → `DuplicateSpecialStepHandlerRegistrationError`; invalid descriptor (missing, mismatched type, empty inputContract, reserved type) → `InvalidSpecialStepHandlerRegistrationError`.

### Executor Service

- **`StepSpecialStepExecutorService`**: Entry point for all special step execution; resolves handler; handles for_each via per-iteration item template resolution; supports switch/conditional input selection (branch-matched inputs override base); publishes `turn_end` event and calls `handleJobComplete` on the workflow engine after each execution.
- **Lazy workflow engine resolution** via `ModuleRef` to avoid startup circular dependency.

### Plugin System

- **`SpecialStepPluginLoaderService`**: `OnApplicationBootstrap` loads plugins from `NEXUS_SPECIAL_STEP_PLUGIN_DIR` env var; validates nexus.plugin.json against Zod schema; resolves entrypoint with path-traversal containment (no `..`, no absolute paths, no symlink escape); wraps plugin handlers with descriptor (owningDomain=plugin); validates runtime result shape (status=completed, source=plugin, mode must match handler type).
- **Sandbox**: All plugin results validated before returning to executor; cannot return core-mode results.

## Health Findings

### Test Coverage

| File | Test File | Coverage |
|---|---|---|
| `step-special-step-registry.service.ts` | `step-special-step-registry.service.spec.ts` | Full: registration, plugin registration/unregistration, fail-fast conditions, reserved type enforcement |
| `step-special-step-executor.service.ts` | `step-special-step-executor.service.spec.ts` | Full: all 9 handler types, for_each item template resolution, invoke_workflow concurrency skip, git_operation all sub-actions and outcomes, plugin handler delegation |
| `step-special-step-handler.di.spec.ts` | (same) | Verifies DI graph for invoke_workflow, http_webhook, mcp_tool_call |
| `step-emit-event-special-step.handler.ts` | `step-emit-event-special-step.handler.spec.ts` | Full: emit with/without payload, missing/empty event_name rejection |
| `step-http-webhook-special-step.handler.ts` | `step-http-webhook-special-step.handler.spec.ts` | Full: allowlist enforcement, blocked audit, successful POST with JSON response, failed request handling |
| `step-mcp-tool-call-special-step.handler.ts` | `step-mcp-tool-call-special-step.handler.spec.ts` | Full: policy enforcement, local invocation, external mount HTTP fallback, timeout, failure audit |
| `step-git-operation-special-step.handler.ts` | `step-git-operation-special-step.handler.spec.ts` | Full: target branch normalization, stale worktree branch resolution, auth_error metadata, provision_worktree, commit_paths with validation, clean commit output |
| `step-web-automation-special-step.handler.ts` | `step-web-automation-special-step.handler.spec.ts` | Maps executor result to handler output shape |
| `plugin/special-step-plugin-loader.service.ts` | `plugin/special-step-plugin-loader.service.spec.ts` | Full: skip on unconfigured/missing dir, valid plugin load, manifest id mismatch, missing entrypoint, path traversal containment, symlink escape, malformed handler/execute, invalid result shape |

### Code Quality Indicators

- Strong typing throughout: `ISpecialStepHandler` interface, `SpecialStepExecutionContext`, discriminated union `SpecialStepExecutionResult` for each mode.
- Consistent error messaging: all handlers prefix errors with `Step {stepId}: `.
- Policy helpers (`special-step-policy.helpers.ts`) shared between `http_webhook` and `mcp_tool_call` for URL/pattern allowlisting.
- No TODO comments in handler files; no placeholder implementations.
- Tests use proper mocking (vi.fn()) and verify both result and output shapes.

## Open Questions

1. **run_command handler has no dedicated test file** — only exercised via the executor integration tests. A dedicated spec.ts would improve isolated coverage and boundary testing for timeout, killed, and stderr edge cases.
2. **register_tool handler has no dedicated test file** — only exercised via executor integration tests. Isolated testing of validation (missing name/schema/code) is absent.
3. **manage_tool_candidate handler has no dedicated test file** — validate and publish paths not independently tested.
4. **web_automation handler has minimal test coverage** — only one test verifying the result/output mapping; no tests for failure artifact flow or session handling.
5. **invoke_workflow handler has no dedicated test file** — symbolic ID resolution, active child reuse, and concurrency skip logic only tested via executor fixture.
6. **Policy enforcement consistency** — `http_webhook` requires explicit `policy.allowed_urls`, `mcp_tool_call` requires both `policy.allowed_servers` and `policy.allowed_tools`. There is no centralized policy enforcement abstraction; policy helpers are duplicated across handlers with minor signature variations.

---