# EPIC: API and Kanban Domain Separation Enforcement

## Overview
This epic governs the final decoupling of the `api` (Control Plane) and `kanban` (Project/Domain) projects. While a logical split has occurred, several leaks remain in shared core schemas and capability providers. This work will eliminate those leaks, genericize the orchestrator core, and implement strict automated guardrails to prevent regressions.

## Current Status & Problem Statement
The `api` project still references domain-specific concepts such as `WorkItem` and `project_id`.
- **Core Schema Leaks:** `packages/core` contains orchestrator schemas (War Room, Agent Mentions) that explicitly define `project_id` and `work_item_id`.
- **Boilerplate Debt:** `apps/api` uses `.omit()` logic to hide these fields from its runtime capabilities, indicating an leaky abstraction.
- **Dependency Violations:** `apps/api` still depends on `@nexus/kanban-contracts`.
- **Test Failures:** `core-kanban-cutover.boundary.spec.ts` currently fails due to unclassified kanban terms in the workflow providers.

## Architectural Boundaries

### 1. Control Plane (`apps/api`)
- **Responsibility:** Orchestration, LLM management, transport, and session lifecycle.
- **Terminology:** `scope_id`, `context_id`, `session_id`, `workflow_run_id`.
- **Forbidden Knowledge:** Entities, repositories, or contracts related to Kanban, Projects, or WorkItems.

### 2. Domain Project (`apps/kanban`)
- **Responsibility:** Managing the project state, work items, and kanban logic.
- **Terminology:** `project_id`, `work_item_id`.
- **Communication:** Receives generic events/callbacks from the API and maps them to domain concepts.

## Implementation Plan

### Phase 1: Core Genericization
- [ ] **Genericize War Room:** Remove `project_id` and `work_item_id` from `OpenWarRoomSchema` in `packages/core`.
- [ ] **Genericize Agent Mentions:** Remove `work_item_id` from `MentionAgentSchema` in `packages/core`.
- [ ] **Standardize Types:** Update `packages/core/src/schemas/tools/nexus-orchestrator` to use consistent `scope_id` patterns.

### Phase 2: API Decoupling
- [ ] **Provider Cleanup:** Remove `.omit()` logic from `WarRoomCapabilityProvider` and `AgentMentionsCapabilityProvider`.
- [ ] **Controller Alignment:** Update `WorkflowRuntimeWarRoomController` and `WorkflowRuntimeAgentMentionsController` to use generic fields.
- [ ] **Remove Leaked Dependencies:** Uninstall `@nexus/kanban-contracts` from `apps/api`.

### Phase 3: Automated Guardrails
- [ ] **ESLint Hardening:** Add `no-restricted-imports` to `apps/api` to block `@nexus/kanban-contracts`.
- [ ] **ESLint Term Blocking:** Add `no-restricted-syntax` to block usage of `project_id` and `work_item_id` in `apps/api/src`.
- [ ] **Test Resolution:** Fix all violations in `core-kanban-cutover.boundary.spec.ts` and remove stale exceptions.

## Success Criteria
1. `npm run test` for `apps/api/src/core-kanban-cutover.boundary.spec.ts` passes with 100% success and NO stale exceptions.
2. `apps/api` has NO dependency on `@nexus/kanban-contracts` in `package.json`.
3. `packages/core` schemas for War Room and Mentions contain ZERO references to `project_id` or `work_item_id`.
4. ESLint prevents any developer from re-introducing `project_id` or `WorkItem` into the `api` project.

## Identified Leaks (as of 2026-05-12)
- `apps/api/src/workflow/providers/agent-mentions-capability.provider.ts`
- `apps/api/src/workflow/providers/war-room-capability.provider.ts`
- `apps/api/src/workflow/workflow-runtime/workflow-runtime-agent-mentions.controller.ts`
- `apps/api/src/workflow/workflow-runtime/workflow-runtime-war-room.controller.ts`
- `packages/core/src/schemas/tools/nexus-orchestrator/war-room.schemas.ts`
- `packages/core/src/schemas/tools/nexus-orchestrator/agent-mentions.schemas.ts`
