# EPIC-090: Core Control Plane Decoupling and Special-Step Extension Boundary

Status: Implemented (deterministic E2E validation deferred by request)
Priority: P0
Depends On: EPIC-088, EPIC-089
Related: PLAN-REFACTOR Phase 2
Last Updated: 2026-04-13

---

## 1. Epic Summary

Decouple apps/api into a true control plane by removing direct Kanban/Chat domain dependencies from workflow execution internals.

This epic introduces explicit extension seams so domain behavior is injected through contracts, not hard imports.

---

## 2. Context

Current workflow runtime is tightly coupled to project/session code:

1. Workflow module imports session module and project module.
2. Special-step handlers directly reference work-item/project services.
3. Runtime tools service reads project/work-item data via project service injections.
4. Workflow parser depends on project work-item execution types.

This prevents independent evolution of domain services and creates circular extraction risk.

---

## 3. References

1. ../../PLAN-REFACTOR.md
2. ../../apps/api/src/workflow/workflow.module.ts
3. ../../apps/api/src/workflow/step-special-step-executor.service.ts
4. ../../apps/api/src/workflow/step-transition-status-special-step.handler.ts
5. ../../apps/api/src/workflow/step-manage-execution-special-step.handler.ts
6. ../../apps/api/src/workflow/step-hydrate-work-items-special-step.handler.ts
7. ../../apps/api/src/workflow/workflow-runtime-tools.service.ts
8. ../../apps/api/src/workflow/workflow-parser.service.ts
9. ../../apps/api/src/project/work-item-automation.service.ts

---

## 4. Scope

### In Scope

1. Define control-plane facing domain ports for work-item/project/session operations.
2. Replace direct domain imports in workflow execution paths with port interfaces.
3. Convert special-step dispatch to a registration mechanism that supports external domain adapters.
4. Add typed error model for missing or invalid handler registration.
5. Introduce internal Core API endpoints for workflow run request/status/control.

### Out of Scope

1. Full removal of compatibility adapters.
2. Moving project/session data ownership to new services (handled later).

---

## 5. Implementation Plan

### 5.1 Port Interfaces

1. Add domain port interfaces in apps/api control-plane layer or shared package:
   - WorkItemDomainPort
   - ProjectDomainPort
   - ChatSessionDomainPort
2. Create temporary in-process adapter implementations backed by current project/session services.

### 5.2 Special-Step Registry

1. Replace constructor-only handler registration with provider-based registry discovery.
2. Require each handler to declare:
   - stable type key
   - input contract
   - owning domain
3. Fail fast with typed startup error when required handler is missing.

### 5.3 Runtime Tools Decoupling

1. Split workflow runtime tools into:
   - control-plane generic tools
   - domain-provided tools via adapter interface
2. Move project-specific query logic behind domain adapter APIs.

### 5.4 Internal Core API

1. Add internal routes under /internal/core/workflow-runs for domain-service consumption.
2. Preserve current external workflow routes during transition.
3. Emit domain-agnostic core lifecycle events using shared contract envelope.

---

## 6. Deliverables

1. Domain port interfaces and in-process adapters.
2. Extensible special-step handler registry with startup validation.
3. Decoupled runtime tools boundary.
4. Internal Core workflow-run API surface.
5. Regression tests for deterministic workflow behavior.

---

## 7. Acceptance Criteria

1. Workflow execution paths no longer import project/session services directly in core runtime components.
2. Special-step handlers are discoverable via registry mechanism and validated at boot.
3. Missing required handlers fail with typed, actionable startup diagnostics.
4. Internal Core workflow API endpoints are available and contract-validated.
5. Deterministic orchestration regression suite remains green.

---

## 8. Actionable Tasks

- [x] E090-001 Define work-item/project/chat domain port interfaces.
- [x] E090-002 Implement temporary in-process adapters for each port.
- [x] E090-003 Refactor special-step executor to registry/provider model.
- [x] E090-004 Migrate domain-specific handlers to adapter-backed implementations.
- [x] E090-005 Split runtime tools into generic and domain-provided partitions.
- [x] E090-006 Add internal /internal/core/workflow-runs APIs with shared contracts.
- [x] E090-007 Add startup validation and diagnostics for handler/port registration.
- [ ] E090-008 Run deterministic workflow regression and fix behavior drift (deferred per request to ignore E2E tests).

---

## 9. Test and Quality Gates

1. npm run lint
2. npm run lint:summary
3. npm run test:api
4. npm run test:e2e:kanban:deterministic

Validation note: deterministic E2E was explicitly excluded for this delivery per user instruction to ignore E2E tests.

---

## 10. Risks and Mitigations

1. Risk: Behavioral drift while refactoring special-step flow.
   Mitigation: snapshot tests around step execution outputs and event logs.
2. Risk: Hidden domain assumptions remain in helper utilities.
   Mitigation: import-boundary checks plus adapter-only access pattern.
3. Risk: Startup failures due to handler wiring complexity.
   Mitigation: explicit registry diagnostics and smoke tests.

---

## 11. Exit Criteria

1. Core workflow runtime compiles and runs through adapter contracts, not domain imports.
2. Internal core API is stable for external domain service integration.
3. Existing workflows remain behaviorally compatible under deterministic tests.
