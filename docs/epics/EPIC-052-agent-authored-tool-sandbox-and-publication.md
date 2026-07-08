# EPIC-052: Agent-Authored Tool Sandbox and Publication Pipeline

> Status: Planned
> Priority: High
> Estimate: 4-7 weeks
> Created: 2026-04-05
> Owner: TBD

---

## 1. Epic Summary

Deliver a first-class workflow where agents can:

1. Generate a tool implementation (Node or Python script).
2. Run deterministic validation in an isolated sandbox container.
3. Publish the tool as a callable capability for other agents.

This epic closes the current gap between "tool metadata registration" and "validated, executable, reusable tool runtime."

---

## 2. Current-State Review (What Already Exists)

The platform already has several foundational pieces:

1. Dynamic registration path exists:
   - `register_tool` special step is implemented and wired.
   - `ToolRegistryService.upsertTool()` persists tool entries.
2. Capability transport path exists:
   - `upsert_tool` is now an `api_callback` capability.
3. Tool mount + discovery path exists:
   - API writes mounted tool files with metadata.
   - pi-runner loads mounted metadata and surfaces callable tool definitions.
4. Containerized command execution exists for execution jobs:
   - Multi-step execution jobs can run `run_command` steps inside the same container.
5. Basic app management exists:
   - Web `/tools` page supports CRUD (name, schema, TypeScript code, tier).
6. Proof workflow exists:
   - `web-search-tool-test.workflow.yaml` demonstrates agent code generation followed by `register_tool`.

Conclusion: you already have dynamic registry plumbing, but not an end-to-end, safety-gated "agent builds and validates executable tool runtime before publish" flow.

---

## 3. Missing Functionality Against Target Idea

To satisfy the idea fully, the following is still missing:

1. No dedicated sandbox publication lifecycle:
   - There is no explicit author -> validate -> publish state machine for tools.
2. No mandatory isolated test gate before registration:
   - Existing `register_tool` accepts name/schema/code directly.
3. No language-agnostic runtime contract:
   - Current tool model is TypeScript-centric and does not model Python scripts.
4. Runtime execution mismatch for agent-authored code:
   - Mounted tool loading uses metadata + callback semantics; custom TypeScript body is not a guaranteed executable runtime path.
5. No draft/validated/published artifact model:
   - Tool registry has no status/version/validation report fields.
6. No first-class UX for validation and publish controls:
   - Web tool management is CRUD only; no sandbox-run logs, validation history, or one-click publish.
7. No policy boundary for agent-authored executable code:
   - Missing strict governance around who can publish, what runtimes are allowed, and what network/filesystem rights are granted.

---

## 4. Goals

1. Enable agents to author Node/Python tool code safely.
2. Enforce isolated sandbox validation before publication.
3. Make published tools callable by other agents through a stable runtime transport.
4. Add governance, observability, and rollback-ready versioning.
5. Provide UI/API visibility into draft, validation, and publication outcomes.

---

## 5. Non-Goals

1. Replacing the existing capability contract system.
2. Replacing current `api_callback` transport for built-in orchestration tools.
3. Building arbitrary internet-enabled untrusted code execution.
4. Adding general package-manager install freedom in sandbox (no unrestricted npm/pip).

---

## 6. Target Architecture

### 6.1 Tool Candidate Lifecycle

Introduce an explicit lifecycle:

1. `draft` (authored code + schema + language + metadata)
2. `validated` (sandbox test suite passed)
3. `published` (registry entry is active/callable)
4. `failed` (validation failed with report)

### 6.2 New Artifact and Validation Data Model

Add persistent entities:

1. `tool_artifacts`
   - tool logical name
   - language (`node` | `python`)
   - source code
   - optional test spec
   - declared input schema
   - checksum/version
2. `tool_validation_runs`
   - artifact id
   - sandbox image/runtime
   - status/exit code
   - stdout/stderr
   - duration, timestamps
   - policy denials if blocked

### 6.3 Sandboxed Validation Service

Create `ToolSandboxService`:

1. Spins short-lived sandbox containers (no host workspace mount by default).
2. Applies strict constraints:
   - no Docker socket
   - readonly rootfs where possible
   - network disabled by default
   - CPU/memory/time limits
3. Runs language harness:
   - Node: execute candidate module + smoke assertions.
   - Python: execute candidate module + smoke assertions.
4. Produces structured validation report for workflow and UI consumption.

### 6.4 Publication Runtime Path

Publish tools through a stable callback contract:

1. Published tools are represented in `ToolRegistry` with an internal `api_callback` that routes to a new runtime endpoint.
2. New runtime endpoint executes the latest published artifact in sandbox and returns structured tool result.
3. This keeps runner-side invocation consistent while enabling language-flexible execution.

### 6.5 Workflow Primitives

Add two new special step types:

1. `validate_tool_candidate`
   - reads tool candidate payload
   - runs sandbox validation
   - stores validation report
2. `publish_tool_candidate`
   - requires successful validation run id
   - publishes/updates registry entry and marks active version

Keep `register_tool` for legacy/manual scenarios, but document it as unsafe for autonomous agent-authored runtime code.

### 6.6 Web App Enhancements

Upgrade `/tools` into lifecycle management:

1. Draft creation form with language selector.
2. "Run validation" action and log viewer.
3. Publish button gated on passing validation.
4. Version history with rollback target selection.
5. Status badges (`draft`, `validated`, `published`, `failed`).

---

## 7. Delivery Plan

### Phase 1: Foundation and Data Model

1. Add DB migrations for artifacts and validation runs.
2. Add service/repository layer for candidate lifecycle.
3. Add API DTOs and contracts for create/validate/publish flows.
4. Add policy checks for who can validate/publish.

### Phase 2: Sandbox Validation Engine

1. Implement `ToolSandboxService` and hardened container policy.
2. Implement Node and Python harness runners.
3. Persist validation results and expose logs.
4. Add unit/integration tests for success/failure/timeouts/policy denials.

### Phase 3: Workflow Integration

1. Implement `validate_tool_candidate` special step handler.
2. Implement `publish_tool_candidate` special step handler.
3. Seed a reference workflow template for agent-authored tools.
4. Add workflow validation rules for required fields and dependencies.

### Phase 4: Runtime Invocation and Registry Wiring

1. Add tool runtime execution endpoint for published artifacts.
2. Wire published tools to callback transport for agent calls.
3. Ensure capability preflight includes publication status checks.
4. Add telemetry events for validation/publish/execution outcomes.

### Phase 5: UI + E2E Hardening

1. Add tools lifecycle views and actions in web app.
2. Add e2e scenario:
   - agent authors tool
   - sandbox validation passes
   - tool is published
   - different agent run calls the new tool successfully
3. Add failure-path e2e:
   - validation failure blocks publish
   - policy denial blocks publish
4. Update docs/runbooks.

---

## 8. Backend Scope

### Expected Files to Modify

1. `apps/api/src/tool/tool-registry.service.ts`
2. `apps/api/src/tool/tool.controller.ts`
3. `apps/api/src/workflow/step-special-step.types.ts`
4. `apps/api/src/workflow/step-special-step-executor.service.ts`
5. `apps/api/src/workflow/validation/workflow-validation.job-validators.ts`
6. `apps/api/src/tool/capability-manifest.execution.entries.ts`
7. `apps/api/src/tool/capability-preflight.service.ts`
8. `apps/api/src/workflow/workflow.module.ts`

### Expected Files to Create

1. `apps/api/src/database/entities/tool-artifact.entity.ts`
2. `apps/api/src/database/entities/tool-validation-run.entity.ts`
3. `apps/api/src/database/repositories/tool-artifact.repository.ts`
4. `apps/api/src/database/repositories/tool-validation-run.repository.ts`
5. `apps/api/src/tool/tool-sandbox.service.ts`
6. `apps/api/src/tool/tool-candidate.service.ts`
7. `apps/api/src/tool/tool-runtime-execution.service.ts`
8. `apps/api/src/workflow/step-validate-tool-candidate-special-step.handler.ts`
9. `apps/api/src/workflow/step-publish-tool-candidate-special-step.handler.ts`
10. `apps/api/src/database/migrations/<timestamp>-create-tool-artifact-and-validation-tables.ts`

---

## 9. Runner Scope

### Expected Files to Modify

1. `packages/pi-runner/src/session-factory.ts`

### Expected Files to Create

1. `packages/pi-runner/src/tool-runtime.types.ts` (only if needed for callback contract typing)

Note:
Runner changes are intentionally minimal if tool invocation remains callback-driven.

---

## 10. Frontend Scope

### Expected Files to Modify

1. `apps/web/src/pages/tools/Tools.tsx`
2. `apps/web/src/pages/tools/ToolForm.tsx`
3. `apps/web/src/lib/api/client.ts`
4. `apps/web/src/lib/api/types.ts`
5. `apps/web/src/hooks/useTools.ts`

### Expected Files to Create

1. `apps/web/src/pages/tools/ToolValidationRuns.tsx`
2. `apps/web/src/pages/tools/ToolPublishPanel.tsx`
3. `apps/web/src/pages/tools/ToolVersionHistory.tsx`

---

## 11. Security and Governance Requirements

1. Sandbox containers must run with least privilege and strict resource limits.
2. No direct host workspace mount for validation by default.
3. Network access off by default; explicit allowlist for approved cases only.
4. Publishing requires role + policy check (and optional approval gate in supervised mode).
5. Full audit log for candidate creation, validation, and publish actions.

---

## 12. Testing Strategy

1. Unit tests:
   - candidate lifecycle state transitions
   - sandbox harness behavior and timeout handling
   - publication gating logic
2. Integration tests:
   - special steps `validate_tool_candidate` and `publish_tool_candidate`
   - runtime callback execution endpoint
3. E2E tests:
   - cross-agent reuse of published tool
   - failure and denial scenarios

---

## 13. Acceptance Criteria

1. Agent can author a Node or Python tool candidate and persist it as draft.
2. Validation runs in an isolated sandbox and records reproducible logs.
3. Publish is blocked unless latest validation status is pass.
4. Published tool appears in capability resolution and is callable by other agents.
5. Tool execution result is returned through standard tool telemetry path.
6. UI exposes draft/validated/published state and validation logs.
7. E2E flow (author -> validate -> publish -> reuse) passes.

---

## 14. Risks and Mitigations

1. Risk: sandbox execution cost and latency.
   - Mitigation: short timeouts, constrained images, caching, queue limits.
2. Risk: security vulnerabilities in untrusted code execution.
   - Mitigation: strict container hardening, zero secret injection by default, no host mounts.
3. Risk: capability drift with new lifecycle states.
   - Mitigation: extend capability contract validation to require `published` status for callable tools.
4. Risk: migration complexity for existing manually registered tools.
   - Mitigation: backward-compatible legacy path and phased migration guidance.

---

## 15. Open Questions

1. Should publication always require human approval in supervised mode, even after validation pass?
2. Should we allow outbound internet during validation for selected tool classes?
3. Do we support private project-scoped tools before global publication?
4. What rollback semantics do we want when a newly published version degrades downstream workflows?
