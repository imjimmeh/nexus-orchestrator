# EPIC: Work Item Priority, Dependency Graph, and Auto-Dispatch

**Epic ID:** EPIC-038  
**Status:** Implemented  
**Created:** 2026-03-30  
**Priority:** P0 - Critical  
**Theme:** Workflow-Driven Kanban Automation

## 1. Executive Summary

### 1.1 Problem Statement
Work item execution is currently reactive: items start when users manually move cards. The platform lacks first-class dependency relationships between work items, does not consistently carry spec markdown into execution context, and has no queue dispatcher that fills in-progress capacity automatically.

### 1.2 Solution Overview
Implement a workflow-driven dispatch system that:
- models dependency relationships for epic/story/task work items,
- auto-attaches relevant markdown spec files to execution context,
- automatically promotes eligible todo items to in-progress using agent-assisted prioritization,
- enforces configurable concurrency limits per project.

### 1.3 Success Criteria
- Work items support explicit dependencies with validation and cycle prevention.
- Relevant markdown spec file(s) are auto-linked into work item execution context.
- Dispatcher automation selects and starts highest-priority eligible todo items.
- Active in-progress work item count never exceeds configured limit.
- Automation remains event-driven and workflow-configurable (minimal hardcoded orchestration).

---

## 2. Context & User Stories

### 2.1 Context
The platform already has workflow-driven status automation and status-triggered workflows. This epic extends the kanban lifecycle to support queue orchestration and dependency-aware execution while preserving the existing workflow/event architecture.

### 2.2 User Stories
- **As a PM**, I want to define dependency links so blocked items do not start prematurely.
- **As a PM**, I want priority to influence which todo item starts next.
- **As a Developer**, I want each work item run to automatically include its corresponding markdown spec file context.
- **As an Admin**, I want to cap concurrent in-progress items using a setting (X) so compute usage and focus are controlled.
- **As a User**, I want queue advancement to be automatic and event-driven instead of manual card movement.

---

## 3. Technical Requirements

### 3.1 Data Model & API
- Add first-class work item dependency modeling:
  - `depends_on` relation (work item -> work item)
  - `blocked_by` read projection
- Enforce constraints:
  - same project only,
  - no self dependency,
  - no cycles.
- Preserve and harden priority semantics (`p0`..`p3`) across create/update/hydration.
- Extend DTOs and endpoints for dependency creation and updates.

### 3.2 Context Attachment
- Auto-link markdown source files to `executionConfig.contextFiles` when work items are created from specs or via APIs.
- Merge auto-derived context with user-provided context files (deduplicated, validated against repo file list).
- Ensure in-progress implementation workflow prompt references these context files explicitly.

### 3.3 Queue Dispatch Automation
- Introduce dispatcher workflow that reacts to lifecycle events and fills available execution slots.
- Candidate selection requirements:
  - only `todo` status,
  - dependency-satisfied,
  - sorted by priority (with deterministic tie-breaker),
  - optionally refined by agent recommendation.
- Transition selected work items to `in-progress` via existing status transition path.

### 3.4 Concurrency & Configuration
- Add system setting(s) for dispatcher capacity control:
  - `work_item_dispatch_max_active_per_project` (integer > 0)
- Capacity algorithm:
  - active statuses include `in-progress`, `in-review`, `ready-to-merge`, and optionally `blocked` (configurable policy decision).
- Add lock/idempotency guard to prevent over-dispatch under concurrent events.

### 3.5 Event-Driven Architecture
- Trigger dispatcher from status lifecycle changes and workflow run completion/failure events.
- Keep orchestration workflow/event-driven; avoid periodic polling where possible.
- Add telemetry events for dispatch decisions (eligible count, selected IDs, skipped reasons).

---

## 4. Tasks

### Phase 1: Dependency Model and API
- [x] Create schema/migration for work item dependency edges.
- [x] Add repository methods for dependency CRUD and lookup.
- [x] Extend create/update work item DTOs to accept dependency IDs.
- [x] Implement dependency validation (same-project, no self, no cycles).
- [x] Add API responses exposing `dependsOn` and `blockedBy`.
- [x] Add unit/integration tests for dependency validation and persistence.

### Phase 2: Priority Normalization and Selection Inputs
- [x] Normalize priority handling end-to-end (`p0`..`p3`) and reject invalid values.
- [x] Ensure hydration and API creation use same normalization rules.
- [x] Add stable tie-break ordering (createdAt/updatedAt/id) for deterministic dispatch.
- [x] Add tests for priority ordering edge cases.

### Phase 3: Markdown Context Auto-Attachment
- [x] Implement context resolver service to derive markdown context file candidates.
- [x] Auto-populate `executionConfig.contextFiles` on create/createMany/hydrate.
- [x] Preserve user-defined context files and deduplicate.
- [x] Update implementation workflow prompt to enumerate/use context files.
- [x] Add tests for context auto-linking, fallback behavior, and idempotency.

### Phase 4: Event-Driven Dispatcher Workflow
- [x] Add workflow seed for todo dispatch automation.
- [x] Add trigger bindings for lifecycle events that should refill capacity.
- [x] Implement candidate query service for eligible todo items.
- [x] Implement agent-assisted selection step and output contract.
- [x] Transition selected tickets to `in-progress` with suppress/loop controls to avoid recursion.
- [x] Add tests for dispatch decisions and re-entrancy safety.

### Phase 5: Capacity Controls, Observability, and Hardening
- [x] Add system setting default and admin update support docs.
- [x] Add project-scoped lock/idempotency protections.
- [x] Emit structured telemetry for dispatch attempts and outcomes.
- [ ] Add dashboard/board indicators for auto-dispatch activity (optional UI enhancement).
- [x] Add e2e test covering: dependency block -> unblocked -> auto-start.
- [x] **Server-side capacity gate in selected dispatch**: the historical API dispatch action was superseded by the Kanban-owned `kanban.dispatch_selected_work_items` boundary, which enforces `work_item_dispatch_max_active_per_project` at the execution boundary. Regardless of how many IDs the agent sends, only items up to the remaining capacity slots are started; the rest are skipped and reported back. This closes the trust-boundary gap where an LLM agent could ignore the `slots` prompt instruction.
- [x] **Hierarchical candidate filtering in dispatch coordinator**: `reconcileProject` now filters candidates through `filterHierarchyReadyCandidates` — tasks are only eligible when their parent story is active (`in-progress`/`in-review`/`ready-to-merge`/`done`), and stories are only eligible when their parent epic is active. Items without a parent pass through unchanged.

---

## 5. Acceptance Criteria

- [x] Work item dependencies can be created, updated, and queried via API.
- [x] Circular dependencies are rejected with clear validation errors.
- [x] A todo item with unsatisfied dependencies is never auto-dispatched.
- [x] Auto-dispatched item selection prefers higher priority items first.
- [x] Relevant markdown context files are attached automatically and visible in execution config.
- [x] In-progress automation receives and uses attached context files during execution.
- [x] The number of active items never exceeds configured capacity X.
- [x] Queue refill occurs from events (status/run changes) without manual intervention.
- [x] Dispatcher remains idempotent under duplicate/concurrent trigger events.
- [x] Unit, integration, and e2e tests pass for new behavior.

---

## 6. Dependencies

- EPIC-034 (Workflow-Driven Kanban Lifecycle) - status transition automation foundation.
- EPIC-037 (Spec-Driven Work Item Hydration) - source markdown metadata and hydration flow.
- EPIC-033 (Observability Correlation + Event Sourcing) - telemetry and run tracing support.

---

## 7. Risks & Mitigations

- **Risk:** Dispatch race conditions start too many items.
  - **Mitigation:** project-scoped lock + transactional re-check before status transition.
  - **Mitigation (added):** server-side capacity enforcement in selected dispatch re-checks `work_item_dispatch_max_active_per_project` and active item count before each dispatch batch, capping started items to remaining slots.

- **Risk:** Agent ignores slot limit in prompt and starts excessive items.
  - **Mitigation:** `kanban.dispatch_selected_work_items` enforces the cap server-side regardless of agent behavior. The agent is treated as untrusted at this boundary.

- **Risk:** Dependency graph validation adds query overhead.
  - **Mitigation:** index dependency table and keep cycle check bounded to project graph.

- **Risk:** Incorrect markdown auto-linking causes invalid context paths.
  - **Mitigation:** validate against repository file list, skip invalid paths with warnings.

- **Risk:** Agent-based prioritization introduces nondeterminism.
  - **Mitigation:** enforce deterministic fallback ranking and strict output schema.

---

## 8. Out of Scope (This Epic)

- Full critical-path scheduling/forecasting UI.
- Cross-project dependency links.
- Automatic reprioritization based on external product analytics.
